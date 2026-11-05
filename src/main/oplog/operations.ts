import { basename } from 'node:path'
import { IpcChannel } from '@shared/ipc'
import type { AppAction } from '@shared/apps'
import type { TerminalOpenOptions } from '@shared/terminal'

export interface OpInfo {
  label: string
  serial?: string
  detail?: string
}

const APP_ACTION: Record<AppAction, string> = {
  launch: '打开应用',
  uninstall: '卸载应用',
  restore: '恢复应用',
  disable: '停用应用',
  enable: '启用应用',
  forceStop: '强制停止应用',
  clearData: '清除应用数据'
}

const names = (paths: unknown) => (Array.isArray(paths) ? paths.map((p) => basename(String(p))).join(', ') : '')

/**
 * 哪些 IPC 调用算作用户操作、记进操作日志，以及怎样描述它们。
 * 后台轮询（设备列表、状态采集、包名补全、进程号查询）不在这里，不会刷屏。
 */
export const OPERATIONS: Partial<Record<string, (...args: never[]) => OpInfo>> = {
  [IpcChannel.AdbConnect]: (address: string) => ({ label: '无线连接', detail: address }),
  [IpcChannel.AdbDisconnect]: (serial: string) => ({ label: '断开连接', serial }),
  [IpcChannel.MirrorStart]: (serial: string) => ({ label: '开始投屏', serial }),
  [IpcChannel.MirrorStop]: () => ({ label: '停止投屏' }),
  [IpcChannel.TerminalOpen]: (serial: string, options: TerminalOpenOptions) => {
    if (options?.kind === 'local') return { label: '打开本机终端' }
    if (options?.kind === 'logcat') return { label: '打开 Logcat', serial, detail: options.logcatArgs || undefined }
    return { label: options?.root ? '打开 root 终端' : '打开 Shell', serial }
  },
  [IpcChannel.FilesList]: (serial: string, dir: string) => ({ label: '浏览目录', serial, detail: dir }),
  [IpcChannel.FilesPush]: (serial: string, paths: string[], dir: string) => ({ label: '上传文件', serial, detail: `${names(paths)} → ${dir}` }),
  [IpcChannel.FilesPull]: (serial: string, remote: string, local: string) => ({ label: '下载文件', serial, detail: `${remote} → ${local}` }),
  [IpcChannel.FilesRemount]: (serial: string, point: string) => ({ label: 'remount 分区', serial, detail: point }),
  [IpcChannel.FilesDiskUsage]: (serial: string, dir: string, asRoot: boolean) => ({
    label: asRoot ? '用 root 统计目录占用' : '统计目录占用',
    serial,
    detail: dir
  }),
  [IpcChannel.RootEnter]: (serial: string) => ({ label: '进入 root', serial }),
  [IpcChannel.RootExit]: (serial: string) => ({ label: '退出 root', serial }),
  [IpcChannel.AppsList]: (serial: string) => ({ label: '扫描应用', serial }),
  [IpcChannel.AppsRun]: (serial: string, pkg: string, action: AppAction) => ({ label: APP_ACTION[action] ?? action, serial, detail: pkg }),
  [IpcChannel.AppsExport]: (serial: string, pkg: string) => ({ label: '导出 APK', serial, detail: pkg }),
  [IpcChannel.AppsInstall]: (serial: string, paths: string[]) => ({ label: '安装 APK', serial, detail: names(paths) }),
  [IpcChannel.DeviceScreenshot]: (serial: string) => ({ label: '截图', serial }),
  [IpcChannel.TraceRecordStart]: (serial: string) => ({ label: '录制 Trace', serial }),
  [IpcChannel.TraceRecordStop]: (serial: string) => ({ label: '结束录制 Trace', serial })
}

/** 调用没抛错、但结果里带着失败（如部分文件上传失败）时，取第一条失败原因 */
export function failureOf(result: unknown): string | undefined {
  const items = Array.isArray(result) ? result : [result]
  const failed = items.find((r) => r && typeof r === 'object' && (r as { ok?: unknown }).ok === false) as { message?: string } | undefined
  return failed ? failed.message || 'failed' : undefined
}
