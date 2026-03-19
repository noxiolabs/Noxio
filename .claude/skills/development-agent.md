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
Architecture doc: CLAUDE.md in the repo root (source of truth for all sessions).
Extended product context: noxio-product-doc.docx (external, owner has access — ask if needed).

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
Phase 1 — Electron Shell + IPC Bridge (Weeks 1-2):
1. Electron shell — BrowserWindow, preload.js, basic IPC
2. Redux store structure — all slices defined even if empty
3. npm run dev with hot reload working

Phase 2 — Infrastructure (Weeks 3-4):
4. Hardware detector — GPU, VRAM, RAM, OS detection
5. Ollama process manager — start, stop, health check
6. LiteLLM process manager — config generation, startup, cloud routing

Phase 3 — Setup Wizard (Weeks 5-6):
7. 6-screen wizard UI
8. Model recommender algorithm
9. Model downloader with progress events

Phase 4 — Chat Panel (Weeks 7-8) — v0.1-alpha MILESTONE:
10. Chat panel with streaming
11. Model selector
12. Conversation history
13. StatusBar
14. Basic cloud hybrid: API keys + budget cap in settings

Phase 5 — Create Panel (Weeks 9-10):
15. ComfyUI process manager
16. Image generation API wrapper
17. Create panel UI
18. VRAM auto-management

Phase 6 — Voice Panel (Weeks 11-12):
19. Whisper process manager
20. Kokoro process manager
21. Voice panel UI

Phase 7 — Agent Panel (Weeks 13-14):
22. Agent panel (framework TBD)

Phase 8 — Polish + Launch (Weeks 15-16) — v0.1 FULL RELEASE:
23. Gaming mode
24. System tray
25. Windows .exe installer

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
