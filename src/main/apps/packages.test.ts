import { describe, expect, it } from 'vitest'
import { parsePackageList } from './packages'

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
