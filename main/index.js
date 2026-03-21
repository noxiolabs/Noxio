/**
 * @file index.js
 * @description Electron main process entry point. Creates the BrowserWindow,
 * loads the renderer (Vite dev server in dev, built dist/ in prod), wires up
 * the IPC handler layer, and starts background services in the correct order.
 *
 * Startup sequence (Phase 2):
 *   1. Create BrowserWindow
 *   2. Register all IPC handlers
 *   3. Init process-manager with window reference
 *   4. Start health-checker polling
 *   5. Run hardware detection (result accessible via get-hardware-info IPC)
 *   6. Start Ollama
 *   7. Start LiteLLM (optional — failures are non-fatal in Phase 2)
 *
 * This is the only file that should spawn OS processes or access the
 * filesystem directly — the renderer communicates exclusively via IPC.
 */

'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registerHandlers } = require('./ipc/handlers');
const processManager = require('./infrastructure/process-manager');
const healthChecker = require('./infrastructure/health-checker');
const { detectHardware } = require('./infrastructure/detector');
const litellm = require('./services/litellm');
const logger = require('./utils/logger');

const isDev = process.env.NODE_ENV === 'development';

/** @type {BrowserWindow|null} */
let mainWindow = null;

/**
 * Creates the main application window with security-hardened webPreferences.
 * @returns {BrowserWindow}
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f0f11',
    show: false, // revealed in 'ready-to-show' to avoid white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // renderer cannot access Node APIs directly
      nodeIntegration: false,   // non-negotiable — keep renderer sandboxed
      sandbox: false,           // needed for preload to use require()
      webSecurity: true,
    },
  });

  // Load renderer
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    logger.info('Loaded renderer from Vite dev server (http://localhost:5173)');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    logger.info('Loaded renderer from dist/index.html');
  }

  // Show window only when fully rendered — prevents white flash on startup
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    logger.info('Main window ready and shown');
  });

  // Open external links in the OS browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Starts all Phase 2 background services. Called after the window is created.
 * Ollama is required; LiteLLM is optional and its failure does not block startup.
 * @param {BrowserWindow} win
 */
async function startBackgroundServices(win) {
  // Wire process manager to the window so it can push status events
  processManager.init(win);

  // Start health polling — runs every 5s, emits service-status + vram-update
  healthChecker.startPolling(win);

  // Run hardware detection. The result is returned by the get-hardware-info IPC handler
  // on demand — we run it here eagerly so the first IPC call is instant.
  try {
    const hardware = await detectHardware();
    logger.info(
      `Startup hardware: ${hardware.gpu.name}, ${hardware.gpu.vramTotalMB}MB VRAM, ` +
      `${hardware.ram.totalMB}MB RAM`
    );
  } catch (err) {
    logger.warn(`Startup hardware detection failed — ${err.message}`);
  }

  // Start Ollama — core service, must be running for any chat functionality
  try {
    await processManager.startService('ollama');
  } catch (err) {
    logger.error(`Failed to start Ollama: ${err.message}`);
  }

  // Start LiteLLM — optional in Phase 2; direct Ollama access used for chat
  try {
    await litellm.startLiteLLM({});
  } catch (err) {
    logger.warn(`LiteLLM failed to start (optional in Phase 2): ${err.message}`);
  }
}

app.whenReady().then(async () => {
  logger.info(`Noxio starting — Electron ${process.versions.electron}, Node ${process.versions.node}`);

  const win = createWindow();
  registerHandlers(win);

  // Start background services after window is created (non-blocking relative to render)
  startBackgroundServices(win).catch((err) => {
    logger.error(`Background service startup error: ${err.message}`);
  });

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Shut down all services gracefully before the app exits.
// IMPORTANT: Electron does not await async before-quit handlers — the process
// exits before stopAll() completes, leaving Ollama orphaned. The correct pattern
// is to call event.preventDefault(), run cleanup, then call app.exit() explicitly.
let _quitting = false;
app.on('before-quit', (event) => {
  if (_quitting) return; // prevent re-entry when app.exit() triggers another before-quit
  event.preventDefault();
  _quitting = true;
  logger.info('Noxio shutting down — stopping background services');
  healthChecker.stopPolling();
  processManager.stopAll()
    .catch((err) => logger.error(`Shutdown error: ${err.message}`))
    .finally(() => app.exit(0));
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logger.info('All windows closed — quitting');
    app.quit();
  }
});

// Security: prevent navigation to arbitrary URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowedOrigins = ['http://localhost:5173'];
    if (!allowedOrigins.some((origin) => url.startsWith(origin))) {
      logger.warn(`Blocked navigation to: ${url}`);
      event.preventDefault();
    }
  });
});
