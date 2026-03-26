/**
 * @file Voice/index.jsx
 * @description Voice panel: push-to-talk recording, Whisper transcription,
 * LLM response, and Kokoro TTS playback.
 *
 * TODO Phase 6: implement.
 */

import React from 'react';

export default function VoicePanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <p className="text-white/60 text-sm">Voice is not available in this version.</p>
      <p className="text-white/40 text-xs">Speech-to-text and text-to-speech are coming in a future release.</p>
    </div>
  );
}
