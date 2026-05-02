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
import { createConversation, sendMessage, finaliseStream, retryLastMessage } from '../../store/slices/chat';
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
  const [modelLoading, setModelLoading] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [searching, setSearching]     = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const droppedFilesRef = useRef(null);
  const [dropTick, setDropTick] = useState(0);
  const prevStreamingRef = useRef(false);

  /** Saved IPC payload and retry state for model-loading auto-retry */
  const retryPayloadRef  = useRef(null);
  const retryAttemptRef  = useRef(0);
  const retryTimerRef    = useRef(null);
  const fatalStreamErrorRef = useRef(false);
  const MAX_RETRY_ATTEMPTS = 12;  // ~96 s at 8 s intervals
  const RETRY_INTERVAL_MS  = 8_000;

  const activeConversation = conversations.find((c) => c.id === activeId);

  // Two-phase stream timeout:
  //   INITIAL — time allowed before the first token (model may be loading cold)
  //   PER_TOKEN — max silence between tokens once streaming has started
  const streamTimeoutRef = useRef(null);
  const INITIAL_STREAM_TIMEOUT_MS = 300_000; // 5 min — covers cold model load + web search startup
  const PER_TOKEN_STREAM_TIMEOUT_MS = 60_000; // 60 s between tokens once streaming begins

  // Reset to the shorter per-token timeout on each incoming token.
  useEffect(() => {
    function resetStreamTimeout() {
      if (!streamTimeoutRef.current) return;
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = setTimeout(() => {
        dispatch(finaliseStream());
        setStreamError('Ollama lost connection. Response may be incomplete.');
      }, PER_TOKEN_STREAM_TIMEOUT_MS);
    }

    window.electronAPI?.on('stream-token', resetStreamTimeout);
    window.electronAPI?.on('stream-thinking', resetStreamTimeout);

    function onStreamError(rawError) {
      fatalStreamErrorRef.current = true;
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      retryPayloadRef.current = null;
      retryAttemptRef.current = 0;
      setModelLoading(false);
      dispatch(finaliseStream());
      setStreamError(friendlyOllamaError(rawError));
    }
    window.electronAPI?.on('stream-error', onStreamError);
    // ChatPanel never unmounts during app lifetime, so listener cleanup is omitted.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear retry state when the user switches to a different conversation
  useEffect(() => {
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    retryPayloadRef.current = null;
    retryAttemptRef.current = 0;
    setModelLoading(false);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleRetry() {
    if (retryAttemptRef.current >= MAX_RETRY_ATTEMPTS || !retryPayloadRef.current) {
      setModelLoading(false);
      setStreamError('Ollama did not respond after loading. Please try again.');
      return;
    }
    setModelLoading(true);
    retryTimerRef.current = setTimeout(executeRetry, RETRY_INTERVAL_MS);
  }

  function executeRetry() {
    retryAttemptRef.current += 1;
    const payload = retryPayloadRef.current;
    if (!payload || !window.electronAPI) return;

    dispatch(retryLastMessage());
    window.electronAPI.sendChatMessage(payload);

    // Reset the initial timeout for this attempt
    clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => {
      dispatch(finaliseStream());
      setStreamError('Ollama lost connection. Response may be incomplete.');
    }, INITIAL_STREAM_TIMEOUT_MS);
  }

  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      // Stream just finished — clear any pending timeout
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;

      const conv = conversations.find((c) => c.id === activeId);
      if (conv) {
        const last = conv.messages[conv.messages.length - 1];
        if (last?.role === 'assistant' && !last.content.trim() && !last.thinking?.trim() && !fatalStreamErrorRef.current) {
          // Empty response — model is likely still loading into VRAM, auto-retry
          scheduleRetry();
        } else {
          // Successful response — clear any retry state
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          retryPayloadRef.current = null;
          retryAttemptRef.current = 0;
          setModelLoading(false);
        }
      }
    }
    prevStreamingRef.current = streaming;
  }, [streaming, conversations, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setModelLoading(false);
    fatalStreamErrorRef.current = false;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    retryAttemptRef.current = 0;
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

    // Build messages after web search so Ollama receives the enriched content
    const messages = [...existingMessages, { role: 'user', content: fullContent }];

    dispatch(sendMessage({ content: fullContent, attachments: displayAttachments, webSearchUsed }));
    setInput('');

    if (window.electronAPI) {
      // Only send think:true for toggle-thinking models (Qwen 3/3.5) via the user button.
      // Always-thinking models (gemma4, deepseek-r1) think natively in their output —
      // sending think:true to them causes Ollama to return HTTP 400.
      const effectiveThinkingMode = thinkingMode;

      const payload = {
        message: fullContent,
        model: selectedModel,
        conversationId: convId,
        messages,
        systemPrompt,
        contextWindow,
        thinkingMode: effectiveThinkingMode,
        images: imageAttachments,
      };

      // Save for model-loading auto-retry
      retryPayloadRef.current = payload;

      window.electronAPI.sendChatMessage(payload);
    }

    clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => {
      dispatch(finaliseStream());
      setStreamError('Ollama lost connection. Response may be incomplete.');
    }, INITIAL_STREAM_TIMEOUT_MS);
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
        {modelLoading && !streaming && (
          <p className="text-center text-xs text-accent/80 pb-2 px-4 animate-pulse">
            Loading model into memory… retrying automatically
          </p>
        )}
        {streamError && (
          <p className="text-center text-xs text-red-400/80 pb-2 px-4">{streamError}</p>
        )}
      </div>
    </div>
  );
}

function friendlyOllamaError(raw) {
  if (!raw) return 'Ollama returned an error.';
  if (raw.includes('unknown model architecture')) {
    return 'Ollama is out of date and cannot load this model. Go to Settings → System and update Ollama.';
  }
  if (raw.includes('unable to load model') || raw.includes('failed to load model')) {
    return `Failed to load model: ${raw}`;
  }
  if (raw.includes('out of memory') || raw.toLowerCase().includes('cuda out of memory') || raw.includes('CUDA error')) {
    return 'Not enough VRAM to load this model. Try a smaller model or free up VRAM.';
  }
  if (raw.includes('model not found') || raw.includes('pull model manifest')) {
    return `Model not found — try re-downloading it in Settings. (${raw})`;
  }
  return raw;
}

function BrainIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66Z" />
    </svg>
  );
}
