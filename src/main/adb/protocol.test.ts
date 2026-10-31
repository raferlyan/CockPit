import { describe, expect, it } from 'vitest'
import { connectionOf, encodeRequest, parseDeviceList, readLengthPrefixed } from './protocol'

describe('encodeRequest', () => {
  it('prefixes 4-digit hex length', () => {
    expect(encodeRequest('host:version').toString()).toBe('000chost:version')
  })
})

describe('readLengthPrefixed', () => {
  it('splits complete messages and keeps the remainder', () => {
    const buf = Buffer.from('0003abc0002xy0005hel')
    const { messages, rest } = readLengthPrefixed(buf)
    expect(messages).toEqual(['abc', 'xy'])
    expect(rest.toString()).toBe('0005hel')
  })

  it('handles empty payload (no devices)', () => {
    expect(readLengthPrefixed(Buffer.from('0000')).messages).toEqual([''])
  })

  it('waits for an incomplete header', () => {
    const { messages, rest } = readLengthPrefixed(Buffer.from('00'))
    expect(messages).toEqual([])
    expect(rest.toString()).toBe('00')
  })
})

describe('parseDeviceList', () => {
  it('parses `adb devices -l` output', () => {
    const text = [
      'List of devices attached',
      'c5002490               device usb:1-1 product:OnePlus7Pro_CH model:GM1910 device:OnePlus7Pro transport_id:1',
      '192.168.1.20:5555      unauthorized transport_id:3',
      'emulator-5554          offline',
      ''
    ].join('\n')

    expect(parseDeviceList(text)).toEqual([
      {
        serial: 'c5002490',
        state: 'device',
        connection: 'usb',
        usbPath: '1-1',
        product: 'OnePlus7Pro_CH',
        model: 'GM1910',
        deviceName: 'OnePlus7Pro',
        transportId: '1'
      },
      { serial: '192.168.1.20:5555', state: 'unauthorized', connection: 'tcp', transportId: '3' },
      { serial: 'emulator-5554', state: 'offline', connection: 'usb' }
    ])
  })

  it('handles CRLF and "no permissions"', () => {
    const text = 'ABC123\tno permissions (user in plugdev group); see [http://developer.android.com/tools/device.html] usb:1-2\r\n'
    const [device] = parseDeviceList(text)
    expect(device.state).toBe('no permissions')
    expect(device.usbPath).toBe('1-2')
  })

  it('maps unknown states', () => {
    expect(parseDeviceList('X1 weird')[0].state).toBe('unknown')
  })
})

describe('connectionOf', () => {
  it.each([
    ['192.168.1.2:5555', 'tcp'],
    ['adb-R58N123-AbCdE._adb-tls-connect._tcp', 'tcp'],
    ['emulator-5554', 'usb'],
    ['c5002490', 'usb']
  ])('%s → %s', (serial, expected) => {
    expect(connectionOf(serial)).toBe(expected)
  })
})
