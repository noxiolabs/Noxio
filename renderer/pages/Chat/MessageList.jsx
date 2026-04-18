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
  const containerRef     = useRef(null);

  const conversation = conversations.find((c) => c.id === activeId);
  const messages = conversation?.messages ?? [];

  // Track the length of the currently streaming message so the scroll effect
  // fires on every new token, not just when messages.length changes.
  const streamingContentLength = useSelector((s) => {
    if (!s.chat.streamingMessageId) return 0;
    const conv = s.chat.conversations.find((c) => c.id === s.chat.activeConversationId);
    const msg = conv?.messages.find((m) => m.id === s.chat.streamingMessageId);
    return msg?.content?.length ?? 0;
  });

  // Scroll to bottom on new messages (smooth) and on every streaming token (instant).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming, streamingContentLength]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center select-none">
        <div className="w-10 h-10 rounded-full bg-card/60 border border-stroke/50 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-accent/60" />
        </div>
        <p className="text-fg-dim text-sm">Start a conversation</p>
        <p className="text-fg-faint text-xs">Ask anything — it runs locally on your GPU</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isStreaming={streaming && msg.id === streamingMsgId}
        />
      ))}
    </div>
  );
}
