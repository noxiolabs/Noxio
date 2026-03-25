/**
 * @file InstallLocationScreen.jsx
 * @description Setup wizard — Screen 4 (inserted between Capabilities and Models).
 * Lets the user choose where Noxio stores services and models. Validates the path
 * via IPC and shows per-drive cards with usage bars for quick selection.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';

const SIZES = { chat: 10, coding: 8, image: 15, voice: 2, base: 3 };

/** Horizontal usage bar inside a drive card. */
function UsageBar({ usedGB, totalGB }) {
  const pct = totalGB > 0 ? Math.min(100, Math.round((usedGB / totalGB) * 100)) : 0;
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-violet-500';
  return (
    <div className="w-full h-1 bg-zinc-700 rounded-full overflow-hidden mt-2">
      <div className={`h-full ${color} rounded-full transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Single drive card. Clicking sets the path input to {letter}:\Noxio. */
function DriveCard({ drive, selected, onSelect }) {
  const freeGB = drive.freeGB ?? 0;
  const totalGB = drive.totalGB ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col p-3 rounded-lg border text-left transition-colors w-full ${
        selected ? 'border-violet-600 bg-violet-900/20' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold text-zinc-100">{drive.letter}:</span>
        {drive.label && <span className="text-xs text-zinc-500 truncate">{drive.label}</span>}
      </div>
      <p className="text-xs text-zinc-500 mt-1">{freeGB.toFixed(1)} GB free / {totalGB.toFixed(0)} GB</p>
      <UsageBar usedGB={totalGB - freeGB} totalGB={totalGB} />
    </button>
  );
}

/**
 * @param {{ onNext: (dir: string) => void, onBack: () => void, selectedCapabilities: string[] }} props
 */
export default function InstallLocationScreen({ onNext, onBack, selectedCapabilities = [] }) {
  const [pathValue, setPathValue]   = useState('');
  const [drives, setDrives]         = useState([]);
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const debounceRef                 = useRef(null);

  const totalGB = SIZES.base + selectedCapabilities.reduce((sum, cap) => sum + (SIZES[cap] ?? 0), 0);

  /** Validate the given directory via IPC. */
  const validate = useCallback(async (dir) => {
    if (!dir.trim()) { setValidation(null); return; }
    setValidating(true);
    try {
      const result = await window.electronAPI.validateInstallDir(dir);
      setValidation(result);
    } finally {
      setValidating(false);
    }
  }, []);

  /** Debounced path change handler. */
  const handlePathChange = useCallback((value) => {
    setPathValue(value);
    setValidation(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => validate(value), 600);
  }, [validate]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const [defaultDir, drivesResult] = await Promise.all([
        window.electronAPI.getDefaultInstallDir(),
        window.electronAPI.getAvailableDrives(),
      ]);
      if (cancelled) return;
      const dir = defaultDir?.dir ?? '';
      setPathValue(dir);
      setDrives(drivesResult ?? []);
      if (dir) validate(dir);
    }
    init();
    return () => { cancelled = true; };
  }, [validate]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  async function handleBrowse() {
    const result = await window.electronAPI.pickInstallDirectory();
    if (result?.dir) handlePathChange(result.dir);
  }

  const canContinue = validation?.ok === true && !validating;
  const selectedLetter = pathValue.length >= 2 ? pathValue[0].toUpperCase() : null;

  return (
    <div className="flex flex-col items-center h-full gap-8 px-8 overflow-y-auto py-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">Choose storage location</h2>
        <p className="mt-1 text-zinc-500 text-sm">
          Noxio will store AI services and models here. Pick a location with enough free space.
        </p>
      </div>

      <div className="w-full max-w-lg space-y-4">
        {drives.length > 0 && (
          <div className={`grid gap-2 ${drives.length > 3 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {drives.map((drive) => (
              <DriveCard
                key={drive.letter}
                drive={drive}
                selected={selectedLetter === drive.letter.toUpperCase()}
                onSelect={() => handlePathChange(`${drive.letter}:\\Noxio`)}
              />
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={pathValue}
            onChange={(e) => handlePathChange(e.target.value)}
            placeholder="C:\Noxio"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600 transition-colors font-mono"
          />
          <button
            type="button"
            onClick={handleBrowse}
            className="px-4 py-2.5 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-sm transition-colors flex-shrink-0"
          >
            Browse
          </button>
        </div>

        <div className="min-h-[1.25rem]">
          {validating && <p className="text-xs text-zinc-500">Checking path...</p>}
          {!validating && validation?.ok === true && (
            <p className="text-xs text-green-400">Path is valid — {validation.freeGB?.toFixed(1)} GB free</p>
          )}
          {!validating && validation?.ok === false && (
            <p className="text-xs text-red-400">{validation.message ?? 'Invalid path'}</p>
          )}
          {!validating && !validation && pathValue && (
            <p className="text-xs text-zinc-600">Validating...</p>
          )}
        </div>

        <p className="text-xs text-zinc-500">~{totalGB} GB needed for selected capabilities</p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-sm transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => onNext(pathValue)}
          disabled={!canContinue}
          className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
