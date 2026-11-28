import { useEffect, useState } from 'react'
import type { AppSettings, CategoryBinding, DocumentCategory } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { Close } from './icons'
import { platform } from '../platform/api'

/** The categories a user can bind, with the label shown beside each. */
const CATEGORY_LABELS: Array<{ key: DocumentCategory; label: string }> = [
  { key: 'ppt', label: '演示文稿' },
  { key: 'pdf', label: 'PDF' },
  { key: 'docx', label: 'Word 文档' },
  { key: 'xls', label: 'Excel 表格' }
]

interface SettingsSheetProps {
  open: boolean
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

/** Minimal settings sheet: engine override, cache budget, log access. */
export function SettingsSheet({ open, onClose, onSaved }: SettingsSheetProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void platform().getSettings().then((value) => {
      if (!cancelled) setSettings(value)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const patch = async (next: Partial<AppSettings>): Promise<void> => {
    setBusy(true)
    try {
      const saved = await platform().setSettings(next)
      setSettings(saved)
      onSaved(saved)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        data-testid="settings-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={zh.common.settings}
      >
        <header className="sheet-head">
          <h2>{zh.common.settings}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={zh.common.close}>
            <Close size={16} />
          </button>
        </header>

        <div className="sheet-body">
          <div className="sheet-row">
            <div>
              <label htmlFor="lo-path">{zh.engine.chooseLoPath}</label>
              <p className="sheet-hint">{settings?.loPathOverride || zh.engine.bundled}</p>
            </div>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  const picked = await platform().pickLoPath()
                  if (!picked) return
                  const status = await platform().setLoPath(picked)
                  setSettings(await platform().getSettings())
                  onSaved(await platform().getSettings())
                  void status
                }}
              >
                选择目录
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !settings?.loPathOverride}
                onClick={() => void patch({ loPathOverride: '' })}
              >
                清除
              </button>
            </div>
          </div>

          <div className="sheet-row">
            <div>
              <label htmlFor="cache-budget">缓存上限</label>
              <p className="sheet-hint">{settings?.cacheBudgetMb ?? 2048} MB</p>
            </div>
            <input
              id="cache-budget"
              type="range"
              min={256}
              max={8192}
              step={256}
              value={settings?.cacheBudgetMb ?? 2048}
              disabled={busy || !settings}
              onChange={(e) => void patch({ cacheBudgetMb: Number(e.target.value) })}
            />
          </div>

          <div className="sheet-row">
            <div>
              <label htmlFor="nav-position">翻页按钮位置</label>
              <p className="sheet-hint">放映时上一页/下一页放在底栏还是屏幕两侧</p>
            </div>
            <select
              id="nav-position"
              className="sheet-select"
              data-testid="nav-position"
              value={settings?.navButtonPosition ?? 'bottom'}
              disabled={busy || !settings}
              onChange={(e) =>
                void patch({ navButtonPosition: e.target.value === 'side' ? 'side' : 'bottom' })
              }
            >
              <option value="bottom">底栏</option>
              <option value="side">屏幕两侧</option>
            </select>
          </div>

          <div className="sheet-row">
            <div>
              <label htmlFor="keep-toolbar">写字时底栏常驻</label>
              <p className="sheet-hint">使用画笔或橡皮时不再自动隐藏工具栏</p>
            </div>
            <input
              id="keep-toolbar"
              type="checkbox"
              data-testid="keep-toolbar"
              checked={settings?.keepToolbarInInkMode ?? true}
              disabled={busy || !settings}
              onChange={(e) => void patch({ keepToolbarInInkMode: e.target.checked })}
            />
          </div>

          <div className="sheet-row">
            <div>
              <label htmlFor="ink-on-exit">退出时的批注</label>
              <p className="sheet-hint">结束放映时如何处理本场新画的笔迹</p>
            </div>
            <select
              id="ink-on-exit"
              className="sheet-select"
              data-testid="ink-on-exit"
              value={settings?.inkOnExit ?? 'ask'}
              disabled={busy || !settings}
              onChange={(e) => {
                const value = e.target.value
                void patch({
                  inkOnExit: value === 'keep' ? 'keep' : value === 'discard' ? 'discard' : 'ask'
                })
              }}
            >
              <option value="ask">每次询问</option>
              <option value="keep">总是保留</option>
              <option value="discard">总是不保留</option>
            </select>
          </div>

          <div className="sheet-row">
            <div>
              <label htmlFor="transitions">幻灯片切换动画</label>
              <p className="sheet-hint">放映翻页时播放转场效果</p>
            </div>
            <input
              id="transitions"
              type="checkbox"
              data-testid="enable-transitions"
              checked={settings?.enableTransitions ?? true}
              disabled={busy || !settings}
              onChange={(e) => void patch({ enableTransitions: e.target.checked })}
            />
          </div>

          {/* One binding per category: a deck is presented, a document is read. */}
          {CATEGORY_LABELS.map(({ key, label }) => {
            const binding = settings?.bindings?.[key]
            const setBinding = (next: Partial<CategoryBinding>): void => {
              if (!settings) return
              void patch({
                bindings: {
                  ...settings.bindings,
                  [key]: { ...binding!, ...next }
                }
              })
            }
            return (
              <div className="sheet-row" key={key}>
                <div>
                  <label>{label}</label>
                  <p className="sheet-hint">默认视图与工具栏样式</p>
                </div>
                <div className="sheet-actions">
                  <select
                    className="sheet-select"
                    data-testid={'view-mode-' + key}
                    value={binding?.viewMode ?? 'slide'}
                    disabled={busy || !binding}
                    onChange={(e) =>
                      setBinding({
                        viewMode: e.target.value === 'single-column' ? 'single-column' : 'slide'
                      })
                    }
                  >
                    <option value="slide">幻灯片</option>
                    <option value="single-column">单列竖屏</option>
                  </select>
                  <select
                    className="sheet-select"
                    data-testid={'toolbar-style-' + key}
                    value={binding?.toolbarStyle ?? 'bar'}
                    disabled={busy || !binding}
                    onChange={(e) =>
                      setBinding({ toolbarStyle: e.target.value === 'fab' ? 'fab' : 'bar' })
                    }
                  >
                    <option value="bar">标准底栏</option>
                    <option value="fab">悬浮球</option>
                  </select>
                </div>
              </div>
            )
          })}

          <div className="sheet-row">
            <div>
              <label htmlFor="autostart">开机自启动</label>
              <p className="sheet-hint">
                后台预加载，让课堂上双击文件立即打开。开启后关闭窗口会最小化到托盘，需从托盘菜单完全退出
              </p>
            </div>
            <input
              id="autostart"
              type="checkbox"
              data-testid="autostart"
              checked={settings?.autostart ?? false}
              disabled={busy || !settings}
              onChange={(e) => void patch({ autostart: e.target.checked })}
            />
          </div>

          <div className="sheet-row">
            <div>
              <label>诊断</label>
              <p className="sheet-hint">日志与缓存目录</p>
            </div>
            <div className="sheet-actions">
              <button type="button" className="btn" onClick={() => void platform().openLog()}>
                {zh.common.openLog}
              </button>
              <button type="button" className="btn" onClick={() => void platform().revealCache()}>
                {zh.common.revealCache}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}