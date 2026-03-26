# CLAUDE.md — Noxio

This file gives Claude full context to work on Noxio without needing a briefing every session. Read this before doing anything else.

---

## What Noxio Is

A local-first AI desktop application. One app replaces ChatGPT, Midjourney, ElevenLabs, and cloud AI agents — running entirely on the user's GPU. No cloud required, no subscriptions, no data leaving the machine.

**Core principle:** Your personal AI. Runs locally. Works privately. No subscriptions.

**Capabilities:**
- **Think** — chat, reason, write (local LLMs via Ollama)
- **Code** — coding-optimised model routing
- **Create** — image and video generation via ComfyUI (FLUX.1, SDXL)
- **Voice** — speech-to-text (Whisper) + text-to-speech (Kokoro)
- **Act** — autonomous agent with sandboxed workspace

**Hybrid model:** Users can optionally add cloud API keys (OpenAI, Anthropic, etc.) with per-provider monthly budget caps. LiteLLM handles routing. Local always takes priority unless the user opts into cloud.

---

## Product Positioning (Updated March 2026)

Noxio is a **local AI environment**, not an AI agent platform.

The goal is to be the infrastructure layer that makes local AI accessible and usable — alongside cloud AI tools, not competing with them. Claude, GPT, and future AI tools are the agents. Noxio is the local runtime they can connect to and use. Think of it as "localhost for AI": a single place where LLMs, image generation, voice, and future capabilities run privately on the user's hardware, ready to be used by any tool or workflow.

**What this means in practice:**
- Noxio replaces the need for ChatGPT/Midjourney/ElevenLabs subscriptions for users who want to run things locally
- Noxio does not try to out-agent Claude Code, GPT Actions, or similar tools
- Future integration work will focus on making Noxio's local services *accessible to* external agents (MCP server, local API surface) rather than building a competing agent runtime
- The Agent panel is **deferred indefinitely** — the agentic ecosystem is moving fast and the right complementary role will become clearer over time

---

## Hybrid Cloud Routing (Critical — Read Before Touching Settings or LiteLLM)

Noxio is local-first but has a full hybrid routing layer. This is a core product feature, not an afterthought.

### How routing decisions are made

LiteLLM is the single routing layer. Every LLM request goes through it. The router decides local vs cloud based on three signals, in priority order:

1. **User privacy preference** — if user marks a conversation/task as private, local only. Cloud is never used, even if budget is available.
2. **Budget** — per-provider monthly spend cap set by the user in Settings. If the provider budget is exhausted, fall back to local automatically. Never exceed budget.
3. **Task complexity** — tasks the router classifies as needing more capability (long context, multi-step reasoning, complex code) can be routed to cloud if cloud is enabled and budget allows.

### Routing decision tree

```
Incoming request
      │
      ▼
Is this conversation marked private?
      │ Yes → Local only (no cloud ever)
      │ No
      ▼
Is cloud enabled for this provider?
      │ No → Local only
      │ Yes
      ▼
Is provider budget remaining > 0?
      │ No → Local fallback
      │ Yes
      ▼
Task complexity assessment:
  - Short, simple, general chat → Local (no reason to spend budget)
  - Long context (>4K tokens) + local model context limit exceeded → Cloud
  - Complex reasoning task + user opted into "best quality" → Cloud
  - Coding task → Local preferred (qwen2.5-coder is strong), Cloud if complexity flag
      │
      ▼
Route to best available model (local or cloud)
```

### Cloud providers supported (via LiteLLM)

| Provider | Models | Budget key |
|---|---|---|
| OpenAI | gpt-4o, gpt-4o-mini | `openai_monthly_usd` |
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | `anthropic_monthly_usd` |
| Google | gemini-2.0-flash, gemini-2.5-pro | `google_monthly_usd` |

### Budget enforcement

- Budget caps are stored in the Redux `settings` slice and persisted to disk
- LiteLLM is configured with these caps at startup and on every settings change
- Usage tracking: LiteLLM's `/usage` endpoint is polled every 5 minutes, stored in Redux, shown in StatusBar
- When a provider hits 90% of budget: warn user in StatusBar
- When a provider hits 100%: auto-fallback to local, notify user, never error silently

### Settings Redux shape (relevant fields)

```js
settings: {
  cloudProviders: {
    openai:    { apiKey: '', enabled: false, monthlyBudgetUSD: 0, usedUSD: 0 },
    anthropic: { apiKey: '', enabled: false, monthlyBudgetUSD: 0, usedUSD: 0 },
    google:    { apiKey: '', enabled: false, monthlyBudgetUSD: 0, usedUSD: 0 },
  },
  routing: {
    preferLocal: true,       // always prefer local when capability is comparable
    allowCloudForLongContext: true,
    allowCloudForComplexReasoning: false, // off by default, user opts in
  }
}
```

### What NOT to do

- Never send a request to cloud if the conversation is marked private
- Never silently exceed a budget cap — always fall back to local
- Never hard-code model names in the router — model lists come from LiteLLM config
- Never expose API keys in renderer process — keys live in main process only, accessed via IPC

---

## Project Identity

| | |
|---|---|
| Repo | github.com/noxiolabs/Noxio |
| Org | github.com/noxiolabs |
| License | AGPL-3.0 |
| Website | noxiolabs.dev |
| Status | Active development — nothing in repo yet as of March 2026 |
| Product doc | noxio-product-doc.docx (external, v1.6) — owner has access. Contains full vision, architecture decisions, competitive landscape, learnings log. Ask owner to share the relevant section if you need something not covered in CLAUDE.md. **CLAUDE.md is the source of truth for Claude sessions** — do not require the product doc to work. |

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
| Image/video gen | ComfyUI (native Windows, port 8188) |
| Speech-to-text | faster-whisper (native pip, port 10300) |
| Text-to-speech | Kokoro FastAPI (native pip, port 8880) |
| Agent | TBD (port 5000) |

