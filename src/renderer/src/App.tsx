import { useEffect, useState } from 'react'
import PreviewPage from './pages/Preview'
import PlaybackPage from './pages/Playback'

type Route = 'preview' | 'playback'

function routeFromHash(): Route {
  return window.location.hash.replace('#', '') === 'playback' ? 'playback' : 'preview'
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)

  useEffect(() => {
    const onHashChange = (): void => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return route === 'playback' ? <PlaybackPage /> : <PreviewPage />
}
