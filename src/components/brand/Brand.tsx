import { useId, type ReactNode } from 'react'
import { useArtworkSource } from '../../lib/artwork'
import type { LoaderType } from '../../lib/types'

/** Simple emblem per mod loader, drawn in its own brand colours. */
const LOADER_MARKS: Record<LoaderType, ReactNode> = {
  vanilla: (
    <>
      <rect width="32" height="32" fill="#3f6b2f" />
      <rect x="3" y="10" width="26" height="6" fill="#7cc86a" />
      <rect x="3" y="16" width="26" height="13" fill="#6d4c33" />
    </>
  ),
  fabric: (
    <>
      <rect width="32" height="32" fill="#d9c9ad" />
      <rect x="5" y="5" width="9" height="9" fill="#b9a684" />
      <rect x="18" y="5" width="9" height="9" fill="#c6b592" />
      <rect x="5" y="18" width="9" height="9" fill="#c6b592" />
      <rect x="18" y="18" width="9" height="9" fill="#b9a684" />
    </>
  ),
  quilt: (
    <>
      <rect width="32" height="32" fill="#c9b4f7" />
      <rect x="4" y="11" width="10" height="10" fill="#a487e6" transform="rotate(45 9 16)" />
      <rect x="18" y="11" width="10" height="10" fill="#a487e6" transform="rotate(45 23 16)" />
    </>
  ),
  forge: (
    <>
      <rect width="32" height="32" fill="#5b6470" />
      <path d="M6 11h20v6l-4 2v5H10v-5l-4-2z" fill="#f0a35c" />
      <rect x="9" y="25" width="14" height="4" fill="#f0a35c" />
    </>
  ),
  neoforge: (
    <>
      <rect width="32" height="32" fill="#e8863c" />
      <path d="M18 4 9 18h6l-2 10 10-14h-6z" fill="#fff4e6" />
    </>
  ),
}

/**
 * Optional loader logos: drop `fabric.png`, `forge.png`, `neoforge.png` or
 * `quilt.png` into `public/artwork` and they replace the drawn emblems below.
 */
const LOADER_IMAGE_CANDIDATES: Record<LoaderType, string[]> = {
  vanilla: ['artwork/vanilla.png', 'artwork/vanilla.webp', 'artwork/vanilla.svg'],
  fabric: ['artwork/fabric.png', 'artwork/fabric.webp', 'artwork/fabric.svg'],
  quilt: ['artwork/quilt.png', 'artwork/quilt.webp', 'artwork/quilt.svg'],
  forge: ['artwork/forge.png', 'artwork/forge.webp', 'artwork/forge.svg'],
  neoforge: ['artwork/neoforge.png', 'artwork/neoforge.webp', 'artwork/neoforge.svg'],
}

