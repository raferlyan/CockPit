import { describe, expect, it } from 'vitest'
import { driveSu, extractChallenge, type PtyLike } from './suDriver'
import { RootSession } from './RootSession'

/** 模拟设备上的 mksh：认 su、密码提示、id，root 后能执行 RootSession 发来的标记命令 */
function fakeShell(opts: { su: 'none' | 'free' | 'password' | 'challenge'; password?: string; decrypt?: (c: string) => string }) {
  const listeners = new Set<(d: string) => void>()
  let root = false
  let awaiting: string | null = null
  const out = (text: string) => setTimeout(() => listeners.forEach((l) => l(text)), 1)
  const prompt = () => out(root ? 'fake:/ # ' : 'fake:/ $ ')
  const io: PtyLike & { kill(): void } = {
    write(data) {
      if (data === '\x03') return
      const line = data.replace(/\r$/, '')
      if (awaiting !== null) {
        const ok = line === awaiting
        awaiting = null
        if (ok) {
          root = true
          out('\r\n')
          prompt()
        } else {
          out('\r\nsu: incorrect password\r\n')
          prompt()
        }
        return
      }
      out(`${line}\r\n`)
      if (line === 'su') {
        if (opts.su === 'none') {
          out('/system/bin/sh: su: inaccessible or not found\r\n')
          prompt()
        } else if (opts.su === 'free') {
          root = true
          prompt()
        } else if (opts.su === 'password') {
          awaiting = opts.password!
          out('Password: ')
        } else {
          const challenge = 'A7F3C9E1'
          awaiting = opts.decrypt!(challenge)
          out(`Challenge: ${challenge}\r\nPassword: `)
        }
        return
      }
      if (line === 'id') out(root ? 'uid=0(root) gid=0(root)\r\n' : 'uid=2000(shell)\r\n')
      const marker = /echo "__CK""B(\w+)"; \( (.*) \) <\/dev\/null 2>&1; echo "__CK""E\1:\$\?"/.exec(line)
      if (marker) {
        const [, id, command] = marker
        const fail = command.startsWith('false')
        out(`__CKB${id}\r\n${fail ? 'boom\r\n' : command === 'echo hi' ? 'hi\r\n' : ''}__CKE${id}:${fail ? 1 : 0}\r\n`)
      }
      prompt()
    },
    onData(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    kill() {}
  }
  prompt()
  return io
}

const base = { suCommand: 'su', stepTimeout: 500 }

describe('driveSu', () => {
  it('enters root with password-free su', async () => {
    await expect(driveSu(fakeShell({ su: 'free' }), { ...base, method: 'su' })).resolves.toBeUndefined()
  })

  it('types the saved password', async () => {
    await driveSu(fakeShell({ su: 'password', password: 's3cret' }), { ...base, method: 'password', password: 's3cret' })
  })

  it('reports a wrong password', async () => {
    await expect(driveSu(fakeShell({ su: 'password', password: 's3cret' }), { ...base, method: 'password', password: 'nope' })).rejects.toThrow(
      /su 没有通过/
    )
  })

  it('feeds the challenge to the decrypt tool', async () => {
    const reverse = (c: string) => [...c].reverse().join('')
    const seen: string[] = []
    await driveSu(fakeShell({ su: 'challenge', decrypt: reverse }), {
      ...base,
      method: 'challenge',
      decrypt: async (c) => {
        seen.push(c)
        return reverse(c)
      }
    })
    expect(seen).toEqual(['A7F3C9E1'])
  })

  it('explains when su needs a password but the method is password-free', async () => {
    await expect(driveSu(fakeShell({ su: 'password', password: 'x' }), { ...base, method: 'su' })).rejects.toThrow(/改用「密码」或「解密工具」/)
  })

  it('explains a missing su with its output', async () => {
    await expect(driveSu(fakeShell({ su: 'none' }), { ...base, method: 'su' })).rejects.toThrow(/su 执行失败.*not found/)
  })
})

describe('extractChallenge', () => {
  it('reads labeled challenges', () => {
    expect(extractChallenge('su\r\nChallenge: 9F8E7D6C\r\nPassword: ')).toBe('9F8E7D6C')
    expect(extractChallenge('su\r\n挑战码：AB12CD34\r\n请输入密码：')).toBe('AB12CD34')
  })

  it('falls back to the last token with a digit', () => {
    expect(extractChallenge('su\r\n 3a9f00c1b2 \r\nplease input password: ')).toBe('3a9f00c1b2')
  })

  it('uses a custom pattern capture group', () => {
    expect(extractChallenge('su\r\n[seed=xyz-777]\r\nPassword:', 'seed=([\\w-]+)')).toBe('xyz-777')
  })
})

describe('RootSession', () => {
  it('runs commands through markers and reports failures', async () => {
    const io = fakeShell({ su: 'free' })
    await driveSu(io, { ...base, method: 'su' })
    const session = new RootSession(io, 'su')
    await expect(session.exec('echo hi', 1000)).resolves.toBe('hi')
    await expect(session.exec('false', 1000)).rejects.toThrow('boom')
    session.close()
    await expect(session.exec('echo hi')).rejects.toThrow(/root 会话已结束/)
  })
})
