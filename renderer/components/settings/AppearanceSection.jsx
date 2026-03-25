/**
 * @file AppearanceSection.jsx
 * @description Settings section stub for appearance preferences (theme and font
 * size). Only Dark theme and Medium font size are active in Phase 4. Other
 * options show a "coming soon" label and are non-interactive.
 */

import React from 'react';
import { useSelector } from 'react-redux';

const THEMES = [
  { id: 'dark',   label: 'Dark',   available: true  },
  { id: 'light',  label: 'Light',  available: false },
  { id: 'system', label: 'System', available: false },
];

const FONT_SIZES = [
  { id: 'small',  label: 'Small',  available: false },
  { id: 'medium', label: 'Medium', available: true  },
  { id: 'large',  label: 'Large',  available: false },
];

/**
 * @returns {JSX.Element}
 */
export default function AppearanceSection() {
  const theme    = useSelector((s) => s.settings.ui.theme);
  const fontSize = useSelector((s) => s.settings.ui.fontSize);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Appearance</h2>
        <p className="text-xs text-zinc-500">
          Theme and font size customisation. Additional options are coming in a future phase.
        </p>
      </div>

      {/* Theme */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-300">Theme</label>
        <div className="flex gap-2">
          {THEMES.map(({ id, label, available }) => (
            <div key={id} className="relative">
              <button
                disabled={!available}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  available && theme === id
                    ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                    : available
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600'
                    : 'bg-zinc-800/50 border-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {label}
              </button>
              {!available && (
                <span className="absolute -top-2 -right-2 text-[9px] bg-zinc-700 text-zinc-400 px-1 rounded-full leading-4">
                  soon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-300">Font size</label>
        <div className="flex gap-2">
          {FONT_SIZES.map(({ id, label, available }) => (
            <div key={id} className="relative">
              <button
                disabled={!available}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  available && fontSize === id
                    ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                    : available
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600'
                    : 'bg-zinc-800/50 border-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {label}
              </button>
              {!available && (
                <span className="absolute -top-2 -right-2 text-[9px] bg-zinc-700 text-zinc-400 px-1 rounded-full leading-4">
                  soon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
