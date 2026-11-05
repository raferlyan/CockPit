import { detectIdentity, stripAnsi } from '../shell/prompt'

/** 驱动 su 用到的终端读写，ShellService 的标签和后台 root 会话都提供这个接口 */
export interface PtyLike {
  write(data: string): void
  /** 返回取消订阅函数 */
  onData(listener: (data: string) => void): () => void
}

export interface SuOptions {
  method: 'su' | 'password' | 'challenge'
  suCommand: string
  /** password 方式的目标用户，空表示 root */
  user?: string
  password?: string
  /** challenge 方式：把挑战码换成密码 */
  decrypt?: (challenge: string) => Promise<string>
  challengePattern?: string
  /** 每一步等待的上限 */
  stepTimeout?: number
}

const DEFAULT_STEP_TIMEOUT = 15_000
/** 看到密码提示后等这么久再输入 */
const PASSWORD_SETTLE = 300

/** 行尾的密码提示，如 `Password:`、`请输入密码：` */
const PASSWORD_PROMPT = /(pass(word|wd|code)?|密码|口令|pin)[^\n]*[:：>]\s*$/i
/** su 直接失败的输出 */
const SU_FAILURE = /not found|inaccessible|permission denied|not allowed|incorrect|wrong|denied|failure|failed|invalid|authentication|错误|失败/i
/** 自动识别挑战码时不会是挑战码的词 */
const STOP_WORDS = new Set(['password', 'passwd', 'please', 'input', 'enter', 'challenge', 'random', 'code', 'key', 'root', 'su', 'for', 'the', 'your'])

/**
 * 从 su 的输出里找挑战码。pattern 有捕获组时取第一组；
 * 自动识别时先找「challenge / code / 挑战码: xxx」这种写法，否则取最后一个像样的字母数字串。
 */
export function extractChallenge(output: string, pattern?: string): string | null {
  const text = stripAnsi(output)
  if (pattern?.trim()) {
    const match = new RegExp(pattern, 'm').exec(text)
    return match ? (match[1] ?? match[0]).trim() || null : null
  }
  const labeled = /(?:challenge|random|code|key|seed|挑战码|随机码|校验码)\s*[:：=]?\s*([A-Za-z0-9+/=_-]{4,})/i.exec(text)
  if (labeled && !STOP_WORDS.has(labeled[1].toLowerCase())) return labeled[1]
  const tokens = text.match(/[A-Za-z0-9+/=_-]{4,}/g) ?? []
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]
    if (!STOP_WORDS.has(token.toLowerCase()) && /\d/.test(token)) return token
  }
  for (let i = tokens.length - 1; i >= 0; i--) if (!STOP_WORDS.has(tokens[i].toLowerCase())) return tokens[i]
  return null
}

/** 失败时带上 su 最后的输出，方便看出是哪一步出的问题 */
export class SuError extends Error {
  constructor(message: string, readonly output = '') {
    const tail = stripAnsi(output).replace(/\r/g, '').trim().split('\n').slice(-4).join(' ⏎ ').slice(-300)
    super(tail ? `${message}（su 输出：${tail}）` : message)
    this.name = 'SuError'
  }
}

/**
 * 在一个已经打开的 `adb shell` 里切到 root：输入 su，按需要回答密码或挑战码，
 * 看到 `#` 提示符后再用 `id` 确认 uid=0。已经是 root 时直接返回。
 */
export async function driveSu(io: PtyLike, options: SuOptions): Promise<void> {
  const stepTimeout = options.stepTimeout ?? DEFAULT_STEP_TIMEOUT
  let buffer = ''
  let waiter: (() => void) | null = null
  const off = io.onData((data) => {
    buffer += data
    waiter?.()
  })
  /** 等到 check 返回非 undefined；每次有新输出就检查一遍 */
  const until = <T>(check: () => T | undefined, what: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const tryNow = () => {
        let result: T | undefined
        try {
          result = check()
        } catch (error) {
          finish()
          reject(error)
          return
        }
        if (result !== undefined) {
          finish()
          resolve(result)
        }
      }
      const timer = setTimeout(() => {
        finish()
        reject(new SuError(`${what}超时（${stepTimeout / 1000} 秒）`, buffer))
      }, stepTimeout)
      const finish = () => {
        clearTimeout(timer)
        waiter = null
      }
      waiter = tryNow
      tryNow()
    })
  const lastLine = () => stripAnsi(buffer).split(/\r?\n|\r/).pop() ?? ''

  try {
    // 先等 shell 的提示符，进程刚启动时输入会丢
    const start = await until(() => detectIdentity(buffer.slice(-256)), '等待设备 shell 提示符')
    if (start === 'root') return

    const command = [options.suCommand.trim() || 'su', options.method === 'password' ? options.user?.trim() : ''].filter(Boolean).join(' ')
    buffer = ''
    io.write(`${command}\r`)

    let answered = false
    // 循环直到出现 root 提示符；中间可能要回答一次密码
    for (;;) {
      const state = await until(() => {
        const tail = buffer.slice(-256)
        const identity = detectIdentity(tail)
        if (identity === 'root') return 'root' as const
        // 回到普通提示符：su 已经退出（命令不存在、密码错误、被拒绝）
        if (identity === 'user' && stripAnsi(buffer).includes('\n')) return 'exited' as const
        if (PASSWORD_PROMPT.test(lastLine())) return answered ? ('rejected' as const) : ('password' as const)
        return undefined
      }, answered ? '提交密码后等待 root 提示符' : '等待 su 响应')

      if (state === 'root') break
      if (state === 'rejected') {
        io.write('\x03')
        throw new SuError(options.method === 'challenge' ? 'su 再次要求输入密码：解密工具算出的密码不对' : 'su 再次要求输入密码：保存的密码不对', buffer)
      }
      if (state === 'exited') {
        throw new SuError(
          answered ? 'su 没有通过：密码不对或被拒绝' : SU_FAILURE.test(buffer) ? 'su 执行失败' : 'su 直接退出了，没有切到 root',
          buffer
        )
      }
      // 需要密码
      if (options.method === 'su') {
        throw new SuError('su 要求输入密码：请在 root 方式里改用「密码」或「解密工具」', buffer)
      }
      let secret: string
      if (options.method === 'password') {
        if (!options.password) throw new SuError('su 要求输入密码，但还没有保存密码：请在 root 方式设置里填写', buffer)
        secret = options.password
      } else {
        const challenge = extractChallenge(buffer, options.challengePattern)
        if (!challenge) throw new SuError('没能从 su 的输出里找到挑战码：可以在 root 方式设置里填写提取挑战码的正则', buffer)
        if (!options.decrypt) throw new SuError('还没有配置解密工具', buffer)
        secret = (await options.decrypt(challenge)).trim()
        if (!secret) throw new SuError(`解密工具没有输出密码（挑战码 ${challenge}）`, buffer)
      }
      // 有的 su 先打印提示再关回显，输入太快会被 tcsetattr 冲掉；稍等一下再输入，和手动输入的节奏一样
      await new Promise((r) => setTimeout(r, PASSWORD_SETTLE))
      answered = true
      buffer = ''
      io.write(`${secret}\r`)
    }

    // 提示符可能被改过，用 id 确认真的是 uid 0
    buffer = ''
    io.write('id\r')
    await until(() => {
      const text = stripAnsi(buffer)
      if (/uid=0\b/.test(text)) return true
      if (/uid=\d+/.test(text) && detectIdentity(buffer.slice(-256))) throw new SuError('su 之后的身份不是 root', buffer)
      return undefined
    }, '确认 root 身份')
  } finally {
    off()
  }
}
