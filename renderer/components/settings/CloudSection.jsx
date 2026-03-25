/**
 * @file CloudSection.jsx
 * @description Settings section for cloud API provider configuration. Allows
 * the user to set API keys, toggle providers on/off, and set monthly budget
 * caps per provider. Keys are never stored in Redux after saving — only the
 * masked form is retained for display.
 */

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateCloudProvider, updateCloudUsage, setCloudApiKeySet } from '../../store/slices/settings';

/**
 * Per-provider metadata: display label, model hint, plain-English key
 * explanation, and the URL where the user can generate an API key.
 */
const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-4o, GPT-4o mini',
    keyExplanation: "An API key is a password that lets Noxio use OpenAI's AI online when needed.",
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    hint: 'Claude Opus, Sonnet, Haiku',
    keyExplanation: "An API key is a password that lets Noxio use Anthropic's AI online when needed.",
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google',
    hint: 'Gemini 2.0 Flash, 2.5 Pro',
    keyExplanation: "An API key is a password that lets Noxio use Google's AI online when needed.",
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
];

/**
 * Shows the provider's API key URL as copyable text.
 * Used in place of a clickable link because openExternal is not exposed
 * in the preload bridge.
 *
 * @param {{ url: string }} props
 */
function ApiKeyUrlDisplay({ url }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex items-center gap-2 mt-0.5">
      <span className="text-xs text-zinc-500 truncate max-w-xs">{url}</span>
      <button
        onClick={handleCopy}
        className="text-xs text-violet-400 hover:text-violet-300 flex-shrink-0"
      >
        {copied ? 'Copied!' : 'Copy link →'}
      </button>
    </div>
  );
}

/**
 * Single provider card component.
 *
 * @param {{ providerId: string, label: string, hint: string, keyExplanation: string, keyUrl: string }} props
 */
