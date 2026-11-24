import { create } from 'zustand'
import type { DeckInfo, EngineStatus, InkPage } from '@shared/types'
import type { PdfDocumentProxyLike } from './lib/pdf'

export interface DeckState {
  info: DeckInfo | null
  doc: PdfDocumentProxyLike | null
  url: string | null
}

interface AppState {
  engine: EngineStatus | null
  deck: DeckState
  currentPage: number
  loading: boolean
  loadingMessage: string
  loadingRatio: number
  error: { message: string; detail?: string } | null
  drawerOpen: boolean
  ink: InkPage[]
  setEngine: (engine: EngineStatus | null) => void
  setDeck: (deck: DeckState) => void
  setPage: (page: number) => void
  setLoading: (loading: boolean, message?: string, ratio?: number) => void
  setError: (error: { message: string; detail?: string } | null) => void
  toggleDrawer: (open?: boolean) => void
  setInk: (ink: InkPage[]) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set) => ({
  engine: null,
  deck: { info: null, doc: null, url: null },
  currentPage: 0,
  loading: false,
  loadingMessage: '',
  loadingRatio: 0,
  error: null,
  drawerOpen: false,
  ink: [],
  setEngine: (engine) => set({ engine }),
  setDeck: (deck) => set({ deck }),
  setPage: (page) => set({ currentPage: page }),
  setLoading: (loading, message = '', ratio = 0) =>
    set({ loading, loadingMessage: message, loadingRatio: ratio }),
  setError: (error) => set({ error }),
  toggleDrawer: (open) => set((s) => ({ drawerOpen: open ?? !s.drawerOpen })),
  setInk: (ink) => set({ ink }),
  reset: () =>
    set({
      deck: { info: null, doc: null, url: null },
      currentPage: 0,
      error: null,
      ink: [],
      loading: false
    })
}))
