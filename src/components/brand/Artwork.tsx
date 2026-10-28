import { useEffect, useState } from 'react'
import { api, isDesktop } from '../../lib/api'
import { useArtworkSource } from '../../lib/artwork'
import { MinecraftLogo } from './Brand'

const BACKGROUND_CANDIDATES = [
  'artwork/background.png',
  'artwork/background.jpg',
  'artwork/background.jpeg',
  'artwork/background.webp',
]

const TITLE_CANDIDATES = ['artwork/title.png', 'artwork/title.webp', 'artwork/title.svg']

/** Mojang ships an image with every version's patch notes. */
function useVersionArtwork(versionId: string | null | undefined) {
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    if (!versionId || !isDesktop) return
    api.artwork
      .versionArt(versionId)
      .then((artwork) => {
        if (!cancelled && artwork?.dataUrl) setSource(artwork.dataUrl)
      })
      .catch(() => {
        // Offline, or Mojang never published art for this version.
      })
    return () => {
      cancelled = true
    }
  }, [versionId])

  return source
}

/**
 * The dashboard background: the selected version's update art when Mojang has
 * published one, and the bundled artwork from `public/artwork` otherwise.
 */
export function useHeroArtwork(versionId: string | null | undefined): string | null {
  const bundled = useArtworkSource(BACKGROUND_CANDIDATES)
  return useVersionArtwork(versionId) || bundled
}

export function TitleArtwork({
  height = 'clamp(46px, 5.4vw, 72px)',
  className = '',
}: {
  height?: string
  className?: string
}) {
  const source = useArtworkSource(TITLE_CANDIDATES)

  if (!source) return <MinecraftLogo height={height} className={className} />

  return (
    <img
      className={`title-artwork ${className}`}
      src={source}
      alt="Minecraft"
      style={{ height }}
      draggable={false}
    />
  )
}