**v0.1 is fully native Windows — no Docker, no WSL terminal exposed to users.** All background services are spawned and managed by the Electron main process. The user never sees a terminal.

---

## Repository Structure

```
main/
  index.js                    # Electron entry point, BrowserWindow, loads preload.js
  preload.js                  # Security bridge, exposes window.electronAPI via contextBridge
  infrastructure/
    detector.js               # GPU/VRAM/RAM/OS/driver detection
    installer.js              # Silent install of Ollama, ComfyUI, Whisper, Kokoro
    process-manager.js        # Starts, stops, monitors all background services
    orchestrator.js           # VRAM-aware mode switching (pauses/resumes services)
    health-checker.js         # Polls service endpoints, reports status to renderer
  services/
    ollama.js                 # Ollama: pull, list, create, run, stop
    comfyui.js                # ComfyUI process + image gen API wrapper
    whisper.js                # faster-whisper process + transcription wrapper
    kokoro.js                 # Kokoro process + TTS API wrapper
  wizard/
    hardware-scan.js          # Runs detector, returns structured hardware object
    model-recommender.js      # VRAM-aware model recommendation algorithm
    model-downloader.js       # Downloads models via Ollama and HuggingFace CLI
  ipc/
    handlers.js               # ALL IPC channel definitions (document every channel here)

renderer/
  store/
    slices/
      infrastructure.js       # Service statuses, VRAM, hardware, current mode
      chat.js                 # Conversations, messages, streaming state
      create.js               # Prompt, style, quality, output gallery
      voice.js                # Recording state, transcript
      settings.js             # Setup state, model config, cloud API keys
    middleware/
      ipc-middleware.js       # Syncs Redux actions to/from IPC events
  pages/
    Setup/                    # 7-screen setup wizard
    Chat/                     # Chat panel: streaming, model selector, history
    Create/                   # Create panel: prompt, style presets, gallery
    Voice/                    # Voice panel: push to talk, transcript
    Agent/                    # Agent panel: goal input, execution log
  components/
    Sidebar.jsx               # Mode navigation: Chat / Create / Voice / Agent
    StatusBar.jsx             # VRAM meter, service health dots, current model

configs/
  nvidia/                     # NVIDIA-specific: Ollama Modelfiles
  apple/                      # Phase 2: Apple Silicon scripts
  amd/                        # Phase 3: AMD ROCm config
```

---

## The Three Electron Processes

This is critical to get right — never blur these boundaries.

| Process | What it is | Can do | Cannot do |
|---|---|---|---|
| Main process | Node.js | Full system: spawn processes, files, network | Cannot render UI |
| Renderer process | Chromium | Render React UI, handle input, IPC calls | Cannot use Node.js APIs directly |
| Preload script | Privileged bridge | Expose safe IPC subset via contextBridge | Cannot be bypassed by renderer |

**Rule:** All service management lives in the main process. The React UI only makes IPC calls. Non-negotiable.

---

## IPC Channels

### Renderer → Main (invoke)

| Channel | Payload | Returns |
|---|---|---|
| get-hardware-info | none | Hardware object |
| get-service-statuses | none | Service status map |
| switch-mode | mode: string | void (result via event) |
| get-model-recommendations | capabilities[] | Recommendation map |
| start-installation | config object | void (progress via events) |
| send-chat-message | message, model, conversationId | void (tokens via events) |
| stop-stream | none | void |
| generate-image | prompt, style, quality | void (progress via events) |
| start-recording | none | void |
| stop-recording | none | Transcribed text |

### Main → Renderer (events)

| Event | Payload | Purpose |
|---|---|---|
| service-status | { service, status, pid } | Updates Redux service health |
| stream-token | token: string | Appends to streaming message |
| stream-complete | none | Finalises streaming message |
| install-progress | { step, percent, message } | Updates wizard progress |
| mode-ready | mode: string | Hides loading, confirms switch |
| vram-update | { usedGB, availableGB } | Updates VRAM meter |
| download-progress | { model, percent } | Updates model download in wizard |

---

## VRAM Auto-Management

On 16GB VRAM (RTX 5080), only one major workload can occupy VRAM at a time.

| User action | Background | User sees |
|---|---|---|
| Chat → Create | Ollama paused if needed, ComfyUI started | Brief loading, then Create ready |
| Create → Chat | ComfyUI paused, Ollama resumed | Brief loading, then Chat ready |
| /image in Chat | Ollama paused, image generated, Ollama resumed | Inline image in chat |
| Voice panel | Whisper (1.5GB) + Kokoro (CPU only). No conflict with 14B LLM. | Immediate |

---

## Model Recommendation Algorithm (by usable VRAM)

| Usable VRAM | Chat | Coding | Image |
|---|---|---|---|
| 18GB+ | qwen2.5:32b | qwen2.5-coder:14b | FLUX.1-dev-fp8 |
| 10–18GB | qwen2.5:14b | qwen2.5-coder:14b | FLUX.1-schnell-fp8 |
| 6–10GB | qwen2.5:7b | qwen2.5-coder:7b | SDXL-lightning |
| 3–6GB | qwen2.5:3b | qwen2.5-coder:3b | SDXL 4-bit |
| <3GB | Cloud API recommended | Cloud API recommended | Cloud API recommended |

Note: RTX 5080 has 16GB VRAM but display consumes ~989MiB, leaving ~15GB usable. Effective tier: 10–18GB.

---

## Setup Wizard Flow (7 screens)

