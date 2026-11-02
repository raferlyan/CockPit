/**
 * adb shell 命令行智能提示：根据当前输入行给出命令、子命令、选项、包名和历史命令候选。
 * 纯函数，不依赖 xterm，方便单测。
 */

interface Spec {
  desc?: string
  sub?: Record<string, Spec>
  /** 选项及说明；值为 Spec 时表示该选项后面还要跟参数 */
  options?: Record<string, string | Spec>
  /** 位置参数是应用包名 */
  packages?: boolean
  /** 位置参数的固定取值 */
  values?: Record<string, string>
}

const KEYCODES: Record<string, string> = {
  KEYCODE_HOME: '主页',
  KEYCODE_BACK: '返回',
  KEYCODE_MENU: '菜单',
  KEYCODE_APP_SWITCH: '多任务',
  KEYCODE_POWER: '电源',
  KEYCODE_WAKEUP: '亮屏',
  KEYCODE_SLEEP: '息屏',
  KEYCODE_VOLUME_UP: '音量+',
  KEYCODE_VOLUME_DOWN: '音量-',
  KEYCODE_VOLUME_MUTE: '静音',
  KEYCODE_ENTER: '回车',
  KEYCODE_DEL: '退格',
  KEYCODE_TAB: 'Tab',
  KEYCODE_ESCAPE: 'Esc',
  KEYCODE_DPAD_UP: '方向上',
  KEYCODE_DPAD_DOWN: '方向下',
  KEYCODE_DPAD_LEFT: '方向左',
  KEYCODE_DPAD_RIGHT: '方向右',
  KEYCODE_DPAD_CENTER: '确认',
  KEYCODE_CAMERA: '相机',
  KEYCODE_NOTIFICATION: '通知栏',
  KEYCODE_SETTINGS: '设置',
  KEYCODE_SYSRQ: '截屏'
}

const PROPS: Record<string, string> = {
  'ro.build.version.release': 'Android 版本',
  'ro.build.version.sdk': 'API 级别',
  'ro.build.fingerprint': '构建指纹',
  'ro.build.type': 'user / userdebug / eng',
  'ro.build.display.id': '构建号',
  'ro.product.model': '型号',
  'ro.product.brand': '品牌',
  'ro.product.manufacturer': '厂商',
  'ro.product.device': '设备代号',
  'ro.product.cpu.abi': 'ABI',
  'ro.hardware': '硬件平台',
  'ro.serialno': '序列号',
  'ro.debuggable': '是否可调试',
  'ro.secure': '安全模式',
  'sys.boot_completed': '是否开机完成',
  'persist.sys.locale': '系统语言',
  'persist.sys.timezone': '时区',
  'dalvik.vm.heapsize': '应用堆上限',
  'debug.hwui.profile': 'GPU 渲染分析',
  'log.tag': '默认日志级别'
}

const SETTINGS_NS = { system: '系统设置', secure: '安全设置', global: '全局设置' }

const pkg = (desc: string): Spec => ({ desc, packages: true })
const ns = (desc: string): Spec => ({ desc, values: SETTINGS_NS })
const onOff = (desc: string): Spec => ({ desc, values: { enable: '开启', disable: '关闭' } })

const DUMPSYS_SERVICES: Record<string, Spec> = {
  activity: {
    desc: 'Activity / 进程 / 广播',
    values: {
      activities: 'Activity 栈',
      services: '服务',
      broadcasts: '广播',
      providers: 'ContentProvider',
      processes: '进程',
      top: '前台 Activity',
      recents: '最近任务',
      lru: '进程 LRU',
      oom: 'OOM 优先级'
    },
    packages: true
  },
  window: { desc: '窗口', values: { windows: '窗口列表', displays: '屏幕', policy: '策略' } },
  meminfo: pkg('内存占用'),
  cpuinfo: { desc: 'CPU 占用' },
  gfxinfo: pkg('渲染帧耗时'),
  package: pkg('包信息'),
  battery: { desc: '电池', values: { reset: '恢复真实状态', unplug: '模拟拔电' } },
  batterystats: pkg('耗电统计'),
  power: { desc: '电源 / 唤醒锁' },
  alarm: { desc: '闹钟' },
  jobscheduler: { desc: 'JobScheduler' },
  connectivity: { desc: '网络连接' },
  wifi: { desc: 'Wi-Fi' },
  netstats: { desc: '流量统计' },
  display: { desc: '显示' },
  input: { desc: '输入设备' },
  SurfaceFlinger: { desc: '图层合成' },
  audio: { desc: '音频' },
  location: { desc: '定位' },
  notification: { desc: '通知' },
  usagestats: { desc: '使用统计' },
  procstats: { desc: '进程统计' },
  deviceidle: { desc: 'Doze 状态' },
  thermalservice: { desc: '温控' },
  sensorservice: { desc: '传感器' },
  'media.camera': { desc: '相机' }
}

