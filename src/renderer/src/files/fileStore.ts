import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../api'

interface Transfer {
  serial: string
  /** 待上传的本机绝对路径 */
  files: string[]
}

interface FileState {
  transfer: Transfer | null
  /** 打开传输对话框；已为同一设备打开时把文件追加进去 */
  openTransfer(serial: string, files?: string[]): void
  addFiles(files: string[]): void
  removeFile(path: string): void
  closeTransfer(): void
}

const unique = (paths: string[]) => [...new Set(paths)]

export const useFileStore = create<FileState>((set) => ({
  transfer: null,
  openTransfer: (serial, files = []) =>
    set((s) => ({ transfer: { serial, files: unique(s.transfer?.serial === serial ? [...s.transfer.files, ...files] : files) } })),
  addFiles: (files) => set((s) => (s.transfer ? { transfer: { ...s.transfer, files: unique([...s.transfer.files, ...files]) } } : s)),
  removeFile: (path) => set((s) => (s.transfer ? { transfer: { ...s.transfer, files: s.transfer.files.filter((f) => f !== path) } } : s)),
  closeTransfer: () => set({ transfer: null })
}))

interface DragLike {
  dataTransfer: DataTransfer | null
}

/** 拖动的是本机文件（而不是页面里的文字等） */
export function hasDraggedFiles(e: DragLike): boolean {
  return Boolean(e.dataTransfer?.types.includes('Files'))
}

/** 拖放进来的文件的本机绝对路径；拿不到路径的（如从浏览器拖来的图片）会被忽略 */
export function droppedPaths(e: DragLike): string[] {
  return Array.from(e.dataTransfer?.files ?? [])
    .map((file) => api.files.pathForFile(file))
    .filter(Boolean)
}

/** 文件拖到没有处理拖放的地方时，Electron 默认会把窗口导航到该文件，这里统一拦掉 */
export function usePreventFileNavigation(): void {
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (hasDraggedFiles(e)) e.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])
}
