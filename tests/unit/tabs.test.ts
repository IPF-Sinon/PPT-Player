// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { samePath, useAppStore } from '../../src/renderer/src/store'

/** Reset the shared store between cases. */
beforeEach(() => {
  useAppStore.setState({ tabs: [], activeTabId: null, mode: 'preview' })
})

describe('samePath', () => {
  it('treats Windows paths case insensitively', () => {
    expect(samePath('C:\\Decks\\A.pptx', 'c:\\decks\\a.pptx')).toBe(true)
  })

  it('ignores separator style', () => {
    expect(samePath('C:\\Decks\\A.pptx', 'C:/Decks/A.pptx')).toBe(true)
  })

  it('still distinguishes different files', () => {
    expect(samePath('C:\\Decks\\A.pptx', 'C:\\Decks\\B.pptx')).toBe(false)
  })
})

describe('tab lifecycle', () => {
  it('opens a tab and makes it active', () => {
    const id = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const state = useAppStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).toBe(id)
    expect(state.tabs[0].title).toBe('A.pptx')
  })

  it('focuses the existing tab instead of opening the same file twice', () => {
    const first = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const second = useAppStore.getState().openTab('c:\\decks\\a.pptx')
    expect(second).toBe(first)
    expect(useAppStore.getState().tabs).toHaveLength(1)
  })

  it('starts a new tab in the loading state with a clean error', () => {
    useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const tab = useAppStore.getState().tabs[0]
    expect(tab.status).toBe('loading')
    expect(tab.error).toBeNull()
    expect(tab.currentPage).toBe(0)
  })

  it('focuses the neighbour when the active tab closes', () => {
    const a = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const b = useAppStore.getState().openTab('C:\\Decks\\B.pptx')
    const c = useAppStore.getState().openTab('C:\\Decks\\C.pptx')
    expect(useAppStore.getState().activeTabId).toBe(c)

    useAppStore.getState().closeTab(c)
    const state = useAppStore.getState()
    expect(state.tabs).toHaveLength(2)
    // Closing the last tab falls back to the one before it.
    expect(state.activeTabId).toBe(b)
    expect(a).not.toBe(b)
  })

  it('closes a background tab without changing focus', () => {
    const a = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const b = useAppStore.getState().openTab('C:\\Decks\\B.pptx')
    useAppStore.getState().closeTab(a)
    expect(useAppStore.getState().activeTabId).toBe(b)
  })

  it('clears the active tab when the last one closes', () => {
    const a = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    useAppStore.getState().closeTab(a)
    const state = useAppStore.getState()
    expect(state.tabs).toHaveLength(0)
    expect(state.activeTabId).toBeNull()
  })

  it('cycles tabs and wraps around', () => {
    const a = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const b = useAppStore.getState().openTab('C:\\Decks\\B.pptx')
    useAppStore.getState().cycleTab(1)
    expect(useAppStore.getState().activeTabId).toBe(a)
    useAppStore.getState().cycleTab(-1)
    expect(useAppStore.getState().activeTabId).toBe(b)
  })
})

describe('page and step', () => {
  it('clamps the page to the deck', () => {
    const id = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    useAppStore.getState().updateTab(id, { pageCount: 3 })
    useAppStore.getState().setPage(id, 99)
    expect(useAppStore.getState().tabs[0].currentPage).toBe(2)
    useAppStore.getState().setPage(id, -5)
    expect(useAppStore.getState().tabs[0].currentPage).toBe(0)
  })

  it('resets the step when the page changes', () => {
    const id = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    useAppStore.getState().updateTab(id, { pageCount: 3 })
    useAppStore.getState().setStep(id, 2)
    expect(useAppStore.getState().tabs[0].currentStep).toBe(2)
    useAppStore.getState().setPage(id, 1)
    // A new page always starts before its first click.
    expect(useAppStore.getState().tabs[0].currentStep).toBe(0)
  })

  it('never sets a negative step', () => {
    const id = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    useAppStore.getState().setStep(id, -3)
    expect(useAppStore.getState().tabs[0].currentStep).toBe(0)
  })
})

describe('engine mode', () => {
  it('switching engine returns the tab to loading', () => {
    const id = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    useAppStore.getState().updateTab(id, { status: 'ready', engineMode: 'native-pptx' })
    useAppStore.getState().setEngineMode(id, 'libreoffice')
    const tab = useAppStore.getState().tabs[0]
    expect(tab.engineMode).toBe('libreoffice')
    expect(tab.status).toBe('loading')
    expect(tab.error).toBeNull()
  })

  it('updates only the targeted tab', () => {
    const a = useAppStore.getState().openTab('C:\\Decks\\A.pptx')
    const b = useAppStore.getState().openTab('C:\\Decks\\B.pptx')
    useAppStore.getState().updateTab(a, { pageCount: 7 })
    const state = useAppStore.getState()
    expect(state.tabs.find((t) => t.tabId === a)!.pageCount).toBe(7)
    expect(state.tabs.find((t) => t.tabId === b)!.pageCount).toBe(0)
  })
})
