import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildToolArgs, parseToolOutput, runDecryptTool } from './decryptTool'

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

    it('explains a missing tool', async () => {
      await expect(runDecryptTool({ toolPath: '/nope/decrypt', toolArgs: '{challenge}', toolStdin: false }, 'X')).rejects.toThrow(/找不到这个文件/)
    })
  })
})
