'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helixDesktop', Object.freeze({
  chooseWorkspace: () => ipcRenderer.invoke('helix:workspace:choose'),
  listFiles: () => ipcRenderer.invoke('helix:files:list'),
  readFile: (relativePath) => ipcRenderer.invoke('helix:files:read', relativePath),
  writeFile: (relativePath, content) => ipcRenderer.invoke('helix:files:write', relativePath, content),
  createFile: (relativePath) => ipcRenderer.invoke('helix:files:create', relativePath),
  createFolder: (relativePath) => ipcRenderer.invoke('helix:folders:create', relativePath),
  moveFile: (sourcePath, destinationPath) => ipcRenderer.invoke('helix:files:move', sourcePath, destinationPath),
  deleteFile: (relativePath) => ipcRenderer.invoke('helix:files:delete', relativePath),
  getGitStatus: () => ipcRenderer.invoke('helix:git:status'),
  runNpmScript: (scriptName) => ipcRenderer.invoke('helix:node:npm-script', scriptName),
  runNodeFile: (relativePath) => ipcRenderer.invoke('helix:node:run-file', relativePath),
  getRuntimeCatalog: () => ipcRenderer.invoke('helix:runtime:catalog'),
  getRuntimeAvailability: () => ipcRenderer.invoke('helix:runtime:availability'),
  runProjectFile: (relativePath) => ipcRenderer.invoke('helix:runtime:run-file', relativePath),
  attemptRepair: (relativePath) => ipcRenderer.invoke('helix:repair:attempt', relativePath),
  applyRepair: (id) => ipcRenderer.invoke('helix:repair:apply', id),
  discardRepair: (id) => ipcRenderer.invoke('helix:repair:discard', id),
  openLocalUrl: (url) => ipcRenderer.invoke('helix:runtime:open-local-url', url),
  listTemplates: () => ipcRenderer.invoke('helix:templates:list'),
  createTemplate: (templateId, relativePath) => ipcRenderer.invoke('helix:templates:create', templateId, relativePath),
}));
