/**
 * @file StyleSelector.jsx
 * @description Style preset pill buttons for the Create panel.
 * Renders four mutually-exclusive style options as pill-shaped toggle buttons.
 * The active style is highlighted in violet to match the app's accent colour.
 */

import React from 'react';

/** @type {Array<{ id: string, label: string }>} */
const STYLES = [
  { id: 'photorealistic', label: 'Photorealistic' },
  { id: 'artistic',       label: 'Artistic'       },
  { id: 'abstract',       label: 'Abstract'       },
  { id: 'anime',          label: 'Anime'          },
];

/**
 * @param {{ value: string, onChange: (style: string) => void, disabled?: boolean }} props
 */
export default function StyleSelector({ value, onChange, disabled = false }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Style</p>
      <div className="flex flex-wrap gap-2">
        {STYLES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => !disabled && onChange(id)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              value === id
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
