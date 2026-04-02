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

const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
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

/** @type {Tray|null} */
let tray = null;

/** Whether game mode is currently active (all AI services stopped for gaming) */
let gameModeActive = false;

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

  // Hide to tray instead of closing unless the app is actively quitting.
  // This allows background services (Ollama, etc.) to keep running while the window is hidden.
  mainWindow.on('close', (event) => {
    if (!_quitting) {
      event.preventDefault();
      mainWindow.hide();
      logger.info('Main window hidden to tray');
    }
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

/**
 * Creates the system tray icon with context menu.
 * Falls back to an empty icon if assets/icon.png does not exist (dev mode).
 * @param {BrowserWindow} win
 */
function createTray(win) {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Noxio');

  function buildTrayMenu() {
    return Menu.buildFromTemplate([
      {
        label: 'Open Noxio',
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
          }
        },
      },
      {
        label: gameModeActive ? 'Disable Game Mode' : 'Enable Game Mode',
        click: () => {
          toggleGameMode(win);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ]);
  }

  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => {
    if (win && !win.isDestroyed()) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
        win.focus();
      }
    }
  });

  // Expose a way for handlers.js to refresh the tray menu after game mode changes
  tray._rebuildMenu = () => tray.setContextMenu(buildTrayMenu());
}

/**
 * Toggles game mode: stops all AI services to free VRAM, or restarts them.
 * Emits 'game-mode-changed' to the renderer after the state changes.
 * @param {BrowserWindow} win
 */
async function toggleGameMode(win) {
  gameModeActive = !gameModeActive;
  logger.info(`Game mode: ${gameModeActive ? 'activated' : 'deactivated'}`);

  if (gameModeActive) {
    // Stop all services to free GPU VRAM for gaming
    healthChecker.stopPolling();
    await processManager.stopAll().catch((err) => {
      logger.error(`Game mode: failed to stop services — ${err.message}`);
    });
    logger.info('Game mode: all services stopped, VRAM released');
  } else {
    // Restore services
    const setupComplete = store.get('settings.setupComplete', false);
    const installedServices = store.get('settings.installedServices', {});
    if (setupComplete && installedServices.ollama !== false) {
      await processManager.startService('ollama').catch((err) => {
        logger.error(`Game mode: failed to restart Ollama — ${err.message}`);
      });
    }
    healthChecker.startPolling(win);
    logger.info('Game mode: services restored');
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('game-mode-changed', gameModeActive);
  }

  if (tray?._rebuildMenu) tray._rebuildMenu();
}

/**
 * Returns the current game mode state. Called by the get-game-mode IPC handler.
 * @returns {boolean}
 */
function getGameModeActive() {
  return gameModeActive;
}

app.whenReady().then(async () => {
  logger.info(`Noxio starting — Electron ${process.versions.electron}, Node ${process.versions.node}`);

  // Remove the application menu bar completely
  Menu.setApplicationMenu(null);

  const win = createWindow();
  registerHandlers(win, { toggleGameMode: () => toggleGameMode(win), getGameModeActive });

  createTray(win);

  // Start background services after window is created (non-blocking relative to render)
  startBackgroundServices(win).catch((err) => {
    logger.error(`Background service startup error: ${err.message}`);
  });

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
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

// Don't quit when all windows are closed — we hide to tray instead.
// Quitting only happens via the tray menu "Quit" option or app.quit() directly.
app.on('window-all-closed', () => {
  // Intentionally do nothing — the window hides to tray, not closes.
  // macOS already handles this via 'activate'.
  logger.info('All windows hidden to tray — app continues running');
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
