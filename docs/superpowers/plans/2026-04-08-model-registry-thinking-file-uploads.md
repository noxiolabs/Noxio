# Model Registry, Thinking Toggle & File Uploads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a central model capability registry, group the model selector by company, show the Think button only for Qwen models, and support image/text/PDF file attachments in the chat with drag-and-drop.

**Architecture:** A pure-data `model-registry.js` in the renderer is the single source of truth for model capabilities. All UI components import helpers from it. File attachments are read in the renderer (images as base64, text as string, PDFs via a new `extract-pdf-text` IPC call to `pdf-parse` in main), assembled into the message in `handleSend`, and forwarded to Ollama's images array field for vision models.

**Tech Stack:** React, Redux Toolkit, Electron IPC, Vitest, Tailwind CSS, `pdf-parse` (new dependency)

---

## File Map

| File | Action |
|------|--------|
| `renderer/utils/model-registry.js` | **Create** — capability registry |
| `tests/model-registry.test.js` | **Create** — registry unit tests |
| `renderer/pages/Chat/ModelSelector.jsx` | **Modify** — group by company |
| `renderer/pages/Chat/index.jsx` | **Modify** — conditional Think button, drag-and-drop, handleSend with attachments |
| `renderer/pages/Chat/ChatInput.jsx` | **Modify** — paperclip button, attachment chips, file reading |
| `renderer/pages/Chat/MessageBubble.jsx` | **Modify** — attachment badges on user messages |
| `renderer/store/slices/chat.js` | **Modify** — add `attachments` to Message type + sendMessage |
| `tests/store/chat.test.js` | **Modify** — add sendMessage attachments test |
| `main/ipc/handlers.js` | **Modify** — add `extract-pdf-text` handler, pass `images` to generateStream |
| `main/preload.js` | **Modify** — expose `extractPdfText` |
| `main/services/ollama.js` | **Modify** — forward `images` on last user message |
| `package.json` | **Modify** — add `pdf-parse` dependency |

---

## Task 1: Model Registry

**Files:**
- Create: `renderer/utils/model-registry.js`
- Create: `tests/model-registry.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/model-registry.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  getModelMeta,
  getModelFamily,
  getModelCompany,
  supportsThinkingToggle,
  supportsVision,
  groupModelsByCompany,
} from '../renderer/utils/model-registry';

describe('getModelMeta', () => {
  it('returns metadata for a known gemma4 model', () => {
    const meta = getModelMeta('gemma4:27b');
    expect(meta).not.toBeNull();
    expect(meta.company).toBe('Google');
    expect(meta.supportsThinking).toBe('always');
    expect(meta.supportsVision).toBe(true);
  });

  it('returns metadata for deepseek-r1 before generic deepseek', () => {
    const meta = getModelMeta('deepseek-r1:7b');
    expect(meta.supportsThinking).toBe('always');
  });

  it('returns generic deepseek metadata for deepseek-v3', () => {
    const meta = getModelMeta('deepseek-v3.2:latest');
    expect(meta.supportsThinking).toBe(false);
  });

  it('returns null for unknown model', () => {
    expect(getModelMeta('unknown-model:latest')).toBeNull();
  });
});

describe('supportsThinkingToggle', () => {
  it('returns true for qwen3 models', () => {
    expect(supportsThinkingToggle('qwen3:14b')).toBe(true);
  });

  it('returns false for gemma4 (always thinks)', () => {
    expect(supportsThinkingToggle('gemma4:27b')).toBe(false);
  });

  it('returns false for unknown model', () => {
    expect(supportsThinkingToggle('llama2:7b')).toBe(false);
  });
});

describe('supportsVision', () => {
  it('returns true for gemma4', () => {
    expect(supportsVision('gemma4:e4b')).toBe(true);
  });

  it('returns true for llama4', () => {
    expect(supportsVision('llama4:scout')).toBe(true);
  });

  it('returns false for qwen3 (non-VL)', () => {
    expect(supportsVision('qwen3:14b')).toBe(false);
  });

  it('returns true for qwen3-vl', () => {
    expect(supportsVision('qwen3-vl:7b')).toBe(true);
  });
});

describe('groupModelsByCompany', () => {
  it('groups known models by company', () => {
    const models = [
      { name: 'gemma4:27b' },
      { name: 'qwen3:14b' },
      { name: 'mystery:7b' },
    ];
    const groups = groupModelsByCompany(models);
    expect(groups['Google']).toHaveLength(1);
    expect(groups['Alibaba']).toHaveLength(1);
    expect(groups['Other']).toHaveLength(1);
  });

  it('returns empty object for empty list', () => {
    expect(groupModelsByCompany([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd E:/repos/Noxio && npm test -- --reporter=verbose tests/model-registry.test.js
```

