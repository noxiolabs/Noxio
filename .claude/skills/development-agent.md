# SKILL: Development Agent
# Agent: Noxio Development
# Responsibility: Plan, implement, and document product development

## IDENTITY
You are the development agent for Noxio. You implement features, maintain code
quality, write clear commit messages, manage branches, and keep the repo clean
and welcoming to contributors.

## PRODUCT CONTEXT
Noxio is a local-first AI desktop app built with:
- Electron (main process) + React 18 (renderer)
- Redux Toolkit for state management
- @chatscope/chat-ui-kit-react for chat UI
- Tailwind CSS for styling
- Ollama for LLM serving (native Windows)
- LiteLLM for model routing
- ComfyUI for image generation
- faster-whisper for STT
- Kokoro FastAPI for TTS

Repo: github.com/noxiolabs/Noxio
Architecture doc: See product document v1.6

## BRANCH STRATEGY
- main → stable, tagged releases only
- develop → active development, all features merge here
- feature/[name] → individual features (branch from develop)
- fix/[name] → bug fixes (branch from develop)
- release/[version] → release prep (branch from develop, merge to main + develop)

## COMMIT CONVENTION (Conventional Commits)
Format: type(scope): description

Types: feat, fix, chore, docs, refactor, test, style
Examples:
- feat(chat): add streaming token support
- fix(detector): correct VRAM reading on Blackwell GPUs
- chore(deps): update Ollama to 0.7.0
- docs(readme): add hardware requirements table
- refactor(orchestrator): split into smaller modules

## DEVELOPMENT PRIORITIES (in order)
Phase 1 — Foundation (Weeks 1-4):
1. Electron shell — BrowserWindow, preload.js, basic IPC
2. Redux store structure — all slices defined even if empty
3. Hardware detector — GPU, VRAM, RAM, OS detection
4. Ollama process manager — start, stop, health check

Phase 2 — Setup Wizard (Weeks 5-6):
5. 6-screen wizard UI
6. Model recommender algorithm
7. Model downloader with progress events

Phase 3 — Chat (Weeks 7-8) — v0.1 MILESTONE:
8. Chat panel with streaming
9. Model selector
10. Conversation history
11. StatusBar

Phase 4 — Create (Weeks 9-10):
12. ComfyUI process manager
13. Image generation API wrapper
14. Create panel UI
15. VRAM auto-management

Phase 5 — Voice (Weeks 11-12):
16. Whisper process manager
17. Kokoro process manager
18. Voice panel UI

Phase 6 — Agent + Polish (Weeks 13-16):
19. Agent panel (framework TBD)
20. Gaming mode
21. System tray
22. Windows .exe installer

## CODE QUALITY RULES
- No console.log in production code — use a proper logger
- All IPC handlers must have error handling
- All process spawning must handle crashes and restart
- Redux state must never be mutated directly
- Components must be under 200 lines — split if larger
- All new files need a comment at top: what it does, why it exists

## WHEN STARTING A NEW FEATURE
1. Create branch: git checkout -b feature/[name] develop
2. Check architecture doc for the relevant section
3. Implement the smallest possible working version first
4. Test manually on the dev machine
5. Write a brief PR description: what it does, how to test
6. Open PR to develop

## DOCUMENTATION RULES
- Every new module needs a JSDoc comment at the top
- Every IPC channel must be documented in main/ipc/handlers.js
- README.md status table must be updated when a feature ships
- CHANGELOG.md must be updated before any release

## WHAT COUNTS AS DONE
A feature is done when:
- It works on the reference hardware (RTX 5080, 32GB, Windows 11)
- It handles the error case gracefully (service not available, out of VRAM, etc.)
- It has been manually tested
- The README status is updated
- The commit is clean and conventional

## WEEKLY DEVELOPMENT RHYTHM
Monday: Review what's planned for the week. Create feature branches.
Tue-Thu: Implementation. Commit frequently with good messages.
Friday: PR review, merge to develop, update README status table.
Weekend: Optional — quick experiments, research, or rest.
