# TASKS.md — Noxio

Current task list, status, and phase breakdown. Update this file at the start of every session before doing any work.

---

## Current Status (as of March 2026)

- POC validated on reference hardware (RTX 5080, Windows 11)
- GitHub repo created: github.com/noxiolabs/Noxio
- README, LICENSE (AGPL-3.0), topics, Discussions all live on GitHub
- **Nothing is in the repo yet** — development starts now
- Target: v0.1 working by end of Week 16

---

## Active Sprint

**Week 1–2: Electron Shell + IPC Bridge**

- [ ] Scaffold repo structure (`main/`, `renderer/`, `configs/`)
- [ ] `main/index.js` — BrowserWindow, load preload, dev/prod mode handling
- [ ] `main/preload.js` — contextBridge, expose `window.electronAPI`
- [ ] `main/ipc/handlers.js` — register all IPC channels (stubs OK for now)
- [ ] `renderer/store/` — define all Redux slices (infrastructure, chat, create, voice, settings) with initial state, even if empty
- [ ] `renderer/store/middleware/ipc-middleware.js` — IPC ↔ Redux sync
- [ ] Basic React shell renders in Electron window (no styling needed yet)
- [ ] `npm run dev` starts Electron with hot reload
- [ ] `package.json` with all required scripts: dev, build, package, lint, test
- [ ] `.eslintrc` and `.prettierrc` config files
- [ ] `CONTRIBUTING.md` placeholder

---

## Upcoming Phases

### Phase 2 — Infrastructure (Weeks 3–4)

- [ ] `main/infrastructure/detector.js` — detect GPU name, VRAM (total + free), RAM, OS version, NVIDIA driver version
- [ ] `main/infrastructure/process-manager.js` — spawn services, track PIDs, handle crashes, restart logic
- [ ] `main/infrastructure/health-checker.js` — poll each service endpoint, emit `service-status` events to renderer
- [ ] `main/services/ollama.js` — pull model, list models, generate (streaming), stop generation
- [ ] IPC: `get-hardware-info` handler wired to detector
- [ ] IPC: `get-service-statuses` handler wired to health-checker
- [ ] Redux `infrastructure` slice populated from real IPC data
- [ ] Manual test: detector returns correct GPU/VRAM on RTX 5080

### Phase 3 — Setup Wizard (Weeks 5–6)

- [ ] `main/wizard/hardware-scan.js` — wraps detector, returns structured hardware object
- [ ] `main/wizard/model-recommender.js` — VRAM-aware recommendation algorithm (see CLAUDE.md for tiers)
- [ ] `main/wizard/model-downloader.js` — download models via Ollama, emit `download-progress` events
- [ ] `main/infrastructure/installer.js` — silent install of Ollama (and eventually ComfyUI, Whisper, Kokoro)
- [ ] Setup wizard UI: Screen 1 — Welcome
- [ ] Setup wizard UI: Screen 2 — Hardware (calls `get-hardware-info`)
- [ ] Setup wizard UI: Screen 3 — Capabilities (checkboxes)
- [ ] Setup wizard UI: Screen 4 — Models (calls `get-model-recommendations`, shows download sizes)
- [ ] Setup wizard UI: Screen 5 — Installing (progress bar, streaming install events)
- [ ] Setup wizard UI: Screen 6 — Ready (health-checker confirms all services up)
- [ ] React Router: wizard route vs main app route
- [ ] Test full wizard flow on reference hardware

### Phase 4 — Chat Panel (Weeks 7–8) — v0.1 MILESTONE

- [ ] Streaming chat: `send-chat-message` → Ollama → `stream-token` events → UI appends tokens
- [ ] `stop-stream` IPC handler
- [ ] Model selector UI (lists available Ollama models)
- [ ] Conversation history (stored in Redux, persisted to disk)
- [ ] `renderer/components/Sidebar.jsx` — Chat / Create / Voice / Agent navigation
- [ ] `renderer/components/StatusBar.jsx` — VRAM meter, service health dots, current model name
- [ ] `vram-update` events wired to StatusBar
- [ ] Markdown + code block rendering in chat messages
- [ ] `/image` shortcut stub (no-op in v0.1, graceful message)
- [ ] Manual end-to-end test: open app → chat with qwen2.5:14b → streaming works → conversation history persists

### Phase 5 — Create Panel (Weeks 9–10)

- [ ] `main/services/comfyui.js` — start ComfyUI process, call image gen API, stream progress
- [ ] `main/infrastructure/orchestrator.js` — VRAM orchestration: pause Ollama before starting ComfyUI, resume after
- [ ] IPC: `generate-image` handler
- [ ] Create panel UI: prompt input, style presets (photorealistic / artistic / abstract / anime), quality slider
- [ ] Output gallery: display generated images, allow save
- [ ] VRAM auto-management wired: Chat → Create triggers orchestrator
- [ ] Test: generate image while chat is loaded → Ollama pauses → image generates → Ollama resumes

### Phase 6 — Voice Panel (Weeks 11–12)

- [ ] `main/services/whisper.js` — start faster-whisper process, transcription API
- [ ] `main/services/kokoro.js` — start Kokoro FastAPI, TTS API
- [ ] IPC: `start-recording`, `stop-recording` handlers
- [ ] Voice panel UI: push-to-talk button, transcript display, voice response toggle
- [ ] Redux `voice` slice: recording state, transcript
- [ ] Test: push to talk → transcription → LLM response → Kokoro speaks response

### Phase 7 — Agent Panel (Weeks 13–14)

- [ ] Decide agent framework (OpenClaw vs Open Interpreter vs custom) — document decision in CLAUDE.md
- [ ] Agent process manager in `main/`
- [ ] IPC channels for agent: start goal, stream execution log, stop agent
- [ ] Agent panel UI: goal input, execution log (scrolling), workspace file viewer
- [ ] Tool permission model: user explicitly grants each tool type (file read, file write, web, etc.)
- [ ] Sandboxed workspace directory — agent confined to this folder by default

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