0. **PrereqScreen** (added Phase 3.5) — Checks for Ollama, Python, GPU before proceeding. Shows download links if missing. Blocks progress until prerequisites pass.
1. **Welcome** — name, tagline, Get Started
2. **Hardware** — GPU name, VRAM, RAM (detector.js runs in background)
3. **Capabilities** — checkboxes: Chat, Coding, Images, Voice, Agent
4. **Models** — recommended model per capability, swap option, cloud API key input, total download size
5. **Installing** — progress bar, friendly step messages (installer.js + model-downloader.js streaming events)
6. **Ready** — "Your AI is ready" (health-checker confirms all services up)

---

## Modality Routing

Routing is explicit UI panels as primary, with shortcuts layered on top:
- `/image`, `/video` — shortcuts in chat
- Mic button, camera button — panel shortcuts
- No automatic intent detection (v0.1)

---

## Branch Strategy

| Branch | Purpose | Who merges |
|---|---|---|
| main | Stable, tagged releases only | Owner only after review |
| develop | Active development, all features merge here | Owner after PR review |
| feature/[name] | Individual features (e.g. feature/chat-panel) | PR to develop |
| fix/[name] | Bug fixes (e.g. fix/vram-detection) | PR to develop |
| release/[version] | Release preparation | PR to main + develop |

---

## Commit Convention (Conventional Commits)

