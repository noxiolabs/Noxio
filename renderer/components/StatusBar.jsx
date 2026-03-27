/**
 * @file StatusBar.jsx
 * @description Bottom status bar. Shows service health dots, VRAM usage meter,
 * and the currently selected model. All data sourced from Redux — no IPC here.
 */

import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

const SERVICE_LABELS = {
  ollama:  'AI Engine',
  comfyui: 'Image',
  whisper: 'Voice In',
  kokoro:  'Voice Out',
};

const STATUS_COLOR = {
  running:        'bg-green-500',
  starting:       'bg-yellow-400 animate-pulse',
  stopped:        'bg-zinc-600',
  error:          'bg-red-500',
  'not-installed':'bg-zinc-700',
};

/** Single service health indicator dot. */
function HealthDot({ name, status }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
  const label = SERVICE_LABELS[name] ?? name;
  const title = status === 'not-installed'
    ? `${label}: Not installed`
    : `${label}: ${status}`;
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      <span className="text-zinc-600 text-[10px]">{label}</span>
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

/**
 * Small pill indicating whether the current (or most recent) stream was routed
 * to a cloud provider. Shown only while streaming or immediately after if the
 * last route was cloud. Disappears (reverts to nothing) when local routing is used.
 */
function RoutingPill({ provider, streaming }) {
  // Only surface cloud routing — local is the expected default, no pill needed.
  if (!streaming || provider === 'local' || !provider) return null;

  const tints = {
    openai:    'text-green-400  bg-green-500/10  border-green-500/20',
    anthropic: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    google:    'text-blue-400   bg-blue-500/10   border-blue-500/20',
  };
  const label = {
    openai:    'OpenAI',
    anthropic: 'Anthropic',
    google:    'Google',
  };

  const tint  = tints[provider]  ?? 'text-zinc-400 bg-zinc-800 border-zinc-700';
  const text  = label[provider]  ?? provider;

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border ${tint}`}>
      <span aria-hidden="true">↑</span>
      {text}
    </span>
  );
}

export default function StatusBar() {
  const services    = useSelector((s) => s.infrastructure.services);
  const vram        = useSelector((s) => s.infrastructure.vram);
  const model       = useSelector((s) => s.chat.selectedModel);
  const lastRouting = useSelector((s) => s.infrastructure.lastRouting);
  const streaming   = useSelector((s) => s.chat.streaming);
  const [vramTimedOut, setVramTimedOut] = useState(false);

  // After 10s with no VRAM data, stop showing "checking" and show "N/A" instead
  useEffect(() => {
    if (vram.availableGB > 0) {
      setVramTimedOut(false);
      return;
    }
    const t = setTimeout(() => setVramTimedOut(true), 10000);
    return () => clearTimeout(t);
  }, [vram.availableGB]);

  // Only show services that are actually installed
  const visibleServices = Object.entries(services).filter(
    ([, svc]) => svc.status !== 'not-installed'
  );

  return (
    <div className="flex items-center justify-between px-4 h-8 bg-[#0a0a0c] border-t border-zinc-800/60 flex-shrink-0">
      {/* Left: service health dots — installed services only */}
      <div className="flex items-center gap-3">
        {visibleServices.map(([name, svc]) => (
          <HealthDot key={name} name={name} status={svc.status} />
        ))}
      </div>

      {/* Center: active model + cloud routing pill */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-600 truncate max-w-[200px]">
          {model ?? 'No model selected'}
        </span>
        <RoutingPill provider={lastRouting.provider} streaming={streaming} />
      </div>

      {/* Right: VRAM meter — shows 'checking' until first vram-update, then 'N/A' after 10s */}
      <div className="flex items-center">
        {vram.availableGB > 0 ? (
          <VramMeter usedGB={vram.usedGB} availableGB={vram.availableGB} />
        ) : vramTimedOut ? (
          <span className="text-[10px] text-zinc-700">VRAM N/A</span>
        ) : (
          <span className="text-[10px] text-zinc-700 animate-pulse">VRAM checking…</span>
        )}
      </div>
    </div>
  );
}
