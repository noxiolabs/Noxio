/**
 * @file MessageList.jsx
 * @description Scrollable list of chat messages for the active conversation.
 * Auto-scrolls to the bottom when new tokens arrive during streaming.
 */

import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import MessageBubble from './MessageBubble';

export default function MessageList() {
  const conversations    = useSelector((s) => s.chat.conversations);
  const activeId         = useSelector((s) => s.chat.activeConversationId);
  const streaming        = useSelector((s) => s.chat.streaming);
  const streamingMsgId   = useSelector((s) => s.chat.streamingMessageId);
  const bottomRef        = useRef(null);

  const conversation = conversations.find((c) => c.id === activeId);
  const messages = conversation?.messages ?? [];

  // Auto-scroll to bottom while streaming and on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center select-none">
        <div className="w-10 h-10 rounded-full bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-violet-500/60" />
        </div>
        <p className="text-zinc-500 text-sm">Start a conversation</p>
        <p className="text-zinc-700 text-xs">Ask anything — it runs locally on your GPU</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isStreaming={streaming && msg.id === streamingMsgId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
