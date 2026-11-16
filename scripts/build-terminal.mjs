import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'

const outDir = resolve('out/windows-terminal')
await mkdir(outDir, { recursive: true })
await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    target: 'node22',
    lib: { entry: 'src/windows-terminal/cli.ts', formats: ['cjs'], fileName: () => 'cockpit-adb-shell.cjs' },
    rolldownOptions: { platform: 'node', external: [/^node:/] }
  }
})
for (const name of ['install.cjs', 'install.cmd', 'README.md']) {
  await copyFile('windows-terminal/' + name, resolve(outDir, name))
}
await copyFile('LICENSE', resolve(outDir, 'LICENSE'))
await copyFile('node_modules/@xterm/xterm/LICENSE', resolve(outDir, 'LICENSE-xterm'))
