# CLAUDE.md — Noxio

This file gives Claude full context to work on Noxio without needing a briefing every session. Read this before doing anything else.

---

## What Noxio Is

A local-first AI desktop application. One app replaces ChatGPT, Midjourney, ElevenLabs, and cloud AI agents — running entirely on the user's GPU. No cloud required, no subscriptions, no data leaving the machine.

**Core principle:** Your personal AI. Runs locally. Works privately. No subscriptions.

**Capabilities (v0.1):**
- **Think** — chat, reason, write (local LLMs via Ollama)
- **Code** — coding-optimised model routing
- **Create** — image generation via ComfyUI (FLUX.1, SDXL)
- **Voice** — deferred to post-v0.1 (shown but disabled everywhere)
- **Act** — deferred indefinitely (shown but disabled everywhere)

**Hybrid model:** Users can optionally add cloud API keys (OpenAI, Anthropic, etc.) with per-provider monthly budget caps. LiteLLM handles routing. Local always takes priority unless the user opts into cloud.

---

## Product Positioning (Updated March 2026)

Noxio is a **local AI environment**, not an AI agent platform.

The goal is to be the infrastructure layer that makes local AI accessible — alongside cloud AI tools, not competing with them. Claude, GPT, and future tools are the agents. Noxio is the local runtime they can connect to. Think "localhost for AI": LLMs, image generation, voice, and future capabilities running privately on the user's hardware.

- Noxio replaces ChatGPT/Midjourney/ElevenLabs subscriptions for users who want local
- Noxio does not out-agent Claude Code, GPT Actions, or similar tools
- Future integration: MCP server and local API surface so external agents can use Noxio's services
- Agent panel is **deferred indefinitely** — the agentic ecosystem is moving fast; re-evaluate when the right complementary role is clear

---

## Hybrid Cloud Routing (Critical — Read Before Touching Settings or LiteLLM)

LiteLLM is the single routing layer. Every LLM request goes through it. Routing priority:

1. **Privacy** — conversation marked private → local only, never cloud
2. **Budget** — provider monthly cap exhausted → local fallback, never exceed
3. **Complexity** — long context, complex reasoning, coding → cloud if enabled and budget allows

**Decision tree:**
```
Private? Yes → Local only
Cloud enabled? No → Local only
Budget remaining? No → Local fallback
Complexity assessment:
  Short/simple chat → Local
  Long context (>4K tokens) + local limit exceeded → Cloud
  Complex reasoning + user opted in → Cloud
  Coding → Local preferred (qwen2.5-coder is strong), Cloud if complexity flag
```

**Cloud providers (via LiteLLM):**

| Provider | Models | Budget key |
|---|---|---|
| OpenAI | gpt-4o, gpt-4o-mini | `openai_monthly_usd` |
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | `anthropic_monthly_usd` |
| Google | gemini-2.0-flash, gemini-2.5-pro | `google_monthly_usd` |

**Budget enforcement:** Caps in Redux `settings` slice, persisted to disk, passed to LiteLLM at startup. Usage polled every 5 min from LiteLLM `/usage`. At 90% → StatusBar warning. At 100% → auto-fallback to local, notify user. `usedUSD` resets monthly — tracked via `usageResetMonth` (ISO year-month) per provider in the store.

**Settings Redux shape:**
```js
settings: {
  cloudProviders: {
    openai:    { apiKey: '', enabled: false, monthlyBudgetUSD: 0, usedUSD: 0, usageResetMonth: null },
    anthropic: { apiKey: '', enabled: false, monthlyBudgetUSD: 0, usedUSD: 0, usageResetMonth: null },
    google:    { apiKey: '', enabled: false, monthlyBudgetUSD: 0, usedUSD: 0, usageResetMonth: null },
  },
  routing: {
    preferLocal: true,
    allowCloudForLongContext: true,
    allowCloudForComplexReasoning: false,
  }
}
```

