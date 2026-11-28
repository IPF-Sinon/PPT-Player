import { lazy, useEffect, useState } from 'react'
import PreviewPage from './pages/Preview'
import { platform } from './platform/api'

type Mode = 'preview' | 'playback'

export default function App() {
  const [mode, setMode] = useState<Mode>('preview')

  useEffect(() => {
    const off = platform().onPlayState((state) => {
      setMode(state.active ? 'playback' : 'preview')
    })
    return off
  }, [])

  // Tell the shell the UI is up. The smoke test waits for this and nothing else: a
  // window exists before the renderer runs, so a window is not proof of a working
  // build, but this marker is.
  useEffect(() => {
    void platform().reportReady()
  }, [])

  if (mode === 'preview') return <PreviewPage />
  // Playback is loaded on demand: it is only reachable once a deck is open, so its
  // bundle must not weigh on the first paint.
  const Playback = PlaybackLazy
  return <Playback />
}

const PlaybackLazy = lazy(() => import('./pages/Playback'))
