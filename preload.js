const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAiSettings: () => ipcRenderer.invoke('ai:getSettings'),
  saveAiSettings: (s) => ipcRenderer.invoke('ai:saveSettings', s),
  generate: (opts) => ipcRenderer.invoke('ai:generate', opts),
  savePng: (dataUrl, defaultName) => ipcRenderer.invoke('file:savePng', { dataUrl, defaultName }),
  saveProject: (json, defaultName) => ipcRenderer.invoke('file:saveProject', { json, defaultName }),
  openProject: () => ipcRenderer.invoke('file:openProject'),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpConfig: () => ipcRenderer.invoke('mcp:config'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
});
