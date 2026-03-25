/**
 * @file Sidebar.jsx
 * @description Left navigation sidebar. Switches between Chat, Create, Voice,
 * and Agent panels. Create / Voice / Agent are disabled until their phases ship.
 * Gaming Mode button (Phase 5) will pause AI services to free VRAM for games.
 * Settings gear button opens the SettingsOverlay on the Models section.
 */

import React from 'react';
import { useDispatch } from 'react-redux';
import { openSettingsPanel } from '../store/slices/settings';

const MODES = [
  { id: 'chat',   label: 'Chat',   Icon: ChatIcon   },
  { id: 'create', label: 'Create', Icon: CreateIcon },
  { id: 'voice',  label: 'Voice',  Icon: VoiceIcon,  disabled: true },
  { id: 'agent',  label: 'Agent',  Icon: AgentIcon,  disabled: true },
];

/**
 * @param {{ activeMode: string, onModeChange: (mode: string) => void }} props
 */
export default function Sidebar({ activeMode, onModeChange }) {
  const dispatch = useDispatch();

  /** Opens the settings overlay on the Models section. */
  function handleOpenSettings() {
    dispatch(openSettingsPanel('models'));
  }

  return (
    <aside className="flex flex-col w-[60px] bg-[#0a0a0c] border-r border-zinc-800/60 py-3 gap-0.5 flex-shrink-0">
      {MODES.map(({ id, label, Icon, disabled }) => (
        <button
          key={id}
          onClick={() => !disabled && onModeChange(id)}
          disabled={disabled}
          title={disabled ? `${label} — coming soon` : label}
          className={`flex flex-col items-center justify-center py-3 mx-1.5 rounded-lg transition-colors ${
            disabled
              ? 'opacity-25 cursor-not-allowed text-zinc-500'
              : activeMode === id
              ? 'bg-violet-600/20 text-violet-400'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          <Icon />
          <span className="text-[9px] mt-1 font-medium tracking-wide">{label}</span>
        </button>
      ))}

      <div className="flex-1" />

      {/* Settings gear — opens SettingsOverlay */}
      <button
        onClick={handleOpenSettings}
        title="Settings"
        className="flex flex-col items-center justify-center py-3 mx-1.5 rounded-lg transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
      >
        <GearIcon />
        <span className="text-[9px] mt-1 font-medium tracking-wide">Settings</span>
      </button>

      <button
        disabled
        title="Gaming Mode — Phase 5"
        className="flex flex-col items-center justify-center py-3 mx-1.5 rounded-lg opacity-20 cursor-not-allowed text-zinc-500"
      >
        <GamingIcon />
        <span className="text-[9px] mt-1 font-medium tracking-wide">Game</span>
      </button>
    </aside>
  );
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CreateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function GamingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="12" x2="10" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <circle cx="15" cy="11" r="1" />
      <circle cx="17" cy="13" r="1" />
      <path d="M3 7h18l-2 10H5L3 7z" />
    </svg>
  );
}
