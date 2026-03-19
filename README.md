# Noxio

**Your personal AI. Runs locally. Works privately. No subscriptions.**

> 🚧 Building in public — star to follow along. v0.1 in active development.

---

## What is Noxio?

Noxio is a desktop app that runs a complete AI stack on your own PC. No cloud required, no subscriptions, no data leaving your machine.

One app replaces:

| What you use now | What Noxio replaces it with |
|---|---|
| ChatGPT | Local LLM (Qwen, DeepSeek, Mistral) |
| Midjourney | FLUX.1 image generation |
| ElevenLabs | Kokoro TTS voice synthesis |
| Whisper API | Local speech-to-text |
| Cursor / Copilot | Local coding model |
| Cloud AI agents | Sandboxed local agent |

Everything runs on your GPU. Nothing is sent anywhere — unless you want it to be.

---

## Why local AI?

- **Privacy** — your conversations, images, and code never leave your machine
- **No limits** — no message caps, no rate limits, no usage tiers
- **No fees** — pay once for the hardware, run forever
- **Yours** — your models, your data, your stack

---

## Local + Cloud, Your Way

Noxio is local-first but not cloud-hostile. You can mix both however you want.

- **Run fully local** — everything on your GPU, nothing sent anywhere
- **Add cloud as a fallback** — provide an OpenAI, Anthropic, or Gemini API key and Noxio switches to cloud automatically when your local resources are occupied or the task needs more capability
- **Set a budget** — define a monthly spend limit per cloud provider. Once reached, Noxio falls back to local automatically
- **Per-task control** — choose local for private tasks, cloud for tasks that need more power

The router handles all of this invisibly. You just chat — Noxio picks the right model.

---

## Features (v0.1 target)

- 🧠 **Chat** — streaming chat with automatic model routing (coding / reasoning / general)
- 🎨 **Create** — image generation with a simple prompt interface (no ComfyUI node graphs exposed)
- 🎙️ **Voice** — push to talk input, spoken responses via local TTS
- 🤖 **Agent** — autonomous agent with sandboxed workspace and user-granted tool access
- ⚡ **Setup wizard** — detects your GPU, recommends the right models, downloads and configures everything automatically. No terminal required.
- 🔀 **Smart routing** — `/image`, `/video` shortcuts in chat. Automatic VRAM management between modes.
- ☁️ **Cloud hybrid** — optional cloud API fallback with per-provider budget controls
- 🎮 **Gaming mode** — one click to pause all AI services and free your GPU

---

## Hardware Requirements

| Component | Minimum | Recommended |
|---|---|---|
| GPU | NVIDIA RTX 3070 Ti / 3080 (8GB+)* | NVIDIA RTX 3090 / 4080 / 5080 (16GB+) |
| RAM | 16GB | 32GB |
| Storage | 50GB free | 100GB+ free |
| OS | Windows 11 | Windows 11 |

> *8GB VRAM supports smaller models (3B–7B). 10GB+ recommended for the full 14B model experience. Under 8GB, cloud API fallback mode is recommended.
> Mac (Apple Silicon) and Linux support planned for v0.2 and v0.3.
> AMD GPU support coming in v0.3.

---

## Current Status

Noxio is in active early development. The architecture is fully designed and a proof of concept has been validated on the reference hardware (RTX 5080, 32GB RAM, Windows 11). Active development on the Electron app and UI begins now.

### What has been validated (POC, not yet in repo):
- Local LLM serving via Ollama with custom model configs (Qwen2.5 14B, DeepSeek-R1 14B, Qwen2.5-Coder 14B)
- Model routing via LiteLLM
- Image generation via ComfyUI with FLUX.1 Schnell FP8
- VRAM management between LLM and image generation workloads
- Docker-based service orchestration on Windows + WSL2

### What is being built now:

| Component | Status | Target |
|---|---|---|
| Electron app shell | 🔧 Starting | Week 1-2 |
| IPC bridge + Redux store | 🔧 Starting | Week 1-2 |
| Hardware detector | 🔧 Starting | Week 3-4 |
| Ollama process manager | 🔧 Starting | Week 3-4 |
| Setup wizard (6 screens) | ⏳ Planned | Week 5-6 |
| Chat panel with streaming | ⏳ Planned | Week 7-8 |
| Create panel (image gen) | ⏳ Planned | Week 9-10 |
| Voice panel (STT + TTS) | ⏳ Planned | Week 11-12 |
| Agent panel | ⏳ Planned | Week 13-14 |
| Gaming mode + system tray | ⏳ Planned | Week 15-16 |
| Windows installer (.exe) | ⏳ Planned | Week 15-16 |

> **v0.1-alpha (Week 8):** Chat panel working — stream conversations with a local LLM through a clean desktop UI. No terminal needed. Early testers welcome.
> **v0.1 full release (Week 16):** All features complete — chat, create, voice, agent, gaming mode, cloud hybrid.

---

## Architecture

