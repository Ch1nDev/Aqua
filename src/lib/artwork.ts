import { useEffect, useState } from 'react'

/**
 * Resolves the first asset that actually exists out of a candidate list, so
 * artwork dropped into `public/artwork` is used and a built-in fallback can be
 * rendered when it is not there.
 */
export function useArtworkSource(candidates: string[]) {
  const [source, setSource] = useState<string | null>(null)
  const key = candidates.join('|')

  useEffect(() => {
    let cancelled = false
    let index = 0

    const tryNext = () => {
      if (cancelled || index >= candidates.length) return
      const url = candidates[index]
      index += 1
      const image = new Image()
      image.onload = () => {
        if (!cancelled) setSource(url)
      }
      image.onerror = tryNext
      image.src = url
    }

    setSource(null)
    tryNext()
    return () => {
      cancelled = true
    }
    // The candidate list is a stable module constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return source
}
