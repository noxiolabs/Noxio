/**
 * @file QualitySelector.jsx
 * @description Quality preset selector for the Create panel.
 * Renders three mutually-exclusive quality options as pill-shaped toggle buttons.
 * Each option maps to a different number of inference steps in the backend:
 *   Draft    → 4 steps  (fastest, lower quality)
 *   Standard → 8 steps  (balanced)
 *   High     → 20 steps (best quality, slowest)
 */

import React from 'react';

/** @type {Array<{ id: string, label: string, hint: string }>} */
const QUALITIES = [
  { id: 'draft',    label: 'Draft',    hint: 'Fast'     },
  { id: 'standard', label: 'Standard', hint: 'Balanced' },
  { id: 'high',     label: 'High',     hint: 'Best'     },
];

/**
 * @param {{ value: string, onChange: (quality: string) => void, disabled?: boolean }} props
 */
export default function QualitySelector({ value, onChange, disabled = false }) {
  return (
    <div>
      <p className="text-[10px] text-fg-dim uppercase tracking-wider mb-2">Quality</p>
      <div className="flex gap-2">
        {QUALITIES.map(({ id, label, hint }) => (
          <button
            key={id}
            onClick={() => !disabled && onChange(id)}
            disabled={disabled}
            title={hint}
            className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${
              value === id
                ? 'bg-accent text-white'
                : 'bg-card text-fg-muted hover:bg-raise hover:text-fg'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
