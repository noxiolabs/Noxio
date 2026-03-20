/**
 * @file create.js
 * @description Redux slice for the Create panel: image generation prompt, style
 * and quality settings, generation state, and the output gallery.
 */

import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  /** Current prompt text in the Create panel */
  prompt: '',

  /** Visual style preset */
  style: 'photorealistic', // 'photorealistic' | 'artistic' | 'abstract' | 'anime'

  /** Quality / speed trade-off */
  quality: 'balanced', // 'draft' | 'balanced' | 'high'

  /** True while an image is being generated */
  generating: false,

  /** Generation progress 0–100, shown in the progress bar */
  progress: 0,

  /** Gallery of previously generated images */
  gallery: [], // [{ id, url, prompt, style, quality, createdAt }]
};

const createSliceObj = createSlice({
  name: 'create',
  initialState,
  reducers: {
    setPrompt(state, action) {
      state.prompt = action.payload;
    },

    setStyle(state, action) {
      state.style = action.payload;
    },

    setQuality(state, action) {
      state.quality = action.payload;
    },

    /**
     * Marks image generation as started.
     */
    startGeneration(state) {
      state.generating = true;
      state.progress = 0;
    },

    /**
     * Updates generation progress. Triggered by install-progress IPC events
     * while ComfyUI is generating.
     */
    updateProgress(state, action) {
      state.progress = action.payload;
    },

    /**
     * Adds a completed image to the gallery and resets generating state.
     * @param {Object} action.payload
     * @param {string} action.payload.url - Path or data URL of the generated image
     */
    finishGeneration(state, action) {
      state.generating = false;
      state.progress = 0;
      state.gallery.unshift({
        id: nanoid(),
        url: action.payload.url,
        prompt: state.prompt,
        style: state.style,
        quality: state.quality,
        createdAt: Date.now(),
      });
    },

    /**
     * Removes an image from the gallery by ID.
     */
    removeFromGallery(state, action) {
      state.gallery = state.gallery.filter((item) => item.id !== action.payload);
    },
  },
});

export const {
  setPrompt,
  setStyle,
  setQuality,
  startGeneration,
  updateProgress,
  finishGeneration,
  removeFromGallery,
} = createSliceObj.actions;

export default createSliceObj.reducer;
