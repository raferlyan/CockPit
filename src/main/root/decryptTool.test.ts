import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildToolArgs, parseToolOutput, runDecryptTool, setDecryptToolFallbackDir } from './decryptTool'

describe('decrypt tool', () => {
  it('builds args with quoted parts and the challenge placeholder', () => {
    expect(buildToolArgs('-k "my key" --in={challenge}', 'AB12')).toEqual(['-k', 'my key', '--in=AB12'])
    expect(buildToolArgs('', 'AB12')).toEqual([])
  })

  it('takes the last non-empty line and strips labels', () => {
    expect(parseToolOutput('Decrypt tool v1\r\nPassword: 1a2b3c\r\n\r\n')).toBe('1a2b3c')
    expect(parseToolOutput('密码：xyz\n')).toBe('xyz')
  })

  describe.skipIf(process.platform === 'win32')('runs a real executable', () => {
    let tool: string
    beforeAll(async () => {
      // 假的解密工具：从参数或标准输入读挑战码，输出倒序串
      tool = join(await mkdtemp(join(tmpdir(), 'cockpit-tool-')), 'decrypt')
      await writeFile(tool, '#!/bin/sh\nc="$1"; [ -z "$c" ] && read -r c\necho "decrypting..."\necho "$c" | rev\n')
      await chmod(tool, 0o755)
    })

    it('passes the challenge as an argument by default', async () => {
      await expect(runDecryptTool({ toolPath: tool, toolArgs: '', toolStdin: false }, 'ABC123')).resolves.toBe('321CBA')
    })

    it('passes the challenge on stdin', async () => {
      await expect(runDecryptTool({ toolPath: tool, toolArgs: '', toolStdin: true }, 'XY9')).resolves.toBe('9YX')
    })

    it('runs in the tool directory so it can save its token cache there', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cockpit-tool-'))
      const cacheTool = join(dir, 'decrypt')
      await writeFile(cacheTool, '#!/bin/sh\necho token > access_token && echo "$1" | rev\n')
      await chmod(cacheTool, 0o755)
      await expect(runDecryptTool({ toolPath: cacheTool, toolArgs: '', toolStdin: false }, 'AB')).resolves.toBe('BA')
      expect((await readFile(join(dir, 'access_token'), 'utf8')).trim()).toBe('token')
    })

    it('falls back to a writable directory when the tool directory is read-only', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cockpit-tool-'))
      const fallback = await mkdtemp(join(tmpdir(), 'cockpit-fallback-'))
      const cacheTool = join(dir, 'decrypt')
      await writeFile(cacheTool, '#!/bin/sh\necho token > access_token || exit 1\necho "$1" | rev\n')
      await chmod(cacheTool, 0o755)
      await chmod(dir, 0o555)
      setDecryptToolFallbackDir(fallback)
      try {
        await expect(runDecryptTool({ toolPath: cacheTool, toolArgs: '', toolStdin: false }, 'AB')).resolves.toBe('BA')
        expect((await readFile(join(fallback, 'access_token'), 'utf8')).trim()).toBe('token')
      } finally {
        await chmod(dir, 0o755)
      }
    })

    it('does not take an error message as the password', async () => {
      const failing = join(await mkdtemp(join(tmpdir(), 'cockpit-tool-')), 'decrypt')
      await writeFile(failing, '#!/bin/sh\necho "保存access_token失败"\n')
      await chmod(failing, 0o755)
      await expect(runDecryptTool({ toolPath: failing, toolArgs: '', toolStdin: false }, 'AB')).rejects.toThrow(/解密工具报错：保存access_token失败/)
    })

    it('explains a missing tool', async () => {
      await expect(runDecryptTool({ toolPath: '/nope/decrypt', toolArgs: '{challenge}', toolStdin: false }, 'X')).rejects.toThrow(/找不到这个文件/)
    })
  })
})
