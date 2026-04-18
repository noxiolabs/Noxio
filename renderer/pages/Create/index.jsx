/**
 * @file Create/index.jsx
 * @description Create panel: image generation via ComfyUI. Presents a simple
 * two-column layout — controls on the left, image output on the right. The
 * ComfyUI node graph is never exposed; all generation is driven by style and
 * quality presets that map to pre-built backend workflows.
 *
 * Layout:
 *   [Controls 320px] | [ImageGallery flex-1]
 *
 * Generation flow:
 *   1. User enters prompt, selects style + quality, clicks Generate
 *   2. invoke('generate-image') → main process → orchestrator → ComfyUI
 *   3. 'image-progress' events update the progress bar
 *   4. On success: image added to gallery and shown at full size
 *   5. On error: error message shown below the generate button
 */

import React, { useState, useEffect, useRef } from 'react';
import { nanoid } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';
import StyleSelector from './StyleSelector';
import QualitySelector from './QualitySelector';
import ImageGallery from './ImageGallery';

export default function CreatePanel() {
  const comfyuiStatus = useSelector((s) => s.infrastructure.services?.comfyui?.status);
  const [prompt, setPrompt]           = useState('');
  const [style, setStyle]             = useState('photorealistic');
  const [quality, setQuality]         = useState('standard');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress]       = useState(0);
  const [currentImage, setCurrentImage] = useState(null);
  const [gallery, setGallery]         = useState([]);
  const [error, setError]             = useState('');

  /** Ref to the progress listener so we can remove it on unmount */
  const progressListenerRef = useRef(null);

  // Clean up image-progress listener on unmount
  useEffect(() => {
    return () => {
      if (progressListenerRef.current && window.electronAPI) {
        window.electronAPI.off('image-progress', progressListenerRef.current);
      }
    };
  }, []);

  async function handleGenerate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isGenerating) return;

    setError('');
    setIsGenerating(true);
    setProgress(0);

    // Subscribe to progress events
    const onProgress = ({ percent }) => {
      setProgress(percent ?? 0);
    };
    progressListenerRef.current = onProgress;

    if (window.electronAPI) {
      window.electronAPI.on('image-progress', onProgress);
    }

    try {
      const result = window.electronAPI
        ? await window.electronAPI.generateImage(trimmedPrompt, style, quality)
        : { error: 'electronAPI not available' };

      if (result?.error) {
        setError(result.error);
        setProgress(0);
      } else if (result?.imagePath) {
        const newImage = {
          id: nanoid(),
          src: result.imagePath,
          prompt: trimmedPrompt,
          timestamp: Date.now(),
        };
        setCurrentImage(newImage);
        setGallery((prev) => [newImage, ...prev]);
        setProgress(100);
      }
    } catch (err) {
      setError(`Generation failed: ${err.message}`);
      setProgress(0);
    } finally {
      setIsGenerating(false);
      // Unregister progress listener
      if (window.electronAPI && progressListenerRef.current) {
        window.electronAPI.off('image-progress', progressListenerRef.current);
        progressListenerRef.current = null;
      }
    }
  }

  function handleSelectImage(image) {
    setCurrentImage(image);
  }

  if (comfyuiStatus === 'not-installed') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 p-8">
        <p className="text-fg/60 text-sm">Image generation is not set up.</p>
        <p className="text-fg-faint text-xs">ComfyUI was not installed during setup. To enable image generation, go to Settings and add the Images capability.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left column: controls */}
      <div className="w-[300px] flex-shrink-0 flex flex-col gap-5 p-5 border-r border-stroke overflow-y-auto">
        <div>
          <p className="text-sm font-semibold text-fg mb-1">Create</p>
          <p className="text-xs text-fg-dim">Generate images with local AI</p>
        </div>

        {/* Prompt */}
        <div>
          <p className="text-[10px] text-fg-dim uppercase tracking-wider mb-2">Prompt</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
            placeholder="Describe the image you want to create..."
            rows={5}
            className="w-full bg-panel border border-card rounded-lg px-3 py-2.5 text-sm text-fg placeholder-fg-faint resize-none focus:outline-none focus:border-accent/60 transition-colors disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
          />
        </div>

        {/* Style selector */}
        <StyleSelector value={style} onChange={setStyle} disabled={isGenerating} />

        {/* Quality selector */}
        <QualitySelector value={quality} onChange={setQuality} disabled={isGenerating} />

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <SpinnerIcon />
              Generating…
            </>
          ) : (
            'Generate'
          )}
        </button>

        {/* Progress bar */}
        {isGenerating && (
          <div className="w-full bg-card rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-xs text-red-400/90 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="text-[10px] text-fg-dim mt-auto">
          Tip: press Ctrl+Enter to generate
        </p>
      </div>

      {/* Right column: image output */}
      <div className="flex-1 p-5 overflow-hidden">
        <ImageGallery
          currentImage={currentImage}
          gallery={gallery}
          onSelectImage={handleSelectImage}
        />
      </div>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
