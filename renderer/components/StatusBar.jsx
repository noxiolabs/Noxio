/**
 * @file StatusBar.jsx
 * @description Bottom status bar. Shows service health dots, VRAM usage meter,
 * and the currently selected model. All data sourced from Redux — no IPC here.
 */

import React from 'react';
import { useSelector } from 'react-redux';

const STATUS_COLOR = {
  running:  'bg-green-500',
  starting: 'bg-yellow-400 animate-pulse',
  stopped:  'bg-zinc-600',
  error:    'bg-red-500',
};

/** Single service health indicator dot. */
function HealthDot({ name, status }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
  return (
    <div className="flex items-center gap-1.5" title={`${name}: ${status}`}>
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      <span className="text-zinc-600 text-[10px] capitalize">{name}</span>
    </div>
  );
}

/** VRAM usage bar — shown as a thin horizontal meter. */
function VramMeter({ usedGB, availableGB }) {
  const total = usedGB + availableGB;
  const pct = total > 0 ? Math.round((usedGB / total) * 100) : 0;
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-violet-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-1000`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-600 tabular-nums">
        {usedGB.toFixed(1)}/{(total).toFixed(0)} GB
      </span>
    </div>
  );
}

export default function StatusBar() {
  const services = useSelector((s) => s.infrastructure.services);
  const vram     = useSelector((s) => s.infrastructure.vram);
  const model    = useSelector((s) => s.chat.selectedModel);

  return (
    <div className="flex items-center justify-between px-4 h-8 bg-[#0a0a0c] border-t border-zinc-800/60 flex-shrink-0">
      {/* Left: service health dots */}
      <div className="flex items-center gap-3">
        {Object.entries(services).map(([name, svc]) => (
          <HealthDot key={name} name={name} status={svc.status} />
        ))}
      </div>

      {/* Center: active model */}
      <div className="text-[10px] text-zinc-600 truncate max-w-[200px]">
        {model ?? 'No model selected'}
      </div>

      {/* Right: VRAM meter — shows 'checking' until the first vram-update arrives */}
      <div className="flex items-center">
        {vram.availableGB > 0 ? (
          <VramMeter usedGB={vram.usedGB} availableGB={vram.availableGB} />
        ) : (
          <span className="text-[10px] text-zinc-700 animate-pulse">VRAM checking…</span>
        )}
      </div>
    </div>
  );
}
