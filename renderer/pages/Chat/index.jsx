/**
 * @file Chat/index.jsx
 * @description Main chat panel. Composes ConversationSidebar, MessageList,
 * ModelSelector, and ChatInput into the full chat layout.
 *
 * Layout:
 *   [ConversationSidebar 220px] | [Chat area flex-1]
 *                                   [Top bar: ModelSelector]
 *                                   [MessageList flex-1]
 *                                   [ChatInput]
 *
 * Message flow:
 *   1. User submits → sendMessage() dispatched (adds to Redux + creates assistant placeholder)
 *   2. Full messages array sent to main process via IPC
 *   3. 'stream-token' events → ipc-middleware → appendStreamToken()
 *   4. 'stream-complete' → finaliseStream() (auto-titles conversation)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { nanoid } from '@reduxjs/toolkit';
import { createConversation, sendMessage, finaliseStream } from '../../store/slices/chat';
import { supportsThinkingToggle, getModelMeta } from '../../utils/model-registry';
import ConversationSidebar from './ConversationSidebar';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import ModelSelector from './ModelSelector';

export default function ChatPanel() {
  const dispatch      = useDispatch();
  const conversations = useSelector((s) => s.chat.conversations);
  const activeId      = useSelector((s) => s.chat.activeConversationId);
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const streaming     = useSelector((s) => s.chat.streaming);
  const systemPrompt = useSelector((s) => s.settings.chat.systemPrompt);
  const contextWindow = useSelector((s) => s.settings.chat.contextWindow);
  const [input, setInput]             = useState('');
  const [streamError, setStreamError] = useState('');
  const [thinkingMode, setThinkingMode] = useState(false);
  const [searching, setSearching]     = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const droppedFilesRef = useRef(null);
  const [dropTick, setDropTick] = useState(0);
  const prevStreamingRef = useRef(false);

  const activeConversation = conversations.find((c) => c.id === activeId);

  // Stream timeout — if no stream-complete arrives within 60 s (e.g. Ollama crash),
  // force-finalise so the UI doesn't hang on "Generating…" indefinitely.
  const streamTimeoutRef = useRef(null);
  const STREAM_TIMEOUT_MS = 60_000;

  // Reset the stream timeout on each incoming token so long thinking phases
  // (e.g. gemma4, deepseek-r1) don't trigger the crash-detection timeout.
  useEffect(() => {
    function resetStreamTimeout() {
      if (!streamTimeoutRef.current) return; // Not streaming — nothing to reset
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = setTimeout(() => {
        dispatch(finaliseStream());
        setStreamError('Ollama lost connection. Response may be incomplete.');
      }, STREAM_TIMEOUT_MS);
    }

    window.electronAPI?.on('stream-token', resetStreamTimeout);
    window.electronAPI?.on('stream-thinking', resetStreamTimeout);
    // ChatPanel never unmounts during app lifetime, so listener cleanup is omitted.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      // Stream just finished — clear any pending timeout
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;

      // Detect empty assistant response: Ollama may have been loading the model
      // and returned an error before sending any tokens.
      const conv = conversations.find((c) => c.id === activeId);
      if (conv) {
        const last = conv.messages[conv.messages.length - 1];
        if (last?.role === 'assistant' && !last.content.trim() && !last.thinking?.trim()) {
          setStreamError('No response received. Ollama may still be loading the model — please try again in a moment.');
        }
      }
    }
    prevStreamingRef.current = streaming;
  }, [streaming, conversations, activeId]);

  // Auto-reset thinking mode when switching to a model that doesn't support toggle thinking.
  // Prevents stale thinkingMode: true from persisting on non-Qwen models.
  useEffect(() => {
    if (!supportsThinkingToggle(selectedModel)) {
      setThinkingMode(false);
    }
  }, [selectedModel]);

  function buildSearchContext(query, searchResult, originalContent) {
    const lines = [`[Web search: "${query}"]`];

    (searchResult.results ?? []).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title}${r.snippet ? ` \u2014 ${r.snippet}` : ''}`);
      if (r.url) lines.push(`   Source: ${r.url}`);
    });

    lines.push('---', '', originalContent);
    return lines.join('\n');
  }

  async function handleSend(attachments = [], webSearchEnabled = false) {
    setStreamError('');
    const content = input.trim();
    if ((!content && attachments.length === 0) || !selectedModel || streaming) return;

    let convId = activeId;
    if (!convId) {
      convId = nanoid();
      dispatch(createConversation({ id: convId, model: selectedModel }));
    }

    // Process attachments: extract text/pdf inline, collect image base64
    let fullContent = content;
    const imageAttachments = [];
    const displayAttachments = [];

    for (const att of attachments) {
      displayAttachments.push({ name: att.name, type: att.type });

      if (att.type === 'image') {
        // Strip data URL prefix to get raw base64
        const base64 = att.content.includes(',') ? att.content.split(',')[1] : att.content;
        if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
          setStreamError(`Invalid image data for "${att.name}". Please try again.`);
          return;
        }
        imageAttachments.push(base64);
      } else if (att.type === 'pdf') {
        // Send ArrayBuffer to main for text extraction
        try {
          const buffer = Array.from(new Uint8Array(att.content));
          const result = await window.electronAPI.extractPdfText(buffer);
          if (result?.text) {
            fullContent = `[Attached: ${att.name}]\n${result.text}\n---\n${fullContent}`;
          } else if (result?.error) {
            setStreamError(`Could not read PDF "${att.name}": ${result.error}`);
            return;
          }
        } catch (err) {
          setStreamError(`Could not read PDF "${att.name}": ${err.message}`);
          return;
        }
      } else {
        // text / md — inject directly
        fullContent = `[Attached: ${att.name}]\n${att.content}\n---\n${fullContent}`;
      }
    }

    const existingMessages = (activeConversation?.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages = [...existingMessages, { role: 'user', content: fullContent }];

    // Web search: fetch results and prepend context if enabled
    let webSearchUsed = false;
    if (webSearchEnabled && content.trim() && window.electronAPI?.searchWeb) {
      setSearching(true);
      try {
        const searchResult = await window.electronAPI.searchWeb(content);
        if (!searchResult.error && searchResult.results?.length) {
          fullContent = buildSearchContext(content, searchResult, fullContent);
          webSearchUsed = true;
        } else if (searchResult.error) {
          setStreamError(`Web search failed: ${searchResult.error} — sending without search context`);
        }
      } catch (err) {
        setStreamError(`Web search error: ${err.message} — sending without search context`);
      } finally {
        setSearching(false);
      }
    }

    dispatch(sendMessage({ content: fullContent, attachments: displayAttachments, webSearchUsed }));
    setInput('');

    if (window.electronAPI) {
      // Always-thinking models (gemma4, deepseek-r1) need think:true unconditionally.
      // Toggle-thinking models (qwen3) use the user-controlled thinkingMode button.
      const effectiveThinkingMode =
        thinkingMode || getModelMeta(selectedModel)?.supportsThinking === 'always';

      window.electronAPI.sendChatMessage({
        message: fullContent,
        model: selectedModel,
        conversationId: convId,
        messages,
        systemPrompt,
        contextWindow,
        thinkingMode: effectiveThinkingMode,
        images: imageAttachments,
      });
    }

    clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => {
      dispatch(finaliseStream());
      setStreamError('Ollama lost connection. Response may be incomplete.');
    }, STREAM_TIMEOUT_MS);
  }

  function handleStop() {
    if (window.electronAPI) {
      window.electronAPI.stopStream();
    }
  }

  return (
    <div
      className="flex h-full overflow-hidden relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          droppedFilesRef.current = e.dataTransfer.files;
          setDropTick((t) => t + 1);
        }
      }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-panel/80 border-2 border-dashed border-accent/60 rounded-xl pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-2">📎</div>
            <p className="text-accent font-medium text-sm">Drop files here</p>
            <p className="text-fg-dim text-xs mt-1">Images, PDF, TXT, MD</p>
          </div>
        </div>
      )}
      <ConversationSidebar />

      {/* Chat area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-stroke flex-shrink-0 min-h-[48px]">
          {/* Conversation title — primary label */}
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-fg truncate leading-tight">
              {activeConversation?.title ?? 'New conversation'}
            </h1>
            {activeConversation && (
              <p className="text-[10px] text-fg-dim leading-tight mt-0.5">
                {activeConversation.messages.filter((m) => m.role === 'user').length} messages
              </p>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Thinking mode toggle — only for models with toggleable thinking (Qwen 3/3.5) */}
            {supportsThinkingToggle(selectedModel) && (
              <button
                onClick={() => setThinkingMode((m) => !m)}
                title={thinkingMode ? 'Thinking mode on — click to disable' : 'Enable thinking mode'}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                  thinkingMode
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'text-fg-dim hover:text-fg hover:bg-card/60 border border-transparent'
                }`}
              >
                <BrainIcon />
                <span>Think</span>
              </button>
            )}

            {streaming && (
              <span className="text-xs text-accent font-medium animate-pulse">Generating…</span>
            )}

            <ModelSelector conversationId={activeId} />
          </div>
        </div>

        {/* Full-width streaming progress bar */}
        {streaming && (
          <div className="h-0.5 w-full bg-card flex-shrink-0">
            <div className="h-full bg-accent/70 animate-pulse w-full" />
          </div>
        )}

        {/* Messages */}
        <MessageList />

        {/* Input */}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          droppedFiles={droppedFilesRef.current}
          dropTick={dropTick}
          searching={searching}
        />
        {streamError && (
          <p className="text-center text-xs text-red-400/80 pb-2 px-4">{streamError}</p>
        )}
      </div>
    </div>
  );
}

function BrainIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66Z" />
    </svg>
  );
}