Format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`

Examples:
```
feat(chat): add streaming token support
fix(detector): correct VRAM reading on Blackwell GPUs
chore(deps): update Ollama to 0.7.0
docs(readme): add hardware requirements table
refactor(orchestrator): split into smaller modules
```

---

## Code Quality Rules

- No `console.log` in production — use a proper logger
- All IPC handlers must have error handling
- All process spawning must handle crashes and restart gracefully
- Redux state must never be mutated directly
- Components must be under 200 lines — split if larger
- Every new file needs a JSDoc comment at the top explaining what it does and why it exists
- Every public function needs a JSDoc comment

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
- `libcuda.so.1` must be mounted if using Docker: `-v /usr/lib/wsl/lib:/usr/lib/wsl/lib:ro`
- `NCCL_P2P_DISABLE=1`, `NCCL_SHM_DISABLE=1` required for single-GPU WSL
- Do NOT use secondary GPU (GTX 1650 Super) for display — causes PCIe frame copy, kills gaming FPS

**Ollama configuration:**
- Default context on 14B = 32768 → requires 48GB total. Always set `num_ctx 4096` in Modelfile
- `OLLAMA_HOST=0.0.0.0` — so LiteLLM and other services can reach Ollama
- `OLLAMA_KEEP_ALIVE=-1` — keeps model warm between requests
- `OLLAMA_NUM_GPU=999` — maximises GPU layers
- `OLLAMA_FLASH_ATTENTION=1` — speed improvement
- Set env vars via Admin PowerShell: `[System.Environment]::SetEnvironmentVariable("NAME","VALUE","Machine")`
- GGUF Q4: 14B model ~8GB vs ~28GB in FP16

**Why Ollama over vLLM:**
- vLLM reserves all KV cache upfront — hard-fails if insufficient, no CPU offload
- Ollama auto CPU-offloads overflow layers to RAM — 32B models work on 16GB VRAM
- Ollama hot-swaps models in 10–15s — essential for multi-model setup

**Model formats require different backends:**
- GGUF (LLMs) → Ollama
- SafeTensors (FLUX, SDXL, video) → ComfyUI
- CTranslate2 (Whisper) → faster-whisper
- ONNX/PyTorch (Kokoro) → Kokoro FastAPI

---

## Phase 2 Implementation Notes

Facts that are not derivable from git log and aren't obvious from reading the code. Reference these when debugging or extending Phase 2 modules.

**nvidia-smi path search order (detector.js)**
1. `C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe` (hard path)
2. `nvidia-smi` on PATH
- On multi-GPU systems: primary GPU is whichever has the highest `vramTotalMB`
- All subprocess calls use `execFile` (never `shell: true`) with a 10s timeout
- Failures return zeroed fields — they never throw

**WMIC is removed on modern Windows 11 — use PowerShell instead (detector.js)**
- RAM: `Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json`
- CPU: `Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors | ConvertTo-Json`
- Run via `powershell.exe -NoProfile -NonInteractive -Command "..."`
- Do not use `wmic` anywhere — it is absent on Windows 11 23H2+ builds

**`num_ctx: 4096` enforcement (ollama.js)**
- Hardcoded in every `generateStream` call in `main/services/ollama.js`
- Must not be removed or made configurable without first solving the OOM problem — Ollama's default context on a 14B model requires ~48GB total; 4096 keeps it safe on 16GB VRAM

**LiteLLM config file location**
- Written to `app.getPath('userData')/litellm-config.yaml` — not the app install directory
- Phase 2 config is local-only (single Ollama model); full cloud routing deferred to Phase 4

**API key handling**
- API keys are NEVER written to `litellm-config.yaml`
- Keys are passed as environment variables to the spawned LiteLLM process
- This keeps keys out of the filesystem and out of the renderer process

**Startup sequence (main/index.js)**
```
processManager.init(win)
healthChecker.startPolling(win)
detectHardware()              // eager warm-up, result cached for IPC handler
processManager.startService('ollama')
litellm.startLiteLLM({})     // optional — non-fatal failure in Phase 2
```

**LiteLLM deferral decision**
- LiteLLM startup failure is non-fatal in Phase 2: logged as a warning, app continues
- Full cloud routing (budget enforcement, provider switching, usage polling) is Phase 4 work

**Process manager details (process-manager.js)**
- All services spawned with `child_process.spawn()`, `windowsHide: true`, never `shell: true`
- Ollama path resolution: `%APPDATA%\Local\Programs\Ollama\ollama.exe` → `C:\Program Files\Ollama\ollama.exe` → PATH
- Python resolution for LiteLLM/ComfyUI/Whisper/Kokoro: `python` → `python3`
- Restart backoff: `min(1000 * 2^restartCount, 30000)ms`, max 5 retries
- Graceful shutdown order (reverse start order): kokoro → whisper → comfyui → litellm → ollama
- Shutdown sequence: SIGTERM → 8s wait → SIGKILL

**Health checker details (health-checker.js)**
- Poll interval: 5s — covers both HTTP health checks and VRAM update in one tick
- Uses Node built-in `http` module only (no fetch, no axios)
- Per-request timeout: 3s
- `service-status` event emitted only on state transitions, not on every tick

---

## Phase 3 Implementation Notes

Facts that are not derivable from git log and aren't obvious from reading the code. Reference these when debugging or extending Phase 3 modules.

**hardware-scan.js (main/wizard/hardware-scan.js)**
- Wraps `detector.js` and returns a higher-level capability object: `{ vramTier, canRunChat, canRunImage, canRunVoice, canRunCoding, needsCloud }`
- `vramTier` maps directly to the tiers in the Model Recommendation Algorithm table (18GB+, 10–18GB, 6–10GB, 3–6GB, <3GB)
- `needsCloud` is set to `true` only when usable VRAM is below 3GB — signals the wizard to prompt for API keys

**model-recommender.js (main/wizard/model-recommender.js)**
- Takes a capabilities array and the hardware object from `hardware-scan.js`
- Returns one recommended model per requested capability based on VRAM tier
- Model lists are the same as the Model Recommendation Algorithm table in this file — keep them in sync if you update either

**model-downloader.js (main/wizard/model-downloader.js)**
- Coordinates Ollama pulls for all recommended models sequentially
- Emits `download-progress` events (`{ model, percent }`) to the renderer for wizard progress display
- Does not download image models (SafeTensors) — ComfyUI model download is handled separately by installer.js

**installer.js (main/infrastructure/installer.js)**
- Full installation orchestration: calls model-downloader for LLM models, handles ComfyUI model fetching
- Emits `install-progress` events (`{ step, percent, message }`) consumed by the InstallingScreen
- Each install step is wrapped in try/catch — failures emit an error state rather than crashing the process

**Wizard boot flow — `setupComplete` flag**
- `settings.setupComplete` (Redux `settings` slice, persisted to disk) gates wizard vs. main app
- On first launch: `setupComplete === false` → `App.jsx` renders the wizard instead of the main app shell
- On wizard completion (ReadyScreen): `setupComplete` is set to `true` → app re-renders into main shell
- Never set `setupComplete = true` programmatically before health-checker confirms all required services are up

**PrereqScreen details**
- Added as Phase 3.5 — not in the original Phase 3 spec
- Runs before WelcomeScreen (index 0 in wizard flow)
- Checks: Ollama binary present, Python ≥ 3.10 present, NVIDIA GPU detected
- If a prerequisite is missing, shows a download/install link and a re-check button — wizard cannot advance until all checks pass

---

## Phase 4 Implementation Notes

Facts that are not derivable from git log and aren't obvious from reading the code. Reference these when debugging or extending Phase 4 modules.

**File ownership (Chat panel)**
- `renderer/pages/Chat/index.jsx` — top-level panel, owns stream lifecycle and the 60-second timeout
- `renderer/pages/Chat/ConversationSidebar.jsx` — conversation list, delete action, active state highlight
- `renderer/pages/Chat/MessageList.jsx` — message feed, auto-scroll on new token
- `renderer/pages/Chat/MessageBubble.jsx` — Markdown rendering via `react-markdown` + `remark-gfm`; handles code blocks
- `renderer/pages/Chat/ChatInput.jsx` — text input, disabled while `isStreaming === true`
- `renderer/pages/Chat/ModelSelector.jsx` — model dropdown, fetches available models from Ollama on mount

**Conversation ID pre-generation**
- The conversation ID is generated in the component BEFORE the Redux dispatch, not inside the reducer
- Reason: if the `send-chat-message` IPC call fires before Redux has processed the `createConversation` action, the main process emits `stream-token` events for a conversation ID that the renderer doesn't know about yet
- Fix: generate ID → dispatch `createConversation(id)` → then invoke IPC with the same ID

**60-second stream timeout (Chat/index.jsx)**
- After sending a message, a `setTimeout` of 60 000ms is set in `Chat/index.jsx`
- If `stream-complete` arrives normally, the timeout is cleared
- If it never arrives (Ollama crash, silent hang), the timeout fires and calls `finaliseStream()` directly
- Prevents the UI being permanently stuck in streaming state

**Duplicate stream-complete guard (chat.js slice)**
- `finaliseStream()` in `renderer/store/slices/chat.js` checks `state.isStreaming` before applying changes
- If `isStreaming` is already `false`, it returns early — no-op
- This prevents double-finalisation when both the IPC event listener and the 60s timeout fire in close succession

**Auto-title generation**
- Triggered on `stream-complete` inside `Chat/index.jsx`
- Title is taken from the first user message in the conversation: first 50 characters, trimmed
- No LLM call is made for title generation — purely string slicing

**Full conversation history per request**
- Every `send-chat-message` IPC invocation sends the full `messages[]` array for the active conversation, not just the latest message
- The main process passes this array directly to Ollama's chat endpoint for LLM context
- This means large conversations increase request payload size proportionally — no summarisation or windowing in Phase 4

**ModelSelector fetch-once behaviour**
- `ModelSelector.jsx` calls the `list-models` IPC channel once on component mount (`useEffect` with empty deps array)
- It does NOT re-fetch when the selected model changes — an earlier version fetched on every model change, causing a re-fetch loop that hammered Ollama
- To refresh the model list (e.g., after a new pull), the user must navigate away and back, or a manual refresh button must be added

---

## Real Installer Implementation Notes

Facts that are not derivable from git log and aren't obvious from reading the code. Reference these when debugging or extending the installer modules.

**Service install directory layout (service-installer.js)**
- All Python-based services are installed under a single `installDir` root chosen by the user during the wizard
- ComfyUI lands at `{installDir}/comfyui/ComfyUI_windows_portable/` after zip extraction
- Python venvs are at `{installDir}/venvs/{service}/` — one venv per service (litellm, whisper, kokoro)
- The venv python executable is always at `{installDir}/venvs/{service}/Scripts/python.exe`
- The LiteLLM CLI entry point is at `{installDir}/venvs/litellm/Scripts/litellm.exe`
- Whisper models are downloaded into `{installDir}/venvs/whisper/models/`
- Kokoro models are downloaded into `{installDir}/venvs/kokoro/models/`
- The FLUX model lands at `{installDir}/comfyui/ComfyUI_windows_portable/ComfyUI/models/checkpoints/flux1-schnell-fp8.safetensors`

**ComfyUI launch method (process-manager.js)**
- ComfyUI is launched by running `run_nvidia_gpu.bat` directly — not via Python
- The `cwd` for the spawn call must be set to the directory containing `run_nvidia_gpu.bat`, not to `installDir` or any parent — the .bat relies on relative paths internally
- When process-manager loads a persisted ComfyUI path, it automatically sets `SERVICE_CONFIG.comfyui.cwd = path.dirname(batPath)`

**Per-service pip packages (service-installer.js / installer.js)**
- LiteLLM venv: `litellm[proxy]`
- Whisper venv: `faster-whisper`
- Kokoro venv: `kokoro-onnx`, `soundfile`
- All packages are installed with `pip install --upgrade` so re-runs bring packages up to date without recreating the venv

**Python minimum version and WindowsApps rejection (service-installer.js)**
- Required minimum: Python 3.11+ — 3.10 (used in Phase 3 PrereqScreen) is not sufficient for the real installer
- Windows App Store Python stubs (path contains `WindowsApps`) are explicitly rejected — they silently fail when used as a real interpreter
- Path resolution uses PowerShell `Get-Command` rather than `where` to get the fully-resolved path before rejection check

**`not-installed` service status (process-manager.js)**
- If `_installedServices[name] === false` when `startService()` is called, the service emits status `not-installed` and returns immediately without spawning
- This prevents crash loops for services the user did not select during setup
- Ollama is exempt from this check — it uses adopt-or-spawn logic regardless of the installed flag

**electron-store key and persisted settings fields (main/index.js, renderer/store/slices/settings.js)**
- Store name: `noxio-settings` — results in `noxio-settings.json` in Electron's userData directory
- Fields read at startup from the store: `settings.setupComplete`, `settings.servicePaths`, `settings.installedServices`, `settings.installDir`
- `servicePaths` maps service name → absolute path to the service's launch executable (bat for ComfyUI, python.exe for Whisper/Kokoro, litellm.exe for LiteLLM)
- `installedServices` maps service name → boolean; gates whether a service will be started or emit `not-installed`

**`setPersistedPaths()` call requirement (main/index.js)**
- Must be called before any `startService()` call — it populates `_servicePaths` and `_installedServices` inside process-manager
- In `main/index.js`, the call order is: `processManager.init(win)` → `processManager.setPersistedPaths(...)` → `processManager.startService('ollama')`
- If `setPersistedPaths` is not called, process-manager falls back to dynamic PATH resolution, which will fail for venv-installed services like Whisper and Kokoro

**Confirmed download URLs (ollama-installer.js, service-installer.js)**
- Ollama installer: `https://ollama.com/download/OllamaSetup.exe` — uses NSIS `/S` flag for silent unattended install
- ComfyUI portable zip: `https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu126.7z` — uses `cu126` (CUDA 12.6), not `cu128`. This is deliberate: a `cu128` portable zip is not yet available; `cu126` runs on Blackwell and all NVIDIA cards via CUDA's backwards-compatibility guarantee. Upgrade to `cu128` only when Comfy-Org publishes that variant.
- FLUX.1-schnell fp8 model: `https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors` — minimum expected size is 9 GB; files smaller than this are treated as corrupt and re-downloaded

