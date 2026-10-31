// 用 Electron 把 docs/assets/logo.svg 渲染成打包用的 build/icon.png（1024×1024）
// 用法：npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'docs/assets/logo.svg'), 'utf8')
const SIZE = 1024

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.webContents.setZoomFactor(1)
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  mkdirSync(join(root, 'build'), { recursive: true })
  writeFileSync(join(root, 'build/icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('build/icon.png', image.getSize())
  app.quit()
})
