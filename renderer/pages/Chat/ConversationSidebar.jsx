/**
 * @file ConversationSidebar.jsx
 * @description Left column of the chat panel. Lists all conversations, lets
 * the user switch between them, create new ones, and delete old ones.
 * Active conversation is highlighted in ice blue. Each conversation gets a
 * colored avatar circle showing the first letter of its title.
 * The sidebar is resizable by dragging its right edge.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  createConversation,
  setActiveConversation,
  deleteConversation,
} from '../../store/slices/chat';

const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 260;

/** Relative date label — "Today", "Yesterday", or the date string. */
function relativeDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Deterministic avatar color from a conversation id string.
 * Returns one of 8 distinct hue classes so adjacent conversations look varied.
 */
const AVATAR_COLORS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
];

function avatarColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function ConversationSidebar() {
  const dispatch       = useDispatch();
  const conversations  = useSelector((s) => s.chat.conversations);
  const activeId       = useSelector((s) => s.chat.activeConversationId);
  const selectedModel  = useSelector((s) => s.chat.selectedModel);
  const streaming      = useSelector((s) => s.chat.streaming);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const confirmTimerRef = useRef(null);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  // Auto-cancel pending delete confirm after 3 seconds
  useEffect(() => {
    if (confirmingDeleteId) {
      confirmTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
    }
    return () => clearTimeout(confirmTimerRef.current);
  }, [confirmingDeleteId]);

  // Global mouse move/up handlers for drag resize
  useEffect(() => {
    function onMouseMove(e) {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(next);
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  function handleDragStart(e) {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleNew() {
    dispatch(createConversation({ model: selectedModel }));
  }

  function handleDelete(e, id) {
    e.stopPropagation();
    if (confirmingDeleteId === id) {
      dispatch(deleteConversation(id));
      setConfirmingDeleteId(null);
    } else {
      setConfirmingDeleteId(id);
    }
  }

  return (
    <div
      className="flex flex-col flex-shrink-0 bg-panel relative"
      style={{ width }}
    >
      {/* Header + New chat button */}
      <div className="px-3 pt-3 pb-2.5 border-b border-stroke">
        <p className="text-[10px] font-semibold text-fg-dim uppercase tracking-wider mb-2 px-1">
          Conversations
        </p>
        <button
          onClick={handleNew}
          disabled={streaming}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-card/60 hover:bg-card disabled:opacity-40 text-fg text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {conversations.length === 0 ? (
          <p className="text-center text-fg-faint text-xs mt-8 px-3">No conversations yet</p>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeId;
            const initial = (conv.title ?? 'N').charAt(0).toUpperCase();
            const color = avatarColor(conv.id);

            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => dispatch(setActiveConversation(conv.id))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') dispatch(setActiveConversation(conv.id)); }}
                className={`group w-full flex items-center gap-2.5 px-2.5 py-2 mx-1 rounded-lg text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-accent/15 text-fg'
                    : 'text-fg-muted hover:bg-card/50 hover:text-fg'
                }`}
                style={{ width: 'calc(100% - 8px)' }}
              >
                {/* Avatar circle */}
                <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-[11px] font-semibold text-white leading-none">{initial}</span>
                </div>

                {/* Title + date */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate leading-snug">{conv.title}</p>
                  <p className="text-[10px] text-fg-dim mt-0.5">{relativeDate(conv.createdAt)}</p>
                </div>

                {/* Delete button — two-step confirm */}
                <button
                  onClick={(e) => handleDelete(e, conv.id)}
                  title={confirmingDeleteId === conv.id ? 'Click again to confirm' : 'Delete'}
                  className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all ${
                    confirmingDeleteId === conv.id
                      ? 'opacity-100 text-red-400'
                      : 'opacity-0 group-hover:opacity-100 text-fg-dim hover:text-red-400'
                  }`}
                >
                  {confirmingDeleteId === conv.id ? (
                    <span className="text-[9px] font-semibold leading-none">✕?</span>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize group/handle"
        onMouseDown={handleDragStart}
        onMouseEnter={() => setIsHoveringHandle(true)}
        onMouseLeave={() => setIsHoveringHandle(false)}
      >
        <div
          className="absolute inset-y-0 right-0 w-px transition-colors duration-150"
          style={{
            backgroundColor: isHoveringHandle
              ? 'rgb(var(--accent) / 0.6)'
              : 'rgb(var(--stroke))',
          }}
        />
      </div>
    </div>
  );
}
