// 下载固定版本的 Perfetto UI 静态文件到 resources/perfetto-ui/，供应用离线内嵌。
// 版本目录下的 manifest.json 列出了全部文件及其 SHA-256（SRI 格式），
// 这里固定 index.html 与 manifest.json 的哈希，其余文件按 manifest 逐个校验。
// 升级：在 https://ui.perfetto.dev/ 的 data-perfetto_version 里找 stable 版本，更新下面三个常量。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'v59.1-79997ada9'
const INDEX_SHA256 = '33ae569b0cfd7ed66b2be9f649de4aaadae0dd42177643a552460a6225d2da99'
const MANIFEST_SHA256 = '356b2801fab5da96af4b51d1ff6ee4ca79f34d39e217af1115fd09987f8bf290'
const BASE = `https://ui.perfetto.dev/${VERSION}/`
const CONCURRENCY = 6

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'perfetto-ui')
const marker = join(target, '.version')

const sha256 = (buf) => createHash('sha256').update(buf).digest()

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === MANIFEST_SHA256) {
  console.log(`Perfetto UI ${VERSION} already present`)
  process.exit(0)
}

async function download(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`Download ${path} failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function expectHex(path, data, hex) {
  const actual = sha256(data).toString('hex')
  if (actual !== hex) throw new Error(`SHA-256 mismatch for ${path}: expected ${hex}, got ${actual}`)
}

console.log(`Downloading Perfetto UI ${VERSION}`)
const index = await download('index.html')
expectHex('index.html', index, INDEX_SHA256)
const manifest = await download('manifest.json')
expectHex('manifest.json', manifest, MANIFEST_SHA256)

const resources = Object.entries(JSON.parse(manifest.toString('utf8')).resources)
const staging = `${target}.partial`
rmSync(staging, { recursive: true, force: true })

const write = (path, data) => {
  const file = join(staging, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
}
write('index.html', index)
write('manifest.json', manifest)

let total = index.length + manifest.length
const queue = [...resources]
async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const [path, integrity] = item
    if (path.includes('..') || path.startsWith('/')) throw new Error(`Unexpected path in manifest: ${path}`)
    const data = await download(path)
    const actual = `sha256-${sha256(data).toString('base64')}`
    if (actual !== integrity) throw new Error(`Integrity mismatch for ${path}: expected ${integrity}, got ${actual}`)
    write(path, data)
    total += data.length
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

writeFileSync(join(staging, '.version'), `${MANIFEST_SHA256}\n`)
rmSync(target, { recursive: true, force: true })
renameSync(staging, target)
console.log(`Saved ${resources.length + 2} files to ${target} (${(total / 1024 / 1024).toFixed(1)} MB)`)
