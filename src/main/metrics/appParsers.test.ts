import { describe, expect, it } from 'vitest'
import {
  appProcCommand,
  foregroundCommand,
  FrameTracker,
  parseAppProc,
  parseEventLog,
  parseForeground,
  parseFramestats,
  parseMeminfoPss,
  parsePids,
  parseThreads,
  parseTimestats,
  type FrameRow
} from './appParsers'

describe('foreground', () => {
  it('takes the first topResumedActivity and expands relative class names', () => {
    const text = [
      '        topResumedActivity=ActivityRecord{9f52f15 u0 com.android.settings/.Settings t124}',
      '        topResumedActivity=ActivityRecord{cba3db5 u0 com.android.deskclock/.DeskClock t123}',
      '  ResumedActivity: ActivityRecord{9f52f15 u0 com.android.settings/.Settings t124}'
    ].join('\n')
    expect(parseForeground(text)).toEqual({ pkg: 'com.android.settings', activity: 'com.android.settings.Settings' })
    expect(parseForeground('  mResumedActivity: ActivityRecord{1 u0 com.foo/com.bar.Main$Inner t3}')).toEqual({ pkg: 'com.foo', activity: 'com.bar.Main$Inner' })
    expect(parseForeground('')).toBeUndefined()
  })

  it('only adds the ps lookup for valid package names', () => {
    expect(foregroundCommand('com.foo')).toContain('grep -F com.foo')
    expect(foregroundCommand('com.foo; reboot')).not.toContain('reboot')
    expect(foregroundCommand(undefined)).not.toContain('ps -A')
  })

  it('collects the package and its sub-processes', () => {
    const text = '  913 com.android.settings\n  990 com.android.settings:remote\n 1001 com.android.settingsfoo\n'
    expect(parsePids(text, 'com.android.settings')).toEqual([913, 990])
  })
})

describe('parseAppProc', () => {
  it('reads utime + stime after the command name and merges RSS / threads', () => {
    const stat = [
      '913 (ndroid.settings) S 335 335 0 0 -1 4194624 39489 690 54 13 568 1263 0 6 10 -10 29 0',
      '990 (weird ) name) S 1 1 0 0 -1 0 0 0 0 0 10 5 0 0'
    ].join('\n')
    const status = '/proc/913/status:VmRSS:\t  180828 kB\n/proc/913/status:Threads:\t29\n/proc/990/status:VmRSS:\t1000 kB'
    const result = parseAppProc(stat, status)
    expect(result.get(913)).toEqual({ ticks: 568 + 1263, rssKB: 180828, threads: 29 })
    expect(result.get(990)).toEqual({ ticks: 15, rssKB: 1000 })
  })

  it('emits placeholder sections when there is nothing to read', () => {
    expect(appProcCommand([])).toEqual(['true', 'true'])
    expect(appProcCommand([1, 2])[0]).toContain('/proc/1/stat /proc/2/stat')
  })
})

describe('parseMeminfoPss / parseThreads', () => {
  it('reads TOTAL PSS in both formats', () => {
    expect(parseMeminfoPss('           TOTAL PSS:    43947            TOTAL RSS:   181188')).toBe(43947)
    expect(parseMeminfoPss('        TOTAL    43947    19268    13768        0')).toBe(43947)
    expect(parseMeminfoPss('')).toBeUndefined()
  })

  it('keeps thread names with spaces', () => {
    expect(parseThreads(' 913 12.5 RenderThread\n 940  3.0 Jit thread pool\n')).toEqual([
      { tid: 913, cpu: 12.5, name: 'RenderThread' },
      { tid: 940, cpu: 3, name: 'Jit thread pool' }
    ])
  })
})