const SPEC: Spec = {
  sub: {
    am: {
      desc: 'Activity 管理',
      sub: {
        start: { desc: '启动 Activity', options: { '-n': pkg('组件 包名/类名'), '-a': 'Action', '-d': 'Data URI', '-W': '等待启动完成', '-S': '先强制停止', '-D': '开启调试' } },
        'start-activity': { desc: '启动 Activity', options: { '-n': pkg('组件 包名/类名'), '-W': '等待启动完成' } },
        startservice: { desc: '启动服务', options: { '-n': pkg('组件 包名/类名') } },
        'start-foreground-service': { desc: '启动前台服务', options: { '-n': pkg('组件 包名/类名') } },
        broadcast: { desc: '发送广播', options: { '-a': 'Action', '-n': pkg('组件'), '--es': '字符串 extra', '--ei': '整数 extra', '--ez': '布尔 extra' } },
        'force-stop': pkg('强制停止应用'),
        kill: pkg('杀掉后台进程'),
        'kill-all': { desc: '杀掉所有后台进程' },
        instrument: { desc: '运行 Instrumentation 测试', options: { '-w': '等待结束', '-r': '原始输出', '-e': '参数' } },
        dumpheap: pkg('导出堆'),
        'set-debug-app': { desc: '设置待调试应用', options: { '-w': '启动时等待调试器', '--persistent': '持久生效' }, packages: true },
        'clear-debug-app': { desc: '清除待调试应用' },
        monitor: { desc: '监控崩溃 / ANR' },
        'get-config': { desc: '当前配置' },
        stack: { desc: '任务栈', values: { list: '列出' } }
      }
    },
    pm: {
      desc: '包管理',
      sub: {
        list: {
          desc: '列出',
          sub: {
            packages: { desc: '已安装应用', options: { '-3': '仅第三方', '-s': '仅系统', '-d': '已禁用', '-e': '已启用', '-f': '显示 APK 路径', '-i': '显示安装来源', '-U': '显示 UID' } },
            permissions: { desc: '权限', options: { '-g': '按组', '-d': '仅危险权限' } },
            'permission-groups': { desc: '权限组' },
            features: { desc: '设备特性' },
            libraries: { desc: '共享库' },
            users: { desc: '用户' },
            instrumentation: { desc: '测试 Instrumentation' }
          }
        },
        path: pkg('APK 路径'),
        install: { desc: '安装 APK', options: { '-r': '覆盖安装', '-d': '允许降级', '-g': '授予全部权限', '-t': '允许测试包' } },
        uninstall: { desc: '卸载', options: { '-k': '保留数据' }, packages: true },
        clear: pkg('清除应用数据'),
        enable: pkg('启用'),
        disable: pkg('禁用'),
        'disable-user': pkg('为当前用户禁用'),
        grant: pkg('授予权限'),
        revoke: pkg('撤销权限'),
        hide: pkg('隐藏'),
        unhide: pkg('取消隐藏'),
        dump: pkg('包详情'),
        'resolve-activity': { desc: '解析 Intent', options: { '--brief': '简要输出' } },
        'trim-caches': { desc: '清理缓存' }
      }
    },
    cmd: {
      desc: '系统服务命令',
      sub: {
        package: {
          desc: '包管理',
          sub: {
            list: { desc: '列出', sub: { packages: { desc: '已安装应用' } } },
            compile: { desc: '编译 dex', options: { '-m': '模式 speed / verify', '-f': '强制' }, packages: true }
          }
        },
        activity: { desc: 'Activity 管理' },
        window: { desc: '窗口' },
        statusbar: { desc: '状态栏', values: { 'expand-notifications': '展开通知', 'expand-settings': '展开快捷设置', collapse: '收起' } },
        wifi: { desc: 'Wi-Fi', values: { status: '状态', 'set-wifi-enabled': '开关 Wi-Fi' } },
        overlay: { desc: 'RRO 资源覆盖', values: { list: '列出', enable: '启用', disable: '禁用' } },
        appops: { desc: '应用权限操作' },
        jobscheduler: { desc: 'JobScheduler', values: { run: '立即执行' } },
        battery: { desc: '电池', values: { unplug: '模拟拔电', reset: '恢复' } },
        thermalservice: { desc: '温控', values: { override: '模拟温控等级', reset: '恢复' } }
      }
    },
    dumpsys: { desc: '系统服务状态', values: Object.fromEntries(Object.entries(DUMPSYS_SERVICES).map(([k, v]) => [k, v.desc ?? ''])), sub: DUMPSYS_SERVICES, options: { '-l': '列出所有服务' } },
    getprop: { desc: '读取系统属性', values: PROPS },
    setprop: { desc: '设置系统属性', values: PROPS },
    settings: {
      desc: '系统设置',
      sub: { get: ns('读取'), put: ns('写入'), delete: ns('删除'), list: ns('列出') }
    },
    input: {
      desc: '模拟输入',
      sub: {
        text: { desc: '输入文本' },
        keyevent: { desc: '按键', values: KEYCODES, options: { '--longpress': '长按' } },
        tap: { desc: '点击 x y' },
        swipe: { desc: '滑动 x1 y1 x2 y2 [毫秒]' },
        draganddrop: { desc: '拖拽' },
        press: { desc: '轨迹球按下' }
      }
    },
    wm: {
      desc: '窗口管理',
      sub: {
        size: { desc: '屏幕分辨率', values: { reset: '恢复默认' } },
        density: { desc: '屏幕密度', values: { reset: '恢复默认' } },
        'dismiss-keyguard': { desc: '解除锁屏' }
      }
    },
    svc: {
      desc: '系统开关',
      sub: { wifi: onOff('Wi-Fi'), data: onOff('移动数据'), bluetooth: onOff('蓝牙'), nfc: onOff('NFC'), power: { desc: '电源', values: { stayon: '充电时常亮', reboot: '重启', shutdown: '关机' } }, usb: { desc: 'USB 模式' } }
    },
    logcat: {
      desc: '查看日志',
      options: {
        '-c': '清空日志',
        '-d': '输出后退出',
        '-s': '只显示指定 TAG',
        '-v': { desc: '输出格式', values: { threadtime: '默认', brief: '简要', time: '时间', color: '彩色', long: '详细', epoch: '时间戳' } },
        '-b': { desc: '日志缓冲区', values: { main: '主', system: '系统', crash: '崩溃', events: '事件', radio: '射频', all: '全部' } },
        '-t': '最近 N 行',
        '-f': '写入文件',
        '-g': '缓冲区大小',
        '--pid': '按进程过滤，如 --pid=$(pidof -s 包名)'
      },
      values: { '*:E': '只看错误', '*:W': '警告及以上', '*:S': '全部静默' }
    },
    monkey: { desc: '压力测试', options: { '-p': pkg('目标应用'), '-v': '详细输出', '-s': '随机种子', '--throttle': '事件间隔毫秒', '--ignore-crashes': '忽略崩溃' } },
    'run-as': pkg('以应用身份执行（仅 debuggable 应用）'),
    pidof: { desc: '查进程号', options: { '-s': '只返回一个' }, packages: true },
    screencap: { desc: '截屏', options: { '-p': 'PNG 格式' } },
    screenrecord: { desc: '录屏', options: { '--time-limit': '时长秒', '--bit-rate': '码率', '--size': '分辨率' } },
    ps: { desc: '进程列表', options: { '-A': '全部进程', '-T': '线程', '-o': '输出列' } },
    top: { desc: '实时进程', options: { '-n': '刷新次数', '-m': '最多显示', '-d': '间隔秒', '-H': '显示线程' } },
    kill: { desc: '结束进程', options: { '-9': '强制' } },
    reboot: { desc: '重启', values: { bootloader: '进入 Bootloader', recovery: '进入 Recovery', fastboot: '进入 fastbootd' } },
    content: { desc: 'ContentProvider', sub: { query: { desc: '查询', options: { '--uri': 'URI' } }, insert: { desc: '插入' }, delete: { desc: '删除' } } },
    appops: { desc: '应用权限操作', sub: { get: pkg('查看'), set: pkg('设置'), reset: pkg('重置') } },
    ls: { desc: '列目录', options: { '-l': '详细', '-a': '含隐藏', '-h': '易读大小', '-R': '递归', '-Z': 'SELinux 标签' } },
    cd: { desc: '切换目录' },
    cat: { desc: '查看文件' },
    rm: { desc: '删除', options: { '-r': '递归', '-f': '强制' } },
    mkdir: { desc: '创建目录', options: { '-p': '逐级创建' } },
    cp: { desc: '复制', options: { '-r': '递归' } },
    mv: { desc: '移动 / 改名' },
    chmod: { desc: '修改权限' },
    df: { desc: '磁盘空间', options: { '-h': '易读大小' } },
    du: { desc: '目录大小', options: { '-h': '易读大小', '-s': '只看总计', '-d': '深度' } },
    grep: { desc: '过滤文本', options: { '-i': '忽略大小写', '-v': '反向', '-E': '正则', '-r': '递归', '-n': '显示行号' } },
    find: { desc: '查找文件', options: { '-name': '按名称', '-type': '类型', '-size': '大小' } },
    ifconfig: { desc: '网卡信息' },
    ip: { desc: '网络配置', values: { addr: '地址', route: '路由', link: '链路' } },
    ping: { desc: '连通性测试', options: { '-c': '次数' } },
    netstat: { desc: '网络连接', options: { '-tlnp': '监听端口' } },
    dmesg: { desc: '内核日志' },
    getenforce: { desc: 'SELinux 状态' },
    setenforce: { desc: '切换 SELinux', values: { '0': 'Permissive', '1': 'Enforcing' } },
    service: { desc: 'Binder 服务', values: { list: '列出', check: '检查' } },
    uptime: { desc: '运行时间' },
    id: { desc: '当前用户' },
    whoami: { desc: '当前用户名' },
    su: { desc: '切换 root' },
    echo: { desc: '输出' },
    clear: { desc: '清屏' },
    exit: { desc: '退出' }
  }
}

