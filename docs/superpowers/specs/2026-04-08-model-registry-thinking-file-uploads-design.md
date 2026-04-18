# Design: Model Registry, Thinking Toggle, & File Uploads

**Date:** 2026-04-08  
**Status:** Approved  
**Scope:** Chat page enhancements — model capability registry, grouped model selector, conditional Think button, file/image attachment support with drag-and-drop

---

## 1. Model Registry

### What
A new file `renderer/utils/model-registry.js` — pure data, no Node APIs — that maps model name patterns to capability metadata. All UI logic reads from this single source of truth.

### Schema

```js
const MODEL_REGISTRY = [
  { pattern: /gemma4/,      family: 'gemma',    company: 'Google',    supportsThinking: 'always',  supportsVision: true  },
  { pattern: /qwen3-vl/,    family: 'qwen',     company: 'Alibaba',   supportsThinking: 'toggle',  supportsVision: true  },
  { pattern: /qwen3/,       family: 'qwen',     company: 'Alibaba',   supportsThinking: 'toggle',  supportsVision: false },
  { pattern: /deepseek-r1/, family: 'deepseek', company: 'DeepSeek',  supportsThinking: 'always',  supportsVision: false },
  { pattern: /deepseek/,    family: 'deepseek', company: 'DeepSeek',  supportsThinking: false,     supportsVision: false },
  { pattern: /gpt-oss/,     family: 'gpt-oss',  company: 'OpenAI',    supportsThinking: 'always',  supportsVision: false },
  { pattern: /llama4/,      family: 'llama',    company: 'Meta',      supportsThinking: false,     supportsVision: true  },
  { pattern: /phi4/,        family: 'phi',      company: 'Microsoft', supportsThinking: false,     supportsVision: false },
];
```

`supportsThinking` values:
- `'always'` — model always thinks (Gemma 4, DeepSeek R1, GPT-OSS) — Think button hidden
- `'toggle'` — model supports optional thinking (Qwen 3/3.5) — Think button shown
- `false` — no thinking capability (Llama 4, Phi-4) — Think button hidden

### Exported helpers

```js
export function getModelMeta(modelName)          // returns first registry match or null
export function getModelFamily(modelName)         // returns family string or 'other'
export function getModelCompany(modelName)        // returns company string or 'Other'
export function supportsThinkingToggle(modelName) // true only when supportsThinking === 'toggle'
export function supportsVision(modelName)         // true when supportsVision === true
export function groupModelsByCompany(models)      // groups [{name}] array by company, unknown → 'Other'
```

---

## 2. Model Selector — Grouped by Company

### What
`ModelSelector.jsx` is updated to group installed models by company using `groupModelsByCompany()` from the registry. Each group renders a non-clickable company header followed by its models.

### UI Structure

```
┌─────────────────────────┐
│ Google                  │  ← company header (muted label, not clickable)
│   gemma4:e4b       ✓   │
│   gemma4:26b            │
│ Alibaba                 │
│   qwen3:14b             │
│ OpenAI                  │
│   gpt-oss-20b           │
│ Other                   │
│   some-unknown-model    │
└─────────────────────────┘
```

Unknown models (no registry match) go into an "Other" group at the bottom.

---

## 3. Think Button — Conditional Visibility

### What
The Think button in `Chat/index.jsx` is conditionally rendered based on the selected model's capability. It is only shown when `supportsThinkingToggle(selectedModel)` returns true (i.e., Qwen 3/3.5 models only).

### Behaviour
- Renders only for Qwen family models
- When the user switches to a non-Qwen model, `thinkingMode` is automatically reset to `false` via a `useEffect` watching `selectedModel`
- This prevents the `thinkingMode: true` flag silently persisting when switching away from Qwen

---

## 4. File Uploads — UI

### What
Users can attach images and text files (`.txt`, `.md`, `.pdf`) to messages. Attachments are shown as chips in the input area before sending, and as read-only badges in sent message bubbles.

### Attachment Chip UI (ChatInput.jsx)

```
┌─────────────────────────────────────────────┐
│ 📄 report.pdf ×   🖼 photo.png ×            │  ← chips row (only when files attached)
├─────────────────────────────────────────────┤
│ 📎  Message…                          [▶]  │  ← paperclip left, send right
└─────────────────────────────────────────────┘
```

- Paperclip button triggers a hidden `<input type="file" multiple accept="image/*,.txt,.md,.pdf">`
- Max 5 attachments per message
- Each chip shows filename + × remove button
- If a non-vision model is selected and an image is attached, the chip shows a warning: "This model doesn't support images" (using `supportsVision()` from registry). Send is not blocked — Ollama ignores the images field gracefully.

### Local State

```js
// ChatInput local state
const [attachments, setAttachments] = useState([]);
// Each attachment: { name: string, type: 'image'|'text'|'pdf', content: string }
```

File reading happens in the renderer on selection/drop:
- Images → `FileReader.readAsDataURL()` → base64 string
- `.txt` / `.md` → `FileReader.readAsText()` → plain string
- `.pdf` → `FileReader.readAsArrayBuffer()` → sent to main via `extractPdfText` IPC → returns plain string

Attachments are cleared after send.

### Drag-and-Drop

The entire chat area (`Chat/index.jsx`) acts as a drop zone:
- `onDragOver` → sets `isDragging: true` → shows full-area overlay ("Drop files here")
- `onDragLeave` / `onDrop` → clears overlay
- Dropped files are passed down to ChatInput and processed identically to clicked attachments

### Message Bubble Display

`MessageBubble.jsx` renders a row of read-only attachment badges beneath user message text:
- Only `{ name, type }` stored in Redux (no content — content is ephemeral, used only at send time)
- Badge icons: 🖼 for images, 📄 for all text types

---

## 5. File Uploads — Backend

### PDF Text Extraction

New IPC handler `extractPdfText` in `handlers.js`:
- Receives raw PDF `ArrayBuffer` from renderer
- Uses `pdf-parse` npm package (main process) to extract text
- Returns plain string to renderer

### Message Assembly (Chat/index.jsx handleSend)

Before sending via IPC, attachments are compiled into the message:

**Text/PDF attachments** — prepended to message content:
```
[Attached: report.pdf]
<extracted text content>
---
User's actual message here
```

**Image attachments** — passed as a separate `images: [base64, ...]` array in the IPC payload (not embedded in message text).

### Ollama API (ollama.js)

The `/api/chat` call gains an `images` field on the user message when images are present:
```json
{
  "role": "user",
  "content": "What's in this image?",
  "images": ["<base64string>"]
}
```

### Redux (chat.js)

`Message` type gains optional `attachments: [{ name, type }]` for display only.  
`sendMessage` action accepts and stores this field.

---

## Files Changed

| File | Change |
|------|--------|
| `renderer/utils/model-registry.js` | **New** — model capability registry |
| `renderer/pages/Chat/ModelSelector.jsx` | Group models by company using registry |
| `renderer/pages/Chat/index.jsx` | Conditional Think button, drag-and-drop zone, pass attachments to IPC |
| `renderer/pages/Chat/ChatInput.jsx` | Paperclip button, attachment chips, file reading |
| `renderer/pages/Chat/MessageBubble.jsx` | Attachment badges on user messages |
| `renderer/store/slices/chat.js` | Add `attachments` field to Message type + sendMessage |
| `main/ipc/handlers.js` | New `extractPdfText` IPC handler |
| `main/services/ollama.js` | Forward `images` array to Ollama chat API |
| `package.json` | Add `pdf-parse` dependency |
