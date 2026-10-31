import { describe, expect, it, vi } from 'vitest'

// SerialService 依赖 electron 与原生串口模块，这里只测纯函数
vi.mock('electron', () => ({}))
vi.mock('serialport', () => ({ SerialPort: class {} }))
const { describeOpenError, localEcho, toCalloutDevice } = await import('./SerialService')

describe('toCalloutDevice', () => {
  it('maps /dev/tty.* to /dev/cu.* on macOS only', () => {
    expect(toCalloutDevice('/dev/tty.usbserial-0001', 'darwin')).toBe('/dev/cu.usbserial-0001')
    expect(toCalloutDevice('/dev/ttyUSB0', 'darwin')).toBe('/dev/ttyUSB0')
    expect(toCalloutDevice('COM3', 'win32')).toBe('COM3')
  })
})

describe('localEcho', () => {
  it('turns Enter into a new line and Backspace into erase', () => {
    expect(localEcho('ls\r')).toBe('ls\r\n')
    expect(localEcho('ab\x7f')).toBe('ab\b \b')
  })
})

describe('describeOpenError', () => {
  it.each([
    ['Error: Resource busy, cannot open /dev/cu.x', '被其它程序占用'],
    ['Opening COM3: Access denied', '被其它程序占用'],
    ['Error: No such file or directory, cannot open /dev/cu.x', '找不到'],
    ['Opening COM9: File not found', '找不到'],
    ['Error: Permission denied, cannot open /dev/ttyUSB0', '没有权限'],
    ['weird', '打开 P 失败']
  ])('%s', (message, expected) => {
    expect(describeOpenError('P', new Error(message))).toContain(expected)
  })
})