**`.part` file pattern for large downloads (service-installer.js)**
- The FLUX model is downloaded to `{destPath}.part` and atomically renamed to the final path on completion
- This prevents a partially-downloaded file from being mistaken for a complete one if the app crashes mid-download
- The idempotency check (skip if file exists and size > 9 GB) only looks at the final path, not the `.part` path — a stale `.part` file will be overwritten on retry

**Whisper and Kokoro model download method (service-installer.js)**
- Models are NOT downloaded via direct HTTP — they are fetched by running a small temporary Python script inside the respective service venv
- The script is written to `os.tmpdir()` as `noxio-dl-{timestamp}.py`, executed via the venv's `python.exe`, then deleted
- For Whisper: instantiates `faster_whisper.WhisperModel("medium", ...)` which triggers the library's own HuggingFace download; model lands in the `download_root` argument path
- For Kokoro: calls `kokoro_onnx.Kokoro.from_pretrained(download_dir=...)` which fetches via the library's own mechanism
- Timeout for each model download script: 300 seconds (5 minutes)

**Ollama installer post-install poll (ollama-installer.js)**
- After the silent installer exits, the module polls `GET http://127.0.0.1:11434/api/tags` every 1 second for up to 15 seconds before declaring failure
- The installer .exe is downloaded to `os.tmpdir()` as `noxio-ollama-setup-{timestamp}.exe` and deleted in a `finally` block regardless of success or failure
- Download progress callbacks fire only when percent increases by ≥ 2 to reduce IPC chatter; same throttle is used for ComfyUI zip and FLUX model downloads