export interface Suggestion {
  /** 候选的完整文本（命令、包名或整行历史） */
  label: string
  desc?: string
  kind: 'history' | 'command' | 'option' | 'package' | 'value'
  /** 接受候选时先删掉的字符数 */
  deleteCount: number
  /** 再输入的文本 */
  insert: string
}

export interface CompletionContext {
  /** 历史命令，越新越靠前 */
  history: string[]
  packages: string[]
}

const MAX_SUGGESTIONS = 8

/** 管道、命令串联后从头开始补全 */
function lastSegment(line: string): string {
  const parts = line.split(/\|\||&&|[|;]/)
  return parts[parts.length - 1].replace(/^\s+/, '')
}

function prefixMatches(names: Record<string, unknown> | undefined, word: string): string[] {
  if (!names) return []
  return Object.keys(names).filter((name) => name.startsWith(word) && name !== word)
}

function descOf(value: string | Spec | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.desc
}

export function suggest(line: string, ctx: CompletionContext): Suggestion[] {
  if (!line.trim()) return []
  const results: Suggestion[] = []
  const seen = new Set<string>()
  const push = (s: Suggestion) => {
    if (seen.has(s.label) || results.length >= MAX_SUGGESTIONS) return
    seen.add(s.label)
    results.push(s)
  }

  // 整行历史优先：前缀相同、更长的历史命令
  for (const entry of ctx.history) {
    if (entry.length > line.length && entry.startsWith(line)) push({ label: entry, kind: 'history', deleteCount: 0, insert: entry.slice(line.length) })
    if (results.length >= 3) break
  }

  const segment = lastSegment(line)
  const tokens = segment.split(/\s+/)
  const word = tokens[tokens.length - 1]
  const done = tokens.slice(0, -1).filter(Boolean)

  // 沿着已输入的词往下走，找到当前所在的命令节点
  let node: Spec = SPEC
  let pendingOption: Spec | undefined
  for (const token of done) {
    pendingOption = undefined
    const sub = node.sub?.[token]
    if (sub) {
      node = sub
      continue
    }
    const option = node.options?.[token.split('=')[0]]
    if (option && typeof option !== 'string') pendingOption = option
  }

  const target = pendingOption ?? node
  const complete = (label: string, kind: Suggestion['kind'], desc?: string) =>
    push({ label, desc, kind, deleteCount: 0, insert: `${label.slice(word.length)} ` })

  if (!pendingOption) {
    for (const name of prefixMatches(node.sub, word)) complete(name, 'command', node.sub![name].desc)
    if (word.startsWith('-')) for (const name of prefixMatches(node.options, word)) complete(name, 'option', descOf(node.options![name]))
  }
  for (const name of prefixMatches(target.values, word)) complete(name, 'value', target.values![name])
  if (target.packages && word.length > 0 && !word.startsWith('-')) {
    // 包名支持包含匹配，输入 tencent 也能找到 com.tencent.mm
    const lower = word.toLowerCase()
    const matched = ctx.packages.filter((p) => p !== word && p.toLowerCase().includes(lower))
    matched.sort((a, b) => Number(!a.startsWith(word)) - Number(!b.startsWith(word)) || a.length - b.length)
    for (const name of matched) {
      if (name.startsWith(word)) complete(name, 'package')
      else push({ label: name, kind: 'package', deleteCount: word.length, insert: `${name} ` })
    }
  }
  return results
}
