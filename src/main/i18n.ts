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
  '选择解密工具': 'Choose decrypt tool',
  '程序': 'Programs',
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
  ['拿不到 root：adbd 不是 root，su 不能免密使用，也还没有在左侧设备列表右键「进入 root」', 'no root available: adbd is not root, su needs a password, and "Enter root" has not been used from the device list'],
  ['已经进入 root，但该分区还没有 remount。可以点「remount 后重试」，或在 root 终端里执行 mount -o rw,remount ', 'root is active, but the partition has not been remounted. Click "Remount and retry", or run in a root terminal: mount -o rw,remount '],
  ['可以点「remount 后重试」，或在终端里 su 后执行 mount -o rw,remount ', 'click "Remount and retry", or su in the terminal and run mount -o rw,remount '],
  ['（这台设备的分区受 verity 或动态分区保护，单纯 mount 改不了，需要 adb root && adb disable-verity，重启后再 adb root && adb remount）', ' (this partition is protected by verity or dynamic partitions, so mount alone cannot change it: run adb root && adb disable-verity, reboot, then adb root && adb remount)'],
  ['adb remount 要求重启设备后才生效：请重启设备，再执行 adb root 后重试上传（adb 输出：', 'adb remount needs a reboot to take effect: reboot the device, run adb root, then retry the upload (adb output: '],
  [' 已重新挂载为可写', ' remounted read-write'],
  ['无法 remount：', 'Cannot remount: '],
  ['remount 失败：', 'Remount failed: '],
  ['该设备不支持 adb root（user 版本的 adbd 不能以 root 运行）：请改用 su、密码或解密工具', 'This device does not support adb root (adbd on user builds cannot run as root): use su, password or decrypt tool instead'],
  ['adb root 之后 adbd 仍不是 root：', 'adbd is still not root after adb root: '],
  ['su 要求输入密码：请在 root 方式里改用「密码」或「解密工具」', 'su asks for a password: switch the root method to "Username + password" or "Decrypt tool"'],
  ['su 要求输入密码，但还没有保存密码：请在 root 方式设置里填写', 'su asks for a password, but none is saved: enter it in Root methods'],
  ['没能从 su 的输出里找到挑战码：可以在 root 方式设置里填写提取挑战码的正则', 'Could not find a challenge in the su output: set a challenge regex in Root methods'],
  ['还没有配置解密工具：请在 root 方式设置里选择解密工具', 'No decrypt tool configured: choose one in Root methods'],
  ['还没有配置解密工具', 'No decrypt tool configured'],
  ['su 再次要求输入密码：解密工具算出的密码不对', 'su asked for the password again: the password from the decrypt tool is wrong'],
  ['su 再次要求输入密码：保存的密码不对', 'su asked for the password again: the saved password is wrong'],
  ['su 没有通过：密码不对或被拒绝', 'su failed: wrong password or denied'],
  ['su 直接退出了，没有切到 root', 'su exited without switching to root'],
  ['su 执行失败', 'su failed'],
  ['su 之后的身份不是 root', 'Still not root after su'],
  ['提交密码后等待 root 提示符', 'Waiting for the root prompt after the password'],
  ['等待设备 shell 提示符', 'Waiting for the device shell prompt'],
  ['等待 su 响应', 'Waiting for su'],
  ['确认 root 身份', 'Verifying root'],
  ['解密工具没有输出密码（挑战码 ', 'The decrypt tool printed no password (challenge '],
  ['解密工具没有输出密码', 'The decrypt tool printed no password'],
  ['解密工具运行失败：', 'Decrypt tool failed: '],
  [' 秒内没有结束（解密工具需要能在命令行里运行并把密码输出到标准输出）', ' s timeout (the tool must run from the command line and print the password to stdout)'],
  ['找不到这个文件', 'file not found'],
  ['root 会话已结束，请重新进入 root', 'The root session ended; enter root again'],
  ['adb shell 已退出', 'adb shell exited'],
  ['（su 输出：', ' (su output: '],
  ['超时（', ' timed out ('],
  ['[Cockpit] 进入 root 失败：', '[Cockpit] Failed to enter root: '],
  ['投屏已结束', 'Mirroring has ended'],
  ['已经在录屏了', 'Already recording'],
  ['当前没有在录屏', 'Not recording'],
  ['（设备没有可用的 su，无法提权访问）', ' (no usable su on the device, cannot elevate)'],
  [
    'adbd 已是 root，但该分区还没有 remount。请执行 adb remount；如果提示需要关闭 verity，先执行 adb disable-verity 并重启设备，再执行 adb root && adb remount',
    'adbd is already root, but the partition has not been remounted. Run adb remount; if it asks to disable verity, run adb disable-verity, reboot, then adb root && adb remount'
  ],
  [
    '设备已 root（su 可用），但该分区还没有 remount。可以在终端里 su 后执行 mount -o rw,remount ',
    'the device is rooted (su works), but the partition has not been remounted. In the terminal, su and run mount -o rw,remount '
  ],
  ['；开启了 verity 的设备需要先 adb root && adb disable-verity && adb remount', '; devices with verity enabled need adb root && adb disable-verity && adb remount first'],
  [
    '，无法写入。userdebug / eng 版本可以先执行 adb root && adb remount；user 版本需要先 root 设备',
    ', so it cannot be written. On userdebug / eng builds run adb root && adb remount; user builds must be rooted first'
  ],
  ['。可以改传到 /sdcard 或 /data/local/tmp', '. Upload to /sdcard or /data/local/tmp instead'],
  ['设备没有 root：adbd 不是 root，也找不到可用的 su', 'the device is not rooted: adbd is not root and no usable su was found'],
  [' 分钟仍未完成（可能在等设备上的 su 授权）', ' min (it may be waiting for su approval on the device)'],
  ['用 root 写入目标位置 ', 'Writing to the target via root did not finish within '],
  [' 是只读挂载的，', ', which is mounted read-only; '],
  [' 所在的分区 ', ' is on partition '],
  ['目标目录 ', 'Target directory '],
  ['检查目标目录失败：', 'Failed to check the target directory: '],
  ['无法创建目录 ', 'Cannot create directory '],
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
  ['sync 应答异常：', 'Unexpected sync reply: '],
  // 下面是很短的片段，必须最后替换，否则会拆坏上面的长句
  ['，而且', ' and '],
  ['而且', 'and '],
  ['没有写入 ', 'No permission to write '],
  [' 的权限', ''],
  ['，', ', '],
  [' 秒）', ' s)']
]
