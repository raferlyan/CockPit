# Cockpit

[中文](README.md) | **English**

Cockpit is a desktop toolkit for debugging Android devices, for macOS and Windows. One window gives you screen mirroring with control, adb terminals, a serial console and live device load monitoring.

## Features

- **Screen mirroring and control**: built on the [scrcpy](https://github.com/Genymobile/scrcpy) 5.0.1 server, decoded in hardware with WebCodecs and embedded in the main window.
  - Mouse: left button taps, right button is Back, middle button is Home, the wheel scrolls.
  - Keyboard: type directly, including through an input method (IME) such as Chinese.
  - Clipboard: synced both ways between computer and device with Cmd/Ctrl+C and Cmd/Ctrl+V.
  - Toolbar: Back, Home, Recents, Volume, Power, Notifications, Rotate.
- **adb terminal**: multiple tabs, with Tab completion, Ctrl+C, vi and other interactive programs working. Each tab shows the current identity: `$` for a normal user, `#` for root.
- **logcat**: colored output, with optional filter arguments such as `-s ActivityManager` or `--pid=$(pidof -s com.example)`.
- **Serial console**: talks to a device's debug UART through a USB-to-serial cable, no adb needed.
  - Configurable baud rate, data bits, parity, stop bits, RTS/CTS flow control and the line ending sent on Enter.
  - Optional local echo; reconnect in place after the cable is unplugged.
- **Device status**:
  - Refreshed every second: total and per-core CPU usage and frequency, memory and swap, CPU/GPU/battery/skin temperature, battery state, network throughput.
  - Also shows the top 10 processes and storage usage.
  - Charts cover the last 5 minutes; with several devices connected you can overlay them for comparison.
- **Device management**: devices are detected on plug and unplug, wireless connection (`adb connect`) is supported, and root availability is shown.
- **Clear feedback**: a notification explains failed actions, requests with no reply after 8 seconds, and why a button is unavailable.

## Download

Get the installer for your platform from [Releases](https://github.com/raferlyan/CockPit/releases/latest):

| Platform | File |
|---|---|
| macOS (Apple silicon) | `Cockpit-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Cockpit-<version>-mac-x64.dmg` |
| Windows 10 1809 or later (x64) | `Cockpit-<version>-win-x64.exe` |

The installers are not signed with a developer certificate yet, so the OS will block the first launch:

- **macOS**: drag Cockpit into Applications, then in Finder right-click Cockpit → Open → Open. If macOS says the app "is damaged and can't be opened", run:

  ```bash
  xattr -cr /Applications/Cockpit.app
  ```

- **Windows**: when SmartScreen appears, click "More info" → "Run anyway".

## Before you start

1. Install [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools), which provides adb. Cockpit looks for adb in this order:
   - `ANDROID_HOME` / `ANDROID_SDK_ROOT`
   - `PATH`
   - the default SDK location
2. On the phone, enable Developer options → USB debugging, then accept the authorization prompt after connecting.
3. For the serial console, install the driver for your USB-to-serial chip (CH340, CP210x, FTDI, etc.).

## Current limitations

- Only one device can be mirrored at a time; mirroring several devices at once is in progress.
- H.264 is the only supported video codec.
- In progress:
  - Root authentication (su password prompts) and root-only metrics.
  - Browsing app-private storage (SharedPreferences, MMKV, DataStore, SQLite).
- Audio forwarding is not supported yet.

## Development

Requires Node 22+ and adb.

```bash
npm install
npm run dev
```

| Command | Description |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run typecheck` | Type checking |
| `npm test` | Unit tests |
| `npm run fetch-server` | Download and verify scrcpy-server |
| `npm run package` | Build the unpacked app into `release/` |
| `npm run dist:mac` / `npm run dist:win` | Build installers |

**Releasing**: bump the version in `package.json`, then push a tag starting with `v` (for example `git tag v0.2.0 && git push origin v0.2.0`). GitHub Actions builds the macOS and Windows installers and publishes them to Releases.

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture and module design (in Chinese).

## Tech stack

Electron · React · TypeScript · Zustand · xterm.js · node-pty · serialport · uPlot · WebCodecs · scrcpy-server

## License

[Apache License 2.0](LICENSE). scrcpy-server comes from [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy) and is also licensed under Apache 2.0.