export function LoaderMark({
  type,
  size = 26,
  className,
}: {
  type: LoaderType
  size?: number
  className?: string
}) {
  const logo = useArtworkSource(LOADER_IMAGE_CANDIDATES[type] || [])

  return (
    <span
      className={[`loader-mark`, logo && 'loader-mark--logo', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {logo ? (
        <img src={logo} alt="" draggable={false} />
      ) : (
        <svg viewBox="0 0 32 32" width={size} height={size}>
          {LOADER_MARKS[type] || LOADER_MARKS.vanilla}
        </svg>
      )}
    </span>
  )
}

/**
 * The icon for a profile: a modpack's own Modrinth artwork when the profile came
 * from a pack, otherwise the artwork of its mod loader (vanilla included).
 */
export function PackIcon({
  modpack,
  loader = 'vanilla',
  size = 26,
  className,
}: {
  modpack?: { iconUrl: string | null } | null
  loader?: LoaderType
  size?: number
  className?: string
}) {
  const art = modpack?.iconUrl
  if (art) {
    return (
      <img
        className={['pack-art', className].filter(Boolean).join(' ')}
        src={art}
        alt=""
        loading="lazy"
        draggable={false}
      />
    )
  }
  return <LoaderMark type={loader} size={size} className={className} />
}

/** The launcher's own artwork, served from the bundled icons. */
export function AppIcon({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <img
      className={className ? `app-icon ${className}` : 'app-icon'}
      src="icon.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

/** The Aqua wordmark: the launcher's name artwork in its blocky brand style. */
export function AquaWordmark({ className }: { className?: string }) {
  return (
    <img
      className={className ? `aqua-wordmark ${className}` : 'aqua-wordmark'}
      src="artwork/aqua/aquawordmark.png"
      alt="Aqua Launcher"
      draggable={false}
    />
  )
}

export function CubeMark({ size = 34 }: { size?: number }) {
  return (
    <span className="cube-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <rect width="32" height="32" rx="8" fill="var(--panel-3)" />
        <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.08)" />
        <path d="M16 6 26 11.6 16 17.2 6 11.6Z" fill="var(--accent)" />
        <path d="M6 11.6 16 17.2 16 25 6 19.4Z" fill="#4a7f9e" />
        <path d="M26 11.6 16 17.2 16 25 26 19.4Z" fill="#35617a" />
        <path d="M6 14.2 16 19.8 16 22 6 16.4Z" fill="#3b5462" opacity="0.9" />
        <path d="M26 14.2 16 19.8 16 22 26 16.4Z" fill="#2e414d" opacity="0.9" />
      </svg>
    </span>
  )
}

const GLYPHS: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
}

const WORD = 'MINECRAFT'
const GLYPH_WIDTH = 5
const GLYPH_HEIGHT = 7
const GAP = 1.2
const TOTAL_WIDTH = WORD.length * GLYPH_WIDTH + (WORD.length - 1) * GAP

export function MinecraftLogo({
  height = 'clamp(40px, 5vw, 68px)',
  className,
  tagline = true,
}: {
  height?: string
  className?: string
  tagline?: boolean
}) {
  const gradientId = useId().replace(/:/g, '')
  const pixels: Array<{ key: string; x: number; y: number }> = []
  let cursor = 0
  for (const letter of WORD) {
    const glyph = GLYPHS[letter]
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (glyph[row][column] === '1') {
          pixels.push({ key: `${letter}-${row}-${column}`, x: cursor + column, y: row })
        }
      }
    }
    cursor += GLYPH_WIDTH + GAP
  }

  return (
    <div className={`minecraft-logo ${className || ''}`} aria-label="Minecraft Java Edition" role="img">
      <svg
        viewBox={`-0.4 -0.4 ${TOTAL_WIDTH + 0.8} ${GLYPH_HEIGHT + 1.2}`}
        style={{ height }}
        preserveAspectRatio="xMinYMin meet"
      >
        <defs>
          <linearGradient id={`mc-face-${gradientId}`} x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stopColor="#e8ffdd" />
            <stop offset="28%" stopColor="#b9f3a0" />
            <stop offset="70%" stopColor="#7be06d" />
            <stop offset="100%" stopColor="#54b94c" />
          </linearGradient>
          <linearGradient id={`mc-side-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4c9e4d" />
            <stop offset="100%" stopColor="#2c642f" />
          </linearGradient>
          <filter id={`mc-shadow-${gradientId}`} x="-10%" y="-20%" width="120%" height="150%">
            <feDropShadow dx="0" dy="0.35" stdDeviation="0.35" floodColor="#020a04" floodOpacity="0.75" />
          </filter>
        </defs>
        <g opacity="0.58">
          {pixels.map((pixel) => (
            <rect
              key={`extrude-${pixel.key}`}
              x={pixel.x + 0.25}
              y={pixel.y + 0.42}
              width={0.92}
              height={0.92}
              fill={`url(#mc-side-${gradientId})`}
            />
          ))}
        </g>
        <g filter={`url(#mc-shadow-${gradientId})`}>
          {pixels.map((pixel) => (
            <rect
              key={pixel.key}
              x={pixel.x}
              y={pixel.y}
              width={0.92}
              height={0.92}
              fill={`url(#mc-face-${gradientId})`}
            />
          ))}
        </g>
        <g opacity="0.3">
          {pixels
            .filter((pixel) => pixel.y === 0)
            .map((pixel) => (
              <rect
                key={`highlight-${pixel.key}`}
                x={pixel.x}
                y={pixel.y}
                width={0.92}
                height={0.17}
                fill="#ffffff"
              />
            ))}
        </g>
      </svg>
      {tagline ? <span className="minecraft-logo__tag">Java Edition</span> : null}
    </div>
  )
}

interface CubeSpec {
  x: number
  y: number
  tileWidth: number
  tileHeight: number
  depth: number
  tone: 'grass' | 'soil' | 'water' | 'leaf' | 'trunk'
  opacity?: number
}

function isoCube({ x, y, tileWidth, tileHeight, depth, tone, opacity = 1 }: CubeSpec) {
  const top = `M ${x} ${y - tileHeight / 2} L ${x + tileWidth / 2} ${y} L ${x} ${y + tileHeight / 2} L ${x - tileWidth / 2} ${y} Z`
  const left = `M ${x - tileWidth / 2} ${y} L ${x} ${y + tileHeight / 2} L ${x} ${y + tileHeight / 2 + depth} L ${
    x - tileWidth / 2
  } ${y + depth} Z`
  const right = `M ${x + tileWidth / 2} ${y} L ${x} ${y + tileHeight / 2} L ${x} ${y + tileHeight / 2 + depth} L ${
    x + tileWidth / 2
  } ${y + depth} Z`
  const fills: Record<CubeSpec['tone'], [string, string, string]> = {
    grass: ['url(#voxel-grass-top)', 'url(#voxel-grass-left)', 'url(#voxel-grass-right)'],
    soil: ['#4a3b2b', '#403326', '#33281e'],
    water: ['#67d8d0', '#3a9aa0', '#2f7c86'],
    leaf: ['#6bb45f', '#4c8d47', '#3a7139'],
    trunk: ['#7a5c3e', '#604832', '#4b3827'],
  }
  const [topFill, leftFill, rightFill] = fills[tone]
  return (
    <g opacity={opacity}>
      <path d={left} fill={leftFill} />
      <path d={right} fill={rightFill} />
      <path d={top} fill={topFill} stroke="rgba(7,16,10,0.28)" strokeWidth="0.7" />
    </g>
  )
}

