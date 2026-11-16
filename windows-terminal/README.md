# Cockpit ADB Shell for Windows Terminal Preview

解压整个 ZIP，双击 `install.cmd`。安装到当前用户。Windows x64 体验包内含 Node.js，设备连接使用本机已有的 Android SDK Platform-Tools。支持 PATH、ANDROID_HOME、ANDROID_SDK_ROOT 和 Android Studio 默认 SDK 目录。

重新打开 Windows Terminal Preview，在新建标签页菜单选择 **Cockpit ADB Shell**。连接一台已授权 USB 调试的设备；多台设备可在启动 Terminal 前设置 `ANDROID_SERIAL`，或在 PowerShell 单独运行：

```powershell
& "$env:LOCALAPPDATA\CockpitAdbShell\app\node.exe" "$env:LOCALAPPDATA\CockpitAdbShell\app\cockpit-adb-shell.cjs" -s SERIAL
```

1. 输入 `pm li`，光标右侧显示候选，按 Tab 或 → 接受。输入 `pa` 再按 Tab，得到 `pm list packages`。按回车执行。
2. 输入 `pm path settings` 可按包名片段查找设备上的应用。用 ↑↓ 切换候选，Tab 接受。包名在后台获取，缓存一分钟。
3. 空提示符按 ↑ 找回上一条命令；有候选时先按 Esc，再用 ↑↓ 翻历史，翻到最新后按 ↓ 恢复草稿。历史独立保存在 `%LOCALAPPDATA%\CockpitAdbShell\history.sqlite`，最近 300 条由标签页共享。
4. 输入 `cd /sdcard`，再执行 `pwd`，两条命令在同一个设备 shell 中执行。用 `exit` 离开。

**启动**　在 Preview 的「设置 → 启动」中选 Cockpit ADB Shell 为默认配置，即可随终端启动。需要登录后自动打开窗口时，再启用同页的登录启动选项。安装程序只新增配置。Windows Terminal 正式版也会发现该用户级 fragment。

**卸载**　在解压目录的 PowerShell 里执行 `.\install.cmd --uninstall`。已有历史会保留。

**从源码构建**　在 Cockpit 仓库运行 `npm run build:terminal`，生成 `out/windows-terminal`。源码构建默认使用系统 Node.js 22.13 或更高版本；也可以把官方 Windows x64 的 node.exe 和许可证（命名为 LICENSE-node）放入该目录后分发。使用系统 Node.js 的安装可用 `node` 替代上面示例中的 node.exe 路径。
