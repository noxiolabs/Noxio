/**
 * @file ChatInput.jsx
 * @description Chat message input area. Supports Enter to send and
 * Shift+Enter for newlines. Shows a stop button while the assistant is
 * streaming. Disabled when no model is selected or streaming is active
 * and the user hasn't hit stop.
 */

import React, { useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setForceCloud } from '../../store/slices/chat';

/**
 * @param {{
 *   value: string,
 *   onChange: (v: string) => void,
 *   onSend: () => void,
 *   onStop: () => void,
 * }} props
 */
export default function ChatInput({ value, onChange, onSend, onStop }) {
  const dispatch      = useDispatch();
  const streaming     = useSelector((s) => s.chat.streaming);
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const forceCloud    = useSelector((s) => s.chat.forceCloud);
  const cloudProviders = useSelector((s) => s.settings.cloudProviders);
  const textareaRef   = useRef(null);
  const prevStreamingRef = useRef(false);

  // Auto-focus the textarea when a stream finishes so the user can immediately
  // type their next message without clicking.
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      textareaRef.current?.focus();
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // Determine the first enabled cloud provider for the badge label
  const firstEnabledProvider = cloudProviders
    ? Object.entries(cloudProviders).find(([, cfg]) => cfg.enabled)?.[0] ?? null
    : null;
  const hasCloudProvider = Boolean(firstEnabledProvider);

  const providerLabel = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
  };

  function handleCloudToggle() {
    if (!hasCloudProvider) return;
    dispatch(setForceCloud(!forceCloud));
  }

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
          disabled={!selectedModel || streaming}
          rows={1}
          className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm resize-none outline-none leading-relaxed max-h-[200px] disabled:opacity-40"
        />

        {/* Cloud override toggle — only shown when not streaming */}
        {!streaming && (
          <div className="flex-shrink-0 pb-0.5">
            <button
              type="button"
              onClick={handleCloudToggle}
              disabled={!hasCloudProvider}
              title={
                !hasCloudProvider
                  ? 'No cloud provider configured — add one in Settings'
                  : forceCloud
                  ? `Cloud forced: ${providerLabel[firstEnabledProvider] ?? firstEnabledProvider} — click to disable`
                  : 'Use cloud for this message'
              }
              className={[
                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors relative',
                !hasCloudProvider
                  ? 'text-zinc-700 cursor-not-allowed'
                  : forceCloud
                  ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                  : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800',
              ].join(' ')}
            >
              {/* Inline SVG cloud icon */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
              {/* Active provider badge */}
              {forceCloud && firstEnabledProvider && (
                <span className="absolute -top-1.5 -right-1.5 text-[8px] leading-none px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {providerLabel[firstEnabledProvider]?.slice(0, 2).toUpperCase() ?? '?'}
                </span>
              )}
            </button>
          </div>
        )}

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
