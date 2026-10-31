// node-pty 1.1.0 的预编译 spawn-helper 缺少可执行权限，macOS 上会报 posix_spawnp failed
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'node_modules', 'node-pty')
const dirs = ['build/Release', ...(existsSync(join(root, 'prebuilds')) ? readdirSync(join(root, 'prebuilds')).map((d) => `prebuilds/${d}`) : [])]
for (const dir of dirs) {
  const helper = join(root, dir, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
