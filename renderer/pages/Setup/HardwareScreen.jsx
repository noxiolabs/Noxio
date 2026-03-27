/**
 * @file HardwareScreen.jsx
 * @description Setup wizard — Screen 2. Runs a hardware scan via IPC and displays
 * the detected GPU, VRAM, RAM, and which capabilities are available on this machine.
 */

import React, { useEffect, useState } from 'react';

/**
 * @param {{ label: string, value: string }} props
 */
function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200 font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

/**
 * @param {{ label: string, ok: boolean }} props
 */
function CapRow({ label, ok }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      {ok ? (
        <span className="text-green-400 text-xs">Available ✓</span>
      ) : (
        <span className="text-zinc-600 text-xs">Not available</span>
      )}
    </div>
  );
}

/**
 * @param {{ onNext: () => void, onBack: () => void, onHardware: (hw: Object) => void }} props
 */
export default function HardwareScreen({ onNext, onBack, onHardware }) {
  const [hardware, setHardware] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function scan() {
      try {
        const hw = await window.electronAPI.scanWizardHardware();
        if (hw.error) throw new Error(hw.error);
        setHardware(hw);
        onHardware(hw);
      } catch (err) {
        setError(err.message);
      } finally {
        setScanning(false);
      }
    }
    scan();
  }, [onHardware]);

  if (scanning) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm">Scanning hardware...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <p className="text-zinc-400 text-sm">Hardware scan failed</p>
        <p className="text-zinc-600 text-xs">{error}</p>
        <button
          onClick={() => { setScanning(true); setError(null); }}
          className="px-6 py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const vramGB = hardware?.raw?.gpu?.vramTotalMB
    ? (hardware.raw.gpu.vramTotalMB / 1024).toFixed(1)
    : 'Unknown';
  const ramGB = hardware?.raw?.ram?.totalMB
    ? Math.round(hardware.raw.ram.totalMB / 1024)
    : 'Unknown';

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">Your Hardware</h2>
        <p className="mt-1 text-zinc-500 text-sm">Here&apos;s what Noxio detected on your machine.</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 space-y-3">
          <Row label="GPU" value={hardware?.raw?.gpu?.name ?? 'Not detected'} />
          <Row label="VRAM" value={`${vramGB} GB`} />
          <Row label="RAM" value={`${ramGB} GB`} />
          <Row label="CPU" value={hardware?.raw?.cpu?.name ?? 'Unknown'} />
        </div>

        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
          <p className="text-xs text-zinc-600 uppercase tracking-wide mb-3">Capabilities</p>
          <div className="space-y-2">
            <CapRow label="Chat & Code" ok={hardware?.canRunChat} />
            <CapRow label="Image Generation" ok={hardware?.canRunImage} />
            <CapRow label="Voice" ok={hardware?.canRunVoice} />
          </div>
        </div>
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
          className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
