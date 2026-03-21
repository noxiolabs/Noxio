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

- [ ] Start a chat. While the response is streaming, kill the Ollama process from Task Manager.
- [ ] Wait. Within 60 seconds the "Generating…" label should disappear and the partial response should finalise.
- [ ] The input box should become active again (no longer disabled).
- [ ] Start Ollama again. Confirm you can send another message normally.

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

- [ ] Open the model selector dropdown and select a different model.
- [ ] In DevTools → Network (or main process logs): confirm `list-models` IPC is only called once on app startup, NOT again after model selection.
- [ ] Reload the app. Confirm the model selector still auto-selects the first model if none was previously chosen.

---

## 5. Hardware scan failure fallback

**What was fixed:** If `detectHardware()` throws, `scanHardware()` crashed instead of returning a safe fallback.

- [ ] Run the setup wizard normally on the reference machine. Hardware screen shows GPU/VRAM/CPU correctly.
- [ ] (Simulate failure) Temporarily rename `nvidia-smi.exe` to something else, then run the wizard again. The Hardware screen should show "Unknown GPU" and recommend cloud, NOT crash or show a blank screen.
- [ ] Restore `nvidia-smi.exe` and re-run. Correct hardware detected again.

---

## 6. React Error Boundary

**What was fixed:** Uncaught render errors caused a blank white screen with no recovery path.

- [ ] Confirm the app loads normally — no error screen on healthy startup.
- [ ] (Simulate crash) Open DevTools console, type: `throw new Error('test boundary')` and hit Enter. The error boundary screen should appear with the error message and a "Reload app" button.
- [ ] Click "Reload app". App reloads cleanly.
- [ ] (Setup wizard) Confirm the wizard also has boundary protection: navigate to the wizard and repeat the above.

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
