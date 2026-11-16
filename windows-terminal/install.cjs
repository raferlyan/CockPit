'use strict'
const fs = require('node:fs')
const path = require('node:path')

function install() {
  if (process.platform !== 'win32') throw Error('请在 Windows 上运行安装程序。')
  const local = process.env.LOCALAPPDATA
  const app = path.join(local, 'CockpitAdbShell', 'app')
  const fragments = path.join(local, 'Microsoft', 'Windows Terminal', 'Fragments', 'CockpitAdbShell')
  const profile = path.join(fragments, 'profile.json')
  const files = ['cockpit-adb-shell.cjs', 'LICENSE', 'LICENSE-xterm', 'node.exe', 'LICENSE-node']
  if (process.argv.includes('--uninstall')) {
    fs.rmSync(profile, { force: true })
    for (const file of files) fs.rmSync(path.join(app, file), { force: true })
    console.log('已移除 Cockpit ADB Shell 标签页，命令历史已保留。')
    return
  }
  require('node:sqlite')
  fs.mkdirSync(app, { recursive: true })
  fs.mkdirSync(fragments, { recursive: true })
  for (const file of files) {
    const source = path.join(__dirname, file)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(app, file))
  }
  const node = fs.existsSync(path.join(__dirname, 'node.exe')) ? path.join(app, 'node.exe') : process.execPath
  const cli = path.join(app, 'cockpit-adb-shell.cjs')
  if (!fs.existsSync(cli)) throw Error('安装包缺少 cockpit-adb-shell.cjs。')
  const fragment = { profiles: [{
    guid: '{2a716cca-6d79-43bc-8de8-167e36e812a5}',
    name: 'Cockpit ADB Shell',
    commandline: '"' + node + '" "' + cli + '"',
    startingDirectory: '%USERPROFILE%',
    closeOnExit: 'graceful'
  }] }
  fs.writeFileSync(profile + '.tmp', JSON.stringify(fragment, null, 2))
  fs.renameSync(profile + '.tmp', profile)
  console.log('安装完成。重新打开 Windows Terminal Preview，从新建标签页菜单选择 Cockpit ADB Shell。')
}
try { install() } catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
