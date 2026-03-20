/**
 * @file index.js
 * @description Electron main process entry point. Creates the BrowserWindow,
 * loads the renderer (Vite dev server in dev, built dist/ in prod), and wires
 * up the IPC handler layer. This is the only file that should spawn OS processes
 * or access the filesystem directly — the renderer communicates exclusively via IPC.
 */

'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registerHandlers } = require('./ipc/handlers');
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

app.whenReady().then(() => {
  logger.info(`Noxio starting — Electron ${process.versions.electron}, Node ${process.versions.node}`);

  const win = createWindow();
  registerHandlers(win);

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