**installer.js step-weight system (main/infrastructure/installer.js)**
- Each install step has a weight that determines its share of the 0–100 overall progress bar
- LLM model downloads each get 20 weight points; FLUX model download gets 20; ComfyUI zip gets 12
- Steps not needed for the user's selected capabilities are excluded from the active step list and their weights are not counted, so the progress bar always reaches 100% regardless of capability selection
- LiteLLM installation failure is non-fatal — the wizard continues even if `install-litellm` fails, because chat/coding can still work without LiteLLM in Phase 2

---

## Development Rhythm

- **Monday** — Review week plan, create feature branches
- **Tue–Thu** — Implementation, commit frequently
- **Friday** — PR review, merge to develop, update README status table

---

## Definition of Done

A feature is done when:
1. Works on reference hardware (RTX 5080, 32GB RAM, Windows 11)
2. Handles error cases gracefully (service unavailable, out of VRAM, etc.)
3. Has been manually tested
4. README status table is updated
5. Commit is clean and follows Conventional Commits

---

## Reference Hardware (Dev Machine)

| Component | Specification |
|---|---|
| GPU | NVIDIA RTX 5080 16GB (Blackwell sm_100) |
| RAM | 32GB DDR5 7200MHz |
| CPU | AMD Ryzen 9 9950X3D |
| Storage | 2× SSD (C: system, E: AI workload) |
| OS | Windows 11 |
| Secondary GPU | GTX 1650 Super 4GB — NOT used for display |

---

## Pre-Release Audit — Known Issues & Polish Backlog

Audit conducted: 2026-03-25. These findings must be resolved before v0.1 ships. Items are grouped by area and tagged with priority.

### How to use this list
- **[BLOCKER]** — must be fixed before any release
- **[HIGH]** — should be fixed before v0.1
- **[MEDIUM]** — should be fixed before v0.1 or in the first patch
- **[LOW]** — polish items, fix when time permits

---

### Setup Wizard

| # | Priority | Finding | File |
|---|---|---|---|
| W1 | HIGH | PrereqScreen blocks on Python 3.11+ being pre-installed, but the installer creates isolated venvs — the Python check is contradictory and hostile to new users. Resolve: either remove the Python prereq check entirely, or confirm whether the installer truly requires a system Python and update the screen copy accordingly. | `renderer/pages/Setup/PrereqScreen.jsx` |
| W2 | MEDIUM | Ollama row in PrereqScreen shows a warning icon when missing, but the only message is "will be installed automatically" with no action. Confusing — users don't know if they should do something or wait. Show a green "installing automatically" note, not a warning icon. | `renderer/pages/Setup/PrereqScreen.jsx` |
| W3 | MEDIUM | Progress dots show only 6 positions but `TOTAL_STEPS = 8`. Dots under-represent wizard length. Fix dot count to match actual steps (excluding step 0 Welcome and final Ready). | `renderer/pages/Setup/index.jsx` |
| W4 | MEDIUM | HardwareScreen has no Back button. All other wizard steps have Back. Add one. | `renderer/pages/Setup/HardwareScreen.jsx` |
| W5 | HIGH | Agent is a selectable capability in CapabilitiesScreen but is deferred indefinitely. Selecting it installs nothing and lands the user on a stub panel. Remove Agent from `ALL_CAPABILITIES` or mark it non-selectable ("coming soon"). | `renderer/pages/Setup/CapabilitiesScreen.jsx` |
| W6 | LOW | ModelsScreen JSDoc says "Screen 4" but it is now step 5. ReadyScreen says "Screen 6" but is step 7. Update JSDoc comments. | `renderer/pages/Setup/ModelsScreen.jsx`, `ReadyScreen.jsx` |
| W7 | HIGH | No way to re-run setup or add capabilities post-wizard. If a user skips Image generation and later wants to add it, there is no UI path. Requires: new `install-additional-capability` IPC handler + a "Manage capabilities" section in Settings. | `main/ipc/handlers.js` (gap), `renderer/components/SettingsOverlay.jsx` |

---

### Settings Panel

| # | Priority | Finding | File |
|---|---|---|---|
| S1 | HIGH | Appearance settings section is entirely non-functional. Theme and font size options are visible but clicking them does nothing — no `onClick` handler on the active option, no Save button. Either implement dark theme save or replace the section with a "Dark mode only in v0.1" note. | `renderer/components/settings/AppearanceSection.jsx` |
| S2 | MEDIUM | No "Services" or "Capabilities" section in Settings. Users cannot see which services are installed, their install directory, or add new capabilities. Required surface for W7. | `renderer/components/SettingsOverlay.jsx` |
| S3 | MEDIUM | Cloud section shows API key URLs as plain text with a Copy button. `openExternal` is not exposed in the preload bridge. Expose it so users can click directly to the provider's API key page. | `renderer/components/settings/CloudSection.jsx`, `main/preload.js` |
| S4 | HIGH | API keys are held only in-memory and are lost on app restart. No warning is shown. On restart, cloud routing silently falls back to local. Fix: when `enabled: true` is persisted but `_apiKeys` is empty on startup, flag `apiKeyRequired: true` in the settings payload so the UI can prompt re-entry. | `main/ipc/handlers.js` |
| S5 | LOW | VoiceSection in Settings is fully interactive even though Voice panel is a stub. Add a note that Voice is coming in a future release, or gate the section on `installedServices.whisper`. | `renderer/components/settings/VoiceSection.jsx` |
| S6 | MEDIUM | `settings.chat.contextWindow` is persisted via `save-chat-settings` but `ollama.js:generateStream` always uses hardcoded `num_ctx: 4096` and never reads this value. The setting has zero effect. Either wire it up (with OOM warnings for values > 4096 on 16 GB VRAM) or remove the slider until Phase 4 completes the wiring. | `main/services/ollama.js`, `renderer/components/settings/ChatSection.jsx` |
| S7 | LOW | `cloudProviders.{provider}.usedUSD` is never reset monthly. After the first month the accumulated value always exceeds the monthly cap, making budget enforcement meaningless. Store a `usageResetMonth` (ISO year-month) and reset `usedUSD` to 0 when the month changes. | `main/ipc/handlers.js` |

