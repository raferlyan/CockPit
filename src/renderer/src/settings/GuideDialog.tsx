import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from './uiStore'

const isMac = window.cockpit.platform === 'darwin'

interface Step {
  title: string
  body: string[]
}

const STEPS: Step[] = [
  {
    title: '欢迎使用 Cockpit',
    body: [
      'Cockpit 把 Android 设备的投屏、终端、文件传输、应用管理和状态监控放在一个窗口里。',
      '接下来用几步介绍主要功能，随时可以跳过；之后在右下角「设置」里能再次打开本向导。'
    ]
  },
  {
    title: '1. 连接设备',
    body: [
      '在手机「开发者选项」中打开「USB 调试」，用数据线连接电脑，并在手机上点「允许」调试授权。',
      '设备出现在左侧列表后点击它即可选中；无线调试可在列表底部输入 IP:端口 连接。',
      '底部状态栏显示 adb 的连接状态，找不到 adb 时请安装 Android SDK platform-tools。'
    ]
  },
  {
    title: '2. 投屏与操作',
    body: [
      '在右侧设备信息里点「投屏」，画面出现在中间区域，可以直接用鼠标点按、滚轮滑动、键盘输入（支持中文）。',
      '右键是返回，中键是主页；工具栏上有返回、主页、多任务、音量、电源、截图等按键。',
      '「截图」保存原始分辨率图片到「图片/Cockpit」文件夹，同时复制到剪贴板。'
    ]
  },
  {
    title: '3. 拖拽文件与安装应用',
    body: [
      '把 APK 拖到投屏画面或设备信息面板上会直接安装；其它文件会打开「文件传输」，选择目标目录后上传，过程中显示进度。',
      '已 root 的设备访问受保护目录时会自动通过 su 中转，首次可能需要在手机上授权。',
      '「应用管理」可以扫描设备上的全部应用，按用户 / 系统分类搜索，进行卸载、停用、清除数据、导出 APK 等操作。'
    ]
  },
  {
    title: '4. 终端与状态',
    body: [
      '底部区域可以打开 adb Shell、Logcat 和串口终端，输入命令时会给出补全提示，把文件拖进终端会插入其路径。',
      '设备状态显示 CPU、内存、温度、电池和网卡吞吐，多台设备时可切换「对比」查看。'
    ]
  },
  {
    title: '5. 按你的习惯调整',
    body: [
      '拖动区域之间的边框可以调整设备列表、右侧面板和终端的大小，双击边框恢复默认。',
      `右下角「设置」里可以调整整体字号、界面与终端字体、主题；也可以用 ${isMac ? '⌘' : 'Ctrl'} + = / − / 0 快速缩放。`
    ]
  }
]

export function GuideDialog() {
  const [index, setIndex] = useState(0)
  const deviceCount = useAppStore((s) => s.devices.filter((d) => d.state === 'device').length)
  const finish = useUiStore((s) => s.finishGuide)
  const step = STEPS[index]
  const last = index === STEPS.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, STEPS.length - 1))
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  return (
    <div className="dialog-backdrop">
      <div className="dialog guide-dialog" role="dialog" aria-label="使用向导">
        <div className="guide-progress">
          {STEPS.map((s, i) => (
            <button key={s.title} className={`guide-dot${i === index ? ' on' : ''}${i < index ? ' done' : ''}`} title={s.title} onClick={() => setIndex(i)} />
          ))}
        </div>
        <h2 className="guide-title">{step.title}</h2>
        {step.body.map((line) => (
          <p key={line} className="guide-text">
            {line}
          </p>
        ))}
        {index === 1 && (
          <p className={`guide-status ${deviceCount ? 'ok' : ''}`}>
            {deviceCount ? `✓ 已检测到 ${deviceCount} 台在线设备` : '尚未检测到在线设备，连接后这里会自动更新'}
          </p>
        )}
        <div className="dialog-actions">
          {!last && (
            <button className="link" onClick={finish}>
              跳过向导
            </button>
          )}
          <span className="spacer" />
          {index > 0 && (
            <button className="secondary" onClick={() => setIndex(index - 1)}>
              上一步
            </button>
          )}
          <button className="primary" autoFocus onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? '开始使用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
