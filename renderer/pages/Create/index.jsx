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
  const [referenceImage, setReferenceImage] = useState(null); // { dataUrl, name }
  const [strength, setStrength]       = useState(0.5);

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
        ? await window.electronAPI.generateImage(trimmedPrompt, style, quality, referenceImage?.dataUrl ?? null, strength)
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

  function loadReferenceFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setReferenceImage({ dataUrl: e.target.result, name: file.name });
    reader.readAsDataURL(file);
  }

  function handleReferenceInputChange(e) {
    loadReferenceFile(e.target.files[0]);
    e.target.value = '';
  }

  function handleReferenceDrop(e) {
    e.preventDefault();
    loadReferenceFile(e.dataTransfer.files[0]);
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

        {/* Reference image (img2img) */}
        <div>
          <p className="text-[10px] text-fg-dim uppercase tracking-wider mb-2">Reference Image</p>
          {referenceImage ? (
            <div className="flex flex-col gap-2">
              <div className="relative rounded-lg overflow-hidden border border-stroke">
                <img src={referenceImage.dataUrl} alt="reference" className="w-full h-24 object-cover" />
                <button
                  onClick={() => setReferenceImage(null)}
                  disabled={isGenerating}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded p-0.5 transition-colors disabled:opacity-40"
                  title="Remove reference image"
                >
                  <XIcon />
                </button>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-fg-dim mb-1">
                  <span>Influence</span>
                  <span>{Math.round(strength * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={strength}
                  onChange={(e) => setStrength(parseFloat(e.target.value))}
                  disabled={isGenerating}
                  className="w-full accent-accent disabled:opacity-50"
                />
                <div className="flex justify-between text-[9px] text-fg-faint mt-0.5">
                  <span>Subtle</span>
                  <span>Ignore reference</span>
                </div>
              </div>
            </div>
          ) : (
            <label
              className="flex flex-col items-center justify-center gap-1.5 w-full h-20 border border-dashed border-stroke rounded-lg cursor-pointer hover:border-accent/60 hover:bg-accent/5 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleReferenceDrop}
            >
              <UploadIcon />
              <span className="text-[10px] text-fg-faint">Click or drop an image</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleReferenceInputChange} disabled={isGenerating} />
            </label>
          )}
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
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-faint">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
