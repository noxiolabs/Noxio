/**
 * @file orchestrator.js
 * @description VRAM-aware mode orchestrator. When the user switches between Chat,
 * Create, Voice, and Agent modes, this module coordinates pausing and resuming
 * services to avoid VRAM conflicts on single-GPU setups.
 *
 * Key rules (16GB VRAM / RTX 5080):
 *   Chat → Create : pause Ollama if needed, start ComfyUI
 *   Create → Chat : pause ComfyUI, resume Ollama
 *   /image in chat: pause Ollama, generate, resume Ollama
 *   Voice panel   : Whisper (1.5GB) + Kokoro (CPU only) — no LLM conflict
 *   Gaming mode   : pause ALL services, release all VRAM
 *
 * TODO Phase 5: implement pause/resume logic using process-manager.js.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Switches the active mode, pausing/resuming services as required.
 * Emits 'mode-ready' event to renderer when transition is complete.
 * TODO Phase 5: wire to process-manager.js pause/resume.
 *
 * @param {string} targetMode - 'chat' | 'create' | 'voice' | 'agent' | 'gaming'
 * @param {string} currentMode
 * @param {import('electron').BrowserWindow} mainWindow
 * @returns {Promise<void>}
 */
async function switchMode(targetMode, currentMode, mainWindow) {
  logger.info(`orchestrator: switchMode ${currentMode} → ${targetMode} (stub)`);
  // TODO Phase 5: implement VRAM-aware transitions
  mainWindow.webContents.send('mode-ready', targetMode);
}

module.exports = { switchMode };
