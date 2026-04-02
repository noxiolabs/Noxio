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
 *
 * This is the only file that should spawn OS processes or access the
 * filesystem directly — the renderer communicates exclusively via IPC.
 */

'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { registerHandlers } = require('./ipc/handlers');
const processManager = require('./infrastructure/process-manager');
const healthChecker = require('./infrastructure/health-checker');
const { detectHardware } = require('./infrastructure/detector');
const manifest = require('./infrastructure/manifest');
const ollama = require('./services/ollama');
const logger = require('./utils/logger');

// electron-store — read setup state and persisted service paths at startup
const Store = require('electron-store');
const store = new Store({ name: 'noxio-settings' });

// Initialise the install manifest immediately after the store is created.
// This ensures the 'manifest' key exists before any service or IPC handler
// tries to read or write it.
manifest.initManifest(store);

// Handle --reset-setup CLI flag for development: clears setupComplete to rerun the setup wizard
if (process.argv.includes('--reset-setup')) {
  store.set('settings.setupComplete', false);
  logger.info('--reset-setup flag detected: cleared setupComplete, setup wizard will run on next launch');
}

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
    autoHideMenuBar: true,
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
 * Starts all background services. Called after the window is created.
 * Services are only started if setup is complete — during the wizard, service startup
 * is deferred until the wizard completes and the user has chosen their install location.
 * @param {BrowserWindow} win
 */
async function startBackgroundServices(win) {
  // Wire process manager to the window so it can push status events
  processManager.init(win);

  // Load persisted service paths and installed flags so process-manager uses correct executables
  const servicePaths = store.get('settings.servicePaths', {});
  const installedServices = store.get('settings.installedServices', {});
  processManager.setPersistedPaths(servicePaths, installedServices);

  // Run a background manifest verification pass now that paths are loaded.
  // Non-blocking — does not delay service startup. Emits 'manifest-verified'
  // to the renderer once complete so the UI can reflect accurate install state.
  manifest.verifyManifest(store, () => ollama.listModels().catch(() => [])).then((updated) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('manifest-verified', updated);
    }
  }).catch(() => {
    // verifyManifest is already non-throwing — this is a final safety net
  });

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

  const setupComplete = store.get('settings.setupComplete', false);

  if (setupComplete) {
    // Start Ollama if it was successfully installed (or if flag is unset for legacy setups)
    if (installedServices.ollama !== false) {
      try {
        await processManager.startService('ollama');
      } catch (err) {
        logger.error(`Failed to start Ollama: ${err.message}`);
      }
    }

    // comfyui, whisper, kokoro are started on-demand by the VRAM orchestrator
  } else {
    logger.info('main: setup not complete — skipping service startup');
  }
}

app.whenReady().then(async () => {
  logger.info(`Noxio starting — Electron ${process.versions.electron}, Node ${process.versions.node}`);

  // Remove the application menu bar completely
  Menu.setApplicationMenu(null);

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

// Handle Ctrl+C and kill signals from the terminal (e.g. npm run dev).
// These bypass Electron's before-quit event entirely — route them through
// app.quit() so our cleanup handler runs before the process exits.
process.on('SIGINT', () => {
  logger.info('Received SIGINT — initiating graceful shutdown');
  app.quit();
});
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM — initiating graceful shutdown');
  app.quit();
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