Expected: FAIL — `Cannot find module '../renderer/utils/model-registry'`

- [ ] **Step 3: Create the registry**

Create `renderer/utils/model-registry.js`:

```js
/**
 * @file model-registry.js
 * @description Central capability registry for known Ollama model families.
 * Maps model name patterns to metadata: family, company, thinking support, vision support.
 *
 * supportsThinking values:
 *   'always' — model always thinks (Gemma 4, DeepSeek R1, GPT-OSS) — Think button hidden
 *   'toggle' — hybrid thinking (Qwen 3/3.5) — Think button shown
 *   false    — no thinking capability (Llama 4, Phi-4) — Think button hidden
 */

const MODEL_REGISTRY = [
  // ── Google ────────────────────────────────────────────────────────────────
  { pattern: /gemma4/,       family: 'gemma',    company: 'Google',    supportsThinking: 'always', supportsVision: true  },

  // ── Alibaba — qwen3-vl must be checked before qwen3 ──────────────────────
  { pattern: /qwen3-vl/,     family: 'qwen',     company: 'Alibaba',   supportsThinking: 'toggle', supportsVision: true  },
  { pattern: /qwen3/,        family: 'qwen',     company: 'Alibaba',   supportsThinking: 'toggle', supportsVision: false },

  // ── DeepSeek — r1 must be checked before generic deepseek ─────────────────
  { pattern: /deepseek-r1/,  family: 'deepseek', company: 'DeepSeek',  supportsThinking: 'always', supportsVision: false },
  { pattern: /deepseek/,     family: 'deepseek', company: 'DeepSeek',  supportsThinking: false,    supportsVision: false },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  { pattern: /gpt-oss/,      family: 'gpt-oss',  company: 'OpenAI',    supportsThinking: 'always', supportsVision: false },

  // ── Meta ──────────────────────────────────────────────────────────────────
  { pattern: /llama4/,       family: 'llama',    company: 'Meta',      supportsThinking: false,    supportsVision: true  },

  // ── Microsoft ─────────────────────────────────────────────────────────────
  { pattern: /phi4/,         family: 'phi',      company: 'Microsoft', supportsThinking: false,    supportsVision: false },
];

/**
 * Returns the first registry entry whose pattern matches the model name, or null.
 * @param {string} modelName
 * @returns {{ pattern: RegExp, family: string, company: string, supportsThinking: 'always'|'toggle'|false, supportsVision: boolean }|null}
 */
export function getModelMeta(modelName) {
  if (!modelName) return null;
  return MODEL_REGISTRY.find((entry) => entry.pattern.test(modelName)) ?? null;
}

/**
 * @param {string} modelName
 * @returns {string} family name, or 'other' if unknown
 */
export function getModelFamily(modelName) {
  return getModelMeta(modelName)?.family ?? 'other';
}

/**
 * @param {string} modelName
 * @returns {string} company name, or 'Other' if unknown
 */
export function getModelCompany(modelName) {
  return getModelMeta(modelName)?.company ?? 'Other';
}

/**
 * Returns true only for models with toggleable thinking (Qwen 3/3.5).
 * This is the guard for showing the Think button.
 * @param {string} modelName
 * @returns {boolean}
 */
export function supportsThinkingToggle(modelName) {
  return getModelMeta(modelName)?.supportsThinking === 'toggle';
}

/**
 * Returns true for models with vision/multimodal capability.
 * @param {string} modelName
 * @returns {boolean}
 */
export function supportsVision(modelName) {
  return getModelMeta(modelName)?.supportsVision === true;
}

/**
 * Groups an array of model objects by company.
 * Unknown models go into 'Other'.
 * @param {Array<{ name: string }>} models
 * @returns {Record<string, Array<{ name: string }>>}
 */
export function groupModelsByCompany(models) {
  const groups = {};
  for (const model of models) {
    const company = getModelCompany(model.name);
    if (!groups[company]) groups[company] = [];
    groups[company].push(model);
  }
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd E:/repos/Noxio && npm test -- --reporter=verbose tests/model-registry.test.js
```

Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
cd E:/repos/Noxio && git add renderer/utils/model-registry.js tests/model-registry.test.js && git commit -m "feat: add model capability registry with company grouping and thinking/vision flags"
```

---

## Task 2: Model Selector — Grouped by Company

**Files:**
- Modify: `renderer/pages/Chat/ModelSelector.jsx`

- [ ] **Step 1: Update ModelSelector.jsx**

Replace the entire file content. Key change: use `groupModelsByCompany` to group models before rendering, add company headers.

```jsx
/**
 * @file ModelSelector.jsx
 * @description Dropdown that lists locally available Ollama models grouped by
 * company. Uses model-registry to determine groupings. Unknown models go to "Other".
 */