**Rules:** Never cloud if private. Never exceed budget. Never hard-code model names in the router. Never expose API keys in renderer — main process only via IPC.

---

## Project Identity

| | |
|---|---|
| Repo | github.com/noxiolabs/Noxio |
| License | AGPL-3.0 |
| Website | noxiolabs.dev |
| Product doc | noxio-product-doc.docx (external, v1.6) — CLAUDE.md is source of truth for sessions |

---

## Tech Stack

| Layer | Technology |
|---|---|
| App shell | Electron |
| UI | React 18 |
| State | Redux Toolkit |
| Chat UI | @chatscope/chat-ui-kit-react |
| Styling | Tailwind CSS |
| Packaging | electron-builder (Windows .exe) |
| LLM serving | Ollama (native Windows, port 11434) |
| Model routing | LiteLLM (native pip, port 4000) |
| Image gen | ComfyUI (native Windows, port 8188) |
| Speech-to-text | faster-whisper (native pip, port 10300) — deferred |
| Text-to-speech | Kokoro FastAPI (native pip, port 8880) — deferred |

**v0.1 is fully native Windows — no Docker, no WSL exposed to users.** All background services spawned and managed by the Electron main process.

---

## Repository Structure

```
main/
  index.js                    # Electron entry, BrowserWindow, loads preload.js
  preload.js                  # contextBridge security bridge → window.electronAPI
  infrastructure/
    detector.js               # GPU/VRAM/RAM/OS/driver detection
    installer.js              # Silent install orchestration
    process-manager.js        # Start/stop/monitor all background services
    orchestrator.js           # VRAM-aware mode switching
    health-checker.js         # Polls service endpoints, emits status to renderer
  services/
    ollama.js                 # Ollama: pull, list, create, run, stop
    comfyui.js                # ComfyUI image gen API wrapper
    whisper.js                # faster-whisper transcription wrapper
    kokoro.js                 # Kokoro TTS wrapper
  wizard/
    hardware-scan.js          # Wraps detector.js, returns capability object
    model-recommender.js      # VRAM-aware model recommendations
    model-downloader.js       # Ollama model pulls with progress events
  ipc/
    handlers.js               # ALL IPC channel definitions

renderer/
  store/
    slices/
      infrastructure.js       # Service statuses, VRAM, hardware, current mode
      chat.js                 # Conversations, messages, streaming state
      create.js               # Prompt, style, quality, output gallery
      voice.js                # Recording state, transcript
      settings.js             # Setup state, model config, cloud API keys
    middleware/
      ipc-middleware.js       # Bridges IPC events ↔ Redux. Also handles conversation persistence.
  pages/
    Setup/                    # 7-screen setup wizard
    Chat/                     # Chat panel: streaming, model selector, history
    Create/                   # Create panel: prompt, style presets, gallery
    Voice/                    # Coming-soon placeholder
    Agent/                    # Coming-soon placeholder
  components/
    Sidebar.jsx               # Mode nav: Chat / Create / Voice(disabled) / Agent(disabled)
    StatusBar.jsx             # VRAM meter, service health dots (filtered to installed services)
    ErrorBoundary.jsx         # Supports panel={true} for scoped per-panel crash recovery
```

---

## The Three Electron Processes

Never blur these boundaries.

| Process | What it is | Can do | Cannot do |
|---|---|---|---|
| Main process | Node.js | Full system: spawn processes, files, network | Cannot render UI |
| Renderer process | Chromium | React UI, IPC calls | Cannot use Node.js APIs directly |
| Preload script | Bridge | Expose safe IPC subset via contextBridge | Cannot be bypassed by renderer |

**Rule:** All service management in main process. React UI only makes IPC calls. Non-negotiable.

---

## IPC Channels

