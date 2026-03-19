/**
 * @file voice.js
 * @description Redux slice for the Voice panel: push-to-talk recording state,
 * transcript from Whisper, and Kokoro TTS speaking state.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** True while the microphone is recording */
  recording: false,

  /** Transcribed text from the last recording */
  transcript: '',

  /** True while Kokoro is speaking a response */
  speaking: false,

  /** The text currently being spoken (for display) */
  speakingText: '',
};

const voiceSlice = createSlice({
  name: 'voice',
  initialState,
  reducers: {
    startRecording(state) {
      state.recording = true;
      state.transcript = '';
    },

    /**
     * Stops recording and stores the transcript.
     * @param {Object} action.payload
     * @param {string} action.payload.transcript
     */
    stopRecording(state, action) {
      state.recording = false;
      state.transcript = action.payload?.transcript || '';
    },

    /**
     * Marks TTS as active.
     * @param {Object} action.payload
     * @param {string} action.payload.text - Text being spoken
     */
    startSpeaking(state, action) {
      state.speaking = true;
      state.speakingText = action.payload?.text || '';
    },

    stopSpeaking(state) {
      state.speaking = false;
      state.speakingText = '';
    },

    clearTranscript(state) {
      state.transcript = '';
    },
  },
});

export const { startRecording, stopRecording, startSpeaking, stopSpeaking, clearTranscript } =
  voiceSlice.actions;

export default voiceSlice.reducer;
