/**
 * @file ModelsScreen.jsx
 * @description Setup wizard — Screen 4. Fetches VRAM-aware model recommendations
 * via IPC and displays them with download sizes. Shows total download size.
 * Users can see what will be downloaded before confirming.
 */

import React, { useEffect, useState } from 'react';

const CAP_LABELS = {
  chat: 'Chat',
  coding: 'Code',
  image: 'Images',
  voice: 'Voice',
};

/**
 * @param {{
 *   capabilities: string[],
 *   recommendations: Object|null,
 *   onRecommendations: (recs: Object) => void,
 *   models: Object,
 *   onModels: (models: Object) => void,
 *   onNext: () => void,
 *   onBack: () => void,
 * }} props
 */
export default function ModelsScreen({
  capabilities,
  recommendations,
  onRecommendations,
  onModels,
  onNext,
  onBack,
}) {
  const [recs, setRecs] = useState(recommendations);
  const [loading, setLoading] = useState(!recommendations);

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
        onModels(defaults);
      } finally {
        setLoading(false);
      }
    }

    fetchRecs();
  }, [capabilities, recommendations, onRecommendations, onModels]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm">Loading recommendations...</p>
      </div>
    );
  }

  const totalSizeGB = recs
    ? Object.values(recs)
        .filter((r) => r.sizeGB)
        .reduce((sum, r) => sum + r.sizeGB, 0)
        .toFixed(1)
    : null;

  const downloadableCount = recs
    ? Object.values(recs).filter((r) => r.model).length
    : 0;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">Recommended Models</h2>
        <p className="mt-1 text-zinc-500 text-sm">
          Based on your hardware. You can swap models in Settings later.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        {recs &&
          Object.entries(recs).map(([cap, rec]) => (
            <div key={cap} className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-600 uppercase tracking-wide mb-1">
                    {CAP_LABELS[cap] ?? cap}
                  </p>
                  {rec.model ? (
                    <p className="text-sm font-medium text-zinc-100 truncate">{rec.model}</p>
                  ) : (
                    <p className="text-sm text-zinc-600">Cloud API recommended</p>
                  )}
                  {rec.stt && (
                    <p className="text-xs text-zinc-500 mt-1">
                      {rec.stt} + {rec.tts}
                    </p>
                  )}
                </div>
                {rec.sizeGB && (
                  <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded flex-shrink-0">
                    {rec.sizeGB} GB
                  </span>
                )}
              </div>
            </div>
          ))}

        {totalSizeGB && (
          <div className="flex justify-between text-xs text-zinc-500 px-1 pt-1">
            <span>Total download</span>
            <span className="text-zinc-300 font-medium">{totalSizeGB} GB</span>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-sm transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={downloadableCount === 0}
          className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Download & Install →
        </button>
      </div>
    </div>
  );
}