The authoritative list is in `main/ipc/handlers.js` (every handler is JSDoc'd). Key channels:

**Renderer → Main (invoke):** `get-hardware-info`, `get-service-statuses`, `switch-mode`, `send-chat-message`, `stop-stream`, `generate-image`, `start-installation`, `complete-setup`, `save-cloud-provider`, `get-settings`, `list-models`, `pull-model`, `delete-model`, `get-cloud-usage`, `save-chat-history`, `load-chat-history`, `validate-install-dir`, `open-settings`

**Main → Renderer (events):** `service-status`, `stream-token`, `stream-complete`, `vram-update`, `mode-ready`, `install-progress`, `download-progress`, `image-progress`, `routing-decision`, `budget-warning`, `cloud-usage-update`, `manifest-verified`, `model-pull-progress`, `model-pull-complete`, `model-pull-error`

---

## VRAM Auto-Management

On 16GB VRAM (RTX 5080), only one major workload at a time.

| User action | Background | User sees |
|---|---|---|
| Chat → Create | Ollama paused (if running), ComfyUI started | Brief loading, then Create ready |
| Create → Chat | ComfyUI paused, Ollama resumed | Brief loading, then Chat ready |
| /image in Chat | Ollama paused, image generated, Ollama resumed | Inline image in chat |

---

## Model Recommendation Algorithm (by usable VRAM)

| Usable VRAM | Chat | Coding | Image |
|---|---|---|---|
| 18GB+ | qwen2.5:32b | qwen2.5-coder:14b | FLUX.1-dev-fp8 |
| 10–18GB | qwen2.5:14b | qwen2.5-coder:14b | FLUX.1-schnell-fp8 |
| 6–10GB | qwen2.5:7b | qwen2.5-coder:7b | SDXL-lightning |
| 3–6GB | qwen2.5:3b | qwen2.5-coder:3b | SDXL 4-bit |
| <3GB | Cloud API recommended | Cloud API recommended | Cloud API recommended |

RTX 5080: 16GB VRAM, display consumes ~989MiB → ~15GB usable → effective tier: 10–18GB.

---

## Setup Wizard Flow (7 screens)

0. **PrereqScreen** — Checks Ollama and NVIDIA GPU. Ollama installed automatically if missing (no user action needed). NVIDIA GPU is informational only. Continue is never blocked.
1. **Welcome** — name, tagline, Get Started
2. **Hardware** — GPU, VRAM, RAM detected in background
3. **Capabilities** — Chat, Coding, Images. Voice and Agent show "coming soon" and are non-selectable.
4. **Models** — recommended model per capability, swap option, cloud API key input
5. **Installing** — progress bar with step messages
6. **Ready** — health-checker confirms all services up

`settings.setupComplete` (Redux, persisted) gates wizard vs. main app shell.

---

## Branch Strategy

| Branch | Purpose | Who merges |
|---|---|---|
| main | Stable, tagged releases only | Owner only |
| develop | Active development | Owner after PR review |
| feature/[name] | Individual features | PR to develop |
| fix/[name] | Bug fixes | PR to develop |
| release/[version] | Release preparation | PR to main + develop |

---

## Commit Convention

Format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`

---

## Code Quality Rules

- No `console.log` in production — use the logger
- All IPC handlers must have error handling
- All process spawning must handle crashes and restart gracefully
- Redux state must never be mutated directly
- Components must be under 200 lines — split if larger
- Every new file needs a JSDoc comment at the top
- Every public function needs a JSDoc comment
- Never expose WSL terminal, Docker CLI, port numbers, or container names to the user
- Never let the renderer spawn system processes — always IPC to main
- Never hardcode model paths or port numbers in the renderer
- Never use `docker-compose` — fully native Windows only

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Electron in dev mode with hot reload |
| `npm run build` | Build the React renderer for production |
| `npm run package` | Package as Windows .exe installer |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests |

---

## Key Technical Facts (Critical — Don't Repeat These Mistakes)

**RTX 5080 / Blackwell (sm_100):**
- Most pre-2025 Docker/CUDA images don't include sm_100 kernels — will fail silently
- Do NOT use secondary GPU (GTX 1650 Super) for display — causes PCIe frame copy, kills gaming FPS

**Ollama configuration:**
- Default context on 14B = 32768 → requires 48GB total. Always set `num_ctx 4096` in Modelfile
- `OLLAMA_HOST=0.0.0.0` — so LiteLLM and other services can reach Ollama
- `OLLAMA_KEEP_ALIVE=-1`, `OLLAMA_NUM_GPU=999`, `OLLAMA_FLASH_ATTENTION=1`
- Set env vars via Admin PowerShell: `[System.Environment]::SetEnvironmentVariable("NAME","VALUE","Machine")`
- GGUF Q4: 14B model ~8GB vs ~28GB in FP16

**Why Ollama over vLLM:** vLLM reserves all KV cache upfront — hard-fails if insufficient. Ollama auto CPU-offloads and hot-swaps models in 10–15s.

**Model formats → backends:**
- GGUF (LLMs) → Ollama
- SafeTensors (FLUX, SDXL) → ComfyUI
- CTranslate2 (Whisper) → faster-whisper
- ONNX/PyTorch (Kokoro) → Kokoro FastAPI

**WMIC is removed on Windows 11 23H2+ — use PowerShell:**
- RAM: `Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json`
- CPU: `Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors | ConvertTo-Json`
- Run via `powershell.exe -NoProfile -NonInteractive -Command "..."`

---

## Phase 2 Implementation Notes

**nvidia-smi path search (detector.js):**
1. `C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe`
2. `nvidia-smi` on PATH
- Primary GPU = highest `vramTotalMB` on multi-GPU systems
- All subprocess calls use `execFile` (never `shell: true`), 10s timeout
- Failures return zeroed fields — never throw

**`num_ctx: 4096` enforcement (ollama.js):** Hardcoded in every `generateStream` call. Do not remove or make configurable without solving OOM — default on 14B requires ~48GB.

**LiteLLM config:** Written to `app.getPath('userData')/litellm-config.yaml`. API keys are NEVER written to config — passed as env vars to the spawned process.

**Process manager (process-manager.js):**
- All services spawned with `spawn()`, `windowsHide: true`, never `shell: true`
- Ollama path: `%APPDATA%\Local\Programs\Ollama\ollama.exe` → `C:\Program Files\Ollama\ollama.exe` → PATH
- Python for services: `python` → `python3`
- Restart backoff: `min(1000 * 2^restartCount, 30000)ms`, max 5 retries, resets after 30s stable
- Shutdown order (reverse): kokoro → whisper → comfyui → litellm → ollama
- Shutdown: SIGTERM → 8s wait → SIGKILL
- `not-installed` status: if `_installedServices[name] === false`, emits `not-installed` and returns — no crash loop. Ollama is exempt.

**Health checker (health-checker.js):**
- Poll interval: 5s. Node `http` module only. Per-request timeout: 3s.
- `service-status` emitted only on state transitions, not every tick
- Returns `'not-installed'` directly when process-manager state is `not-installed`

**Startup sequence (main/index.js):**
```
processManager.init(win)
processManager.setPersistedPaths(...)   // MUST be before any startService()
healthChecker.startPolling(win)
detectHardware()                         // eager warm-up, result cached
processManager.startService('ollama')
litellm.startLiteLLM({})               // non-fatal if fails
```

---

## Phase 3 Implementation Notes

**hardware-scan.js:** Returns `{ vramTier, canRunChat, canRunImage, canRunVoice, canRunCoding, needsCloud }`. `needsCloud` true only when VRAM < 3GB.

**model-recommender.js:** Takes capabilities array + hardware object → one recommended model per capability. Model lists must match the Model Recommendation Algorithm table above.

**model-downloader.js:** Sequential Ollama pulls. Emits `download-progress` events. Does not download SafeTensors — handled by installer.js.

**PrereqScreen:** Checks Ollama binary and NVIDIA GPU only. Python check was removed — the installer creates isolated venvs so system Python is not required. Ollama missing shows info state (blue), not warning — "will be installed automatically."

---

## Phase 4 Implementation Notes

**Chat panel file ownership:**
- `Chat/index.jsx` — stream lifecycle, 60s timeout
- `Chat/ConversationSidebar.jsx` — conversation list, two-step delete confirm (3s auto-reset)
- `Chat/MessageList.jsx` — message feed, auto-scroll
- `Chat/MessageBubble.jsx` — Markdown via `react-markdown` + `remark-gfm`
- `Chat/ChatInput.jsx` — disabled while `isStreaming`
- `Chat/ModelSelector.jsx` — fetches models once on mount, does NOT re-fetch on model change

**Conversation ID pre-generation:** ID generated in component BEFORE Redux dispatch. Ensures `createConversation` is processed before IPC call fires stream-token events for that ID.

**60-second stream timeout:** `setTimeout` in `Chat/index.jsx`. Cleared on `stream-complete`. Fires `finaliseStream()` directly if Ollama hangs. `finaliseStream` in `chat.js` is idempotent — checks `state.isStreaming` before applying.

**Auto-title:** First 50 chars of first user message. No LLM call. Pure string slicing.

**Conversation persistence (C3):** `ipc-middleware.js` calls `loadChatHistory` on startup → dispatches `hydrateConversations` to chat slice. Subscribes to store with 500ms debounce → calls `saveChatHistory` on any chat state change. Handlers in `handlers.js`, exposed in `preload.js`.

**Full conversation history per request:** Every `send-chat-message` sends the full `messages[]` array. No summarisation or windowing.

---

## Real Installer Implementation Notes

**Service install layout (`service-installer.js`):**
- ComfyUI: `{installDir}/comfyui/ComfyUI_windows_portable/`
- Python venvs: `{installDir}/venvs/{service}/` — one per service
- Venv Python: `{installDir}/venvs/{service}/Scripts/python.exe`
- LiteLLM CLI: `{installDir}/venvs/litellm/Scripts/litellm.exe`
- Whisper models: `{installDir}/venvs/whisper/models/`
- Kokoro models: `{installDir}/venvs/kokoro/models/`
- FLUX model: `{installDir}/comfyui/ComfyUI_windows_portable/ComfyUI/models/checkpoints/flux1-schnell-fp8.safetensors`

**ComfyUI launch:** Run `run_nvidia_gpu.bat` directly. `cwd` must be the directory containing that .bat — it uses relative paths internally.

**Python minimum version:** 3.11+. Windows App Store Python stubs (`WindowsApps` in path) are explicitly rejected — silently fail as real interpreter. Path resolved via PowerShell `Get-Command`.

**Per-service pip packages:**
- LiteLLM: `litellm[proxy]`
- Whisper: `faster-whisper`
- Kokoro: `kokoro-onnx`, `soundfile`
All installed with `pip install --upgrade`.

**electron-store:** Store name `noxio-settings` → `noxio-settings.json` in userData. Fields read at startup: `setupComplete`, `servicePaths`, `installedServices`, `installDir`. Pinned to exact version `8.2.0` in package.json (prevent ESM breakage from minor bump).

**`setPersistedPaths()` call order:** Must be before any `startService()`. Populates `_servicePaths` and `_installedServices` in process-manager. Without it, venv services (Whisper, Kokoro) fail PATH resolution.

**Download URLs:**
- Ollama: `https://ollama.com/download/OllamaSetup.exe` (NSIS `/S` silent)
- ComfyUI zip: `https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu126.7z` — `cu126` deliberate (no cu128 portable yet; backwards-compatible on Blackwell)
- FLUX model: `https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors` — min 9 GB; smaller = corrupt, re-download

**FLUX `.part` pattern:** Downloaded to `{dest}.part`, atomically renamed on completion. Idempotency check only looks at final path.

**Whisper/Kokoro model download:** Run a temporary Python script (`os.tmpdir()/noxio-dl-{ts}.py`) in the service venv. Whisper uses `faster_whisper.WhisperModel("medium", ...)` to trigger HuggingFace download. Kokoro uses `kokoro_onnx.Kokoro.from_pretrained(...)`. 300s timeout each.

**Ollama post-install poll:** Polls `GET http://127.0.0.1:11434/api/tags` every 1s for up to 15s after installer exits. Installer .exe deleted in `finally` regardless. Download progress callbacks throttled to ≥ 2% change.

**installer.js step weights:** LLM downloads = 20pts each, FLUX = 20pts, ComfyUI zip = 12pts. Skipped capabilities excluded from active steps — bar always reaches 100%.

---

## Development Rhythm

- **Monday** — Review week plan, create feature branches
- **Tue–Thu** — Implementation, commit frequently
- **Friday** — PR review, merge to develop, update README

---

## Definition of Done

1. Works on reference hardware (RTX 5080, 32GB RAM, Windows 11)
2. Handles error cases gracefully
3. Manually tested
4. README status table updated
5. Commit follows Conventional Commits

---

## Reference Hardware

| Component | Specification |
|---|---|
| GPU | NVIDIA RTX 5080 16GB (Blackwell sm_100) |
| RAM | 32GB DDR5 7200MHz |
| CPU | AMD Ryzen 9 9950X3D |
| Storage | 2× SSD (C: system, E: AI workload) |
| OS | Windows 11 |
| Secondary GPU | GTX 1650 Super 4GB — NOT used for display |

---

## Remaining Open Items (pre-v0.1)

These are not yet fixed. Everything else from the 2026-03-25 audit has been resolved.

| # | Priority | Finding | File |
|---|---|---|---|
| W3 | MEDIUM | Progress dots show 6 positions but `TOTAL_STEPS = 8`. | `renderer/pages/Setup/index.jsx` |
| W6 | LOW | ModelsScreen JSDoc says "Screen 4", ReadyScreen says "Screen 6". Both are wrong. | `Setup/ModelsScreen.jsx`, `ReadyScreen.jsx` |
| W7 | HIGH | No way to add capabilities post-wizard. Needs `install-additional-capability` IPC handler + "Manage capabilities" section in Settings. | `main/ipc/handlers.js`, `SettingsOverlay.jsx` |
| S2 | MEDIUM | No Services/Capabilities section in Settings. Users can't see installed services or add new ones. | `renderer/components/SettingsOverlay.jsx` |
| S3 | MEDIUM | `openExternal` not exposed in preload — API key URLs in CloudSection are plain text only. | `main/preload.js`, `CloudSection.jsx` |
| S6 | MEDIUM | `settings.chat.contextWindow` persisted but `ollama.js` always uses hardcoded `num_ctx: 4096`. Setting has no effect. | `main/services/ollama.js`, `ChatSection.jsx` |
| N4 | LOW | Settings gear always opens on Models tab. Should remember last active section. | `renderer/components/Sidebar.jsx` |
| C5 | LOW | Code blocks in MessageBubble have no copy-to-clipboard button. | `Chat/MessageBubble.jsx` |
| C6 | LOW | Conversations can't be renamed. Add inline double-click rename. | `Chat/ConversationSidebar.jsx` |
| C7 | LOW | Cloud routing button in ChatInput has no label or tooltip. | `Chat/ChatInput.jsx` |
| CR4 | LOW | Save image uses `<a>` tag hack. Should use native save dialog via `save-image` IPC. | `Create/ImageGallery.jsx` |
| CR5 | LOW | No negative prompt field. Add expandable Advanced section. | `Create/index.jsx` |

---

## Open Questions

- **Website** — noxiolabs.dev needs a landing page.
- **Twitter/X @noxiolabs** — Waiting on domain email setup.
- **Voice re-integration** — Deferred. Whisper STT + Kokoro TTS had orchestrator race condition and missing Python server scripts. Re-approach as a standalone debug session before v0.2.
- **W7 implementation approach** — Capability management post-setup needs design decision: full re-run of install steps for the new capability, or a targeted `install-additional-capability` flow?
