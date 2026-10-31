import { describe, expect, it } from 'vitest'
import { alignSeries, formatKB, formatRate } from './format'

describe('formatKB / formatRate', () => {
  it('picks a readable unit', () => {
    expect(formatKB(512)).toBe('512 KB')
    expect(formatKB(1536)).toBe('1.5 MB')
    expect(formatKB(233595404)).toBe('223 GB')
    expect(formatRate(800)).toBe('800 B/s')
    expect(formatRate(2048)).toBe('2.0 KB/s')
  })
})

describe('alignSeries', () => {
  it('buckets by second and fills gaps with null', () => {
    const a = [
      { t: 1000, v: 1 },
      { t: 2010, v: 2 }
    ]
    const b = [{ t: 2400, v: 5 }, { t: 3000, v: undefined }]
    expect(alignSeries([a, b])).toEqual([
      [1, 2, 3],
      [1, 2, null],
      [null, 5, null]
    ])
  })
})
