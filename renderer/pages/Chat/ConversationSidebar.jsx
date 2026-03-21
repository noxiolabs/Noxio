/**
 * @file ConversationSidebar.jsx
 * @description Left column of the chat panel. Lists all conversations, lets
 * the user switch between them, create new ones, and delete old ones.
 * Active conversation is highlighted in violet.
 */

import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  createConversation,
  setActiveConversation,
  deleteConversation,
} from '../../store/slices/chat';

/** Relative date label — "Today", "Yesterday", or the date string. */
function relativeDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ConversationSidebar() {
  const dispatch       = useDispatch();
  const conversations  = useSelector((s) => s.chat.conversations);
  const activeId       = useSelector((s) => s.chat.activeConversationId);
  const selectedModel  = useSelector((s) => s.chat.selectedModel);
  const streaming      = useSelector((s) => s.chat.streaming);

  function handleNew() {
    dispatch(createConversation({ model: selectedModel }));
  }

  function handleDelete(e, id) {
    e.stopPropagation();
    dispatch(deleteConversation(id));
  }

  return (
    <div className="flex flex-col w-[220px] flex-shrink-0 border-r border-zinc-800/60 bg-[#0c0c0f]">
      {/* New chat button */}
      <div className="p-3 border-b border-zinc-800/60">
        <button
          onClick={handleNew}
          disabled={streaming}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 disabled:opacity-40 text-zinc-300 text-sm transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2">
        {conversations.length === 0 ? (
          <p className="text-center text-zinc-700 text-xs mt-6 px-3">No conversations yet</p>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => dispatch(setActiveConversation(conv.id))}
              className={`group w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors ${
                conv.id === activeId
                  ? 'bg-violet-600/15 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs truncate leading-snug">{conv.title}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{relativeDate(conv.createdAt)}</p>
              </div>

              {/* Delete button — visible on hover */}
              <button
                onClick={(e) => handleDelete(e, conv.id)}
                title="Delete"
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-red-400 transition-all"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
