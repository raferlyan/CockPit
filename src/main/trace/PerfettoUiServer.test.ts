import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PerfettoUiServer } from './PerfettoUiServer'

const root = mkdtempSync(join(tmpdir(), 'cockpit-perfetto-'))
const uiDir = join(root, 'ui')
mkdirSync(join(uiDir, 'assets'), { recursive: true })
writeFileSync(join(uiDir, 'index.html'), '<html></html>')
writeFileSync(join(uiDir, 'trace_processor.wasm'), 'wasm')
writeFileSync(join(root, 'secret.txt'), 'secret')
const tracePath = join(root, 'my trace.pftrace')
writeFileSync(tracePath, 'trace-bytes')

const server = new PerfettoUiServer(uiDir)
// Node 的 fetch 不像 Chromium 那样把 *.localhost 固定解析到本机
const local = (url: string) => url.replace('perfetto.localhost', '127.0.0.1')
afterAll(() => {
  server.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('PerfettoUiServer', () => {
  it('serves the UI with correct content types', async () => {
    const base = await server.uiUrl()
    expect(base).toMatch(/^http:\/\/perfetto\.localhost:\d+\/$/)
    const index = await fetch(local(base))
    expect(index.headers.get('content-type')).toContain('text/html')
    const wasm = await fetch(local(`${base}trace_processor.wasm`))
    expect(wasm.headers.get('content-type')).toBe('application/wasm')
    const worker = await fetch(local(`${base}service_worker.js?v=x`))
    expect(worker.status).toBe(200)
    expect(worker.headers.get('content-type')).toContain('javascript')
  })

  it('does not serve files outside the UI directory', async () => {
    const base = await server.uiUrl()
    for (const path of ['../secret.txt', '%2e%2e/secret.txt', 'assets/%2e%2e/%2e%2e/secret.txt']) {
      const res = await fetch(local(base + path))
      expect(res.status).not.toBe(200)
    }
  })

  it('serves registered traces only by token', async () => {
    const { url, name, size } = await server.register(tracePath)
    expect(name).toBe('my trace.pftrace')
    expect(size).toBe(11)
    expect(url).toMatch(/\/traces\/[0-9a-f]{32}\/my%20trace\.pftrace$/)
    expect(await (await fetch(local(url))).text()).toBe('trace-bytes')
    const base = await server.uiUrl()
    expect((await fetch(local(`${base}traces/deadbeef/x`))).status).toBe(404)
  })

  it('rejects requests for other host names', async () => {
    const base = new URL(await server.uiUrl())
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port: base.port, path: '/', headers: { host: `evil.example:${base.port}` } }, (res) => resolve(res.statusCode ?? 0))
        .on('error', reject)
        .end()
    })
    expect(status).toBe(403)
  })

  it('reports a missing UI build', async () => {
    await expect(new PerfettoUiServer(join(root, 'missing')).uiUrl()).rejects.toThrow('fetch-perfetto')
  })
})
