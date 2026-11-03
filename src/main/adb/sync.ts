import { open, stat } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { SocketReader } from '../util/SocketReader'
import { encodeRequest } from './protocol'

/** adbd 单个 DATA 包的上限 */
const CHUNK_SIZE = 64 * 1024

function syncHeader(id: string, length: number): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'ascii')
  header.writeUInt32LE(length, 4)
  return header
}

function write(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.write(data)) return resolve()
    const onDrain = () => {
      socket.off('close', onClose)
      resolve()
    }
    const onClose = () => {
      socket.off('drain', onDrain)
      reject(new Error('连接已关闭'))
    }
    socket.once('drain', onDrain)
    socket.once('close', onClose)
  })
}

/** 读 adb server 的 OKAY / FAIL 应答 */
async function expectOkay(reader: SocketReader, what: string): Promise<void> {
  const status = (await reader.read(4)).toString('ascii')
  if (status === 'OKAY') return
  const length = parseInt((await reader.read(4)).toString('ascii'), 16)
  const message = length ? (await reader.read(length)).toString('utf8') : status
  throw new Error(`${what}: ${message}`)
}

/**
 * 用 adb sync 协议把单个本机文件写到设备上，边发边回报已发送的字节数。
 * 比 `adb push` 子进程多了精确进度；设备端出错（如无权限）会立即返回 FAIL。
 */
export async function syncPush(
  serverPort: number,
  serial: string,
  local: string,
  remote: string,
  onProgress: (sent: number, total: number) => void,
  timeoutMs: number
): Promise<void> {
  const info = await stat(local)
  const socket = connect({ host: '127.0.0.1', port: serverPort })
  socket.setNoDelay(true)
  const reader = new SocketReader(socket)
  const file = await open(local, 'r')
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    socket.write(encodeRequest(`host:transport:${serial}`))
    await expectOkay(reader, '连接设备失败')
    socket.write(encodeRequest('sync:'))
    await expectOkay(reader, '进入 sync 模式失败')

    const spec = Buffer.from(`${remote},${(info.mode & 0o777) | 0o100000}`, 'utf8')
    socket.write(Buffer.concat([syncHeader('SEND', spec.length), spec]))

    // 设备端出错时会在传输途中提前回 FAIL，先挂上应答读取，发现失败就停止发送
    let settled = false
    const reply = reader.read(8, timeoutMs).finally(() => (settled = true))
    reply.catch(() => undefined)

    const buffer = Buffer.alloc(CHUNK_SIZE)
    let sent = 0
    let lastReport = 0
    onProgress(0, info.size)
    while (!settled) {
      const { bytesRead } = await file.read(buffer, 0, CHUNK_SIZE, sent)
      if (bytesRead === 0) break
      await write(socket, Buffer.concat([syncHeader('DATA', bytesRead), buffer.subarray(0, bytesRead)]))
      sent += bytesRead
      const now = Date.now()
      if (now - lastReport > 100) {
        lastReport = now
        onProgress(sent, info.size)
      }
    }
    if (!settled) socket.write(syncHeader('DONE', Math.floor(info.mtimeMs / 1000)))

    const head = await reply
    const id = head.toString('ascii', 0, 4)
    if (id === 'FAIL') {
      const length = head.readUInt32LE(4)
      throw new Error((await reader.read(length)).toString('utf8'))
    }
    if (id !== 'OKAY') throw new Error(`sync 应答异常：${id}`)
    onProgress(info.size, info.size)
    socket.write(syncHeader('QUIT', 0))
  } finally {
    await file.close()
    reader.detach()
    socket.destroy()
  }
}
