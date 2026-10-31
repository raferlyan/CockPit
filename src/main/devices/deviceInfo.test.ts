import { describe, expect, it } from 'vitest'
import { parseDeviceInfoOutput, parseGetprop, parseRootState, parseWmSize } from './deviceInfo'

describe('parseGetprop', () => {
  it('parses key/value lines including empty values and CRLF', () => {
    const props = parseGetprop('[ro.product.model]: [GM1910]\r\n[ro.empty]: []\n[gsm.operator]: [CMCC,]\n')
    expect(props.get('ro.product.model')).toBe('GM1910')
    expect(props.get('ro.empty')).toBe('')
    expect(props.get('gsm.operator')).toBe('CMCC,')
  })
})

describe('parseWmSize', () => {
  it('prefers override size', () => {
    expect(parseWmSize('Physical size: 1440x3120\nOverride size: 1080x2340')).toBe('1080x2340')
    expect(parseWmSize('Physical size: 1440x3120')).toBe('1440x3120')
    expect(parseWmSize('')).toBeUndefined()
  })
})

describe('parseRootState', () => {
  it.each([
    ['0', '', 'adbd'],
    ['2000', '/system/bin/su', 'su-available'],
    ['2000', '', 'none'],
    ['', '', 'unknown']
  ] as const)('id=%s su=%s → %s', (id, su, expected) => {
    expect(parseRootState(id, su)).toBe(expected)
  })
})

describe('parseDeviceInfoOutput', () => {
  it('combines sections from the batched command', () => {
    const output = [
      '[ro.product.manufacturer]: [OnePlus]',
      '[ro.product.model]: [GM1910]',
      '[ro.product.brand]: [OnePlus]',
      '[ro.build.version.release]: [12]',
      '[ro.build.version.sdk]: [31]',
      '[ro.product.cpu.abi]: [arm64-v8a]',
      '__COCKPIT_SEP__',
      'Physical size: 1440x3120',
      '__COCKPIT_SEP__',
      '2000',
      '__COCKPIT_SEP__',
      '/system/bin/su'
    ].join('\n')

    expect(parseDeviceInfoOutput(output)).toEqual({
      info: {
        manufacturer: 'OnePlus',
        model: 'GM1910',
        brand: 'OnePlus',
        androidVersion: '12',
        sdk: 31,
        abi: 'arm64-v8a',
        resolution: '1440x3120'
      },
      root: 'su-available'
    })
  })
})
