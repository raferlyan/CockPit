/**
 * 主进程里给用户看的文字（对话框标题、错误信息）跟随界面语言。
 * 与渲染进程相同，以中文原文作 key；错误信息在抛出处保持中文，经 IPC 返回前统一翻译。
 */
let language: 'zh' | 'en' = 'zh'

export function setLanguage(next: 'zh' | 'en'): void {
  language = next === 'en' ? 'en' : 'zh'
}

export function tm(zh: string): string {
  return language === 'en' ? (EN[zh] ?? zh) : zh
}

/** 把错误信息里认得的中文片段换成英文，认不出的原样保留 */
export function translateError(message: string): string {
  if (language !== 'en') return message
  let out = message
  for (const [zh, en] of PHRASES) out = out.split(zh).join(en)
  return out
}

const EN: Record<string, string> = {
  '选择要安装的 APK': 'Choose APKs to install',
  'Android 应用': 'Android apps',
  '选择要上传的文件': 'Choose files to upload',
  '选择保存位置': 'Choose a destination',
  '打开 trace 文件': 'Open trace file',
  '所有文件': 'All files',
  '保存日志': 'Save log',
  '保存截图': 'Save screenshot',
  '文本文件': 'Text files',
  '图片': 'Images'
}

/** 长的放前面，避免被短的先替换掉一部分 */
const PHRASES: Array<[string, string]> = [
  [
    '（该分区是只读的：需要先 adb root && adb disable-verity && adb remount，或在设备上 su 后 mount -o rw,remount 对应分区）',
    ' (this partition is read-only: run adb root && adb disable-verity && adb remount first, or su on the device and mount -o rw,remount the partition)'
  ],
  ['（设备没有可用的 su，无法提权访问）', ' (no usable su on the device, cannot elevate)'],
  ['（可能处于锁屏安全界面或不支持 screencap）', ' (the device may be on a secure screen or lacks screencap)'],
  ['目录不存在：', 'Directory not found: '],
  ['不是目录：', 'Not a directory: '],
  ['设备没有返回 PNG 图像', 'The device did not return a PNG image'],
  ['秒没有接收数据，传输已中止（设备可能已卡死或重启）', 's without accepting data, transfer aborted (the device may have hung or rebooted)'],
  ['数据已发完，设备 ', 'All data sent, but the device did not confirm the write within '],
  [' 秒内没有确认写入', 's'],
  ['设备 ', 'Device '],
  ['已通过 root 写入', 'Written via root'],
  ['已通过 root 读取', 'Read via root'],
  ['地址格式应为 host:port', 'Address must be host:port'],
  ['未找到 adb', 'adb not found'],
  ['设备不在线', 'Device is offline'],
  ['设备已断开', 'Device disconnected'],
  ['包名不合法：', 'Invalid package name: '],
  ['找不到可启动的界面：', 'No launchable activity: '],
  ['连接已关闭', 'Connection closed'],
  ['已取消', 'Cancelled'],
  ['读取超时（等待 ', 'Read timed out (waiting for '],
  [' 字节）', ' bytes)'],
  ['连接设备失败', 'Failed to connect to device'],
  ['进入 sync 模式失败', 'Failed to enter sync mode'],
  ['sync 应答异常：', 'Unexpected sync reply: ']
]
