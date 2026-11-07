import { describe, expect, it } from 'vitest'
import {
  parseAccelerators,
  cpuUsage,
  loadCommand,
  parseBattery,
  parseCpuFreq,
  parseDf,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseConnectedIfaces,
  parseProcStat,
  parseThermal,
  parseTop,
  SEP
} from './parsers'

describe('loadCommand', () => {
  it('joins 8 sections and only runs dumpsys when asked', () => {
    expect(loadCommand(true).split(SEP)).toHaveLength(8)
    expect(loadCommand(true)).toContain('dumpsys battery')
    expect(loadCommand(false)).not.toContain('dumpsys')
  })
})

describe('parseProcStat / cpuUsage', () => {
  const a = parseProcStat('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 50 0 50 400 0 0 0 0 0 0\ncpu2 50 0 50 400 0 0 0 0 0 0\nintr 1 2 3')
  const b = parseProcStat('cpu  200 0 200 1000 100 0 0 0 0 0\ncpu0 150 0 50 400 0 0 0 0 0 0\ncpu2 50 0 50 500 0 0 0 0 0 0')

  it('treats idle + iowait as idle and keeps offline cores as holes', () => {
    expect(a.all).toEqual({ busy: 200, total: 1000 })
    expect(a.cores[1]).toBeUndefined()
    expect(a.cores).toHaveLength(3)
  })

  it('computes percentage from two samples', () => {
    // busy +200 / total +500（iowait 计为空闲）
    expect(cpuUsage(a.all, b.all)).toBe(40)
    expect(cpuUsage(a.cores[0], b.cores[0])).toBe(100)
    expect(cpuUsage(a.cores[2], b.cores[2])).toBe(0)
    expect(cpuUsage(undefined, b.all)).toBeNull()
    expect(cpuUsage(b.all, b.all)).toBeNull()
  })
})

describe('parseMeminfo', () => {
  it('reads total, available and swap', () => {
    const text = 'MemTotal:       11780460 kB\nMemFree:          320000 kB\nMemAvailable:    4200000 kB\nCached:  1000 kB\nSwapTotal:       2097148 kB\nSwapFree:        1000000 kB\n'
    expect(parseMeminfo(text)).toEqual({ totalKB: 11780460, availableKB: 4200000, swapTotalKB: 2097148, swapFreeKB: 1000000 })
  })

  it('falls back to MemFree + Cached on old kernels', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemFree: 100 kB\nCached: 200 kB')?.availableKB).toBe(300)
    expect(parseMeminfo('')).toBeUndefined()
  })
})

describe('parseCpuFreq', () => {
  it('converts kHz to MHz and marks missing nodes as null', () => {
    expect(parseCpuFreq('cpu0 1785600\ncpu1 \ncpu3 710400\n')).toEqual([1786, null, null, 710])
  })
})

describe('parseThermal', () => {
  it('groups known sensors, takes the max, and ignores non-temperature zones', () => {
    const text = [
      'cpu-0-0-usr 34800',
      'cpu-1-7-usr 33700',
      'cpuss-0-usr 36800',
      'gpuss-0-usr 32100',
      'gpuss-1-usr 31300',
      'pm8150b-vbat-lvl0 4384',
      'soc 93',
      'lmh-dcvs-01 75000',
      'pm8150b-wp-therm ',
      'xo-therm 31473',
      'skin-therm 30509',
      'wp-therm -40000',
      'pa-therm2 815008',
      'battery 30100'
    ].join('\n')
    expect(parseThermal(text)).toEqual({ cpu: 36.8, gpu: 32.1, skin: 31.5, battery: 30.1 })
  })

  it('accepts sensors that report plain degrees', () => {
    expect(parseThermal('mtktscpu 45')).toEqual({ cpu: 45 })
    expect(parseThermal('')).toBeUndefined()
  })
})

