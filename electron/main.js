const { app, BrowserWindow, Menu, shell, powerSaveBlocker, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow = null;
let serverPort = null;
let powerBlockerId = null;
let updatesReady = false;

// ── Resolve paths for both dev and packaged modes ────────────────────────────
const isPackaged = app.isPackaged;
const APP_ROOT = isPackaged
  ? path.join(process.resourcesPath, 'app.asar')
  : path.join(__dirname, '..');

const BACKEND_PATH  = path.join(APP_ROOT, 'backend', 'server.js');
const FRONTEND_DIST = path.join(APP_ROOT, 'frontend', 'dist');

// Tell the backend where its static files live
process.env.PAKARDOT_DIST = FRONTEND_DIST;

async function startBackend() {
  const { start } = require(BACKEND_PATH);
  // port:0 = let OS pick a free port; bind to loopback only
  const { port } = await start({ port: 0, host: '127.0.0.1' });
  return port;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 320,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    title: 'PakarDot',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);

  // Open external links (e.g. Pikud HaOref site) in default browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updates:status', payload);
}

function configureUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    updatesReady = true;
    sendUpdateStatus({
      state: 'available',
      version: info.version,
      releaseName: info.releaseName,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    updatesReady = false;
    sendUpdateStatus({ state: 'not-available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      state: 'downloading',
      percent: Math.round(progress.percent || 0),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      state: 'downloaded',
      version: info.version,
      releaseName: info.releaseName,
    });
  });

  autoUpdater.on('error', (error) => {
    sendUpdateStatus({
      state: 'error',
      message: error?.message || 'Update check failed',
    });
  });

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) {
      return { state: 'disabled', message: 'Updates are only available in the packaged Mac app.' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { state: 'checking' };
    } catch (error) {
      return { state: 'error', message: error?.message || 'Update check failed' };
    }
  });

  ipcMain.handle('updates:download', async () => {
    if (!app.isPackaged) {
      return { state: 'disabled', message: 'Updates are only available in the packaged Mac app.' };
    }
    if (!updatesReady) {
      return { state: 'idle', message: 'No update is ready to download.' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { state: 'downloading' };
    } catch (error) {
      return { state: 'error', message: error?.message || 'Update download failed' };
    }
  });

  ipcMain.handle('updates:install', () => {
    if (!app.isPackaged) return { state: 'disabled' };
    autoUpdater.quitAndInstall(false, true);
    return { state: 'installing' };
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    serverPort = await startBackend();
  } catch (err) {
    console.error('Backend failed to start:', err);
    app.quit();
    return;
  }

  createWindow();
  configureUpdates();

  // OS-level "prevent display sleep" — complements the in-page Wake Lock API.
  // Activated by default since this app's purpose is to stay on for hours.
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  // Minimal menu — keeps Cmd-Q, Cmd-W, copy/paste, but trims irrelevant items
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3500);
  }
});

app.on('window-all-closed', () => {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  if (process.platform !== 'darwin') app.quit();
});
