/**
 * @file WelcomeScreen.jsx
 * @description Setup wizard — Screen 1. Intro screen with app name, tagline,
 * and a brief capability summary. Entry point into the wizard flow.
 */

import React from 'react';

const FEATURES = [
  'Chat & reason locally',
  'Code with AI assistance',
  'Generate images on-device',
  'Voice in and out',
];

/**
 * @param {{ onNext: () => void }} props
 */
export default function WelcomeScreen({ onNext }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-10 text-center px-8">
      <div className="space-y-3">
        <h1 className="text-6xl font-bold tracking-tight text-white">Noxio</h1>
        <p className="text-xl text-zinc-400">Your personal AI. Runs locally. No subscriptions.</p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 max-w-xs">
        {FEATURES.map((f) => (
          <div key={f} className="flex items-center gap-2 text-sm text-zinc-500">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
            <span>{f}</span>
          </div>
        ))}
      </div>

      <p className="text-sm text-zinc-600 max-w-xs">
        Everything runs on your GPU. Nothing leaves your machine.
      </p>

      <button
        onClick={onNext}
        className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
      >
        Get Started →
      </button>
    </div>
  );
}