describe('parseNetDev', () => {
  it('keeps physical interfaces and skips virtual ones', () => {
    const text = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  5000      10    0    0    0     0          0         0     5000      10    0    0    0     0       0          0
 wlan0: 1000000    800    0    0    0     0          0         0   200000     300    0    0    0     0       0          0
rmnet_ipa0: 900       5    0    0    0     0          0         0      300       1    0    0    0     0       0          0
rmnet_data0:     500       5    0    0    0     0          0         0      100       1    0    0    0     0       0          0
  tun0:  7000       5    0    0    0     0          0         0      700       1    0    0    0     0       0          0`
    expect(parseNetDev(text)).toEqual(
      new Map([
        ['wlan0', { rx: 1000000, tx: 200000 }],
        ['rmnet_data0', { rx: 500, tx: 100 }]
      ])
    )
    expect(parseNetDev('')).toBeUndefined()
  })

  it('treats interfaces with a global address as connected', () => {
    const text = [
      '1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever',
      '10: rmnet_data0    inet6 fe80::e7c3:33b7:f4d6:955b/64 scope link \\       valid_lft forever preferred_lft forever',
      '30: wlan0    inet 192.168.10.200/24 brd 192.168.10.255 scope global wlan0\\       valid_lft forever preferred_lft forever',
      '31: rmnet_data2    inet6 2409:8a28::1/64 scope global dynamic \\       valid_lft 86327sec preferred_lft 29955sec'
    ].join('\n')
    expect(parseConnectedIfaces(text)).toEqual(new Set(['wlan0', 'rmnet_data2']))
  })
})

describe('parseLoadavg', () => {
  it('reads three averages', () => {
    expect(parseLoadavg('2.31 2.07 1.83 1/5651 28407\n')).toEqual([2.31, 2.07, 1.83])
  })
})

describe('parseBattery', () => {
  it('reads the standard section and skips vendor sections before it', () => {
    const text = `Current OPLUS Battery Service state:
  Charger voltage : 4992
  PhoneTemp: 300
Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  health: 2
  present: true
  level: 94
  scale: 100
  voltage: 4382
  temperature: 301
  technology: Li-ion`
    expect(parseBattery(text)).toEqual({ level: 94, temperature: 30.1, voltage: 4382, status: 'charging', power: ['USB'] })
    expect(parseBattery('')).toBeUndefined()
  })
})

describe('parseTop', () => {
  it('parses toybox top rows, drops top itself, sorts by cpu', () => {
    const text = `28583 shell        12.9 4.9M top
 1584 system       12.9 231M system_server
28133 root          6.4    0 [kworker/u24:8]
26066 u0_a221       3.2 120M com.heytap.htms:kit_hlog
12556 u0_a287      20.0 1.2G com.tencent.mm
  482 root          3.2  512K [usbtemp_kthread]`
    const list = parseTop(text, 4)
    expect(list.map((p) => p.name)).toEqual(['com.tencent.mm', 'system_server', '[kworker/u24:8]', 'com.heytap.htms:kit_hlog'])
    expect(list[0]).toEqual({ pid: 12556, user: 'u0_a287', cpu: 20, resKB: 1258291, name: 'com.tencent.mm' })
    expect(list[1].resKB).toBe(231 * 1024)
    expect(list[2].resKB).toBe(0)
  })
})

describe('parseDf', () => {
  it('normalizes mount points and drops duplicates of the same partition', () => {
    const text = `Filesystem      1K-blocks     Used Available Use% Mounted on
/dev/block/dm-2 233595404 28882092 204172640  13% /data/user/0
/dev/fuse       233595404 28882092 204172640  13% /storage/emulated
/dev/root         3444116  3283976    143756  96% /`
    expect(parseDf(text)).toEqual([
      { mount: '/data', sizeKB: 233595404, usedKB: 28882092, availKB: 204172640 },
      { mount: '/', sizeKB: 3444116, usedKB: 3283976, availKB: 143756 }
    ])
  })
})

describe('parseAccelerators', () => {
  it('reads Adreno usage and converts Hz', () => {
    expect(parseAccelerators('uid=0\ngpu_present=1\ngpu_busy=37 %\ngpu_ratio=1 2\ngpu_freq=585000000\ngpu_model=Adreno640v2\n').gpu).toEqual({
      access: 'ok',
      busy: 37,
      freqMHz: 585,
      model: 'Adreno640v2'
    })
  })

  it('falls back to the gpubusy window, idle reads as 0', () => {
    expect(parseAccelerators('uid=0\ngpu_ratio=250 1000\n').gpu?.busy).toBe(25)
    expect(parseAccelerators('uid=0\ngpu_ratio=0 0\n').gpu?.busy).toBe(0)
  })

  it('understands devfreq load and kHz', () => {
    expect(parseAccelerators('uid=0\ngpu_busy=25@400000000Hz\ngpu_freq=400000\n').gpu).toMatchObject({ busy: 25, freqMHz: 400 })
  })

  it('reads a Rockchip board: devfreq GPU and rknpu', () => {
    // 真机读数（节点格式来自用户的 Rockchip 板子）
    const { gpu, npu } = parseAccelerators('uid=0\ngpu_present=1\ngpu_busy=0@300000000Hz\ngpu_freq=300000000\nnpu_present=1\nnpu_busy=NPU load: 0%\nnpu_freq=1000000000\n')
    expect(gpu).toEqual({ access: 'ok', busy: 0, freqMHz: 300 })
    expect(npu).toEqual({ access: 'ok', busy: 0, freqMHz: 1000 })
  })

  it('keeps the tile with a reason when a devfreq GPU cannot be read', () => {
    expect(parseAccelerators('uid=2000\ngpu_present=1\n').gpu).toEqual({ access: 'needs-root' })
  })

  it('averages per-core rknpu load', () => {
    expect(parseAccelerators('uid=0\nnpu_present=1\nnpu_busy=NPU load:  Core0: 10%, Core1: 30%, Core2:  2%,\n').npu).toMatchObject({
      access: 'ok',
      busy: 14,
      cores: [10, 30, 2]
    })
  })

  it('says root is needed when shell cannot read present nodes', () => {
    const { gpu, npu } = parseAccelerators('uid=2000\ngpu_present=1\nnpu_present=1\ngpu_model=Adreno640v2\n')
    expect(gpu).toEqual({ access: 'needs-root', model: 'Adreno640v2' })
    expect(npu).toEqual({ access: 'needs-root' })
  })

  it('reports no driver data when root still cannot read it', () => {
    expect(parseAccelerators('uid=0\nnpu_present=1\n').npu).toEqual({ access: 'unavailable' })
  })

  it('hides an NPU the device does not have', () => {
    expect(parseAccelerators('uid=2000\ngpu_present=1\n').npu).toBeUndefined()
  })

  it('does not treat an impossible reading as usage', () => {
    expect(parseAccelerators('uid=0\ngpu_busy=250\n').gpu).toEqual({ access: 'unavailable' })
  })
})