Noxio is an Electron app. The user sees only the app — everything else runs silently in the background.

```
Noxio (Electron + React)
│
├── Ollama          → LLMs (chat, coding, reasoning) — native Windows
├── LiteLLM         → model router + unified API + cloud fallback
├── ComfyUI         → image and video generation — native Windows
├── faster-whisper  → speech to text
├── Kokoro          → text to speech (CPU only, zero VRAM cost)
└── Agent           → sandboxed autonomous agent
```

All services are installed and managed automatically by the setup wizard.
No terminal. No Docker. No config files. Just install and use.

### How model routing works

```
Your message
     │
     ▼
LiteLLM Router
     │
     ├── Coding task?    → qwen2.5-coder (local)
     ├── Reasoning task? → deepseek-r1 (local)
     ├── General chat?   → qwen2.5 (local)
     └── Cloud budget available + task needs it? → OpenAI / Anthropic / Gemini
```

### How modality routing works

```
Chat panel   → LLM (text response)
Create panel → ComfyUI (image / video)
Voice panel  → Whisper (STT) + LLM + Kokoro (TTS)
Agent panel  → Agent (uses all backends as tools)
```

Shortcuts available from Chat: `/image [prompt]`, `/video [prompt]`

---

## Roadmap

### v0.1-alpha — Chat (Week 8 target)
- [ ] Electron app + setup wizard
- [ ] Chat panel with streaming and model routing
- [ ] Basic cloud hybrid: API key input, per-provider budget cap, LiteLLM routing
- [ ] Windows installer (.exe)
- [ ] Early tester release

### v0.1 — Full Release (Week 16 target)
- [ ] Create panel (FLUX.1 image generation, simple UI)
- [ ] Voice panel (Whisper STT + Kokoro TTS)
- [ ] Agent panel (basic, sandboxed workspace)
- [ ] Gaming mode (one-click GPU free)
- [ ] Public launch

### v0.2 — Mac + Smart Router + Mobile
- [ ] Apple Silicon native support
- [ ] Automatic intent-based model routing
- [ ] Mobile companion app (iOS + Android)
- [ ] Pro tier launch

### v0.3 — Linux + AMD + Cloud Dashboard
- [ ] Linux support
- [ ] AMD GPU support (ROCm)
- [ ] Full cloud management dashboard: usage graphs, spend history, per-provider analytics
- [ ] Enterprise license

### v0.4 — Ecosystem
- [ ] Model marketplace (one-click model installs)
- [ ] Plugin / extension system
- [ ] Multi-machine workload distribution

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Electron |
| UI | React 18 |
| State | Redux Toolkit |
| Chat UI | @chatscope/chat-ui-kit-react |
| Styling | Tailwind CSS |
| LLM serving | Ollama |
| Model router | LiteLLM |
| Image generation | ComfyUI + FLUX.1 |
| Speech to text | faster-whisper |
| Text to speech | Kokoro FastAPI |
| Packaging | electron-builder |

---

## Contributing

Noxio is being built in public and contributions are very welcome.

The best ways to contribute right now:

1. ⭐ **Star the repo** to follow development and help with visibility
2. 👀 **Watch** for release and progress notifications
3. 💬 **Open an issue** to suggest features, report problems, or discuss architecture
4. 🧪 **Test on your hardware** — especially if you have AMD, Apple Silicon, or Intel Arc
5. 🔧 **Submit a PR** — see [CONTRIBUTING.md](CONTRIBUTING.md) (coming soon)

We are particularly looking for contributors with:
- AMD GPU (ROCm testing)
- Apple Silicon Mac (Phase 2)
- Linux (Phase 3)
- React / Electron experience

---

## FAQ

**Does it work without internet?**
Yes — fully local mode works completely offline once models are downloaded.

**How much storage do I need?**
A basic setup (one 14B chat model + voice) needs around 15GB. Adding image generation adds another 15GB. Plan for 50GB+ for a full setup.

**Can I use my existing ChatGPT / Anthropic API key?**
Yes — add your API keys and Noxio will use them as fallback or for specific tasks, with budget controls so you never overspend.

**What about my privacy?**
In local mode, nothing leaves your machine. No telemetry, no analytics, no model training on your data. The code is open source — you can verify this yourself.

**Will it work on my GPU?**
If you have an NVIDIA RTX 3080 or better with 10GB+ VRAM, yes. The setup wizard will tell you exactly what fits on your hardware and recommend the best models for your setup.

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. If you run a modified version as a service, you must open source your changes.

Commercial licenses available for enterprise use — contact us at [hello@noxiolabs.dev](mailto:hello@noxiolabs.dev).

---

<div align="center">

**Built in public by [Noxio Labs](https://noxiolabs.dev)**

⭐ Star this repo to follow development ⭐

[Website](https://noxiolabs.dev) · [Issues](https://github.com/noxiolabs/Noxio/issues) · [Discussions](https://github.com/noxiolabs/Noxio/discussions)

</div>
