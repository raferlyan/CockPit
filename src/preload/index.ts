import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron'
import { IpcChannel, MIRROR_PORT_MESSAGE, type CockpitApi } from '@shared/ipc'

// MessagePort 不能经 contextBridge 传递，改用 window.postMessage 转交给页面
ipcRenderer.on(IpcChannel.MirrorPort, (event, payload: { sessionId: string }) => {
  // 只发给本窗口；file:// 页面的 origin 不透明，只能用 '*'
  window.postMessage({ type: MIRROR_PORT_MESSAGE, sessionId: payload.sessionId }, '*', event.ports)
})

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: CockpitApi = {
  platform: process.platform,
  devices: {
    list: () => ipcRenderer.invoke(IpcChannel.DevicesList),
    refreshInfo: (serial) => ipcRenderer.invoke(IpcChannel.DevicesRefreshInfo, serial),
    packages: (serial) => ipcRenderer.invoke(IpcChannel.DevicesPackages, serial),
    onChanged: (listener) => subscribe(IpcChannel.DevicesChanged, listener)
  },
  adb: {
    status: () => ipcRenderer.invoke(IpcChannel.AdbStatus),
    onStatusChanged: (listener) => subscribe(IpcChannel.AdbStatusChanged, listener),
    connect: (address) => ipcRenderer.invoke(IpcChannel.AdbConnect, address),
    disconnect: (serial) => ipcRenderer.invoke(IpcChannel.AdbDisconnect, serial)
  },
  mirror: {
    start: (serial, options) => ipcRenderer.invoke(IpcChannel.MirrorStart, serial, options),
    stop: (sessionId) => ipcRenderer.invoke(IpcChannel.MirrorStop, sessionId),
    control: (sessionId, input) => ipcRenderer.send(IpcChannel.MirrorControl, sessionId, input),
    onEvent: (listener) => subscribe(IpcChannel.MirrorEvent, listener)
  },
  app: {
    onError: (listener) => subscribe(IpcChannel.AppError, listener),
    setZoom: (factor) => webFrame.setZoomFactor(Math.min(Math.max(factor, 0.7), 1.6)),
    setLanguage: (language) => ipcRenderer.send(IpcChannel.AppSetLanguage, language)
  },
  apps: {
    list: (serial) => ipcRenderer.invoke(IpcChannel.AppsList, serial),
    run: (serial, pkg, action, kind) => ipcRenderer.invoke(IpcChannel.AppsRun, serial, pkg, action, kind),
    exportApk: (serial, pkg, apkPath, localDir) => ipcRenderer.invoke(IpcChannel.AppsExport, serial, pkg, apkPath, localDir),
    install: (serial, apkPaths) => ipcRenderer.invoke(IpcChannel.AppsInstall, serial, apkPaths),
    pids: (serial, pkg) => ipcRenderer.invoke(IpcChannel.AppsPids, serial, pkg)
  },
  device: {
    screenshot: (serial) => ipcRenderer.invoke(IpcChannel.DeviceScreenshot, serial),
    saveImage: (png, label, saveAs) => ipcRenderer.invoke(IpcChannel.DeviceSaveImage, png, label, saveAs)
  },
  theme: {
    get: () => ipcRenderer.invoke(IpcChannel.ThemeGet),
    set: (mode) => ipcRenderer.invoke(IpcChannel.ThemeSet, mode)
  },
  serial: {
    list: () => ipcRenderer.invoke(IpcChannel.SerialList)
  },
  trace: {
    uiUrl: () => ipcRenderer.invoke(IpcChannel.TraceUiUrl),
    open: (localPath) => ipcRenderer.invoke(IpcChannel.TraceOpen, localPath),
    pick: () => ipcRenderer.invoke(IpcChannel.TracePick),
    list: () => ipcRenderer.invoke(IpcChannel.TraceList),
    remove: (path) => ipcRenderer.invoke(IpcChannel.TraceRemove, path),
    openDir: () => ipcRenderer.invoke(IpcChannel.TraceOpenDir),
    record: (serial, options, label) => ipcRenderer.invoke(IpcChannel.TraceRecordStart, serial, options, label),
    stopRecord: (serial) => ipcRenderer.invoke(IpcChannel.TraceRecordStop, serial),
    recordings: () => ipcRenderer.invoke(IpcChannel.TraceRecordList),
    onRecordEvent: (listener) => subscribe(IpcChannel.TraceRecordEvent, listener)
  },
  terminal: {
    open: (serial, options) => ipcRenderer.invoke(IpcChannel.TerminalOpen, serial, options),
    openSerial: (options, size) => ipcRenderer.invoke(IpcChannel.TerminalOpenSerial, options, size),
    write: (id, data) => ipcRenderer.send(IpcChannel.TerminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IpcChannel.TerminalResize, id, cols, rows),
    close: (id) => ipcRenderer.invoke(IpcChannel.TerminalClose, id),
    onEvent: (listener) => subscribe(IpcChannel.TerminalEvent, listener)
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    pickLocal: () => ipcRenderer.invoke(IpcChannel.FilesPickLocal),
    pickDirectory: () => ipcRenderer.invoke(IpcChannel.FilesPickDirectory),
    list: (serial, dir) => ipcRenderer.invoke(IpcChannel.FilesList, serial, dir),
    push: (serial, localPaths, remoteDir, transferId) => ipcRenderer.invoke(IpcChannel.FilesPush, serial, localPaths, remoteDir, transferId),
    cancel: (transferId) => ipcRenderer.send(IpcChannel.FilesCancel, transferId),
    diskUsage: (serial, dir, asRoot) => ipcRenderer.invoke(IpcChannel.FilesDiskUsage, serial, dir, asRoot),
    saveText: (defaultName, text) => ipcRenderer.invoke(IpcChannel.FilesSaveText, defaultName, text),
    onProgress: (listener) => subscribe(IpcChannel.FilesProgress, listener),
    pickApk: () => ipcRenderer.invoke(IpcChannel.FilesPickApk),
    pull: (serial, remotePath, localDir) => ipcRenderer.invoke(IpcChannel.FilesPull, serial, remotePath, localDir),
    reveal: (path) => ipcRenderer.send(IpcChannel.FilesReveal, path)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(IpcChannel.ClipboardRead),
    writeText: (text) => ipcRenderer.send(IpcChannel.ClipboardWrite, text)
  },
  metrics: {
    snapshot: (serial) => ipcRenderer.invoke(IpcChannel.MetricsSnapshot, serial),
    onEvent: (listener) => subscribe(IpcChannel.MetricsEvent, listener)
  }
}

contextBridge.exposeInMainWorld('cockpit', api)
