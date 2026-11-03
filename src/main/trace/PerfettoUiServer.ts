import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, extname, join, normalize, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  // WebAssembly.instantiateStreaming 要求正确的 MIME
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

const TRACE_PREFIX = '/traces/'
/**
 * Chromium 把 *.localhost 直接解析到本机。不用 127.0.0.1 / localhost 是因为 Perfetto 在这两个源上
 * 会当作官方站点开发环境：开启 Google Analytics、弹 cookie 提示、尝试连接 Google 内部扩展服务
 */
export const PERFETTO_HOST = 'perfetto.localhost'

/**
 * Perfetto 会注册 /service_worker.js 做离线缓存，官方版本清单里不含这个文件，缺了会弹报错。
 * 这里的文件本来就在本机，给一个不拦截请求的空 worker，也避免升级版本后读到旧缓存
 */
const NOOP_SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
`

/**
 * 在 127.0.0.1 随机端口上（以 perfetto.localhost 访问）提供打包进来的 Perfetto UI，以及用户打开的 trace 文件。
 * - UI 与 trace 同源，Perfetto 用 `#!/?url=` 直接 fetch，不涉及跨域和 postMessage 授权
 * - trace 只能通过随机 token 访问，不暴露本机任意路径
 * - 首次打开 Trace 视图时才启动
 */
export class PerfettoUiServer {
  private server?: Server
  private origin?: Promise<string>
  private readonly traces = new Map<string, string>()

  constructor(private readonly uiDir: string) {}

  get available(): boolean {
    return existsSync(join(this.uiDir, 'index.html'))
  }

  /** UI 的入口地址，如 http://perfetto.localhost:53124/ */
  async uiUrl(): Promise<string> {
    if (!this.available) throw new Error('未找到 Perfetto UI，请先运行 npm run fetch-perfetto')
    return `${await this.start()}/`
  }

  /** 登记一个本机 trace 文件，返回可以交给 Perfetto 打开的地址 */
  async register(localPath: string): Promise<{ url: string; name: string; size: number }> {
    const info = await stat(localPath)
    if (!info.isFile()) throw new Error('不是文件')
    const token = randomBytes(16).toString('hex')
    this.traces.set(token, localPath)
    const name = basename(localPath)
    // 文件名放进路径，Perfetto 用它作为标题
    return { url: `${await this.start()}${TRACE_PREFIX}${token}/${encodeURIComponent(name)}`, name, size: info.size }
  }

  dispose(): void {
    this.server?.close()
    this.server = undefined
    this.origin = undefined
    this.traces.clear()
  }

  private start(): Promise<string> {
    this.origin ??= new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo
        resolve(`http://${PERFETTO_HOST}:${port}`)
      })
      this.server = server
    })
    return this.origin
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405)
    // 只认本机名，防止网页借 DNS rebinding 以自己的域名访问这个端口
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (host !== PERFETTO_HOST && host !== '127.0.0.1') return end(res, 403)
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      return end(res, 400)
    }

    if (pathname.startsWith(TRACE_PREFIX)) {
      const token = pathname.slice(TRACE_PREFIX.length).split('/')[0]
      const file = this.traces.get(token)
      return file ? sendFile(req, res, file, 'application/octet-stream') : end(res, 404)
    }

    if (pathname === '/service_worker.js') {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-cache' })
      return void res.end(req.method === 'HEAD' ? undefined : NOOP_SERVICE_WORKER)
    }

    const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1))
    if (relative.startsWith('..') || relative.includes(`${sep}..`)) return end(res, 403)
    const file = join(this.uiDir, relative)
    // 版本固定、文件带哈希校验，index.html 之外都可以长缓存
    const cache = relative === 'index.html' ? 'no-cache' : 'max-age=31536000, immutable'
    return sendFile(req, res, file, CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', cache)
  }
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, cache = 'no-store'): Promise<void> {
  let size: number
  try {
    const info = await stat(file)
    if (!info.isFile()) return end(res, 404)
    size = info.size
  } catch {
    return end(res, 404)
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
}

function end(res: ServerResponse, status: number): void {
  res.writeHead(status).end()
}
