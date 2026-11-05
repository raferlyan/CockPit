import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ROOT_METHODS, type RootMethod, type RootSettings, type RootSettingsUpdate } from '@shared/root'

/** 把密码加密成可以落盘的字符串；系统钥匙串不可用时 available 为 false */
export interface SecretCodec {
  available(): boolean
  encrypt(text: string): string
  decrypt(data: string): string
}

interface Stored extends Omit<RootSettings, 'hasPassword'> {
  /** 加密后的密码；钥匙串不可用时以 plain: 前缀明文保存 */
  password?: string
}

export const DEFAULT_ROOT_SETTINGS: Omit<RootSettings, 'hasPassword'> = {
  defaultMethod: 'su',
  deviceMethods: {},
  suCommand: 'su',
  passwordUser: '',
  toolPath: '',
  toolArgs: '{challenge}',
  toolStdin: false,
  challengePattern: ''
}

const isMethod = (value: unknown): value is RootMethod => ROOT_METHODS.includes(value as RootMethod)

/** root 方式设置，保存在 userData 下的 JSON 里；密码用系统钥匙串（Electron safeStorage）加密 */
export class RootSettingsStore {
  private data: Stored

  constructor(
    private readonly file: string,
    private readonly codec: SecretCodec
  ) {
    this.data = this.load()
  }

  get(): RootSettings {
    const { password, ...rest } = this.data
    return { ...rest, deviceMethods: { ...rest.deviceMethods }, hasPassword: Boolean(password) }
  }

  methodFor(serial: string): RootMethod {
    return this.data.deviceMethods[serial] ?? this.data.defaultMethod
  }

  password(): string {
    const stored = this.data.password
    if (!stored) return ''
    if (stored.startsWith('plain:')) return stored.slice(6)
    try {
      return this.codec.decrypt(stored)
    } catch {
      // 换了电脑或钥匙串被重置后解不开，当作没有保存
      return ''
    }
  }

  async update(patch: RootSettingsUpdate): Promise<RootSettings> {
    const next: Stored = { ...this.data }
    if (isMethod(patch.defaultMethod)) next.defaultMethod = patch.defaultMethod
    if (patch.deviceMethods) {
      next.deviceMethods = Object.fromEntries(Object.entries(patch.deviceMethods).filter(([, m]) => isMethod(m)))
    }
    for (const key of ['suCommand', 'passwordUser', 'toolPath', 'toolArgs', 'challengePattern'] as const) {
      if (typeof patch[key] === 'string') next[key] = patch[key].trim()
    }
    if (typeof patch.toolStdin === 'boolean') next.toolStdin = patch.toolStdin
    if (next.challengePattern) new RegExp(next.challengePattern) // 正则写错时直接报错，不保存
    if (typeof patch.password === 'string') {
      if (!patch.password) delete next.password
      else next.password = this.codec.available() ? this.codec.encrypt(patch.password) : `plain:${patch.password}`
    }
    if (!next.suCommand) next.suCommand = 'su'
    this.data = next
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(next, null, 2), { mode: 0o600 })
    return this.get()
  }

  private load(): Stored {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>
      return {
        ...DEFAULT_ROOT_SETTINGS,
        ...raw,
        defaultMethod: isMethod(raw.defaultMethod) ? raw.defaultMethod : DEFAULT_ROOT_SETTINGS.defaultMethod,
        deviceMethods: Object.fromEntries(Object.entries(raw.deviceMethods ?? {}).filter(([, m]) => isMethod(m)))
      }
    } catch {
      return { ...DEFAULT_ROOT_SETTINGS }
    }
  }
}