---

### Navigation & Routing

| # | Priority | Finding | File |
|---|---|---|---|
| N1 | MEDIUM | Voice and Agent sidebar tabs are hardcoded `disabled: true`. Voice tab should enable dynamically when `installedServices.whisper` is true. Agent should be removed from the sidebar entirely (deferred indefinitely). | `renderer/components/Sidebar.jsx` |
| N2 | MEDIUM | App.jsx renders `<ComingSoon label="Voice" />` for the voice route even though `VoicePanel` exists as a component. Wire `VoicePanel` into the `activeMode === 'voice'` branch once the Voice tab is enabled. | `renderer/App.jsx` |
| N3 | LOW | Gaming Mode button sits in sidebar at 20% opacity with tooltip "Gaming Mode — Phase 5." This is internal developer language. Change tooltip to user-facing copy ("Pause AI to free your GPU for gaming — coming soon") or remove it entirely until the feature ships. | `renderer/components/Sidebar.jsx` |
| N4 | LOW | Settings gear button always opens on the Models tab (`openSettingsPanel('models')`) regardless of which tab was last open. Change to open on the last active section. | `renderer/components/Sidebar.jsx` |

---

### Chat Panel

| # | Priority | Finding | File |
|---|---|---|---|
| C1 | HIGH | When no models are installed, Chat shows "No models found" with no guidance. Add an inline prompt or button that navigates to Settings > Models when `models.length === 0`. | `renderer/pages/Chat/ModelSelector.jsx` |
| C2 | MEDIUM | Delete conversation fires immediately with no confirmation. A misclick permanently loses the conversation. Add a two-step confirm (first click = confirm state, second click = execute). | `renderer/pages/Chat/ConversationSidebar.jsx` |
| C3 | HIGH | Conversation history is not persisted between sessions. All conversations are lost on app restart. Persist conversations to electron-store via middleware or on `before-quit`. | `renderer/store/slices/chat.js` |
| C4 | MEDIUM | Streaming "Generating…" indicator is `text-[10px]` in the top bar — easy to miss. Users may try to send a second message. Make the streaming state more visible, or add a full-width loading bar. | `renderer/pages/Chat/index.jsx` |
| C5 | LOW | Code blocks in MessageBubble have no copy-to-clipboard button. This is a standard feature for any coding assistant. Add a Copy button to the `CodeBlock` header. | `renderer/pages/Chat/MessageBubble.jsx` |
| C6 | LOW | Conversations cannot be renamed. Auto-titles based on the first message are often too short or incorrect. Add inline double-click rename. | `renderer/pages/Chat/ConversationSidebar.jsx` |
| C7 | LOW | Cloud routing button (cloud icon in ChatInput) has no visible label. New users won't know what it does. Add a short label or tooltip that explains "Route via cloud AI." | `renderer/pages/Chat/ChatInput.jsx` |
| C8 | LOW | Auto-title truncates at 40 chars in `chat.js` reducer but CLAUDE.md documents 50. Standardise to 50 and update both. | `renderer/store/slices/chat.js` |

---

### Create Panel

| # | Priority | Finding | File |
|---|---|---|---|
| CR1 | HIGH | Create panel renders fully (prompt, generate button) even when ComfyUI is not installed or stopped. If the user did not select Images during setup, clicking Generate returns an error. Add a proactive check on mount: if `services.comfyui.status === 'not-installed'`, show a placeholder explaining ComfyUI is required and how to enable it. | `renderer/pages/Create/index.jsx` |
| CR2 | MEDIUM | Gallery state is local React state — lost on every panel navigation (component unmount). Lift gallery into the Redux `create` slice so images persist when the user switches tabs. | `renderer/pages/Create/index.jsx` |
| CR3 | MEDIUM | `image-progress` IPC event payload is `{ percent }` (object) per CLAUDE.md, but the listener reads it as a raw number. Progress bar will always show `[object Object]%`. Fix: `const onProgress = ({ percent }) => setProgress(percent ?? 0)`. | `renderer/pages/Create/index.jsx` |
| CR4 | LOW | Save image uses an `<a>` tag click hack. Per code comment, Phase 6 should upgrade to a native save dialog via IPC (`save-image` channel). Implement before v0.1. | `renderer/pages/Create/ImageGallery.jsx` |
| CR5 | LOW | No negative prompt field. Add an expandable Advanced section with a negative prompt textarea. | `renderer/pages/Create/index.jsx` |

---

### Status Bar

| # | Priority | Finding | File |
|---|---|---|---|
| SB1 | MEDIUM | Service health dots show all 5 services even when only 2 were installed. Non-installed services show as `stopped` (grey dots) with raw internal names ("comfyui", "litellm"). Filter dots to only services in `settings.selectedCapabilities`, and map to user-facing labels: `{ ollama: 'AI Engine', litellm: 'Router', comfyui: 'Image', whisper: 'Voice In', kokoro: 'Voice Out' }`. | `renderer/components/StatusBar.jsx` |
| SB2 | MEDIUM | On machines without NVIDIA GPU, `vram.availableGB` stays 0 forever and the bar pulses "VRAM checking…" permanently. After 10 seconds with no `vram-update`, switch to "VRAM N/A." | `renderer/components/StatusBar.jsx` |

---

### General / Shell