describe('parseFramestats', () => {
  const header =
    'Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted,'

  it('reads frames, skips flagged ones, and finds the interval despite the swapped header', () => {
    const text = [
      header,
      '0,59748,157408351360,157408351360,0,157410758282,157410758949,157410759449,157410988907,157425018026,157410748657,16666666,157415793490,157416194157,157417152490,157420463365,157446718574,19583,813667,157446718574,157432992324,0,157420463365,',
      '1,59762,157425018026,157425018026,0,157437982532,157437983074,157437983532,157438194282,157475018024,157437758449,16666666,157445340074,157450325407,157450970490,157461030407,157497876782,27709500,2269333,157485816699,157497876782,0,157461030407,'
    ].join('\n')
    expect(parseFramestats(text)).toEqual([{ intended: 157408351360, completed: 157446718574, deadline: 157425018026, interval: 16666666 }])
  })
})

describe('FrameTracker', () => {
  const frame = (i: number, durationMs: number): FrameRow => ({
    intended: 1e9 + i * 16_666_667,
    completed: 1e9 + i * 16_666_667 + durationMs * 1e6,
    interval: 16_666_667
  })

  it('uses the first poll as a baseline, then counts only new frames', () => {
    const tracker = new FrameTracker()
    const old = Array.from({ length: 10 }, (_, i) => frame(i, 10))
    expect(tracker.ingest(old, 0)).toMatchObject({ fps: 0, idle: true, refreshHz: 60 })
    const next = [...old, ...Array.from({ length: 6 }, (_, i) => frame(10 + i, i < 3 ? 10 : 40))]
    const window = tracker.ingest(next, 1000)
    expect(window.fps).toBe(6)
    expect(window.jankRatio).toBe(50)
    expect(window.worstMs).toBe(40)
    expect(window.recent).toHaveLength(6)
    expect(tracker.ingest(next, 2000)).toMatchObject({ fps: 0, idle: true, jankRatio: undefined })
  })
})

describe('parseTimestats', () => {
  it('sums the layers that belong to the package', () => {
    const text = [
      'displayRefreshRate = 60 fps',
      'totalFrames = 34',
      'jankyFrames = 33',
      'displayRefreshRate = 60 fps',
      'layerName = com.foo/com.foo.Main#331',
      'totalFrames = 33',
      'totalTimelineFrames = 32',
      'jankyFrames = 8',
      'displayRefreshRate = 60 fps',
      'layerName = SurfaceView[com.foo/com.foo.Main]#12',
      'totalFrames = 60',
      'totalTimelineFrames = 60',
      'jankyFrames = 2',
      'layerName = none',
      'totalFrames = 5'
    ].join('\n')
    expect(parseTimestats(text, 'com.foo')).toEqual({ frames: 93, timelineFrames: 92, janky: 10, refreshHz: 60 })
    expect(parseTimestats(text, 'com.bar')).toBeUndefined()
  })
})

describe('parseEventLog', () => {
  it('recognizes crash, ANR, kill, start and lmkd lines', () => {
    expect(parseEventLog('11-10 15:12:33.987   539  1106 I am_kill : [0,4804,com.android.deskclock,0,stop com.android.deskclock due to from pid 4846,164364]')).toEqual({
      kind: 'process',
      action: 'kill',
      name: 'com.android.deskclock',
      detail: 'stop com.android.deskclock due to from pid 4846'
    })
    expect(parseEventLog('I am_proc_start: [0,4856,10103,com.android.deskclock,next-top-activity,{com.android.deskclock/com.android.deskclock.DeskClock}]')).toMatchObject({
      kind: 'process',
      action: 'start',
      name: 'com.android.deskclock'
    })
    expect(parseEventLog('I am_crash: [0,913,com.foo,952745541,java.lang.NullPointerException,boom,Main.java,42,0]')).toMatchObject({
      kind: 'crash',
      name: 'com.foo',
      detail: 'java.lang.NullPointerException: boom'
    })
    expect(parseEventLog('I am_anr  : [0,913,com.foo,952745541,Input dispatching timed out]')).toMatchObject({ kind: 'anr', name: 'com.foo' })
    expect(parseEventLog("I lowmemorykiller: Kill 'com.foo' (1234), uid 10100, oom_score_adj 900 to free 12345kB rss")).toMatchObject({
      kind: 'lmk',
      name: 'com.foo'
    })
    expect(parseEventLog('--------- beginning of events')).toBeUndefined()
  })
})
