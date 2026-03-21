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

import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createConversation, sendMessage } from '../../store/slices/chat';
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
  const [input, setInput]   = useState('');

  const activeConversation = conversations.find((c) => c.id === activeId);

  function handleSend() {
    const content = input.trim();
    if (!content || !selectedModel || streaming) return;

    // Ensure there's an active conversation
    let convId = activeId;
    if (!convId) {
      dispatch(createConversation({ model: selectedModel }));
      // After createConversation the store updates — re-read activeId on next render.
      // We capture convId from the action result is not straightforward, so we use
      // a workaround: rely on the next sendMessage finding the new activeConversationId.
    }

    // Add user message to Redux + create assistant placeholder
    dispatch(sendMessage({ content }));
    setInput('');

    // Build messages array for Ollama (all messages in conversation + new user msg)
    const existingMessages = (activeConversation?.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages = [...existingMessages, { role: 'user', content }];

    // Send to main process — tokens come back via 'stream-token' IPC events
    if (window.electronAPI) {
      window.electronAPI.sendChatMessage(messages, selectedModel, convId ?? activeId);
    }
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
          <div className="text-[10px] text-zinc-700">
            {streaming ? (
              <span className="text-violet-400 animate-pulse">Generating…</span>
            ) : activeConversation ? (
              `${activeConversation.messages.filter((m) => m.role === 'user').length} messages`
            ) : null}
          </div>
        </div>

        {/* Messages */}
        <MessageList />

        {/* Input */}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
        />
      </div>
    </div>
  );
}