export function VoxelScene({ className }: { className?: string }) {
  const grid = [
    [0, 0, 1, 0, 0],
    [0, 1, 2, 1, 0],
    [1, 2, 2, 1, 1],
    [0, 1, 2, 1, 0],
    [0, 0, 1, 0, 0],
  ]
  const tileWidth = 76
  const tileHeight = 38
  const originX = 330
  const originY = 214
  const cubes: Array<CubeSpec & { key: string }> = []
  for (let z = 0; z < grid.length; z += 1) {
    for (let x = 0; x < grid[z].length; x += 1) {
      const height = grid[z][x]
      if (!height) continue
      const screenX = originX + (x - z) * (tileWidth / 2)
      const screenY = originY + (x + z) * (tileHeight / 2) - height * 10
      const isWater = x === 3 && z === 2
      cubes.push({
        key: `cube-${x}-${z}`,
        x: screenX,
        y: screenY,
        tileWidth,
        tileHeight,
        depth: 40 + height * 20,
        tone: isWater ? 'water' : 'grass',
        opacity: 0.94,
      })
    }
  }
  cubes.sort((a, b) => a.x + a.y - (b.x + b.y))

  const smallCubes: Array<CubeSpec & { key: string }> = []
  // A small blocky tree on the ridge.
  const treeX = originX + (2 - 1) * (tileWidth / 2)
  const treeY = originY + (2 + 1) * (tileHeight / 2) - 2 * 10
  smallCubes.push({ key: 'trunk-1', x: treeX, y: treeY - 18, tileWidth: 14, tileHeight: 7, depth: 34, tone: 'trunk' })
  smallCubes.push({ key: 'trunk-2', x: treeX, y: treeY - 33, tileWidth: 14, tileHeight: 7, depth: 24, tone: 'trunk' })
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue
      smallCubes.push({
        key: `leaf-${dx}-${dz}`,
        x: treeX + dx * 19,
        y: treeY - 58 + dz * 10,
        tileWidth: 24,
        tileHeight: 12,
        depth: 18,
        tone: 'leaf',
        opacity: 0.9,
      })
    }
  }
  smallCubes.push({ key: 'leaf-top', x: treeX, y: treeY - 72, tileWidth: 26, tileHeight: 13, depth: 19, tone: 'leaf' })
  smallCubes.sort((a, b) => a.x + a.y - (b.x + b.y))
  return (
    <svg className={`voxel-scene ${className || ''}`} viewBox="0 0 660 460" aria-hidden="true">
      <defs>
        <linearGradient id="voxel-grass-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#86d878" />
          <stop offset="100%" stopColor="#58b057" />
        </linearGradient>
        <linearGradient id="voxel-grass-left" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5a7a4c" />
          <stop offset="35%" stopColor="#67563d" />
          <stop offset="100%" stopColor="#41352a" />
        </linearGradient>
        <linearGradient id="voxel-grass-right" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4c6942" />
          <stop offset="35%" stopColor="#54452f" />
          <stop offset="100%" stopColor="#332a20" />
        </linearGradient>
      </defs>
      <g className="voxel-clouds">
        <g fill="#d7e8dc" opacity="0.1">
          <rect x="390" y="82" width="84" height="18" rx="2" />
          <rect x="414" y="64" width="58" height="18" rx="2" />
          <rect x="470" y="100" width="42" height="16" rx="2" />
          <rect x="120" y="130" width="58" height="14" rx="2" opacity="0.8" />
          <rect x="96" y="144" width="38" height="12" rx="2" opacity="0.7" />
        </g>
      </g>
      <g className="voxel-island" opacity="0.92">
        {cubes.map((cube) => (
          <g key={cube.key}>{isoCube(cube)}</g>
        ))}
      </g>
      <g className="voxel-tree" opacity="0.9">
        {smallCubes.map((cube) => (
          <g key={cube.key}>{isoCube(cube)}</g>
        ))}
      </g>
      <g opacity="0.55">
        <path d="M214 318 L258 340 L258 372 L214 350 Z" fill="#3b2d21" />
        <path d="M302 330 L346 352 L346 388 L302 366 Z" fill="#33281e" />
        <path d="M470 300 L508 320 L508 346 L470 326 Z" fill="#3b2d21" />
      </g>
    </svg>
  )
}
