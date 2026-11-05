/**
 * Pure launcher-window placement helpers. `electron/main.js` owns the
 * BrowserWindow and screen list; this module only normalizes persisted values
 * and fits a saved rectangle onto a display that still exists.
 */

export const DEFAULT_LAUNCHER_WINDOW = Object.freeze({
  x: null,
  y: null,
  width: 1400,
  height: 880,
  maximized: false,
})

const MIN_WIDTH = 320
const MAX_WIDTH = 7680
const MIN_HEIGHT = 240
const MAX_HEIGHT = 4320

function integerInRange(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function coordinate(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(value)
}

export function normalizeWindowPlacement(raw, fallback = DEFAULT_LAUNCHER_WINDOW) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_LAUNCHER_WINDOW
  return {
    x: coordinate(source.x, coordinate(base.x, null)),
    y: coordinate(source.y, coordinate(base.y, null)),
    width: integerInRange(source.width, integerInRange(base.width, DEFAULT_LAUNCHER_WINDOW.width, MIN_WIDTH, MAX_WIDTH), MIN_WIDTH, MAX_WIDTH),
    height: integerInRange(source.height, integerInRange(base.height, DEFAULT_LAUNCHER_WINDOW.height, MIN_HEIGHT, MAX_HEIGHT), MIN_HEIGHT, MAX_HEIGHT),
    maximized:
      typeof source.maximized === 'boolean'
        ? source.maximized
        : typeof base.maximized === 'boolean'
          ? base.maximized
          : false,
  }
}

function readWorkArea(display) {
  const area = display && typeof display === 'object' ? display.workArea || display.bounds : null
  if (!area || typeof area !== 'object') return null
  const x = coordinate(area.x, null)
  const y = coordinate(area.y, null)
  const width = integerInRange(area.width, 0, 1, MAX_WIDTH)
  const height = integerInRange(area.height, 0, 1, MAX_HEIGHT)
  if (x === null || y === null || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function fitToArea(placement, area) {
  const width = Math.max(1, Math.min(placement.width, area.width))
  const height = Math.max(1, Math.min(placement.height, area.height))
  return {
    width,
    height,
    x: Math.min(Math.max(placement.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(placement.y, area.y), area.y + area.height - height),
  }
}

/**
 * Fit a placement onto the closest visible display. A saved position wins when
 * it still touches a display; otherwise the nearest display is used and the
 * window is shifted inside its work area. A first-run placement without x/y is
 * centered on the first display.
 */
export function clampWindowPlacement(raw, displays, fallback = DEFAULT_LAUNCHER_WINDOW) {
  const placement = normalizeWindowPlacement(raw, fallback)
  const areas = (Array.isArray(displays) ? displays : []).map(readWorkArea).filter(Boolean)
  if (!areas.length) return { ...placement, x: null, y: null }

  if (placement.x === null || placement.y === null) {
    const area = areas[0]
    const width = Math.max(1, Math.min(placement.width, area.width))
    const height = Math.max(1, Math.min(placement.height, area.height))
    return {
      ...placement,
      width,
      height,
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
    }
  }

  let best = null
  for (const area of areas) {
    const fitted = fitToArea(placement, area)
    const dx = placement.x - fitted.x
    const dy = placement.y - fitted.y
    const distance = dx * dx + dy * dy
    if (!best || distance < best.distance) best = { ...fitted, distance }
  }

  return {
    ...placement,
    x: best.x,
    y: best.y,
    width: best.width,
    height: best.height,
  }
}
