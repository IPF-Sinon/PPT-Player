/**
 * Subscribe a component to a prepared document.
 *
 * Preparing is memoised per deck, so several components asking for the same
 * document share one parse and one measurement; this hook only adds the React
 * state that makes a component re-render when the work finishes.
 */

import { useEffect, useState } from 'react'
import { platform } from '../../platform/api'
import { preparedDocx, prepareDocx, type PreparedDocx } from './registry'

/**
 * The prepared document for a deck, or null while it is still being prepared.
 *
 * The enabled flag exists so a caller can hold the hook unconditionally, as hooks
 * require, without preparing a document for a deck that is not one.
 */
export function useDocx(deckId: string, enabled: boolean): PreparedDocx | null {
  const [prepared, setPrepared] = useState<PreparedDocx | null>(() =>
    enabled && deckId ? preparedDocx(deckId) : null
  )

  useEffect(() => {
    if (!enabled || !deckId) {
      setPrepared(null)
      return
    }
    const already = preparedDocx(deckId)
    if (already) {
      setPrepared(already)
      return
    }
    let cancelled = false
    void prepareDocx(deckId, platform()).then((value) => {
      if (!cancelled) setPrepared(value)
    })
    return () => {
      cancelled = true
    }
  }, [deckId, enabled])

  return prepared
}
