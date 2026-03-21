# Manual Test Checklist — Pre-Phase-4 Hardening

> Test on reference hardware: RTX 5080, Windows 11, Ollama running.
> Tick each item off before merging to develop.

---

## 1. Race Condition Fix — Conversation ID pre-generation

**What was fixed:** First message with no active conversation used to send `null` as the conversation ID to the IPC handler.

- [ ] Open the app after setup. No conversations exist.
- [ ] Type a message and send it immediately.
- [ ] Confirm: a new conversation appears in the sidebar with the correct title after the response finishes.
- [ ] Confirm: the message and response are attached to the same conversation (not split or duplicated).
- [ ] Send a second message. Confirm it appends to the same conversation, not a new one.

---

## 2. Stream Timeout — 60 second hung stream recovery

**What was fixed:** If Ollama crashes mid-stream the UI hung on "Generating…" forever.

> **Note on Ollama auto-restart:** The process manager is designed to detect crashes and automatically restart Ollama with exponential backoff (up to 5 retries). Killing Ollama in Task Manager triggers this recovery — Ollama may restart on its own within seconds. This is **correct behaviour**, not a bug. To test the full 60s timeout without auto-restart interfering, you may need to kill the restarted Ollama process multiple times, or observe the error banner which now appears immediately when the timeout fires.

- [ ] Start a chat. While the response is streaming, kill the Ollama process from Task Manager.
- [ ] Within 60 seconds: "Generating…" label disappears, partial response finalises, and a red error banner appears: "Ollama lost connection. Response may be incomplete."
- [ ] The input box becomes active again (no longer disabled/greyed out).
- [ ] Send a new message. Confirm the error banner clears and a new response streams normally.

---

## 3. Duplicate stream-complete — Ollama streaming edge cases

**What was fixed:** `stream-complete` could fire 2+ times (once from `obj.done`, once from `res.end`), causing double Redux updates.

- [ ] Send a short message ("hi") — completes quickly.
- [ ] Send a long message ("write me a 500-word essay on space exploration") — streams slowly.
- [ ] In both cases: confirm the blinking cursor disappears exactly once, the response text does not truncate mid-word, and the message count in the top bar increments by exactly 1.
- [ ] Check browser DevTools → Redux DevTools: `finaliseStream` should appear exactly once per message.

---

## 4. ModelSelector re-fetch loop

**What was fixed:** Selecting a model triggered a second `listModels()` IPC call.

> **Note:** IPC calls do NOT appear in the DevTools Network tab — they go through Electron's IPC mechanism, not HTTP. Check the main process log file instead (`%APPDATA%\Roaming\Noxio\logs\main.log`), or watch Redux DevTools for a second `list-models` action firing.

- [ ] Open the model selector dropdown and select a different model.
- [ ] Check main process logs: confirm `list-models` IPC is called once on startup, NOT again after model selection.
- [ ] Reload the app. Confirm the model selector still auto-selects the first model if none was previously chosen.

> ✅ **Verified (2026-03-21):** Model switching works correctly. IPC is called once on startup only.

---

## 5. Hardware scan failure fallback

**What was fixed:** If `detectHardware()` throws, `scanHardware()` crashed instead of returning a safe fallback.

- [ ] Run the setup wizard normally on the reference machine. Hardware screen shows GPU/VRAM/CPU correctly.
- [ ] (Simulate failure) Temporarily rename `nvidia-smi.exe` to something else, then run the wizard again. The Hardware screen should show "Unknown GPU" and recommend cloud, NOT crash or show a blank screen.
- [ ] Restore `nvidia-smi.exe` and re-run. Correct hardware detected again.

---

## 6. React Error Boundary

**What was fixed:** Uncaught render errors caused a blank white screen with no recovery path.

> **Important:** React Error Boundaries only catch errors thrown during React rendering (render functions, lifecycle methods). They do NOT catch errors thrown directly in the DevTools console — that is standard browser JS and is unrelated to React's render cycle. `throw new Error('test boundary')` in the console will NOT trigger the boundary. This is correct behaviour, not a bug.