| # | Priority | Finding | File |
|---|---|---|---|
| G1 | HIGH | Voice panel renders "Voice panel — Phase 6" — developer text visible to users if tab is re-enabled. Replace with `<ComingSoon>` component. | `renderer/pages/Voice/index.jsx` |
| G2 | HIGH | Agent panel renders "Agent panel — Phase 7" — same problem. Replace with user-facing "Agent automation is not available in this version." | `renderer/pages/Agent/index.jsx` |
| G3 | MEDIUM | No per-panel `ErrorBoundary`. A crash in ChatPanel takes down the entire app shell. Wrap each panel individually so a crash is contained and the user can switch panels. | `renderer/App.jsx` |
| G4 | MEDIUM | App.jsx comment says "Phase 4: Chat panel live. Create / Voice / Agent show coming soon" — stale, Create is fully implemented. Update. | `renderer/App.jsx` |
| G5 | LOW | WelcomeScreen promotes "Voice in and out" as a shipped feature, but Voice is a stub. Remove or add a "coming soon" qualifier. | `renderer/pages/Setup/WelcomeScreen.jsx` |

---

### Architecture / Main Process

| # | Priority | Finding | File |
|---|---|---|---|
| A1 | HIGH | `send-chat-message` IPC handler: routing and budget enforcement blocks are outside any try/catch. An exception there propagates as an unhandled rejection visible as a raw error in the renderer. Wrap the entire handler body. | `main/ipc/handlers.js` |
| A2 | MEDIUM | `switch-mode` handler calls `mainWindow.webContents.send` without `isDestroyed()` guard. All other handlers have this guard. Add it. | `main/ipc/handlers.js` |
| A3 | MEDIUM | `complete-setup` handler swallows all errors and returns `undefined`. If `store.set` throws, the wizard believes setup succeeded while `setupComplete` was never written. Return `{ success, error? }` and have ReadyScreen check it. | `main/ipc/handlers.js` |
| A4 | MEDIUM | `not-installed` services are reported as `stopped` by the health checker — the status bar shows grey dots as if services crashed rather than were never installed. In `checkService`, return `'not-installed'` directly when `procState.status === 'not-installed'`. | `main/infrastructure/health-checker.js` |
| A5 | MEDIUM | `budget-warning` and `cloud-usage-update` events are exposed in preload allowlist but not subscribed to in `ipc-middleware.js`. They are silently dropped — Redux budget state never updates. Add listeners. | `renderer/store/middleware/ipc-middleware.js` |
| A6 | MEDIUM | `restartCount` in process-manager increments on each crash but never resets after a stable recovery. After one crash, the service gets only 4 more restart chances instead of 5. Reset to 0 after the process has been running stably for ≥ 30 seconds. | `main/infrastructure/process-manager.js` |
| A7 | MEDIUM | `transitionToCreate` stops Ollama even if it was never started (e.g. user skipped LLM). Check `getServiceStates().ollama.status` before calling `stopService`. | `main/infrastructure/orchestrator.js` |
| A8 | MEDIUM | `generateImageWithVRAMSwap` has no concurrency guard. Two rapid generate-image calls will cause interleaved start/stop on Ollama and ComfyUI. Add an `_imageGenerating` flag. | `main/infrastructure/orchestrator.js` |
| A9 | MEDIUM | `electron-store` is pinned with `^8.2.0` — a minor version bump could pull in a pure-ESM build, breaking `require('electron-store')` in the main process. Pin to an exact version. | `package.json` |
| A10 | LOW | `validate-install-dir` accepts a user-supplied path without path traversal sanitisation. Normalise with `path.resolve()` and reject system directory paths. | `main/ipc/handlers.js` |
| A11 | LOW | `usedUSD` never resets monthly — budget cap comparison becomes meaningless after month 1. Add `usageResetMonth` field. | `main/ipc/handlers.js` |

---

### Decisions Made During Audit

- **Voice (Phase 6) deferred** — Voice panel reverted from the feature branch on 2026-03-25. The Whisper STT + Kokoro TTS implementation had unresolvable startup issues (orchestrator race condition, Python server scripts missing). Voice will be re-approached as a standalone debug session before re-integrating.
- **Agent panel deferred indefinitely** — confirmed, per earlier CLAUDE.md note. Remove from setup wizard capability list.
- **Conversation persistence is a v0.1 requirement** — users expect chat history to survive restarts. This is not a Phase 5+ item; it must ship in v0.1.
- **Capability management post-setup is a v0.1 requirement** — users who skip a capability during setup must be able to add it later from Settings without re-running the full wizard.

---

## Open Questions (Resolve During Development)

- **Agent framework** — ~~OpenClaw vs Open Interpreter vs custom~~ **DEFERRED.** See Product Positioning section. Noxio is not building a competing agent runtime. Future work is integration (MCP server, local API surface for external agents), not a standalone agent panel.
- **ComfyUI integration** — **RESOLVED:** Option A (React UI calling ComfyUI API). Implemented in Phase 5. React UI calls ComfyUI's queue/prompt API directly; ComfyUI runs as a background process managed by process-manager.js.
- **VRAM auto-management implementation** — **RESOLVED:** Orchestrator pauses Ollama before starting ComfyUI, resumes after image generation completes. Implemented in `main/infrastructure/orchestrator.js`.
- **Website** — noxiolabs.dev needs at least a landing page.
- **Twitter/X @noxiolabs** — Waiting on domain email setup first.

---

## What Not to Do

- Never expose WSL terminal, Docker CLI, port numbers, or container names to the user
- Never let the renderer process spawn system processes directly — always IPC to main
- Never hardcode model paths or port numbers in the renderer
- Never claim a feature is "done" in the README until it ships in a release
- Never write `console.log` in production code
- Never use `docker-compose` in v0.1 — fully native Windows only