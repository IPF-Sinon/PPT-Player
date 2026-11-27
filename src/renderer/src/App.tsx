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

  if (mode === 'preview') return <PreviewPage />
  // Playback is loaded on demand: it is only reachable once a deck is open, so its
  // bundle must not weigh on the first paint.
  const Playback = PlaybackLazy
  return <Playback />
}

const PlaybackLazy = lazy(() => import('./pages/Playback'))
