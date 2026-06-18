const { app, BrowserWindow, Menu, shell, powerSaveBlocker, ipcMain, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow = null;
let serverPort = null;
let powerBlockerId = null;
let updatesReady = false;
let currentDockStatus = null;

// ── Resolve paths for both dev and packaged modes ────────────────────────────
const isPackaged = app.isPackaged;
const APP_ROOT = isPackaged
  ? path.join(process.resourcesPath, 'app.asar')
  : path.join(__dirname, '..');

const BACKEND_PATH  = path.join(APP_ROOT, 'backend', 'server.js');
const FRONTEND_DIST = path.join(APP_ROOT, 'frontend', 'dist');
const APP_ICON_PATH = isPackaged
  ? path.join(process.resourcesPath, 'icon.icns')
  : path.join(__dirname, '..', 'build-resources', 'icon.icns');
const DOCK_PREVIEW_STATUS = process.argv
  .find(arg => arg.startsWith('--pakardot-dock-preview='))
  ?.split('=')[1];
const DOCK_SNAPSHOT_DIR = process.env.PAKARDOT_DOCK_SNAPSHOT_DIR ?? null;

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

  const appUrl = new URL(`http://127.0.0.1:${serverPort}/`);
  if (['green', 'yellow', 'red', 'unknown'].includes(DOCK_PREVIEW_STATUS)) {
    appUrl.searchParams.set('dockPreview', DOCK_PREVIEW_STATUS);
  }
  mainWindow.loadURL(appUrl.toString());

  // Open external links (e.g. Pikud HaOref site) in default browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function dockPalette(status) {
  switch (status) {
    case 'green':
      return { fill: '#00e676', shadow: '#0a6c41', ring: '#073322' };
    case 'yellow':
      return { fill: '#ffd600', shadow: '#896d00', ring: '#433400' };
    case 'red':
      return { fill: '#ff1744', shadow: '#7f102a', ring: '#370612' };
    default:
      return { fill: '#7c7c7c', shadow: '#4a4a4a', ring: '#242424' };
  }
}

function statusDockIcon(status) {
  const { fill, shadow, ring } = dockPalette(status);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="122" fill="#0b0b0b"/>
      <circle cx="256" cy="256" r="194" fill="${shadow}" opacity="0.34"/>
      <circle cx="256" cy="256" r="172" fill="${fill}"/>
      <circle cx="256" cy="256" r="172" fill="none" stroke="${ring}" stroke-width="24"/>
      <circle cx="210" cy="198" r="54" fill="#ffffff" opacity="0.18"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function applyDockIcon(status) {
  if (process.platform !== 'darwin' || !app.dock || currentDockStatus === status) return;
  currentDockStatus = status;
  const icon = statusDockIcon(status);
  app.dock.setIcon(icon);
  if (DOCK_SNAPSHOT_DIR) {
    try {
      require('fs').mkdirSync(DOCK_SNAPSHOT_DIR, { recursive: true });
      require('fs').writeFileSync(path.join(DOCK_SNAPSHOT_DIR, `${status}.png`), icon.toPNG());
    } catch {}
  }
}

function applyDockIconFromDataUrl(status, dataUrl) {
  if (process.platform !== 'darwin' || !app.dock || currentDockStatus === status) return;
  currentDockStatus = status;
  const icon = (() => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      return statusDockIcon(status);
    }
    try {
      const pngBuffer = Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64');
      const pngIcon = nativeImage.createFromBuffer(pngBuffer);
      return pngIcon.isEmpty() ? statusDockIcon(status) : pngIcon;
    } catch {
      return statusDockIcon(status);
    }
  })();
  app.dock.setIcon(icon);
  if (DOCK_SNAPSHOT_DIR) {
    try {
      require('fs').mkdirSync(DOCK_SNAPSHOT_DIR, { recursive: true });
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
        require('fs').writeFileSync(
          path.join(DOCK_SNAPSHOT_DIR, `${status}.png`),
          Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64'),
        );
      } else {
        require('fs').writeFileSync(path.join(DOCK_SNAPSHOT_DIR, `${status}.png`), icon.toPNG());
      }
    } catch {}
  }
}

function restoreDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  try {
    const icon = nativeImage.createFromPath(APP_ICON_PATH);
    if (!icon.isEmpty()) {
      currentDockStatus = 'app';
      app.dock.setIcon(icon);
      return;
    }
  } catch {}
  applyDockIcon('unknown');
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

function configureDockStatusBridge() {
  ipcMain.on('dock:set-status', (_event, payload) => {
    const nextStatus = payload?.status;
    if (typeof nextStatus !== 'string') return;
    if (!['green', 'yellow', 'red', 'unknown'].includes(nextStatus)) return;
    applyDockIconFromDataUrl(nextStatus, payload?.dataUrl);
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
  configureDockStatusBridge();

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

app.on('before-quit', () => {
  restoreDockIcon();
});
