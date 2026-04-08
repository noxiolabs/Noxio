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
  const prevStreamingRef = useRef(false);

  const activeConversation = conversations.find((c) => c.id === activeId);

  // Stream timeout — if no stream-complete arrives within 60 s (e.g. Ollama crash),
  // force-finalise so the UI doesn't hang on "Generating…" indefinitely.
  const streamTimeoutRef = useRef(null);
  const STREAM_TIMEOUT_MS = 60_000;

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
        if (last?.role === 'assistant' && !last.content.trim()) {
          setStreamError('No response received. Ollama may still be loading the model — please try again in a moment.');
        }
      }
    }
    prevStreamingRef.current = streaming;
  }, [streaming, conversations, activeId]);

  function handleSend() {
    setStreamError('');
    const content = input.trim();
    if (!content || !selectedModel || streaming) return;

    // Resolve the conversation ID before any dispatch so it's stable for both
    // Redux and the IPC call. Pre-generating the ID here means we never rely on
    // reading stale selector values after a dispatch.
    let convId = activeId;
    if (!convId) {
      convId = nanoid();
      dispatch(createConversation({ id: convId, model: selectedModel }));
    }

    // Build messages array for Ollama BEFORE dispatching sendMessage, so the
    // snapshot only contains the confirmed history (no pending placeholder yet).
    const existingMessages = (activeConversation?.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages = [...existingMessages, { role: 'user', content }];

    // Add user message to Redux + create assistant placeholder
    dispatch(sendMessage({ content }));
    setInput('');

    // Send to main process — tokens come back via 'stream-token' IPC events.
    if (window.electronAPI) {
      window.electronAPI.sendChatMessage({
        message: content,
        model: selectedModel,
        conversationId: convId,
        messages,
        systemPrompt,
        contextWindow,
        thinkingMode,
      });
    }

    // Guard against a hung stream (Ollama crash, network drop, etc.)
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
    <div className="flex h-full overflow-hidden">
      <ConversationSidebar />

      {/* Chat area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 flex-shrink-0">
          <ModelSelector conversationId={activeId} />

          <div className="flex items-center gap-3">
            {/* Thinking mode toggle */}
            <button
              onClick={() => setThinkingMode((m) => !m)}
              title={thinkingMode ? 'Thinking mode on — click to disable' : 'Enable thinking mode (for DeepSeek R1, Qwen3, etc.)'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                thinkingMode
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-600/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
              }`}
            >
              <BrainIcon />
              <span>Think</span>
            </button>

            <div className="text-xs text-zinc-500">
              {streaming ? (
                <span className="text-violet-400 font-medium animate-pulse">Generating…</span>
              ) : activeConversation ? (
                `${activeConversation.messages.filter((m) => m.role === 'user').length} messages`
              ) : null}
            </div>
          </div>
        </div>

        {/* Full-width streaming progress bar */}
        {streaming && (
          <div className="h-0.5 w-full bg-zinc-800 flex-shrink-0">
            <div className="h-full bg-violet-500/70 animate-pulse w-full" />
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
