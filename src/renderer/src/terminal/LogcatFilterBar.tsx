import { useEffect, useState } from 'react'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { t } from '../i18n'
import { compileFilter, DEFAULT_FILTER, LEVELS, logcatBuffer, type LogcatFilter } from './logcat'
import { useTerminalStore, type TerminalTab } from './terminalStore'

/** 包名对应的进程会重启换号，定时重新查 */
const PID_POLL_MS = 3_000
/** 输入停顿这么久再应用筛选，避免每敲一个字都重放整个缓存 */
const INPUT_DELAY = 250

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function sameList(a: number[] | null, b: number[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** 输入框本地保存草稿，停顿后再提交 */
function useDebouncedField(value: string, commit: (v: string) => void): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => commit(draft), INPUT_DELAY)
    return () => clearTimeout(timer)
  }, [draft])
  return [draft, setDraft]
}

/** logcat 标签上方的筛选栏：级别、Tag、关键字 / 正则、应用，以及暂停、清空和导出 */
export function LogcatFilterBar({ tab }: { tab: TerminalTab }) {
  const filter = tab.logcatFilter ?? DEFAULT_FILTER
  const { setLogcatFilter, setPaused } = useTerminalStore.getState()
  const update = (patch: Partial<LogcatFilter>) => setLogcatFilter(tab.id, patch)
  const [tags, setTags] = useDebouncedField(filter.tags, (v) => update({ tags: v }))
  const [text, setText] = useDebouncedField(filter.text, (v) => update({ text: v }))
  const [pkg, setPkg] = useDebouncedField(filter.pkg, (v) => update({ pkg: v, pids: null }))
  const compiled = compileFilter(filter)

  // 包名 → 进程号；直接填数字时当作 PID
  useEffect(() => {
    const target = filter.pkg.trim()
    if (!target) return
    if (/^\d+$/.test(target)) {
      update({ pids: [Number(target)] })
      return
    }
    let stopped = false
    const poll = async () => {
      try {
        const pids = (await api.apps.pids(tab.serial, target)).sort((a, b) => a - b)
        const current = useTerminalStore.getState().tabs.find((t) => t.id === tab.id)?.logcatFilter?.pids ?? null
        if (!stopped && !sameList(current, pids)) update({ pids })
      } catch {
        // 包名不合法等情况下保持不显示，输入框旁会提示
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), PID_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [filter.pkg, tab.serial, tab.id])

  const exportLog = async (filtered: boolean) => {
    const lines = logcatBuffer(tab.id).lines
    const chosen = filtered ? lines.filter(compiled.match) : lines
    if (!chosen.length) {
      notify('info', t('没有可导出的日志'))
      return
    }
    try {
      const file = await api.files.saveText(`logcat_${tab.serial.replace(/[^\w.-]+/g, '_')}_${stamp()}${filtered ? '_filtered' : ''}.txt`, chosen.map((l) => l.plain).join('\n') + '\n')
      if (file) {
        notify('success', t('已导出 {n} 行日志', { n: chosen.length }), file)
        api.files.reveal(file)
      }
    } catch (error) {
      notify('error', t('导出日志失败'), errorMessage(error))
    }
  }

  const pidState = filter.pkg.trim() && !/^\d+$/.test(filter.pkg.trim()) ? (filter.pids === null ? t('查找中') : filter.pids.length ? `PID ${filter.pids.join(', ')}` : t('未运行')) : null

  return (
    <div className="logcat-bar">
      <div className="segmented logcat-levels" title={t('最低级别')}>
        {LEVELS.map((level) => (
          <button key={level} className={`level-${level}${filter.minLevel === level ? ' on' : ''}`} onClick={() => update({ minLevel: level })}>
            {level}
          </button>
        ))}
      </div>
      <input
        className="mono logcat-input"
        value={tags}
        placeholder={t('Tag，空格分隔，-前缀排除')}
        title={t('Tag 包含任一关键词即显示；以 - 开头的排除，如：ActivityManager -chatty')}
        onChange={(e) => setTags(e.target.value)}
        spellCheck={false}
      />
      <div className={`logcat-search${compiled.error ? ' invalid' : ''}`}>
        <input
          className="mono logcat-input"
          value={text}
          placeholder={t('关键字，或 /正则/')}
          title={compiled.error ?? t('匹配整行内容；用 /.../ 包起来按正则匹配')}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <button className={`tool${filter.ignoreCase ? '' : ' on'}`} title={t('区分大小写')} onClick={() => update({ ignoreCase: !filter.ignoreCase })}>
          Aa
        </button>
      </div>
      <input
        className="mono logcat-input logcat-pkg"
        value={pkg}
        placeholder={t('包名或 PID')}
        title={t('只看某个应用的日志；应用重启后会自动跟上新的进程号')}
        onChange={(e) => setPkg(e.target.value)}
        spellCheck={false}
      />
      {pidState && <span className="muted logcat-pid">{pidState}</span>}
      {compiled.active && (
        <button
          className="tool"
          title={t('清除全部筛选条件')}
          onClick={() => {
            setTags('')
            setText('')
            setPkg('')
            update({ ...DEFAULT_FILTER, ignoreCase: filter.ignoreCase })
          }}
        >
          {t('重置')}
        </button>
      )}
      <span className="spacer" />
      <button className={`tool${tab.paused ? ' on' : ''}`} title={t('暂停滚动，新日志照常缓存')} onClick={() => setPaused(tab.id, !tab.paused)}>
        {tab.paused ? t('▶ 继续') : t('⏸ 暂停')}
      </button>
      <button
        className="tool"
        title={t('清空已缓存的日志')}
        onClick={() => {
          logcatBuffer(tab.id).clear()
          update({})
        }}
      >
        {t('清空')}
      </button>
      <button className="tool" title={t('导出缓存的全部日志')} onClick={() => void exportLog(false)}>
        {t('导出全部')}
      </button>
      <button className="tool" disabled={!compiled.active} title={t('只导出符合当前筛选条件的日志')} onClick={() => void exportLog(true)}>
        {t('导出筛选结果')}
      </button>
    </div>
  )
}
