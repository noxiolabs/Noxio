/**
 * @file ChatSection.jsx
 * @description Settings section for chat behaviour. Lets the user configure the
 * Ollama context window size (num_ctx), an optional system prompt, and the
 * inference provider (Ollama or any OpenAI-compatible endpoint like LM Studio).
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
  const [ctx,            setCtx]            = useState(chat.contextWindow);
  const [prompt,         setPrompt]         = useState(chat.systemPrompt);
  const [provider,       setProvider]       = useState(chat.provider ?? 'ollama');
  const [customEndpoint, setCustomEndpoint] = useState(chat.customEndpoint ?? 'http://localhost:1234');
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
    const contextWindow  = Math.max(MIN_CTX, Math.min(MAX_CTX, Number(ctx) || 4096));
    const systemPrompt   = prompt.trim();
    const endpoint       = customEndpoint.trim() || 'http://localhost:1234';
    try {
      await window.electronAPI?.saveChatSettings(contextWindow, systemPrompt, provider, endpoint);
      dispatch(updateChatSettings({ contextWindow, systemPrompt, provider, customEndpoint: endpoint }));
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
        <h2 className="text-base font-semibold text-fg mb-1">Chat Settings</h2>
        <p className="text-xs text-fg-dim">
          Configure the inference provider, context window, and an optional system prompt.
        </p>
      </div>

      {/* Provider selection */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-fg">Inference provider</label>
        <div className="flex gap-2">
          <button
            onClick={() => setProvider('ollama')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
              provider === 'ollama'
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-card border-stroke text-fg-dim hover:text-fg hover:border-fg-dim'
            }`}
          >
            Ollama (local)
          </button>
          <button
            onClick={() => setProvider('custom')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
              provider === 'custom'
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-card border-stroke text-fg-dim hover:text-fg hover:border-fg-dim'
            }`}
          >
            Custom endpoint
          </button>
        </div>
        {provider === 'custom' && (
          <div className="flex flex-col gap-1.5 mt-1">
            <label className="text-xs text-fg-dim">Base URL</label>
            <input
              type="text"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              placeholder="http://localhost:1234"
              className="bg-card border border-stroke rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent font-mono"
            />
            <p className="text-xs text-fg-faint">
              Compatible with LM Studio, Jan, Ollama's OpenAI layer, and any server that implements <code className="text-fg-dim">/v1/chat/completions</code>.
            </p>
          </div>
        )}
      </div>

      {/* Context window — only relevant for Ollama */}
      {provider === 'ollama' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-fg">Context window</label>
            <span className="text-sm font-mono text-accent">{ctx.toLocaleString()} tokens</span>
          </div>
          <input
            type="range"
            min={MIN_CTX}
            max={MAX_CTX}
            step={STEP_CTX}
            value={ctx}
            onChange={handleCtxChange}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-fg-faint">
            <span>{MIN_CTX.toLocaleString()}</span>
            <span>{MAX_CTX.toLocaleString()}</span>
          </div>
          {ctx > WARN_CTX && (
            <p className="text-xs text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
              Higher context uses more VRAM. Values above 8,192 may cause out-of-memory
              errors on 16 GB GPUs depending on model size.
            </p>
          )}
          <p className="text-xs text-fg-faint">
            Default: 4,096. This value is passed as <code className="text-fg-dim">num_ctx</code> to Ollama.
          </p>
        </div>
      )}

      {/* System prompt */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-fg">System prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="Leave empty for default behaviour"
          className="bg-card border border-stroke rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent resize-none"
        />
        <p className="text-xs text-fg-faint">
          Prepended as a system message at the start of every conversation.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
