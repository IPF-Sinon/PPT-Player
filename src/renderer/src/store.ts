import { create } from 'zustand'
import type { EngineStatus } from '@shared/types'
import type { EngineMode, TabItem } from './lib/tabs'
import { emptyTab } from './lib/tabs'

/** Windows paths are case insensitive, so de-duplication must be too. */
export function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

interface AppState {
  engine: EngineStatus | null
  tabs: TabItem[]
  activeTabId: string | null
  /** Global mode, driven by the main process fullscreen state. */
  mode: 'preview' | 'playback'

  setEngine: (engine: EngineStatus | null) => void
  setMode: (mode: 'preview' | 'playback') => void

  /** Add a tab, or focus the existing one for the same path. */
  openTab: (filePath: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, patch: Partial<TabItem>) => void
  /** Move to another page, resetting the animation step. */
  setPage: (tabId: string, page: number) => void
  setStep: (tabId: string, step: number) => void
  setEngineMode: (tabId: string, mode: EngineMode) => void
  cycleTab: (delta: number) => void
  activeTab: () => TabItem | null
}

let tabSeq = 0

export const useAppStore = create<AppState>((set, get) => ({
  engine: null,
  tabs: [],
  activeTabId: null,
  mode: 'preview',

  setEngine: (engine) => set({ engine }),
  setMode: (mode) => set({ mode }),

  openTab: (filePath) => {
    const existing = get().tabs.find((tab) => samePath(tab.filePath, filePath))
    if (existing) {
      set({ activeTabId: existing.tabId })
      return existing.tabId
    }
    const tabId = 'tab-' + ++tabSeq
    const tab = emptyTab({ tabId, filePath })
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tabId }))
    return tabId
  },

  closeTab: (tabId) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.tabId === tabId)
      if (index < 0) return state
      const tabs = state.tabs.filter((tab) => tab.tabId !== tabId)
      let activeTabId = state.activeTabId
      if (activeTabId === tabId) {
        // Focus the neighbour so closing never leaves an empty shell.
        const next = tabs[index] ?? tabs[index - 1] ?? null
        activeTabId = next ? next.tabId : null
      }
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateTab: (tabId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.tabId === tabId ? { ...tab, ...patch } : tab))
    })),

  setPage: (tabId, page) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId
          ? { ...tab, currentPage: Math.max(0, Math.min(page, Math.max(0, tab.pageCount - 1))), currentStep: 0 }
          : tab
      )
    })),

  setStep: (tabId, step) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId ? { ...tab, currentStep: Math.max(0, step) } : tab
      )
    })),

  setEngineMode: (tabId, mode) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.tabId === tabId ? { ...tab, engineMode: mode, status: 'loading', error: null } : tab
      )
    })),

  cycleTab: (delta) => {
    const { tabs, activeTabId } = get()
    if (tabs.length < 2) return
    const index = tabs.findIndex((tab) => tab.tabId === activeTabId)
    const next = (index + delta + tabs.length) % tabs.length
    set({ activeTabId: tabs[next].tabId })
  },

  activeTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((tab) => tab.tabId === activeTabId) ?? null
  }
}))

/** Read the active tab without subscribing to the whole store. */
export function activeTabOf(): TabItem | null {
  return useAppStore.getState().activeTab()
}
