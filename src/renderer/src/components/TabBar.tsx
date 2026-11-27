import type { TabItem } from '../lib/tabs'

interface TabBarProps {
  tabs: TabItem[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onOpen: () => void
}

/** Status dot on a tab: converting, partial, ready or failed. */
function statusOf(tab: TabItem): 'loading' | 'partial' | 'ready' | 'error' {
  if (tab.status === 'error') return 'error'
  if (tab.status === 'loading') return 'loading'
  if (tab.headOnly) return 'partial'
  return 'ready'
}

/**
 * Compact tab strip.
 *
 * Scrolls horizontally rather than wrapping, so a dozen open decks still leave the
 * action buttons at a stable position.
 */
export function TabBar({ tabs, activeTabId, onActivate, onClose, onOpen }: TabBarProps) {
  if (tabs.length === 0) return null

  return (
    <div className="tabbar" data-testid="tabbar">
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
            <span className="tab-title">{tab.title}</span>
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
      </div>
      <button type="button" className="tab-new" aria-label="打开文件" data-testid="tab-new" onClick={onOpen}>
        +
      </button>
    </div>
  )
}
