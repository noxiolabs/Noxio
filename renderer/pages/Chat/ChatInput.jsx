/**
 * @file ChatInput.jsx
 * @description Chat message input area. Supports Enter to send and
 * Shift+Enter for newlines. Shows a stop button while the assistant is
 * streaming. Disabled when no model is selected or streaming is active
 * and the user hasn't hit stop.
 */

import React, { useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';

/**
 * @param {{
 *   value: string,
 *   onChange: (v: string) => void,
 *   onSend: () => void,
 *   onStop: () => void,
 * }} props
 */
export default function ChatInput({ value, onChange, onSend, onStop }) {
  const streaming     = useSelector((s) => s.chat.streaming);
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const textareaRef   = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && value.trim() && selectedModel) onSend();
    }
  }

  const canSend = !streaming && value.trim().length > 0 && !!selectedModel;

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="flex items-end gap-2 bg-zinc-900/80 border border-zinc-700/60 rounded-xl p-3 focus-within:border-zinc-600 transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedModel ? 'Message…' : 'Select a model to start chatting'}
          disabled={!selectedModel}
          rows={1}
          className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm resize-none outline-none leading-relaxed max-h-[200px] disabled:opacity-40"
        />

        <div className="flex-shrink-0 pb-0.5">
          {streaming ? (
            <button
              onClick={onStop}
              title="Stop generating"
              className="w-8 h-8 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend}
              title="Send (Enter)"
              className="w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <p className="text-center text-[10px] text-zinc-700 mt-1.5">
        Shift+Enter for new line · runs locally on your GPU
      </p>
    </div>
  );
}
