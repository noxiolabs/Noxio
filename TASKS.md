# TASKS.md — Noxio

Current task list, status, and phase breakdown. Update this file at the start of every session before doing any work.

---

## Current Status (as of March 2026)

- POC validated on reference hardware (RTX 5080, Windows 11)
- GitHub repo created: github.com/noxiolabs/Noxio
- README, LICENSE (AGPL-3.0), topics, Discussions all live on GitHub
- **Phases 1–6 complete** — Chat panel, Create panel (image generation), Voice panel (push-to-talk + TTS), and real service installer all working
- **Image generation confirmed working** on RTX 5080 (Blackwell sm_100) with CUDA 12.8 / ComfyUI cu128
- **83 unit tests passing**
- Phase 5 PR merged to main
- Target: **v0.1-alpha (chat only) — DELIVERED**, v0.1 full release by end of Week 16
- Current week: **Week 10**

---

## Completed Phases

### Phase 1 — Electron Shell + IPC Bridge (Weeks 1–2) ✅ COMPLETE

- [x] Scaffold repo structure (`main/`, `renderer/`, `configs/`)
- [x] `main/index.js` — BrowserWindow, load preload, dev/prod mode handling
- [x] `main/preload.js` — contextBridge, expose `window.electronAPI`
- [x] `main/ipc/handlers.js` — register all IPC channels (stubs OK for now)
- [x] `renderer/store/` — define all Redux slices (infrastructure, chat, create, voice, settings) with initial state, even if empty
- [x] `renderer/store/middleware/ipc-middleware.js` — IPC ↔ Redux sync
- [x] Basic React shell renders in Electron window (no styling needed yet)
- [x] `npm run dev` starts Electron with hot reload
- [x] `package.json` with all required scripts: dev, build, package, lint, test
- [x] `.eslintrc` and `.prettierrc` config files
- [x] `CONTRIBUTING.md` placeholder

### Phase 2 — Infrastructure (Weeks 3–4) ✅ COMPLETE

- [x] `main/infrastructure/detector.js` — detect GPU name, VRAM (total + free), RAM, OS version, NVIDIA driver version
- [x] `main/infrastructure/process-manager.js` — spawn services, track PIDs, handle crashes, restart logic
- [x] `main/infrastructure/health-checker.js` — poll each service endpoint, emit `service-status` events to renderer
- [x] `main/services/ollama.js` — pull model, list models, generate (streaming), stop generation
- [x] `main/services/litellm.js` — start LiteLLM process, generate config from Redux settings (models + cloud API keys + budget caps), restart on settings change
- [x] IPC: `get-hardware-info` handler wired to detector
- [x] IPC: `get-service-statuses` handler wired to health-checker
- [x] Redux `infrastructure` slice populated from real IPC data
- [x] LiteLLM config auto-generated on startup: local Ollama models + any configured cloud providers
- [x] Manual test: detector returns correct GPU/VRAM on RTX 5080
- [x] Manual test: LiteLLM starts and proxies a request to Ollama successfully

### Phase 3 — Setup Wizard (Weeks 5–6) ✅ COMPLETE

- [x] `main/wizard/hardware-scan.js` — wraps detector, returns structured hardware object
- [x] `main/wizard/model-recommender.js` — VRAM-aware recommendation algorithm (see CLAUDE.md for tiers)
- [x] `main/wizard/model-downloader.js` — download models via Ollama, emit `download-progress` events
- [x] `main/infrastructure/installer.js` — silent install of Ollama (and eventually ComfyUI, Whisper, Kokoro)
- [x] Setup wizard UI: Screen 1 — Welcome
- [x] Setup wizard UI: Screen 2 — Hardware (calls `get-hardware-info`)
- [x] Setup wizard UI: Screen 3 — Capabilities (checkboxes)
- [x] Setup wizard UI: Screen 4 — Models (calls `get-model-recommendations`, shows download sizes)
- [x] Setup wizard UI: Screen 5 — Installing (progress bar, streaming install events)
- [x] Setup wizard UI: Screen 6 — Ready (health-checker confirms all services up)
- [x] React Router: wizard route vs main app route
- [x] Test full wizard flow on reference hardware

