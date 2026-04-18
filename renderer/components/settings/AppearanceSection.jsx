/**
 * @file AppearanceSection.jsx
 * @description Settings section for appearance preferences (theme and font size).
 * Dark and Light themes are both active. System theme and non-Medium font sizes
 * remain coming-soon stubs.
 */

import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateUI } from '../../store/slices/settings';

const THEMES = [
  { id: 'dark',   label: 'Dark',   available: true  },
  { id: 'light',  label: 'Light',  available: true  },
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
  const dispatch = useDispatch();
  const theme    = useSelector((s) => s.settings.ui.theme);
  const fontSize = useSelector((s) => s.settings.ui.fontSize);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-fg mb-1">Appearance</h2>
        <p className="text-xs text-fg-dim">
          Theme and font size customisation. Additional options are coming in a future phase.
        </p>
      </div>

      {/* Theme */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-fg">Theme</label>
        <div className="flex gap-2">
          {THEMES.map(({ id, label, available }) => (
            <div key={id} className="relative">
              <button
                disabled={!available}
                onClick={() => available && dispatch(updateUI({ theme: id }))}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  available && theme === id
                    ? 'bg-accent/20 border-accent text-accent'
                    : available
                    ? 'bg-card border-stroke text-fg hover:border-stroke-dim cursor-pointer'
                    : 'bg-card/50 border-stroke text-fg-faint cursor-not-allowed'
                }`}
              >
                {label}
              </button>
              {!available && (
                <span className="absolute -top-2 -right-2 text-[9px] bg-card text-fg-dim px-1 rounded-full leading-4">
                  soon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-fg">Font size</label>
        <div className="flex gap-2">
          {FONT_SIZES.map(({ id, label, available }) => (
            <div key={id} className="relative">
              <button
                disabled={!available}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  available && fontSize === id
                    ? 'bg-accent/20 border-accent text-accent'
                    : available
                    ? 'bg-card border-stroke text-fg hover:border-stroke-dim'
                    : 'bg-card/50 border-stroke text-fg-faint cursor-not-allowed'
                }`}
              >
                {label}
              </button>
              {!available && (
                <span className="absolute -top-2 -right-2 text-[9px] bg-card text-fg-dim px-1 rounded-full leading-4">
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
