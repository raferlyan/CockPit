import { describe, expect, it } from 'vitest'
import { parseInstallTimes, parsePackageList } from './packages'

describe('parsePackageList', () => {
  it('merges pm list outputs into kinds and states', () => {
    const apps = parsePackageList({
      all: 'package:com.android.chrome\npackage:com.example\npackage:com.vendor.bloat\n',
      installed: 'package:/product/app/Chrome/Chrome.apk=com.android.chrome\r\npackage:/data/app/~~a=b/base.apk=com.example\r\n',
      third: 'package:com.example\n',
      disabled: 'package:com.android.chrome\n'
    })
    expect(apps).toEqual([
      { name: 'com.android.chrome', kind: 'system', disabled: true, uninstalled: false, apkPath: '/product/app/Chrome/Chrome.apk' },
      { name: 'com.example', kind: 'user', disabled: false, uninstalled: false, apkPath: '/data/app/~~a=b/base.apk' },
      { name: 'com.vendor.bloat', kind: 'system', disabled: false, uninstalled: true, apkPath: undefined }
    ])
  })
})

describe('parseInstallTimes', () => {
  it('takes the first firstInstallTime / lastUpdateTime per package', () => {
    const text = [
      '  Package [com.example] (1a2b):',
      '    lastUpdateTime=2024-05-02 10:00:00',
      '      User 0: ceDataInode=1 installed=true firstInstallTime=2024-05-01 09:30:00',
      '      User 10: firstInstallTime=2024-06-01 09:30:00',
      '  Package [com.other] (3c4d):'
    ].join('\n')
    const times = parseInstallTimes(text)
    expect(times.get('com.example')).toEqual({
      firstInstallTime: new Date('2024-05-01T09:30:00').getTime(),
      lastUpdateTime: new Date('2024-05-02T10:00:00').getTime()
    })
    expect(times.get('com.other')).toEqual({})
  })
})