import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setSelectedModel } from '../../store/slices/chat';
import { groupModelsByCompany } from '../../utils/model-registry';

// Company display order — known companies first, Other last
const COMPANY_ORDER = ['Google', 'Alibaba', 'OpenAI', 'DeepSeek', 'Meta', 'Microsoft', 'Other'];

export default function ModelSelector({ conversationId }) {
  const dispatch = useDispatch();
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const ollamaStatus = useSelector((s) => s.infrastructure.services.ollama?.status);
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loadedRef = useRef(false);

  async function load() {
    if (!window.electronAPI) return;
    const list = await window.electronAPI.listModels();
    if (list?.length) {
      setModels(list);
      if (!selectedModel) {
        dispatch(setSelectedModel(list[0].name));
      }
    }
  }

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [dispatch, selectedModel]);

  useEffect(() => {
    if (ollamaStatus === 'running' && models.length === 0) {
      load();
    }
  }, [ollamaStatus]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const grouped = groupModelsByCompany(models);

  // Build ordered list of company keys present in current model list
  const orderedCompanies = [
    ...COMPANY_ORDER.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !COMPANY_ORDER.includes(c)),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
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
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
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
            orderedCompanies.map((company) => (
              <div key={company}>
                {/* Company header */}
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 select-none">
                  {company}
                </div>
                {grouped[company].map((m) => (
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
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manually verify in app**

Start the app and open the model selector dropdown. Models should be grouped under company name headers (e.g., "Google", "Alibaba"). Unknown models appear under "Other".

- [ ] **Step 3: Commit**

```bash
cd E:/repos/Noxio && git add renderer/pages/Chat/ModelSelector.jsx && git commit -m "feat: group model selector by company using model registry"
```

---

## Task 3: Conditional Think Button + Auto-Reset

**Files:**
- Modify: `renderer/pages/Chat/index.jsx`

- [ ] **Step 1: Add registry import and update Think button + useEffect**

In `renderer/pages/Chat/index.jsx`, add the import at the top (after existing imports):

```js
import { supportsThinkingToggle } from '../../utils/model-registry';
```

Add a `useEffect` to reset `thinkingMode` when switching away from a Qwen model. Place it after the existing `useEffect` for stream timeout (around line 65):

```js
// Auto-reset thinking mode when switching to a model that doesn't support toggle thinking.
// Prevents stale thinkingMode: true from persisting on non-Qwen models.
useEffect(() => {
  if (!supportsThinkingToggle(selectedModel)) {
    setThinkingMode(false);
  }
}, [selectedModel]);
```

Replace the Think button JSX (lines 132–143) with a conditional render:

```jsx
{/* Thinking mode toggle — only for models with toggleable thinking (Qwen 3/3.5) */}
{supportsThinkingToggle(selectedModel) && (
  <button
    onClick={() => setThinkingMode((m) => !m)}
    title={thinkingMode ? 'Thinking mode on — click to disable' : 'Enable thinking mode'}
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
      thinkingMode
        ? 'bg-violet-600/20 text-violet-300 border border-violet-600/40'
        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
    }`}
  >
    <BrainIcon />
    <span>Think</span>
  </button>
)}
```

- [ ] **Step 2: Manually verify**

With a Qwen3 model selected: Think button is visible. Switch to Gemma4: Think button disappears. Switch back to Qwen3: Think button reappears with `thinkingMode` reset to false.

- [ ] **Step 3: Commit**

```bash
cd E:/repos/Noxio && git add renderer/pages/Chat/index.jsx && git commit -m "feat: show Think button only for Qwen models, auto-reset on model switch"
```

---

## Task 4: Redux — Add attachments Field to Message

**Files:**
- Modify: `renderer/store/slices/chat.js`
- Modify: `tests/store/chat.test.js`

- [ ] **Step 1: Write a failing test**

Open `tests/store/chat.test.js` and add at the bottom:

```js
describe('sendMessage with attachments', () => {
  it('stores attachment metadata on the user message', () => {
    const state0 = stateWithConversation();
    const state1 = reducer(state0, sendMessage({
      content: 'Look at this',
      attachments: [{ name: 'photo.png', type: 'image' }],
    }));
    const conv = state1.conversations[0];
    const userMsg = conv.messages[0];
    expect(userMsg.role).toBe('user');
    expect(userMsg.attachments).toEqual([{ name: 'photo.png', type: 'image' }]);
  });

  it('stores empty array when no attachments provided', () => {
    const state0 = stateWithConversation();
    const state1 = reducer(state0, sendMessage({ content: 'Hello' }));
    const userMsg = state1.conversations[0].messages[0];
    expect(userMsg.attachments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd E:/repos/Noxio && npm test -- --reporter=verbose tests/store/chat.test.js
```

Expected: FAIL — `userMsg.attachments` is undefined

- [ ] **Step 3: Update sendMessage reducer in chat.js**

In `renderer/store/slices/chat.js`, find the `sendMessage` reducer and update it to accept and store `attachments`. The user message object should include `attachments: action.payload.attachments ?? []`:

Find the `sendMessage` reducer (look for where it creates the user message object with `role: 'user'`). Add `attachments` to both the user message and assistant placeholder:

```js
sendMessage(state, action) {
  const conv = state.conversations.find((c) => c.id === state.activeConversationId);
  if (!conv) return;

  const userMessage = {
    id: nanoid(),
    role: 'user',
    content: action.payload.content,
    attachments: action.payload.attachments ?? [],
    createdAt: Date.now(),
  };

  const assistantMessage = {
    id: nanoid(),
    role: 'assistant',
    content: '',
    attachments: [],
    createdAt: Date.now(),
  };

  conv.messages.push(userMessage, assistantMessage);
  state.streamingMessageId = assistantMessage.id;
  state.streaming = true;
},
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd E:/repos/Noxio && npm test -- --reporter=verbose tests/store/chat.test.js
```

Expected: All tests PASS (including existing ones)

- [ ] **Step 5: Commit**

```bash
cd E:/repos/Noxio && git add renderer/store/slices/chat.js tests/store/chat.test.js && git commit -m "feat: add attachments field to chat Message type and sendMessage reducer"
```

---

## Task 5: PDF IPC Handler + pdf-parse

**Files:**
- Modify: `package.json` (add `pdf-parse`)
- Modify: `main/ipc/handlers.js`
- Modify: `main/preload.js`

- [ ] **Step 1: Install pdf-parse**

```bash
cd E:/repos/Noxio && npm install pdf-parse
```

Expected: `pdf-parse` added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Add IPC handler in handlers.js**

In `main/ipc/handlers.js`, add to the channel list comment at the top:

```
 *   extract-pdf-text          → handlers.js: pdf-parse                    ✓
```

Then add the handler inside `registerHandlers()`, after the existing `send-chat-message` handler (around line 558):

```js
/**
 * Extracts plain text from a PDF file buffer.
 * @param {number[]} payload.buffer - PDF file as a plain number array (from renderer ArrayBuffer)
 * @returns {Promise<{ text: string }|{ error: string }>}
 */
ipcMain.handle('extract-pdf-text', async (_event, { buffer } = {}) => {
  try {
    logger.info('IPC: extract-pdf-text');
    const pdfParse = require('pdf-parse');
    const buf = Buffer.from(buffer);
    const data = await pdfParse(buf);
    return { text: data.text };
  } catch (err) {
    logger.error(`IPC: extract-pdf-text failed — ${err.message}`);
    return { error: err.message };
  }
});
```

- [ ] **Step 3: Expose extractPdfText in preload.js**

In `main/preload.js`, add inside the `contextBridge.exposeInMainWorld('electronAPI', { ... })` object, after `stopStream`:

```js
/**
 * Extracts plain text from a PDF buffer.
 * @param {number[]} buffer - PDF file as a plain number array
 * @returns {Promise<{ text: string }|{ error: string }>}
 */
extractPdfText: (buffer) => ipcRenderer.invoke('extract-pdf-text', { buffer }),
```

- [ ] **Step 4: Manually verify**

Start the app. Open DevTools in the renderer and run:

```js
const result = await window.electronAPI.extractPdfText([]);
console.log(result); // Should return { error: '...' } not crash
```

Expected: returns `{ error: 'Invalid PDF structure' }` or similar — no crash, no undefined.

- [ ] **Step 5: Commit**

```bash
cd E:/repos/Noxio && git add main/ipc/handlers.js main/preload.js package.json package-lock.json && git commit -m "feat: add extract-pdf-text IPC handler using pdf-parse"
```

---

## Task 6: ChatInput — File Picker & Attachment Chips

**Files:**
- Modify: `renderer/pages/Chat/ChatInput.jsx`

- [ ] **Step 1: Replace ChatInput.jsx**

Replace the entire file:

```jsx
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
 *   onAttachmentsChange?: (attachments: Array) => void,
 * }} props
 */
export default function ChatInput({ value, onChange, onSend, onStop }) {
  const streaming     = useSelector((s) => s.chat.streaming);
  const selectedModel = useSelector((s) => s.chat.selectedModel);
  const textareaRef   = useRef(null);
  const fileInputRef  = useRef(null);
  const prevStreamingRef = useRef(false);
  const [attachments, setAttachments] = useState([]);

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
    const toAdd = Array.from(files).slice(0, remaining);
    if (!toAdd.length) return;

    const read = await Promise.all(toAdd.map(readFile));
    setAttachments((prev) => [...prev, ...read]);
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
    onSend(attachments);
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
                  key={i}
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
```

- [ ] **Step 2: Manually verify**

Start the app. Click the paperclip — file picker opens. Select a `.txt` and an image. Chips appear above the textarea. The × button removes a chip. Selecting a non-vision model with an image chip shows the amber warning.

- [ ] **Step 3: Commit**

```bash
cd E:/repos/Noxio && git add renderer/pages/Chat/ChatInput.jsx && git commit -m "feat: add file attachment chips and paperclip button to ChatInput"
```

---

## Task 7: Drag-and-Drop + handleSend with Attachments

**Files:**
- Modify: `renderer/pages/Chat/index.jsx`

- [ ] **Step 1: Update Chat/index.jsx**

Add `isDragging` state and drag handlers to the chat area, update `handleSend` to accept and process attachments, and wire `onSend` on `ChatInput` to pass attachments through.

Add state at the top of `ChatPanel` (after `[thinkingMode, setThinkingMode]`):

```js
const [isDragging, setIsDragging] = useState(false);
```

Update `handleSend` to accept `attachments` and build the IPC payload. Replace the existing `handleSend` function:

```js
async function handleSend(attachments = []) {
  setStreamError('');
  const content = input.trim();
  if ((!content && attachments.length === 0) || !selectedModel || streaming) return;

  let convId = activeId;
  if (!convId) {
    convId = nanoid();
    dispatch(createConversation({ id: convId, model: selectedModel }));
  }

  // Process text/pdf attachments into message content prefix
  let fullContent = content;
  const imageAttachments = [];
  const displayAttachments = [];

  for (const att of attachments) {
    displayAttachments.push({ name: att.name, type: att.type });

    if (att.type === 'image') {
      // Strip the data URL prefix (data:image/png;base64,...) to get raw base64
      const base64 = att.content.includes(',') ? att.content.split(',')[1] : att.content;
      imageAttachments.push(base64);
    } else if (att.type === 'pdf') {
      // Send ArrayBuffer to main for text extraction
      const buffer = Array.from(new Uint8Array(att.content));
      const result = await window.electronAPI.extractPdfText(buffer);
      if (result?.text) {
        fullContent = `[Attached: ${att.name}]\n${result.text}\n---\n${fullContent}`;
      }
    } else {
      // text / md — inject directly
      fullContent = `[Attached: ${att.name}]\n${att.content}\n---\n${fullContent}`;
    }
  }

  const existingMessages = (activeConversation?.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const messages = [...existingMessages, { role: 'user', content: fullContent }];

  dispatch(sendMessage({ content: fullContent, attachments: displayAttachments }));
  setInput('');

  if (window.electronAPI) {
    window.electronAPI.sendChatMessage({
      message: fullContent,
      model: selectedModel,
      conversationId: convId,
      messages,
      systemPrompt,
      contextWindow,
      thinkingMode,
      images: imageAttachments,
    });
  }

  clearTimeout(streamTimeoutRef.current);
  streamTimeoutRef.current = setTimeout(() => {
    dispatch(finaliseStream());
    setStreamError('Ollama lost connection. Response may be incomplete.');
  }, STREAM_TIMEOUT_MS);
}
```

Add drag handlers and the drop overlay. Replace the outer `<div className="flex h-full overflow-hidden">` with:

```jsx
return (
  <div
    className="flex h-full overflow-hidden relative"
    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }}
    onDrop={(e) => {
      e.preventDefault();
      setIsDragging(false);
      // Files land in the ChatInput via a custom event — we pass them to a ref
      if (e.dataTransfer.files?.length) {
        droppedFilesRef.current = e.dataTransfer.files;
        setDropTick((t) => t + 1); // trigger useEffect below
      }
    }}
  >
    {/* Drag overlay */}
    {isDragging && (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-900/80 border-2 border-dashed border-violet-500/60 rounded-xl pointer-events-none">
        <div className="text-center">
          <div className="text-4xl mb-2">📎</div>
          <p className="text-violet-300 font-medium text-sm">Drop files here</p>
          <p className="text-zinc-500 text-xs mt-1">Images, PDF, TXT, MD</p>
        </div>
      </div>
    )}
    {/* ... rest of existing layout ... */}
  </div>
);
```

Add `droppedFilesRef` and `dropTick` state to `ChatPanel`, and wire them to `ChatInput`:

```js
const droppedFilesRef = useRef(null);
const [dropTick, setDropTick] = useState(0);
```

Pass to `ChatInput`:

```jsx
<ChatInput
  value={input}
  onChange={setInput}
  onSend={handleSend}
  onStop={handleStop}
  droppedFiles={droppedFilesRef.current}
  dropTick={dropTick}
/>
```

In `ChatInput`, add a `useEffect` to consume dropped files:

```js
useEffect(() => {
  if (droppedFiles && dropTick > 0) {
    handleFiles(droppedFiles);
  }
}, [dropTick]);
```

And add `droppedFiles` and `dropTick` to `ChatInput`'s props destructuring:

```js
export default function ChatInput({ value, onChange, onSend, onStop, droppedFiles, dropTick }) {
```

- [ ] **Step 2: Manually verify drag-and-drop**

Start the app. Drag a file over the chat area — the violet dashed overlay appears. Drop it — the file appears as a chip in the input. Drag-leave without dropping — overlay disappears.

- [ ] **Step 3: Commit**

```bash
cd E:/repos/Noxio && git add renderer/pages/Chat/index.jsx && git commit -m "feat: add drag-and-drop file upload zone and wire attachment assembly in handleSend"
```

---

## Task 8: Ollama — Forward Images to API

**Files:**
- Modify: `main/services/ollama.js`
- Modify: `main/ipc/handlers.js`

- [ ] **Step 1: Update handlers.js to pass images**

In `main/ipc/handlers.js`, find the `send-chat-message` handler (line 539). Update the destructuring to include `images` and pass it to `generateStream`:

```js
ipcMain.handle('send-chat-message', async (_event, { messages, model, conversationId, systemPrompt, contextWindow, thinkingMode, images } = {}) => {
  try {
    logger.info(`IPC: send-chat-message — model: ${model}, conv: ${conversationId}, turns: ${messages?.length}, thinking: ${!!thinkingMode}, images: ${images?.length ?? 0}`);

    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('routing-decision', {
        provider: 'local',
        model,
        conversationId,
      });
    }

    await ollama.generateStream(model, messages, mainWindow, { systemPrompt, contextWindow, think: thinkingMode, images });
  } catch (err) {
    logger.error(`IPC: send-chat-message error — ${err.message}\n${err.stack}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stream-complete');
    }
  }
});
```

- [ ] **Step 2: Update generateStream in ollama.js to attach images to last user message**

In `main/services/ollama.js`, find the `generateStream` function. Update the messages assembly section (currently around line 266–280) to attach images to the last user message when provided:

```js
// Build messages array with optional system prompt prepended
let messagesWithSystem = messages;
if (options.systemPrompt && typeof options.systemPrompt === 'string' && options.systemPrompt.trim()) {
  messagesWithSystem = [
    { role: 'system', content: options.systemPrompt },
    ...messages,
  ];
}

// Attach images to the last user message if provided
if (options.images && options.images.length > 0) {
  messagesWithSystem = messagesWithSystem.map((msg, idx) => {
    const isLastUserMessage =
      msg.role === 'user' &&
      idx === messagesWithSystem.map((m) => m.role).lastIndexOf('user');
    return isLastUserMessage ? { ...msg, images: options.images } : msg;
  });
}

const body = JSON.stringify({
  model,
  messages: messagesWithSystem,
  stream: true,
  options: { num_ctx: safeContextWindow },
  ...(options.think ? { think: true } : {}),
});
```

- [ ] **Step 3: Manually verify with a vision model**

With Gemma4 selected, attach an image and ask "What is in this image?". The model should respond about the image content.

- [ ] **Step 4: Commit**

```bash
cd E:/repos/Noxio && git add main/services/ollama.js main/ipc/handlers.js && git commit -m "feat: forward image attachments to Ollama chat API on last user message"
```

---

## Task 9: MessageBubble — Attachment Badges

**Files:**
- Modify: `renderer/pages/Chat/MessageBubble.jsx`

- [ ] **Step 1: Add attachment badges to user message rendering**

In `renderer/pages/Chat/MessageBubble.jsx`, find the user message return block (currently around line 166):

```jsx
if (isUser) {
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-violet-600/20 border border-violet-600/30 text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}
```

Replace with:

```jsx
if (isUser) {
  const attachments = message.attachments ?? [];
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[75%] flex flex-col items-end gap-1.5">
        {/* Attachment badges */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {attachments.map((att, i) => (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-400 text-[11px]"
              >
                <span>{att.type === 'image' ? '🖼' : '📄'}</span>
                <span className="max-w-[120px] truncate">{att.name}</span>
              </span>
            ))}
          </div>
        )}
        {/* Message bubble */}
        <div className="px-4 py-2.5 rounded-2xl rounded-br-md bg-violet-600/20 border border-violet-600/30 text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify**

Send a message with attachments. The sent bubble shows small attachment badges above the message text with the filename and appropriate icon (🖼 for image, 📄 for text/pdf).

- [ ] **Step 3: Commit**

```bash
cd E:/repos/Noxio && git add renderer/pages/Chat/MessageBubble.jsx && git commit -m "feat: show attachment badges on user message bubbles"
```

---

## Task 10: Run All Tests + Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd E:/repos/Noxio && npm test
```

Expected: All tests pass. No regressions in `chat.test.js`, `model-registry.test.js`, or any other test file.

- [ ] **Step 2: End-to-end smoke test**

1. Start the app
2. Open Chat — model selector shows models grouped by company (e.g., Google / Alibaba headers)
3. Select a Qwen3 model — Think button appears; toggle it on
4. Switch to Gemma4 — Think button disappears, thinkingMode resets to false
5. Attach a `.txt` file via paperclip — chip appears
6. Attach an image — chip appears (with ⚠ if non-vision model)
7. Drag a PDF onto the chat area — drop overlay shows, chip appears after drop
8. Send — message bubble shows attachment badges; model responds
9. Select a vision model (Gemma4), attach an image, ask about it — model describes the image

- [ ] **Step 3: Commit any final clean-up if needed, then push the branch**

```bash
cd E:/repos/Noxio && git log --oneline -10
```

Verify all 9 feature commits are present with clean messages.
