/**
 * @file ImageGallery.jsx
 * @description Image output area for the Create panel.
 * Shows the most recently generated image at full size, with a scrollable
 * thumbnail gallery below it for previous generations. Each thumbnail has a
 * Save button that triggers a file-save dialog via IPC.
 *
 * Empty state is shown when no images have been generated yet.
 */

import React from 'react';

/**
 * @typedef {{ id: string, src: string, prompt: string, timestamp: number }} GalleryImage
 */

/**
 * Saves an image to disk by opening the OS file-save dialog via IPC.
 * Uses the IPC channel 'save-image' if available, otherwise falls back to
 * creating a temporary anchor element for download.
 *
 * @param {string} src - Base64 data URL of the image
 * @param {string} prompt - Prompt used to generate the image (used as filename hint)
 */
async function saveImage(src, prompt) {
  // Fallback: create a temporary anchor and trigger a download in the renderer.
  // Phase 6 can upgrade this to a proper native save dialog via a new IPC channel.
  const link = document.createElement('a');
  const slug = prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
  link.download = `noxio_${slug}_${Date.now()}.png`;
  link.href = src;
  link.click();
}

/**
 * @param {{
 *   currentImage: GalleryImage|null,
 *   gallery: GalleryImage[],
 *   onSelectImage: (image: GalleryImage) => void,
 * }} props
 */
export default function ImageGallery({ currentImage, gallery, onSelectImage }) {
  if (!currentImage && gallery.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-zinc-800/60 flex items-center justify-center mb-4">
          <ImagePlaceholderIcon />
        </div>
        <p className="text-zinc-400 text-sm font-medium">Your generated images will appear here</p>
        <p className="text-zinc-600 text-xs mt-1">Enter a prompt and click Generate</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Current image — full size */}
      {currentImage && (
        <div className="flex-1 relative overflow-hidden rounded-xl bg-zinc-900 min-h-0">
          <img
            src={currentImage.src}
            alt={currentImage.prompt}
            className="w-full h-full object-contain"
          />
          <button
            onClick={() => saveImage(currentImage.src, currentImage.prompt)}
            className="absolute bottom-3 right-3 px-3 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs rounded-lg backdrop-blur-sm transition-colors border border-zinc-700/50"
          >
            Save
          </button>
        </div>
      )}

      {/* Thumbnail gallery — only shown if there's more than one image */}
      {gallery.length > 1 && (
        <div className="flex gap-2 pt-3 overflow-x-auto flex-shrink-0 pb-1">
          {gallery.map((img) => (
            <div
              key={img.id}
              className={`relative flex-shrink-0 cursor-pointer group rounded-lg overflow-hidden border-2 transition-colors ${
                currentImage?.id === img.id
                  ? 'border-violet-500'
                  : 'border-zinc-800 hover:border-zinc-600'
              }`}
              onClick={() => onSelectImage(img)}
            >
              <img
                src={img.src}
                alt={img.prompt}
                className="w-16 h-16 object-cover"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  saveImage(img.src, img.prompt);
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-white font-medium"
              >
                Save
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImagePlaceholderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
