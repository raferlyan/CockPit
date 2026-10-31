// 下载与协议实现绑定的 scrcpy-server 到 resources/，并校验 SHA-256。
// 升级版本时同时修改这里和 src/main/mirror/scrcpyServer.ts 中的 SCRCPY_VERSION。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '5.0.1'
const SHA256 = '764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536'
const URL = `https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/scrcpy-server-v${VERSION}`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'scrcpy-server')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

if (existsSync(target) && sha256(readFileSync(target)) === SHA256) {
  console.log(`scrcpy-server v${VERSION} already present`)
  process.exit(0)
}

console.log(`Downloading ${URL}`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
const data = Buffer.from(await res.arrayBuffer())
const actual = sha256(data)
if (actual !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${actual}`)

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, data)
console.log(`Saved ${target} (${data.length} bytes)`)
