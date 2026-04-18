# Design: Internet Access in Chat (DuckDuckGo)

**Date:** 2026-04-09
**Status:** Approved
**Branch:** feature/p2-internet-access
**Scope:** Chat panel — user-triggered web search toggle using DuckDuckGo Instant Answers API. No API key, no new npm dependencies.

---

## 1. Overview

A globe button in the chat input toolbar lets users enable web search for a message. When active, the main process queries the DuckDuckGo Instant Answers API before sending to Ollama, and prepends the results as a context block. The LLM answers with real-world knowledge from the search.

---

## 2. User Experience

1. Globe icon button sits next to the paperclip in the chat input toolbar
2. Inactive: grey, same style as disabled Think button
3. Active: violet highlight, same style as active Think button
4. When user sends with web search on:
   - Globe button shows a brief loading indicator (spinner) while fetching
   - On success: results prepended to message content before sending to Ollama
   - User message bubble shows a globe badge
5. If search fails or times out (3s): message sends without context — non-blocking, no error banner

---

## 3. Architecture

```
ChatInput
  globe toggle → webSearchEnabled (local state)
  onSend(attachments, webSearchEnabled) ← signature change

index.jsx handleSend(attachments, webSearchEnabled)
  if webSearchEnabled && content:
    results = await window.electronAPI.searchWeb(content)  ← IPC invoke
    if results: fullContent = buildSearchContext(results, content)
  dispatch(sendMessage({ content: fullContent, attachments, webSearchUsed: !!results }))
  sendChatMessage to Ollama

main/ipc/handlers.js
  'search-web' handler → webSearch.search(query) → returns results

main/services/web-search.js
  search(query) → fetch DuckDuckGo IA API → parse → return array
```

---

## 4. DuckDuckGo Instant Answers API

**Endpoint:** `GET https://api.duckduckgo.com/?q={query}&format=json&no_redirect=1&no_html=1&skip_disambig=1`

**Response shape (relevant fields):**
```json
{
  "AbstractText": "Main summary paragraph (Wikipedia-style, often empty)",
  "AbstractURL": "https://...",
  "AbstractSource": "Wikipedia",
  "RelatedTopics": [
    { "Text": "Title — snippet", "FirstURL": "https://..." },
    { "Topics": [...] }
  ],
  "Results": [
    { "Text": "Title — snippet", "FirstURL": "https://..." }
  ]
}
```

**Parsing strategy:**
1. If `AbstractText` is non-empty → include as primary summary
2. Collect `Results` entries (flat, each has `Text` + `FirstURL`)
3. Collect `RelatedTopics` entries that have `Text` + `FirstURL` (skip nested `Topics` groups)
4. Return up to 5 items total: `[{ title, snippet, url }]`

**Text parsing:** DDG `Text` field format is `"Title — snippet text"`. Split on ` — ` to separate title from snippet.

**Timeout:** 3 seconds. If fetch throws or times out, return `{ error: 'timeout' }`.

---

## 5. Context Injection Format

Prepended to the user's message content before sending to Ollama:

```
[Web search: "{query}"]
{AbstractSource}: {AbstractText}
1. {title}
   {snippet}
   Source: {url}
2. ...
---

{original user message}
```

If no AbstractText, omit the source line. If no results at all, send without injection.

---

## 6. IPC Contract

### `search-web` (invoke)

**Input:** `{ query: string }`
**Output (success):** `{ results: Array<{ title: string, snippet: string, url: string }>, abstract?: { text: string, url: string, source: string } }`
**Output (error):** `{ error: string }`

### Preload addition

```js
searchWeb: (query) => ipcRenderer.invoke('search-web', { query }),
```

No new `VALID_RECEIVE_CHANNELS` entries needed — this is pure invoke/response.

---

## 7. Redux State Changes

**`sendMessage` payload:** add `webSearchUsed: boolean`

```js
const userMessage = {
  id: nanoid(),
  role: 'user',
  content,
  attachments: attachments ?? [],
  webSearchUsed: webSearchUsed ?? false,
  createdAt: Date.now(),
};
```

---

## 8. ChatInput Signature Change

```jsx
// Before:
onSend: (attachments) => void

// After:
onSend: (attachments, webSearchEnabled) => void
```

`ChatInput` manages `webSearchEnabled` as local state. `handleSendClick` calls `onSend(attachments, webSearchEnabled)`.

---

## 9. MessageBubble Badge

User messages with `webSearchUsed: true` show a small globe badge below the message content:

```jsx
{message.webSearchUsed && (
  <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 mt-1">
    <GlobeIcon size={10} />
    Web search used
  </span>
)}
```

---

## 10. Error Handling

| Scenario | Behaviour |
|---|---|
| Network error | Return `{ error }`, send without context |
| Timeout (3s) | Same |
| Empty results | Return `{ results: [] }`, send without context injection |
| `query` missing/empty | Handler returns `{ error: 'query required' }` immediately |

---

## 11. Out of Scope

- SearXNG (backlog: future scope)
- Persistent web search setting (always on) — toggle per message only
- Showing search results as a collapsible panel (future UX improvement)
- Caching results
