/**
 * @file Voice/index.jsx
 * @description Push-to-talk voice panel.
 *
 * Pipeline:
 *   1. Hold/click Mic button → MediaRecorder captures WebM/Opus
 *   2. Release → AudioContext decodes WebM → OfflineAudioContext resamples to 16 kHz
 *      → Float32 samples encoded as 16-bit PCM WAV in JS
 *   3. WAV sent to main via IPC → faster-whisper → transcript
 *   4. Transcript sent to LLM via send-chat-message; tokens streamed back
 *   5. On stream-complete → speak-text IPC → Kokoro WAV → Web Audio playback
 *
 * States: idle | recording | transcribing | thinking | speaking | error
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { nanoid } from '@reduxjs/toolkit';
import {
  startRecording as reduxStartRecording,
  stopRecording  as reduxStopRecording,
  startSpeaking,
  stopSpeaking,
  clearTranscript,
} from '../../store/slices/voice';

// ─── WAV encoder ─────────────────────────────────────────────────────────────

/**
 * Encodes a Float32Array of mono 16 kHz PCM samples as a WAV Buffer.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
function encodeWav(samples, sampleRate) {
  const pcm    = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i]  = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const dataBytes   = pcm.byteLength;
  const buffer      = new ArrayBuffer(44 + dataBytes);
  const view        = new DataView(buffer);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate    = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign  = (numChannels * bitsPerSample) / 8;

  // RIFF header
  view.setUint32( 0, 0x52494646, false); // "RIFF"
  view.setUint32( 4, 36 + dataBytes, true);
  view.setUint32( 8, 0x57415645, false); // "WAVE"
  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataBytes, true);

  const dst = new Uint8Array(buffer, 44);
  dst.set(new Uint8Array(pcm.buffer));

  return buffer;
}

/**
 * Converts a raw MediaRecorder blob (WebM/Opus) to 16 kHz mono WAV.
 * @param {Blob} blob
 * @returns {Promise<ArrayBuffer>}
 */
async function blobToWav16k(blob) {
  const TARGET_RATE = 16_000;

  const arrayBuffer = await blob.arrayBuffer();
  const ctx         = new AudioContext();
  const decoded     = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  // Mix down to mono
  const monoBuffer  = new AudioContext({ sampleRate: TARGET_RATE });
  const offline     = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_RATE), TARGET_RATE);
  const src         = offline.createBufferSource();

  // Re-create buffer in offline context
  const srcBuf      = offline.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    srcBuf.copyToChannel(decoded.getChannelData(ch), ch);
  }
  src.buffer = srcBuf;
  src.connect(offline.destination);
  src.start(0);

  const resampled   = await offline.startRendering();
  const samples     = resampled.getChannelData(0);
  monoBuffer.close();

  return encodeWav(samples, TARGET_RATE);
}

// ─── Component ───────────────────────────────────────────────────────────────

const PHASE = {
  IDLE:         'idle',
  RECORDING:    'recording',
  TRANSCRIBING: 'transcribing',
  THINKING:     'thinking',
  SPEAKING:     'speaking',
  ERROR:        'error',
};

const PHASE_LABEL = {
  [PHASE.IDLE]:         'Hold to speak',
  [PHASE.RECORDING]:    'Recording…',
  [PHASE.TRANSCRIBING]: 'Transcribing…',
  [PHASE.THINKING]:     'Thinking…',
  [PHASE.SPEAKING]:     'Speaking…',
  [PHASE.ERROR]:        'Error',
};

