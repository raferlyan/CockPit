import { useEffect, useState } from 'react'
import { COMMON_BAUD_RATES, DEFAULT_SERIAL_OPTIONS, type SerialOptions, type SerialPortInfo } from '@shared/serial'
import { api } from '../api'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { t } from '../i18n'

const STORAGE_KEY = 'cockpit.serial.last'

/** 记住上次的串口参数，方便反复连接同一块板子；存储不可用时用默认值 */
function loadLast(): SerialOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SerialOptions> | null
    return { path: '', ...DEFAULT_SERIAL_OPTIONS, ...saved }
  } catch {
    return { path: '', ...DEFAULT_SERIAL_OPTIONS }
  }
}

function saveLast(options: SerialOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // 忽略：只是便利功能
  }
}

function portLabel(port: SerialPortInfo): string {
  const extra = [port.manufacturer, port.vendorId && port.productId && `${port.vendorId}:${port.productId}`].filter(Boolean).join(' · ')
  return extra ? `${port.path}（${extra}）` : port.path
}

export function SerialDialog({ onOpen, onCancel }: { onOpen(options: SerialOptions): Promise<boolean>; onCancel(): void }) {
  const [options, setOptions] = useState(loadLast)
  const [ports, setPorts] = useState<SerialPortInfo[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [opening, setOpening] = useState(false)
  const set = <K extends keyof SerialOptions>(key: K, value: SerialOptions[K]) => setOptions((o) => ({ ...o, [key]: value }))

  const scan = async () => {
    setScanning(true)
    try {
      const list = await api.serial.list()
      setPorts(list)
      // 上次的串口不在了而列表里只有一个时，直接选它
      setOptions((o) => (list.some((p) => p.path === o.path) || list.length !== 1 ? o : { ...o, path: list[0].path }))
    } catch (error) {
      setPorts([])
      notify('error', t('扫描串口失败'), errorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    void scan()
  }, [])

  const submit = async () => {
    const path = options.path.trim()
    const finalOptions = { ...options, path }
    setOpening(true)
    const ok = await onOpen(finalOptions)
    setOpening(false)
    if (ok) saveLast(finalOptions)
  }

  const baudValid = Number.isInteger(options.baudRate) && options.baudRate > 0
  const disabledReason = opening ? t('正在打开串口') : !options.path.trim() ? t('先选择或输入串口设备') : !baudValid && t('波特率需要是正整数')

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog serial-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (disabledReason) notify('info', disabledReason)
          else void submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2 className="panel-title">{t('打开串口')}</h2>

        <label className="field">
          <span>{t('串口设备')}</span>
          <div className="field-row">
            <input
              className="mono"
              list="serial-ports"
              autoFocus
              value={options.path}
              placeholder={api.platform === 'win32' ? 'COM3' : '/dev/cu.usbserial-0001'}
              onChange={(e) => set('path', e.target.value)}
              spellCheck={false}
            />
            <datalist id="serial-ports">
              {ports?.map((p) => (
                <option key={p.path} value={p.path}>
                  {portLabel(p)}
                </option>
              ))}
            </datalist>
            <ActionButton type="button" className="secondary" disabledReason={scanning && t('正在扫描')} onClick={() => void scan()}>
              {scanning ? t('扫描中') : t('刷新')}
            </ActionButton>
          </div>
        </label>
        {ports && (
          <div className="serial-ports">
            {ports.length === 0 ? (
              <p className="muted">
                {t(t('没有发现串口。插上 USB 转串口线后点「刷新」；如果仍然没有，检查是否装了对应芯片（CH340、CP210x、FTDI 等）的驱动。也可以直接输入设备路径。'))}
              </p>
            ) : (
              ports.map((p) => (
                <button type="button" key={p.path} className={`serial-port${p.path === options.path ? ' on' : ''}`} onClick={() => set('path', p.path)}>
                  {portLabel(p)}
                </button>
              ))
            )}
          </div>
        )}

        <div className="field-grid">
          <label className="field">
            <span>{t('波特率')}</span>
            <input
              className="mono"
              list="serial-bauds"
              inputMode="numeric"
              value={Number.isNaN(options.baudRate) ? '' : options.baudRate}
              onChange={(e) => set('baudRate', Number(e.target.value))}
            />
            <datalist id="serial-bauds">
              {COMMON_BAUD_RATES.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>{t('数据位')}</span>
            <select value={options.dataBits} onChange={(e) => set('dataBits', Number(e.target.value) as SerialOptions['dataBits'])}>
              {[8, 7, 6, 5].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('校验')}</span>
            <select value={options.parity} onChange={(e) => set('parity', e.target.value as SerialOptions['parity'])}>
              <option value="none">{t('无')}</option>
              <option value="even">{t('偶校验')}</option>
              <option value="odd">{t('奇校验')}</option>
              <option value="mark">Mark</option>
              <option value="space">Space</option>
            </select>
          </label>
          <label className="field">
            <span>{t('停止位')}</span>
            <select value={options.stopBits} onChange={(e) => set('stopBits', Number(e.target.value) as SerialOptions['stopBits'])}>
              <option value={1}>1</option>
              <option value={1.5}>1.5</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label className="field">
            <span>{t('回车发送')}</span>
            <select value={options.enter} onChange={(e) => set('enter', e.target.value as SerialOptions['enter'])}>
              <option value="CR">CR (\r)</option>
              <option value="LF">LF (\n)</option>
              <option value="CRLF">CRLF (\r\n)</option>
            </select>
          </label>
        </div>

        <div className="field-checks">
          <label>
            <input type="checkbox" checked={options.rtscts} onChange={(e) => set('rtscts', e.target.checked)} /> {t('硬件流控 RTS/CTS')}
          </label>
          <label>
            <input type="checkbox" checked={options.localEcho} onChange={(e) => set('localEcho', e.target.checked)} /> {t('本地回显（设备不回显输入时打开）')}
          </label>
        </div>

        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            {t(t('取消'))}
          </button>
          <ActionButton type="submit" className="primary" disabledReason={disabledReason}>
            {opening ? t('打开中') : t('打开')}
          </ActionButton>
        </div>
      </form>
    </div>
  )
}
