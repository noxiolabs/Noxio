/**
 * @file ChatSection.jsx
 * @description Settings section for chat behaviour. Lets the user configure the
 * Ollama context window size (num_ctx) and an optional system prompt prepended
 * to every conversation.
 */

import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateChatSettings } from '../../store/slices/settings';

const MIN_CTX   = 512;
const MAX_CTX   = 32768;
const STEP_CTX  = 512;
const WARN_CTX  = 8192;

/**
 * @returns {JSX.Element}
 */
export default function ChatSection() {
  const dispatch  = useDispatch();
  const chat      = useSelector((s) => s.settings.chat);
  const [ctx,     setCtx]     = useState(chat.contextWindow);
  const [prompt,  setPrompt]  = useState(chat.systemPrompt);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');

  function handleCtxChange(e) {
    const value = Number(e.target.value);
    if (!isNaN(value)) setCtx(value);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    const contextWindow = Math.max(MIN_CTX, Math.min(MAX_CTX, Number(ctx) || 4096));
    const systemPrompt  = prompt.trim();
    try {
      await window.electronAPI?.saveChatSettings(contextWindow, systemPrompt);
      dispatch(updateChatSettings({ contextWindow, systemPrompt }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Chat Settings</h2>
        <p className="text-xs text-zinc-500">
          Configure context window size and an optional system prompt for all conversations.
        </p>
      </div>

      {/* Context window */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-300">Context window</label>
          <span className="text-sm font-mono text-violet-400">{ctx.toLocaleString()} tokens</span>
        </div>
        <input
          type="range"
          min={MIN_CTX}
          max={MAX_CTX}
          step={STEP_CTX}
          value={ctx}
          onChange={handleCtxChange}
          className="w-full accent-violet-500"
        />
        <div className="flex justify-between text-xs text-zinc-600">
          <span>{MIN_CTX.toLocaleString()}</span>
          <span>{MAX_CTX.toLocaleString()}</span>
        </div>
        {ctx > WARN_CTX && (
          <p className="text-xs text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
            Higher context uses more VRAM. Values above 8,192 may cause out-of-memory
            errors on 16 GB GPUs depending on model size.
          </p>
        )}
        <p className="text-xs text-zinc-600">
          Default: 4,096. This value is passed as <code className="text-zinc-400">num_ctx</code> to Ollama.
        </p>
      </div>

      {/* System prompt */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-300">System prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="Leave empty for default behaviour"
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 resize-none"
        />
        <p className="text-xs text-zinc-600">
          Prepended as a system message at the start of every conversation.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
