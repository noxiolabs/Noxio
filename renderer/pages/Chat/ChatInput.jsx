/**
 * @file ChatInput.jsx
 * @description Chat message input area. Supports text input, file attachments
 * (images, .txt, .md, .pdf), Enter to send, Shift+Enter for newlines.
 * Shows attachment chips above textarea when files are selected.
 * Exposes { attachments } alongside value/onChange/onSend/onStop.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { supportsVision } from '../../utils/model-registry';

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_MB = 50;

/**
 * Reads a File and returns { name, type, content } for use in handleSend.
 * - Images   → base64 data URL
 * - Text/MD  → plain string
 * - PDF      → ArrayBuffer (caller sends to main for extraction)
 * @param {File} file
 * @returns {Promise<{ name: string, type: 'image'|'text'|'pdf', content: string|ArrayBuffer }>}
 */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');

    reader.onload = (e) => {
      resolve({
        name: file.name,
        type: isImage ? 'image' : isPdf ? 'pdf' : 'text',
        content: e.target.result,
      });
    };
    reader.onerror = reject;

    if (isImage) {
      reader.readAsDataURL(file);
    } else if (isPdf) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
}

/**
 * @param {{
 *   value: string,
 *   onChange: (v: string) => void,
 *   onSend: (attachments: Array<{name:string,type:string,content:any}>) => void,
 *   onStop: () => void,
 *   droppedFiles?: FileList,
 *   dropTick?: number,
 * }} props
 */
export default function ChatInput({ value, onChange, onSend, onStop, droppedFiles, dropTick }) {
  const streaming     = useSelector((s) => s.chat.streaming);
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const textareaRef   = useRef(null);
  const fileInputRef  = useRef(null);
  const prevStreamingRef = useRef(false);
  const [attachments, setAttachments] = useState([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // Auto-focus when streaming ends
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      textareaRef.current?.focus();
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Consume dropped files from parent
  useEffect(() => {
    if (droppedFiles && dropTick > 0) {
      handleFiles(droppedFiles);
    }
  }, [dropTick]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && (value.trim() || attachments.length) && selectedModel) {
        handleSendClick();
      }
    }
  }

  async function handleFiles(files) {
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const candidates = Array.from(files).filter((f) => {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        console.error(`"${f.name}" exceeds the ${MAX_FILE_SIZE_MB}MB limit and was skipped.`);
        return false;
      }
      return true;
    });
    const toAdd = candidates.slice(0, remaining);
    if (!toAdd.length) return;

    try {
      const read = await Promise.all(toAdd.map(readFile));
      setAttachments((prev) => [...prev, ...read]);
    } catch (err) {
      console.error('Failed to read attachment:', err);
    }
  }

  function handleFileInput(e) {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    }
  }

  function removeAttachment(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSendClick() {
    onSend(attachments, webSearchEnabled);
    setAttachments([]);
  }

  const canSend = !streaming && (value.trim().length > 0 || attachments.length > 0) && !!selectedModel;
  const visionSupported = supportsVision(selectedModel);

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="flex flex-col bg-zinc-900/80 border border-zinc-700/60 rounded-xl focus-within:border-zinc-600 transition-colors">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((att, i) => {
              const isImageOnNonVision = att.type === 'image' && !visionSupported;
              return (
                <div
                  key={`${att.name}-${i}`}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border ${
                    isImageOnNonVision
                      ? 'bg-amber-900/20 border-amber-700/40 text-amber-400'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                  }`}
                >
                  <span>{att.type === 'image' ? '🖼' : '📄'}</span>
                  <span className="max-w-[120px] truncate">{att.name}</span>
                  {isImageOnNonVision && (
                    <span className="text-amber-500" title="This model doesn't support images">⚠</span>
                  )}
                  <button
                    onClick={() => removeAttachment(i)}
                    className="ml-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                    aria-label={`Remove ${att.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 p-3">
          {/* Paperclip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || attachments.length >= MAX_ATTACHMENTS}
            title="Attach file (image, txt, md, pdf)"
            className="flex-shrink-0 w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <PaperclipIcon />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.pdf"
            className="hidden"
            onChange={handleFileInput}
          />

          {/* Web search toggle */}
          <button
            onClick={() => setWebSearchEnabled((v) => !v)}
            disabled={streaming}
            title={webSearchEnabled ? 'Web search on — click to disable' : 'Enable web search (DuckDuckGo)'}
            className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              webSearchEnabled
                ? 'bg-violet-600/20 text-violet-300 border border-violet-600/40'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <GlobeIcon />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedModel ? 'Message…' : 'Select a model to start chatting'}
            disabled={!selectedModel || streaming}
            rows={1}
            className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm resize-none outline-none leading-relaxed max-h-[200px] disabled:opacity-40"
          />

          <div className="flex-shrink-0 pb-0.5">
            {streaming ? (
              <button
                onClick={onStop}
                title="Stop generating"
                className="w-8 h-8 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="2" y="2" width="8" height="8" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSendClick}
                disabled={!canSend}
                title="Send (Enter)"
                className="w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-center text-[10px] text-zinc-700 mt-1.5">
        Shift+Enter for new line · runs locally on your GPU
      </p>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