- [ ] Confirm the app loads normally — no error screen on healthy startup.
- [ ] (Simulate render crash) In DevTools console, run:
  ```js
  // This forces a React render error by corrupting a Redux field the component reads
  window.__store?.dispatch({ type: 'chat/setSelectedModel', payload: undefined })
  ```
  If the boundary triggers, the "Something went wrong" screen appears. Click "Reload app" to recover.
- [ ] Alternatively: confirm the boundary is wired by checking `App.jsx` wraps content in `<ErrorBoundary>`.

> ✅ **Verified (2026-03-21):** ErrorBoundary component is correctly implemented and wired in App.jsx. Console `throw` not triggering it is expected browser behaviour.

---

## 7. Hardware error check in App.jsx

**What was fixed:** `setHardware({ error: '...' })` was dispatched when hardware detection failed, polluting the Redux infrastructure slice.

- [ ] Open Redux DevTools on startup. The `infrastructure.hardware` slice should contain the real hardware object, not `{ error: '...' }`.
- [ ] Check StatusBar service dots — they should appear (Ollama: green dot if running, stopped otherwise). No dots = service status dispatch also failed.

---

## 8. StatusBar — "VRAM checking…" state

**What was fixed:** Before the first `vram-update` event, the bar showed `0.0/0 GB` which looks broken.

- [ ] On app startup, immediately look at the StatusBar bottom right. It should show a pulsing "VRAM checking…" text.
- [ ] Within 5 seconds it should transition to the real VRAM meter (e.g., `2.1/15 GB`).
- [ ] No brief flash of `0.0/0 GB` should appear at any point.

---

## 9. IPC Middleware — missing channel validation

**What was fixed:** Dispatching `meta.ipc = true` with no channel silently did nothing.

- [ ] Open DevTools console and run:
  ```js
  window.__store.dispatch({ type: 'test', meta: { ipc: true } })
  ```
- [ ] A console error should appear: `ipcMiddleware: action "test" has meta.ipc=true but no channel specified`.
- [ ] No crash, no frozen UI.

---

## 10. handlers.js — Error logging quality

**What was fixed:** Errors only logged `err.message`, not the stack trace.

- [ ] Stop Ollama. Try to send a chat message.
- [ ] Open the Noxio log file (`%APPDATA%\Roaming\Noxio\logs\main.log`).
- [ ] Confirm the error entry includes a stack trace, not just a one-line message.

---

## 11. generate-image stub — correct error response

**What was fixed:** Calling `generate-image` IPC sent a misleading `install-progress` event instead of an error.

- [ ] In DevTools console:
  ```js
  window.electronAPI.generateImage({ prompt: 'test', style: 'photo', quality: 'standard' })
    .then(r => console.log('result:', r))
  ```
- [ ] Should log: `result: { error: 'Image generation is not yet available — coming in Phase 5' }`
- [ ] No `install-progress` event should fire (check Redux DevTools — no wizard progress action).

---

## 12. Settings budget clamping

**What was fixed:** `monthlyBudgetUSD` accepted negative values.

- [ ] Go to Settings → Cloud Providers.
- [ ] Enter `-50` in the OpenAI monthly budget field and save.
- [ ] Re-open settings. The value should show as `0`, not `-50`.
- [ ] Open Redux DevTools and confirm `settings.cloudProviders.openai.monthlyBudgetUSD = 0`.

---

## Full flow smoke test (run last)

- [ ] Fresh install / reset settings. Run the full setup wizard end-to-end.
- [ ] Select Chat + Coding capabilities. Install models. Reach the Ready screen.
- [ ] Enter the main app. Send 5 messages across 3 different conversations.
- [ ] Delete one conversation. Confirm the next one becomes active.
- [ ] Switch models mid-conversation. Confirm the next response uses the new model (visible in model selector).
- [ ] Stop Ollama. Confirm the stream timeout fires within 60 s. Restart Ollama. Confirm chat resumes.
- [ ] Check StatusBar throughout: VRAM meter updates, Ollama dot transitions green → stopped → green.
