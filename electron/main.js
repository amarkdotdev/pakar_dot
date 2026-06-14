const { app, BrowserWindow, Menu, shell, powerSaveBlocker } = require('electron');
const path = require('path');

let mainWindow = null;
let serverPort = null;
let powerBlockerId = null;

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
});

app.on('window-all-closed', () => {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  if (process.platform !== 'darwin') app.quit();
});
