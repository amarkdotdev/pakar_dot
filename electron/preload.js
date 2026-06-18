const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pakardotUpdates', {
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
});

contextBridge.exposeInMainWorld('pakardotDock', {
  setStatus: (status, dataUrl) => ipcRenderer.send('dock:set-status', { status, dataUrl }),
});

if (process.argv.includes('--pakardot-enable-debug')) {
  contextBridge.exposeInMainWorld('pakardotDebug', {
    setDockStatus: (status, dataUrl) => ipcRenderer.send('dock:set-status', { status, dataUrl }),
  });
}
