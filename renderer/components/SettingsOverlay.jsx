/**
 * @file SettingsOverlay.jsx
 * @description Full-screen settings overlay. Renders above the main app panel when
 * the gear icon is clicked. Contains tabbed navigation across six settings sections.
 * Closes on X button click or Escape key.
 *
 * Layout: fixed full-viewport, two-column — 240px left rail (section tabs) and
 * flex-1 right panel (active section content). Rendered via a React portal so it
 * sits above all other app content without needing z-index fights.
 */

import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { openSettingsPanel, closeSettingsPanel } from '../store/slices/settings';
import ModelsSection        from './settings/ModelsSection';
import VoiceSection         from './settings/VoiceSection';
import ChatSection          from './settings/ChatSection';
import AppearanceSection    from './settings/AppearanceSection';
import CapabilitiesSection  from './settings/CapabilitiesSection';
import SystemSection        from './settings/SystemSection';

const SECTIONS = [
  { key: 'capabilities', label: 'Capabilities' },
  { key: 'models',       label: 'Models'       },
  { key: 'voice',        label: 'Voice'        },
  { key: 'chat',         label: 'Chat'         },
  { key: 'appearance',   label: 'Appearance'   },
  { key: 'system',       label: 'System'       },
];

/**
 * Maps a section key to its content component.
 *
 * @param {string} section
 * @returns {JSX.Element}
 */
function SectionContent({ section }) {
  switch (section) {
    case 'capabilities': return <CapabilitiesSection />;
    case 'models':       return <ModelsSection />;
    case 'voice':        return <VoiceSection />;
    case 'chat':         return <ChatSection />;
    case 'appearance':   return <AppearanceSection />;
    case 'system':       return <SystemSection />;
    default:             return <CapabilitiesSection />;
  }
}

/**
 * @returns {JSX.Element|null} The overlay, or null when not open.
 */
export default function SettingsOverlay() {
  const dispatch       = useDispatch();
  const open           = useSelector((s) => s.settings._settingsPanel.open);
  const activeSection  = useSelector((s) => s.settings._settingsPanel.activeSection);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') dispatch(closeSettingsPanel());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dispatch]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 flex-shrink-0">
        <h1 className="text-base font-semibold text-white tracking-wide">Settings</h1>
        <button
          onClick={() => dispatch(closeSettingsPanel())}
          title="Close settings"
          className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 rounded-lg hover:bg-zinc-800"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Body: left rail + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        <nav className="w-[240px] flex-shrink-0 border-r border-zinc-800/60 py-4 flex flex-col gap-0.5 overflow-y-auto">
          {SECTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => dispatch(openSettingsPanel(key))}
              className={`text-left px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors ${
                activeSection === key
                  ? 'bg-violet-600/20 text-violet-300 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Right panel */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <SectionContent section={activeSection} />
        </div>
      </div>
    </div>
  );
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