### Phase 3.5 — Prerequisites Screen ✅ COMPLETE

- [x] Prerequisites check screen added to wizard flow (7 screens total)
- [x] Detects and guides installation of required system dependencies before wizard proceeds

### Phase 4 — Chat Panel (Weeks 7–8) ✅ COMPLETE — v0.1-alpha MILESTONE DELIVERED

- [x] Streaming chat: `send-chat-message` → Ollama → `stream-token` events → UI appends tokens
- [x] `stop-stream` IPC handler
- [x] Model selector UI (lists available Ollama models)
- [x] Conversation history (stored in Redux, persisted to disk)
- [x] `renderer/components/Sidebar.jsx` — Chat / Create / Voice / Agent navigation
- [x] `renderer/components/StatusBar.jsx` — VRAM meter, service health dots, current model name, cloud budget remaining
- [x] `vram-update` events wired to StatusBar
- [x] Markdown + code block rendering in chat messages
- [x] `/image` shortcut stub (no-op in v0.1-alpha, graceful message)
- [x] Cloud hybrid basic: API key input in Settings, per-provider budget cap enforced, LiteLLM routes to cloud when budget allows and task warrants it
- [x] Manual end-to-end test: open app → chat with qwen2.5:14b → streaming works → conversation history persists

### Phase 4 Hardening (Week 9) ✅ COMPLETE

- [x] Stream timeout fix (60s timeout to prevent hung streams)
- [x] Conversation ID race condition fix
- [x] Duplicate `stream-complete` event fix
- [x] Error boundaries added to renderer
- [x] 83 unit tests written and passing

### Phase 5 — Create Panel + Real Installer (Weeks 9–10) ✅ COMPLETE

- [x] `main/services/comfyui.js` — start ComfyUI process, call image gen API, stream progress
- [x] `main/infrastructure/orchestrator.js` — VRAM orchestration: pause Ollama before starting ComfyUI, resume after
- [x] IPC: `generate-image` handler
- [x] Create panel UI: prompt input, style presets (photorealistic / artistic / abstract / anime), quality slider
- [x] Output gallery: display generated images, allow save
- [x] VRAM auto-management wired: Chat → Create triggers orchestrator
- [x] Real service installer pipeline — Ollama silent install, ComfyUI cu128 portable zip, FLUX model download, per-service Python venvs (LiteLLM, Whisper, Kokoro)
- [x] Installer UI — location picker, step list, progress bar
- [x] ComfyUI routes abstract/anime styles through FLUX when SDXL not installed
- [x] Fix: upgrade ComfyUI PyTorch to cu128 for Blackwell (sm_100) GPU

---

## Active Sprint

**Week 10: Pre-Phase 6 Hardening + P2 Web Search Fixes**

### Pre-Phase 6 Hardening

- [x] Documentation update — CLAUDE.md vision/positioning, TASKS.md, README status table
- [x] Model swap dropdown — wizard ModelsScreen: per-capability dropdown, alternatives computed from equal-or-lower VRAM tiers, total size updates live
- [x] Settings panel — gear icon in Sidebar, full-screen overlay, 6 sections (Models, Cloud, Routing, Voice, Chat, Appearance), 9 IPC channels, Redux slice extended
- [x] Hardware/model dynamism audit — detection is fully dynamic; CUDA cu126 is backwards-compatible across all NVIDIA cards; CLAUDE.md corrected
- [x] InstallingScreen responsive fix — 3-zone layout (pinned header+progress, scrollable steps, pinned footer); all other wizard screens get overflow-y-auto
- [x] Dependency/install state tracking — manifest.js module, electron-store manifest key, startup verification pass, 2 IPC channels, manifest Redux slice

### P2 Web Search — SearXNG Fixes (2026-04-16)

Web search backend switched from DuckDuckGo IA API → self-hosted SearXNG (Docker). Two bugs found and fixed:

