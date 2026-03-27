/**
 * @file ModelSelector.jsx
 * @description Dropdown that lists locally available Ollama models and lets the
 * user switch the active model for the current conversation. Fetches the model
 * list via IPC on mount and refreshes it when the user opens the dropdown.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setSelectedModel } from '../../store/slices/chat';

/**
 * @param {{ conversationId: string|null }} props
 */
export default function ModelSelector({ conversationId }) {
  const dispatch = useDispatch();
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const ollamaStatus = useSelector((s) => s.infrastructure.services.ollama?.status);
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // Tracks whether the initial IPC fetch has already run so the effect
  // never fires a second time if selectedModel changes after auto-select.
  const loadedRef = useRef(false);

  async function load() {
    if (!window.electronAPI) return;
    const list = await window.electronAPI.listModels();
    if (list?.length) {
      setModels(list);
      // Auto-select first model if nothing is selected yet
      if (!selectedModel) {
        dispatch(setSelectedModel(list[0].name));
      }
    }
  }

  // Fetch available models once on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [dispatch, selectedModel]);

  // If the initial fetch returned nothing (Ollama was still starting up),
  // retry automatically once Ollama transitions to 'running'.
  useEffect(() => {
    if (ollamaStatus === 'running' && models.length === 0) {
      load();
    }
  }, [ollamaStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function select(name) {
    dispatch(setSelectedModel(name));
    setOpen(false);
  }

  const label = selectedModel ?? 'Select model';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Refresh model list every time the dropdown is opened so we always
          // show up-to-date models and recover from any failed initial fetch.
          if (next) load();
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 text-zinc-300 text-xs transition-colors"
      >
        <span className="max-w-[160px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-zinc-500 flex-shrink-0">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
          {models.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">
              <p>No models found.</p>
              <button
                onClick={() => {
                  setOpen(false);
                  window.electronAPI?.openSettings?.('models');
                }}
                className="mt-1 text-violet-400 hover:text-violet-300 underline underline-offset-2"
              >
                Open Settings → Models to add one
              </button>
            </div>
          ) : (
            models.map((m) => (
              <button
                key={m.name}
                onClick={() => select(m.name)}
                className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-3 ${
                  m.name === selectedModel
                    ? 'text-violet-400 bg-violet-600/10'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span className="truncate">{m.name}</span>
                {m.name === selectedModel && (
                  <span className="text-violet-500 flex-shrink-0">✓</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
