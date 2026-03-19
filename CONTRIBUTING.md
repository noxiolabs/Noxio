# Contributing to Noxio

Thanks for your interest in contributing. Noxio is built in public and all
contributions are welcome — code, documentation, bug reports, hardware testing,
and ideas.

---

## Before You Start

Read the [README](README.md) to understand what Noxio is and where it stands.
The project is in early development (pre-v0.1). The best contributions right
now are:

- Bug reports and hardware compatibility feedback
- Code for features listed in the roadmap
- Documentation improvements
- Testing on hardware we don't have (AMD GPU, Apple Silicon, Linux)

---

## Development Setup

### Prerequisites

- Node.js 20+ (LTS)
- npm 10+
- Git
- Windows 11 (for v0.1 development)
- NVIDIA GPU with 8GB+ VRAM (8GB runs 3B–7B models; 10GB+ recommended for 14B models)
- [Ollama](https://ollama.ai) installed natively on Windows

### Getting Started

```bash
git clone https://github.com/noxiolabs/Noxio.git
cd Noxio
npm install
npm run dev
```

`npm run dev` starts Electron in development mode with hot reload.

### Available Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Electron in dev mode with hot reload |
| `npm run build` | Build the React renderer for production |
| `npm run package` | Package the app as a Windows .exe installer |
| `npm run lint` | Run ESLint across all files |
| `npm test` | Run unit tests |

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, always working. Only tagged releases land here. |
| `develop` | Active development. All features merge here first. |
| `feature/[name]` | Individual features. e.g. `feature/chat-panel` |
| `fix/[name]` | Bug fixes. e.g. `fix/vram-detection` |
| `release/[version]` | Release preparation. e.g. `release/v0.1.0` |

**Always branch from `develop`, never from `main`.**

```bash
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

---

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/).

```
type(scope): description
```

**Types:**

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `chore` | Dependency updates, build changes |
| `docs` | Documentation only |
| `refactor` | Code restructuring without behaviour change |
| `test` | Adding or fixing tests |
| `style` | Formatting, whitespace |

**Examples:**
```
feat(chat): add streaming token support
fix(detector): correct VRAM reading on Blackwell GPUs
chore(deps): update Ollama to 0.7.0
docs(readme): add AMD GPU setup instructions
refactor(orchestrator): split into smaller modules
```

Keep descriptions short and in the imperative: "add X", not "added X" or "adds X".

---

## Pull Request Process

1. **Create your branch** from `develop` (not `main`)
2. **Make your changes** with clean, conventional commits
3. **Test manually** on real hardware if possible
4. **Open a PR** against `develop`
5. **Fill in the PR description:**
   - What does this PR do?
   - How do you test it?
   - Screenshots or GIF if it's a UI change
   - Hardware tested on (GPU, VRAM, OS)
6. **Wait for review** — all PRs need at least one review before merge
7. **Address feedback** if requested
8. PRs are **squash merged** to keep `develop` history clean

---

## Code Quality

- **No `console.log` in production code** — use the logger utility
- **All IPC handlers need error handling** — services can fail, handle it
- **Components under 200 lines** — split if larger
- **Every new file needs a comment at the top** — what it does, why it exists
- **JSDoc on every exported function**

```javascript
/**
 * @file detector.js
 * @description Detects GPU, RAM, OS, and driver version on the host machine.
 * Called at startup and during the setup wizard hardware scan.
 */

/**
 * Detects all hardware relevant to running Noxio.
 * @returns {Promise<HardwareInfo>} Detected hardware configuration
 */
async function detectHardware() { ... }
```

---

## File and Folder Naming

| Type | Convention | Example |
|---|---|---|
| React components | PascalCase | `ChatPanel.jsx`, `StatusBar.jsx` |
| Utility / service files | camelCase | `detector.js`, `processManager.js` |
| Redux slices | camelCase | `infrastructure.js`, `chat.js` |
| Config files | kebab-case | `model-recommender.js` |
| Test files | source name + `.test` | `detector.test.js` |

---

## Architecture Overview

Noxio uses Electron with a strict process boundary:

- **Main process** (Node.js) — manages all background services, file system, process spawning
- **Renderer process** (React) — UI only, communicates via IPC
- **Preload script** — security bridge between the two

All service management (starting Ollama, switching modes, health checks) lives
in the main process. The React UI only makes IPC calls via `window.electronAPI`.
Never put Node.js code in the renderer.

The full architecture is documented in [CLAUDE.md](CLAUDE.md) in the repo root.

---

## What We Need Help With

### Right Now (pre-v0.1)
- [ ] Electron shell and IPC bridge implementation
- [ ] Hardware detection across different NVIDIA GPU generations
- [ ] Setup wizard UI components

### Coming Soon
- [ ] AMD GPU testing (ROCm)
- [ ] Apple Silicon native installation path
- [ ] Linux support
- [ ] Automated tests for the infrastructure layer

### Always Useful
- Bug reports with clear reproduction steps
- Hardware compatibility reports (what works, what doesn't)
- Documentation improvements
- Typo fixes (yes, really — always welcome)

---

## Reporting Bugs

Use [GitHub Issues](https://github.com/noxiolabs/Noxio/issues).

Please include:
- Your GPU model and VRAM
- Windows version
- Noxio version
- Steps to reproduce
- What you expected vs what happened
- Any error messages or logs

---

## Asking Questions

Use [GitHub Discussions](https://github.com/noxiolabs/Noxio/discussions) for:
- Questions about the architecture
- Ideas for features
- Help getting set up
- General conversation about the project

Use Issues only for confirmed bugs or specific feature requests.

---

## Code of Conduct

Be kind. We're all building something here.

- Constructive criticism is welcome, personal attacks are not
- Assume good faith from other contributors
- Help newcomers — everyone starts somewhere
- If something is wrong, point to the docs or suggest the fix

---

## License

By contributing to Noxio, you agree that your contributions will be licensed
under the [AGPL-3.0 License](LICENSE).