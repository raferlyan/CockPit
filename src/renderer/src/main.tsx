import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StatusWindow } from './metrics/StatusWindow'
import './styles.css'

/** 同一个页面承载主窗口和弹出的设备状态窗口，主进程用 hash 区分 */
const standaloneStatus = window.location.hash === '#status'

createRoot(document.getElementById('root')!).render(<StrictMode>{standaloneStatus ? <StatusWindow /> : <App />}</StrictMode>)
