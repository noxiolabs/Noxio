/**
 * @file VoiceSection.jsx
 * @description Settings section for voice feature configuration. Controls the
 * speech-to-text language (passed to faster-whisper) and the text-to-speech
 * voice (passed to Kokoro FastAPI).
 */

import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateVoiceSettings } from '../../store/slices/settings';

const STT_LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en',   label: 'English' },
  { value: 'fr',   label: 'French' },
  { value: 'de',   label: 'German' },
  { value: 'es',   label: 'Spanish' },
  { value: 'ja',   label: 'Japanese' },
  { value: 'zh',   label: 'Chinese' },
];

const TTS_VOICES = [
  { value: 'af_sky',    label: 'Sky (Female, American)' },
  { value: 'am_adam',   label: 'Adam (Male, American)' },
  { value: 'bf_emma',   label: 'Emma (Female, British)' },
  { value: 'bm_george', label: 'George (Male, British)' },
];

/**
 * @returns {JSX.Element}
 */
export default function VoiceSection() {
  const dispatch        = useDispatch();
  const voice           = useSelector((s) => s.settings.voice);
  const voiceSelected   = useSelector((s) => s.settings.selectedCapabilities?.includes('voice') ?? false);
  const whisperInstalled = useSelector((s) => s.settings.installedServices?.whisper ?? false);
  const [lang,     setLang]    = useState(voice.sttLanguage);
  const [ttsVoice, setTtsVoice] = useState(voice.ttsVoice);
  const [saving,   setSaving]  = useState(false);
  const [saved,    setSaved]   = useState(false);
  const [error,    setError]   = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await window.electronAPI?.saveVoiceSettings(lang, ttsVoice);
      dispatch(updateVoiceSettings({ sttLanguage: lang, ttsVoice }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!voiceSelected || !whisperInstalled) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg mb-1">Voice Settings</h2>
        </div>
        <p className="text-sm text-fg-dim">
          Voice is coming in a future release. Speech-to-text and text-to-speech will be available once Voice is enabled during setup.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-fg mb-1">Voice Settings</h2>
        <p className="text-xs text-fg-dim">
          Configure speech-to-text language and text-to-speech voice.
          Voice services use faster-whisper and Kokoro running locally.
        </p>
      </div>

      {/* STT language */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-fg">
          Speech-to-text language
        </label>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="bg-card border border-stroke rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent w-56"
        >
          {STT_LANGUAGES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <p className="text-xs text-fg-faint">
          'Auto-detect' lets Whisper identify the language from the audio.
        </p>
      </div>

      {/* TTS voice */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-fg">
          Text-to-speech voice
        </label>
        <select
          value={ttsVoice}
          onChange={(e) => setTtsVoice(e.target.value)}
          className="bg-card border border-stroke rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent w-56"
        >
          {TTS_VOICES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <p className="text-xs text-fg-faint">
          Kokoro voices run fully locally. No audio data leaves your machine.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