function ProviderCard({ providerId, label, hint, keyExplanation, keyUrl }) {
  const dispatch  = useDispatch();
  const provider  = useSelector((s) => s.settings.cloudProviders[providerId]);

  const [apiKey,       setApiKey]       = useState('');
  const [editMode,     setEditMode]     = useState(false);
  const [budget,       setBudget]       = useState(String(provider.monthlyBudgetUSD ?? 0));
  const [enabled,      setEnabled]      = useState(provider.enabled);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [error,        setError]        = useState('');
  const [usage,        setUsage]        = useState(provider.usedUSD ?? 0);
  const [verifying,    setVerifying]    = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  // State A: key is set and not in edit mode
  const showMasked = provider.apiKeySet && !editMode;

  useEffect(() => {
    setEnabled(provider.apiKeySet ? provider.enabled : false);
    setBudget(String(provider.monthlyBudgetUSD ?? 0));
    setUsage(provider.usedUSD ?? 0);
  }, [provider.enabled, provider.monthlyBudgetUSD, provider.usedUSD, provider.apiKeySet]);

  function handleKeyChange(e) {
    setApiKey(e.target.value);
    // Clear verification result when the user starts typing a new key
    if (verifyResult !== null) setVerifyResult(null);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    setVerifyResult(null);
    const keyToVerify = apiKey.trim();
    try {
      const result = await window.electronAPI?.saveCloudProvider({
        provider: providerId,
        apiKey: keyToVerify || undefined,
        enabled,
        monthlyBudgetUSD: Number(budget) || 0,
      });
      dispatch(updateCloudProvider({
        provider: providerId,
        config: { enabled, monthlyBudgetUSD: Number(budget) || 0 },
      }));
      if (result?.apiKeySet !== undefined) {
        dispatch(setCloudApiKeySet({
          provider: providerId,
          apiKeySet: result.apiKeySet,
          apiKeyMasked: result.apiKeyMasked ?? '',
        }));
      }
      setApiKey('');
      setEditMode(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      // Trigger verification if a new key was entered
      if (keyToVerify.length > 0) {
        setVerifying(true);
        const vResult = await window.electronAPI?.verifyCloudProvider({
          provider: providerId,
          apiKey: keyToVerify,
        });
        setVerifying(false);
        setVerifyResult(vResult ?? { valid: false, error: 'No response from verifier' });
      }
    } catch (err) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const budgetPct = provider.monthlyBudgetUSD > 0
    ? Math.min(100, Math.round((usage / provider.monthlyBudgetUSD) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-zinc-800 border border-zinc-700/60">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-white">{label}</span>
          <span className="ml-2 text-xs text-zinc-500">{hint}</span>
        </div>
        {/* Enabled toggle — disabled until a verified API key is set */}
        <div className="relative group">
          <button
            role="switch"
            aria-checked={enabled}
            disabled={!provider.apiKeySet}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              !provider.apiKeySet
                ? 'bg-zinc-700 opacity-40 cursor-not-allowed'
                : enabled ? 'bg-violet-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          {!provider.apiKeySet && (
            <div className="absolute right-0 top-7 z-10 hidden group-hover:block w-48 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-zinc-400 shadow-lg">
              Add and verify an API key first
            </div>
          )}
        </div>
      </div>

      {/* API key guidance */}
      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-zinc-500">{keyExplanation}</p>
        <ApiKeyUrlDisplay url={keyUrl} />
      </div>

      {/* API key input — two-state pattern */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">API Key</label>
        {showMasked ? (
          /* State A: key is set, not in edit mode — show masked value + Edit button */
          <div className="flex items-center gap-2">
            <input
              type="password"
              value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
              disabled
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-400 opacity-60 cursor-not-allowed"
            />
            {provider.apiKeyMasked && (
              <span className="text-xs text-zinc-500 flex-shrink-0">{provider.apiKeyMasked}</span>
            )}
            <button
              onClick={() => setEditMode(true)}
              className="text-xs text-violet-400 hover:text-violet-300 flex-shrink-0"
            >
              Edit
            </button>
          </div>
        ) : (
          /* State B: key not set, or user clicked Edit — show editable input */
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={handleKeyChange}
              placeholder="Enter API key"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
            />
            {editMode && (
              <button
                onClick={() => { setEditMode(false); setApiKey(''); setVerifyResult(null); }}
                className="text-xs text-zinc-400 hover:text-zinc-300 flex-shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {/* Budget input */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">Monthly budget (USD)</label>
        <input
          type="number"
          min="0"
          step="1"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 w-36"
        />
      </div>

      {/* Usage bar */}
      {provider.monthlyBudgetUSD > 0 && (
        <div>
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Used this month</span>
            <span>${usage.toFixed(2)} / ${provider.monthlyBudgetUSD}</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                budgetPct >= 90 ? 'bg-red-500' : budgetPct >= 70 ? 'bg-amber-500' : 'bg-violet-500'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Save button + feedback row */}
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving || verifying}
          className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !verifying && !verifyResult && (
          <span className="text-xs text-emerald-400">Saved</span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
        {verifying && (
          <span className="text-xs text-zinc-400">Verifying…</span>
        )}
        {!verifying && verifyResult && verifyResult.valid && (
          <span className="text-xs text-emerald-400">&#10003; Key verified</span>
        )}
        {!verifying && verifyResult && !verifyResult.valid && (
          <span className="text-xs text-red-400">&#10007; {verifyResult.error ?? 'Key invalid'}</span>
        )}
      </div>
    </div>
  );
}

/**
 * @returns {JSX.Element}
 */
export default function CloudSection() {
  const dispatch = useDispatch();

  // Refresh usage data from the main process on mount
  useEffect(() => {
    async function fetchUsage() {
      const usage = await window.electronAPI?.getCloudUsage();
      if (!usage) return;
      ['openai', 'anthropic', 'google'].forEach((provider) => {
        if (usage[provider] != null) {
          dispatch(updateCloudUsage({ provider, usedUSD: usage[provider] }));
        }
      });
    }
    fetchUsage();
  }, [dispatch]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Cloud Providers</h2>
        <p className="text-xs text-zinc-500">
          Add API keys to enable cloud model fallback. Budget caps are checked before
          each cloud request. Full enforcement requires cloud routing to be active.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {PROVIDERS.map(({ id, label, hint, keyExplanation, keyUrl }) => (
          <ProviderCard
            key={id}
            providerId={id}
            label={label}
            hint={hint}
            keyExplanation={keyExplanation}
            keyUrl={keyUrl}
          />
        ))}
      </div>
    </div>
  );
}
