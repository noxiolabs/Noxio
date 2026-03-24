/**
 * @file CapabilitiesScreen.jsx
 * @description Setup wizard — Screen 3. Lets the user select which AI capabilities
 * to enable. Checkboxes are pre-selected based on detected hardware and disabled
 * (with a note) if the machine doesn't have enough VRAM.
 */

import React, { useState } from 'react';

const ALL_CAPABILITIES = [
  {
    id: 'chat',
    label: 'Chat',
    description: 'Ask questions, reason, and write — powered by a local LLM via Ollama.',
    default: true,
  },
  {
    id: 'coding',
    label: 'Code',
    description: 'Coding-optimised model routing using qwen2.5-coder.',
    default: true,
  },
  {
    id: 'image',
    label: 'Images',
    description: 'Generate images with FLUX.1 or SDXL via ComfyUI.',
    requiresImage: true,
    default: false,
  },
  {
    id: 'voice',
    label: 'Voice',
    description: 'Speech-to-text (Whisper) and text-to-speech (Kokoro).',
    default: false,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Autonomous agent with a sandboxed workspace.',
    default: false,
  },
];

/**
 * @param {{
 *   hardware: Object|null,
 *   capabilities: string[],
 *   onCapabilities: (caps: string[]) => void,
 *   onNext: () => void,
 *   onBack: () => void,
 * }} props
 */
export default function CapabilitiesScreen({ hardware, capabilities, onCapabilities, onNext, onBack }) {
  const [selected, setSelected] = useState(() => new Set(capabilities));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleNext() {
    onCapabilities([...selected]);
    onNext();
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">What do you want to do?</h2>
        <p className="mt-1 text-zinc-500 text-sm">Select the capabilities to enable. You can change these later.</p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        {ALL_CAPABILITIES.map((cap) => {
          const isDisabled = cap.requiresImage && !hardware?.canRunImage;
          const isChecked = selected.has(cap.id) && !isDisabled;

          return (
            <button
              key={cap.id}
              onClick={() => !isDisabled && toggle(cap.id)}
              disabled={isDisabled}
              className={`w-full flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                isDisabled
                  ? 'border-zinc-800/50 opacity-40 cursor-not-allowed'
                  : isChecked
                  ? 'border-violet-600/60 bg-violet-600/10'
                  : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/50'
              }`}
            >
              <div
                className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                  isChecked ? 'bg-violet-600 border-violet-600' : 'border-zinc-600'
                }`}
              >
                {isChecked && <span className="text-white text-[10px] leading-none font-bold">✓</span>}
              </div>

              <div>
                <p className="text-sm font-medium text-zinc-100">{cap.label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{cap.description}</p>
                {isDisabled && (
                  <p className="text-xs text-zinc-600 mt-1">Requires more VRAM</p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-sm transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleNext}
          disabled={selected.size === 0}
          className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
