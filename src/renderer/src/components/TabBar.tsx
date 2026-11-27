import type { TabItem } from '../lib/tabs'
import { Folder, Settings } from './icons'

interface TabBarProps {
  tabs: TabItem[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onOpen: () => void
  onSettings: () => void
}

/** Status dot on a tab: converting, partial, ready or failed. */
function statusOf(tab: TabItem): 'loading' | 'partial' | 'ready' | 'error' {
  if (tab.status === 'error') return 'error'
  if (tab.status === 'loading') return 'loading'
  if (tab.headOnly) return 'partial'
  return 'ready'
}

/**
 * The single top strip: tabs on the left, actions on the right.
 *
 * This replaces a separate tab bar plus a separate title bar. The file name used to
 * appear three times (window title, tab, header), and the header carried a close
 * button duplicating the one Windows already draws, so the row is now one layer.
 */
export function TabBar({ tabs, activeTabId, onActivate, onClose, onOpen, onSettings }: TabBarProps) {
  return (
    <div className="topbar" data-testid="tabbar">
      <div className="tabbar-scroll">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            className="tab"
            data-active={tab.tabId === activeTabId}
            data-testid={'tab-' + tab.tabId}
            title={tab.filePath}
            onClick={() => onActivate(tab.tabId)}
            role="tab"
            aria-selected={tab.tabId === activeTabId}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onActivate(tab.tabId)
            }}
          >
            <span className="tab-dot" data-state={statusOf(tab)} aria-hidden="true" />
            <span className="tab-title" data-testid="deck-name">
              {tab.title}
            </span>
            {tab.engineMode === 'native-pptx' ? (
              <span className="tab-badge" title="原生渲染，支持动画">
                动画
              </span>
            ) : null}
            <button
              type="button"
              className="tab-close"
              aria-label="关闭标签"
              data-testid={'tab-close-' + tab.tabId}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.tabId)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="tab-new" aria-label="打开文件" data-testid="tab-new" onClick={onOpen}>
          +
        </button>
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          title="打开文件"
          aria-label="打开文件"
          data-testid="open-file"
          onClick={onOpen}
        >
          <Folder size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="设置"
          aria-label="设置"
          data-testid="open-settings"
          onClick={onSettings}
        >
          <Settings size={17} />
        </button>
      </div>
    </div>
  )
}