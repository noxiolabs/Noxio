/**
 * @file ModelsScreen.jsx
 * @description Setup wizard — Screen 4. Fetches VRAM-aware model recommendations
 * via IPC and displays them with download sizes. Users can swap the recommended
 * model for any alternative that fits in their VRAM via a per-capability dropdown.
 * Shows total download size that updates live as the user makes selections.
 */

import React, { useEffect, useState } from 'react';

const CAP_LABELS = {
  chat: 'Chat',
  coding: 'Code',
  image: 'Images',
  voice: 'Voice',
};

/**
 * Derives the size in GB for the currently selected model within a capability entry.
 * For voice the size is always the fixed bundle size on the rec object.
 * For other capabilities the selection is compared against the recommendation and
 * each alternative to find the matching sizeGB.
 *
 * @param {Object} rec   - Capability recommendation object from IPC.
 * @param {string} selected - Currently selected model name.
 * @returns {number|null}
 */
function resolveSelectedSize(rec, selected) {
  if (!selected) return rec.sizeGB ?? null;
  if (rec.model === selected) return rec.sizeGB ?? null;
  if (Array.isArray(rec.alternatives)) {
    const alt = rec.alternatives.find((a) => a.model === selected);
    if (alt) return alt.sizeGB ?? null;
  }
  return rec.sizeGB ?? null;
}

/**
 * @param {{
 *   capabilities: string[],
 *   recommendations: Object|null,
 *   onRecommendations: (recs: Object) => void,
 *   models: Object,
 *   onModels: (models: { [capability: string]: string }) => void,
 *   onNext: () => void,
 *   onBack: () => void,
 *   installDir: string|null,
 * }} props
 */
export default function ModelsScreen({
  capabilities,
  recommendations,
  onRecommendations,
  onModels,
  onNext,
  onBack,
  installDir = null,
}) {
  const [recs, setRecs] = useState(recommendations);
  const [loading, setLoading] = useState(!recommendations);

  /**
   * Per-capability user selection. Keys are capability names, values are model name
   * strings. Defaults to the recommended model for each capability; updated when the
   * user picks a different option from the dropdown.
   * @type {[Object, Function]}
   */
  const [selections, setSelections] = useState(() => {
    if (!recommendations) return {};
    const defaults = {};
    Object.entries(recommendations).forEach(([cap, rec]) => {
      if (rec.model) defaults[cap] = rec.model;
    });
    return defaults;
  });

  useEffect(() => {
    if (recommendations) return;

    async function fetchRecs() {
      try {
        const result = await window.electronAPI.getModelRecommendations(capabilities);
        setRecs(result);
        onRecommendations(result);

        const defaults = {};
        Object.entries(result).forEach(([cap, rec]) => {
          if (rec.model) defaults[cap] = rec.model;
        });
        setSelections(defaults);
        onModels(defaults);
      } finally {
        setLoading(false);
      }
    }

    fetchRecs();
  }, [capabilities, recommendations, onRecommendations, onModels]);

  /**
   * Handles the user selecting a different model from the dropdown for a given
   * capability. Updates local selection state and propagates via onModels.
   *
   * @param {string} cap - Capability key (e.g. 'chat', 'coding', 'image').
   * @param {string} model - Newly selected model name.
   */
  function handleModelChange(cap, model) {
    const updated = { ...selections, [cap]: model };
    setSelections(updated);
    onModels(updated);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm">Loading recommendations...</p>
      </div>
    );
  }

  // Total size is computed from the currently selected model per capability,
  // not just the default recommendation, so it updates as the user swaps.
  const totalSizeGB = recs
    ? Object.entries(recs)
        .filter(([, r]) => r.sizeGB || (Array.isArray(r.alternatives) && r.alternatives.length))
        .reduce((sum, [cap, r]) => {
          const size = resolveSelectedSize(r, selections[cap]);
          return sum + (size ?? 0);
        }, 0)
        .toFixed(1)
    : null;

  const downloadableCount = recs
    ? Object.values(recs).filter((r) => r.model).length
    : 0;

  return (
    <div className="flex flex-col items-center h-full gap-8 px-8 overflow-y-auto py-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">Recommended Models</h2>
        <p className="mt-1 text-zinc-500 text-sm">
          Based on your hardware. Swap to a lighter model if needed.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        {recs &&
          Object.entries(recs).map(([cap, rec]) => {
            const selectedModel = selections[cap] ?? rec.model;
            const selectedSize = resolveSelectedSize(rec, selectedModel);
            const hasAlternatives = Array.isArray(rec.alternatives) && rec.alternatives.length > 0;

            return (
              <div key={cap} className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
                {/* Capability label row */}
                <p className="text-xs text-zinc-600 uppercase tracking-wide mb-2">
                  {CAP_LABELS[cap] ?? cap}
                </p>

                {rec.model ? (
                  <div className="flex items-center justify-between gap-3">
                    {hasAlternatives ? (
                      /* Swap dropdown — shown when alternatives are available */
                      <select
                        value={selectedModel}
                        onChange={(e) => handleModelChange(cap, e.target.value)}
                        className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm font-medium rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-600 focus:border-violet-600 truncate"
                        aria-label={`Select model for ${CAP_LABELS[cap] ?? cap}`}
                      >
                        {/* Recommended model is always first in the list */}
                        <option value={rec.model}>{rec.model} (recommended)</option>
                        {rec.alternatives.map((alt) => (
                          <option key={alt.model} value={alt.model}>
                            {alt.model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      /* No alternatives available — show static text */
                      <p className="text-sm font-medium text-zinc-100 truncate flex-1 min-w-0">
                        {selectedModel}
                      </p>
                    )}

                    {selectedSize != null && (
                      <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded flex-shrink-0">
                        {selectedSize} GB
                      </span>
                    )}
                  </div>
                ) : rec.stt ? (
                  /* Voice capability — fixed bundle, no swap */
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-violet-400">Runs locally</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {rec.stt} + {rec.tts}
                      </p>
                    </div>
                    {rec.sizeGB && (
                      <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded flex-shrink-0">
                        {rec.sizeGB} GB
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-600">Cloud API recommended</p>
                )}
              </div>
            );
          })}

        {totalSizeGB && (
          <div className="flex justify-between text-xs text-zinc-500 px-1 pt-1">
            <span>Total download</span>
            <span className="text-zinc-300 font-medium">{totalSizeGB} GB</span>
          </div>
        )}
      </div>

      {installDir ? (
        <p className="text-xs text-zinc-500 text-center">
          Files will be stored in:{' '}
          <span className="text-zinc-400 font-mono">{installDir}</span>
        </p>
      ) : (
        <p className="text-xs text-red-400 text-center">
          No install location selected — go back and choose one.
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-sm transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={downloadableCount === 0 || installDir === null}
          className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Download & Install →
        </button>
      </div>
    </div>
  );
}