export default function VoicePanel() {
  const dispatch      = useDispatch();
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const transcript    = useSelector((s) => s.voice.transcript);

  const [phase, setPhase]         = useState(PHASE.IDLE);
  const [response, setResponse]   = useState('');
  const [errorMsg, setErrorMsg]   = useState('');

  const recorderRef    = useRef(null);
  const chunksRef      = useRef([]);
  const streamBufRef   = useRef('');
  const audioCtxRef    = useRef(null);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  // ── LLM stream listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return;

    function onToken(token) {
      if (phase !== PHASE.THINKING && phase !== PHASE.SPEAKING) return;
      streamBufRef.current += token;
      setResponse(streamBufRef.current);
    }

    async function onComplete() {
      const fullText = streamBufRef.current.trim();
      if (!fullText) {
        setPhase(PHASE.IDLE);
        return;
      }
      await speakResponse(fullText);
    }

    window.electronAPI.on('stream-token', onToken);
    window.electronAPI.on('stream-complete', onComplete);
    return () => {
      window.electronAPI.off('stream-token', onToken);
      window.electronAPI.off('stream-complete', onComplete);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Core actions ──────────────────────────────────────────────────────────

  function handleError(msg) {
    setErrorMsg(msg);
    setPhase(PHASE.ERROR);
    dispatch(reduxStopRecording({ transcript: '' }));
    dispatch(stopSpeaking());
  }

  async function beginRecording() {
    if (phase !== PHASE.IDLE && phase !== PHASE.ERROR) return;

    setPhase(PHASE.RECORDING);
    setResponse('');
    setErrorMsg('');
    streamBufRef.current = '';
    dispatch(reduxStartRecording());

    if (window.electronAPI) {
      window.electronAPI.startRecording().catch(() => {});
    }

    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current   = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Release mic tracks
        stream.getTracks().forEach((t) => t.stop());

        if (chunksRef.current.length === 0) {
          handleError('No audio captured.');
          return;
        }

        setPhase(PHASE.TRANSCRIBING);

        try {
          const blob      = new Blob(chunksRef.current, { type: 'audio/webm' });
          const wavBuffer = await blobToWav16k(blob);
          const audioData = Array.from(new Uint8Array(wavBuffer));

          const result = window.electronAPI
            ? await window.electronAPI.stopRecording(audioData)
            : { transcript: '' };

          const text = result?.transcript?.trim() || '';
          dispatch(reduxStopRecording({ transcript: text }));

          if (!text) {
            setPhase(PHASE.IDLE);
            return;
          }

          await askLLM(text);
        } catch (err) {
          handleError(err.message || 'Transcription failed.');
        }
      };

      recorder.start();
    } catch (err) {
      handleError(err.message || 'Microphone access denied.');
    }
  }

  function endRecording() {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  async function askLLM(text) {
    setPhase(PHASE.THINKING);
    streamBufRef.current = '';

    if (!window.electronAPI) {
      handleError('Electron API not available.');
      return;
    }

    const model          = selectedModel || 'llama3';
    const conversationId = nanoid();

    try {
      await window.electronAPI.sendChatMessage({
        messages: [{ role: 'user', content: text }],
        model,
        conversationId,
      });
    } catch (err) {
      handleError(err.message || 'LLM request failed.');
    }
  }

  async function speakResponse(text) {
    setPhase(PHASE.SPEAKING);
    dispatch(startSpeaking({ text }));

    try {
      const result = window.electronAPI
        ? await window.electronAPI.speakText(text)
        : null;

      if (!result?.audioData?.length) {
        dispatch(stopSpeaking());
        setPhase(PHASE.IDLE);
        return;
      }

      const wavBuffer = new Uint8Array(result.audioData).buffer;
      const actx      = new AudioContext();
      audioCtxRef.current = actx;

      const decoded = await actx.decodeAudioData(wavBuffer);
      const src     = actx.createBufferSource();
      src.buffer    = decoded;
      src.connect(actx.destination);
      src.onended   = () => {
        actx.close();
        audioCtxRef.current = null;
        dispatch(stopSpeaking());
        setPhase(PHASE.IDLE);
      };
      src.start(0);
    } catch (err) {
      dispatch(stopSpeaking());
      handleError(err.message || 'TTS playback failed.');
    }
  }

  function handleReset() {
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    dispatch(clearTranscript());
    dispatch(stopSpeaking());
    setResponse('');
    setErrorMsg('');
    setPhase(PHASE.IDLE);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isRecording = phase === PHASE.RECORDING;
  const isBusy      = phase === PHASE.TRANSCRIBING || phase === PHASE.THINKING || phase === PHASE.SPEAKING;
  const isError     = phase === PHASE.ERROR;

  const micRingColor = isRecording
    ? 'ring-red-500 shadow-red-500/40'
    : isBusy
      ? 'ring-violet-500 shadow-violet-500/30'
      : isError
        ? 'ring-rose-600 shadow-rose-600/30'
        : 'ring-zinc-600 hover:ring-violet-500';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-between h-full px-6 py-8 gap-6 select-none">

      {/* ── Transcript + Response area ─────────────────────────────────── */}
      <div className="flex flex-col gap-4 w-full max-w-xl flex-1 overflow-y-auto">
        {transcript && (
          <div className="rounded-xl bg-zinc-800/60 border border-zinc-700/40 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1 font-medium uppercase tracking-wide">You said</p>
            <p className="text-zinc-100 text-sm leading-relaxed">{transcript}</p>
          </div>
        )}

        {response && (
          <div className="rounded-xl bg-violet-950/40 border border-violet-700/30 px-4 py-3">
            <p className="text-xs text-violet-400 mb-1 font-medium uppercase tracking-wide">
              {phase === PHASE.SPEAKING ? 'Speaking' : 'Response'}
            </p>
            <p className="text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">{response}</p>
          </div>
        )}

        {isError && errorMsg && (
          <div className="rounded-xl bg-rose-950/40 border border-rose-700/40 px-4 py-3">
            <p className="text-xs text-rose-400 mb-1 font-medium uppercase tracking-wide">Error</p>
            <p className="text-zinc-300 text-sm">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* ── Push-to-talk button ────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4">
        <button
          onMouseDown={beginRecording}
          onMouseUp={endRecording}
          onTouchStart={beginRecording}
          onTouchEnd={endRecording}
          disabled={isBusy}
          aria-label={isRecording ? 'Release to stop recording' : 'Hold to record'}
          className={[
            'relative w-20 h-20 rounded-full ring-2 shadow-lg transition-all duration-150',
            'flex items-center justify-center',
            'bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed',
            micRingColor,
          ].join(' ')}
        >
          {/* Pulse ring while recording */}
          {isRecording && (
            <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
          )}

          {/* Icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={[
              'w-8 h-8 relative z-10',
              isRecording ? 'text-red-400' : isBusy ? 'text-violet-400' : 'text-zinc-300',
            ].join(' ')}
          >
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z" />
            <path
              fillRule="evenodd"
              d="M6.25 11a.75.75 0 0 1 .75.75 5 5 0 0 0 10 0 .75.75 0 0 1 1.5 0 6.5 6.5 0 0 1-5.75 6.46V21h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5v-2.79A6.5 6.5 0 0 1 5.5 11.75.75.75 0 0 1 6.25 11Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        <p className="text-zinc-400 text-sm tabular-nums min-w-[10ch] text-center">
          {PHASE_LABEL[phase]}
        </p>

        {(transcript || response || isError) && phase === PHASE.IDLE && (
          <button
            onClick={handleReset}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
