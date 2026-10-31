import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
    onError: (listener) => subscribe(IpcChannel.AppError, listener)
  },
  serial: {
    list: () => ipcRenderer.invoke(IpcChannel.SerialList)
  },
  terminal: {
    open: (serial, options) => ipcRenderer.invoke(IpcChannel.TerminalOpen, serial, options),
    openSerial: (options, size) => ipcRenderer.invoke(IpcChannel.TerminalOpenSerial, options, size),
    write: (id, data) => ipcRenderer.send(IpcChannel.TerminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IpcChannel.TerminalResize, id, cols, rows),
    close: (id) => ipcRenderer.invoke(IpcChannel.TerminalClose, id),
    onEvent: (listener) => subscribe(IpcChannel.TerminalEvent, listener)
  },
  metrics: {
    snapshot: (serial) => ipcRenderer.invoke(IpcChannel.MetricsSnapshot, serial),
    onEvent: (listener) => subscribe(IpcChannel.MetricsEvent, listener)
  }
}

contextBridge.exposeInMainWorld('cockpit', api)
