import { execFile } from 'node:child_process'
import type { DecryptToolConfig } from '@shared/root'
import { formatCommand, recordCommand } from '../oplog/OperationLog'

const TOOL_TIMEOUT = 20_000

/** 按空白拆参数，双引号括起来的部分保持完整；{challenge} 换成挑战码 */
export function buildToolArgs(template: string, challenge: string): string[] {
  const args: string[] = []
  for (const match of template.matchAll(/"([^"]*)"|(\S+)/g)) args.push((match[1] ?? match[2]).split('{challenge}').join(challenge))
  return args
}

/** 解密工具的输出里取最后一个非空行作为密码（前面可能有提示文字） */
export function parseToolOutput(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const last = lines.pop() ?? ''
  // 「password: xxx」「密码：xxx」这种带标签的输出只取值
  return last.replace(/^(?:password|passwd|pwd|密码|口令)\s*[:：=]\s*/i, '')
}

/**
 * 运行用户提供的解密工具，把 su 给出的挑战码换成密码。
 * 参数模板里没有 {challenge} 且没勾选标准输入时，挑战码作为唯一的参数传入。
 */
export function runDecryptTool(config: DecryptToolConfig, challenge: string): Promise<string> {
  const toolPath = config.toolPath.trim()
  if (!toolPath) return Promise.reject(new Error('还没有配置解密工具：请在 root 方式设置里选择解密工具'))
  let args = buildToolArgs(config.toolArgs, challenge)
  if (!config.toolArgs.includes('{challenge}') && !config.toolStdin) args = [...args, challenge]
  // .bat / .cmd 要经过 cmd.exe 才能运行
  const viaShell = process.platform === 'win32' && /\.(bat|cmd)$/i.test(toolPath)
  recordCommand(formatCommand(toolPath, args), config.toolStdin ? '本机解密工具，挑战码同时写入标准输入' : '本机解密工具')
  return new Promise((resolve, reject) => {
    const child = execFile(
      toolPath,
      args,
      { timeout: TOOL_TIMEOUT, windowsHide: true, shell: viaShell, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const reason = error.killed
            ? `${TOOL_TIMEOUT / 1000} 秒内没有结束（解密工具需要能在命令行里运行并把密码输出到标准输出）`
            : (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? '找不到这个文件'
              : stderr.trim() || error.message
          reject(new Error(`解密工具运行失败：${reason}`))
          return
        }
        const password = parseToolOutput(stdout)
        if (!password) reject(new Error(`解密工具没有输出密码${stderr.trim() ? `：${stderr.trim()}` : ''}`))
        else resolve(password)
      }
    )
    if (config.toolStdin) child.stdin?.end(`${challenge}\n`)
    else child.stdin?.end()
  })
}