- [x] Docker not auto-starting on search — added `ensureRunning()` to `web-search.js`: checks health, runs `docker start noxio-searxng`, polls until ready (20s timeout)
- [x] SearXNG bot detection blocking requests — added `X-Forwarded-For: 127.0.0.1` + `X-Real-IP: 127.0.0.1` headers to all fetches in `web-search.js`
- [x] Noisy engine errors (wikidata KeyError, ahmia, torch) — disabled in `settings.yml` template written by `update-searxng` IPC handler
- [x] Globe button locked when SearXNG not running — removed `searxngAvailable !== false` guard from onClick; button now always toggleable; amber style when enabled+down to signal auto-start pending
- [x] Default model in Settings → Capabilities not applying to chat — `handleModelChange` now also dispatches `setSelectedModel` to chat slice when capability is `chat`
- [ ] UI full retheme — complete visual overhaul before public release (separate branch)

### Phase 6 — Voice Panel (Weeks 11–12) ✅ COMPLETE

- [x] `main/services/whisper.js` — HTTP wrapper for whisper_server.py (faster-whisper)
- [x] `main/services/kokoro.js` — HTTP wrapper for kokoro_server.py (kokoro-onnx)
- [x] `main/scripts/whisper_server.py` — FastAPI server, lazy-loads model, CUDA float16 / CPU int8 fallback
- [x] `main/scripts/kokoro_server.py` — FastAPI server, lazy-loads ONNX model, returns WAV bytes
- [x] `main/infrastructure/process-manager.js` — fixed SERVICE_CONFIG paths for whisper + kokoro
- [x] IPC: `start-recording`, `stop-recording` (WAV → Whisper → transcript), `speak-text` (Kokoro TTS)
- [x] `main/preload.js` — stopRecording accepts audioData array, speakText method added
- [x] Voice panel UI: push-to-talk button, transcript display, LLM response stream, Kokoro TTS playback
- [x] Redux `voice` slice: recording state, transcript, speaking state
- [x] Test: push to talk → transcription → LLM response → Kokoro speaks response

### Phase 7 — Agent Panel ⏸ DEFERRED

The agentic space is moving fast (Claude tool use, GPT Actions, Model Context Protocol, etc.). Noxio's role is to be the **local runtime that complements these tools** — not to build a competing agent. We will revisit once the ecosystem stabilises and a clear, complementary integration path is defined.

No work on Phase 7 until the owner decides the integration strategy.

### Phase 8 — Polish + Launch (Weeks 15–16)

- [ ] Gaming mode: `switch-mode` to gaming → pauses all AI services, releases VRAM
- [ ] System tray icon: show/hide window, quick mode switch, quit
- [ ] Windows .exe installer via electron-builder
- [ ] README status table fully up to date
- [ ] CONTRIBUTING.md complete (setup, branches, commits, PR process)
- [ ] CHANGELOG.md v0.1.0 entry
- [ ] Demo video: setup wizard → first chat, no terminal visible
- [ ] Launch posts: r/LocalLLaMA, r/MachineLearning, r/selfhosted, HackerNews (Show HN)

---

## Backlog (Post v0.1)

### v0.2 — Mac + Smart Router + Mobile
- [ ] Apple Silicon native support
- [ ] Automatic intent-based model routing
- [ ] Mobile companion app (iOS + Android)
- [ ] Pro tier launch

### v0.3 — Linux + AMD + Cloud Hybrid
- [ ] Linux support (Docker-based)
- [ ] AMD ROCm via `configs/amd/`
- [ ] Full cloud API management dashboard with budget controls
- [ ] Enterprise license

### v0.4 — Ecosystem
- [ ] Model marketplace
- [ ] Plugin/extension system
- [ ] Multi-machine workload distribution

---

## Ongoing / Always Active

- [ ] Keep README status table accurate — update when any feature ships
- [ ] Update product doc (noxio-product-doc) when decisions change, learnings discovered, or roadmap shifts
- [ ] Research log (`docs/research-log.md`) — append findings, never delete entries
- [ ] CONTRIBUTING.md — keep in sync with current dev process
- [ ] Review open questions in CLAUDE.md and resolve during relevant phases

---

## How to Use This File

**At the start of every session:**
1. Read this file to understand current state
2. Move any completed items to a "Completed" section or delete them
3. Add any new tasks discovered during the session
4. Only start work on the current sprint — don't skip phases

**When a task is done:**
- Tick it off: `- [x] Task description`
- Update the README status table on GitHub
- If it's a phase milestone, note the completion date here