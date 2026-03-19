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

## Project Identity

| | |
|---|---|
| Repo | github.com/noxiolabs/Noxio |
| Org | github.com/noxiolabs |
| License | AGPL-3.0 |
| Website | noxiolabs.dev |
| Status | Active development — nothing in repo yet as of March 2026 |

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
    Setup/                    # 6-screen setup wizard
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

## Setup Wizard Flow (6 screens)

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

## Open Questions (Resolve During Development)

- **Agent framework** — OpenClaw vs Open Interpreter vs custom. Evaluate sandboxing, tool access API, Windows support, active maintenance.
- **ComfyUI integration** — Option A: React UI calling ComfyUI API (full control). Option B: embed ComfyUI with locked pre-loaded workflow (faster). Option C: different image gen backend.
- **VRAM auto-management implementation** — Exact logic for pause/resume timing, error handling, race conditions.
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