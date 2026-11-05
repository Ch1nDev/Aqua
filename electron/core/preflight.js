const MB = 1024 * 1024
const GB = 1024 * MB
const BLOCKING_DISK_BYTES = 2 * GB
const WARN_DISK_BYTES = 5 * GB
const MEMORY_WARN_RATIO = 0.7

/** Health checks that stop a launch when they fail. */
const BLOCKING_CHECKS = new Set([
  'version-json',
  'client-jar',
  'asset-index',
  'libraries',
  'java',
  'java-arch',
  'memory',
  'game-dir',
])

const LEVEL_RANK = { error: 0, warn: 1 }

export function formatPreflightBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return 'Unknown'
  if (value >= GB) return `${(value / GB).toFixed(1)} GB`
  return `${Math.max(1, Math.round(value / MB))} MB`
}

/**
 * Pure launch gate. It turns the health cache plus the current system numbers
 * into at most a handful of rows the player can understand and act on.
 */
export function buildPreflight({ installation, health, system = {}, settings = {} } = {}) {
  if (!installation?.id) throw new Error('Installation is required.')

  const rows = []
  const checks = Array.isArray(health?.checks) ? health.checks : []
  const freeBytes = Number(system.freeBytes)
  const hasFreeBytes = Number.isFinite(freeBytes)

  for (const check of checks) {
    if (check.status !== 'error' || !BLOCKING_CHECKS.has(check.id)) continue
    // A current statfs reading is more precise than the cached health row.
    if (check.id === 'disk-space' && hasFreeBytes) continue
    rows.push({
      id: check.id,
      level: 'error',
      title: check.title,
      detail: check.detail,
      action: check.fix || { kind: 'open-settings', label: 'Open settings' },
    })
  }

  if (hasFreeBytes) {
    if (freeBytes < BLOCKING_DISK_BYTES) {
      rows.push({
        id: 'disk-free',
        level: 'error',
        title: 'Not enough free disk space',
        detail: `${formatPreflightBytes(freeBytes)} free on the game drive. Aqua requires at least 2 GB free before launching.`,
        action: { kind: 'open-folder', label: 'Open game folder' },
      })
    } else if (freeBytes < WARN_DISK_BYTES) {
      rows.push({
        id: 'disk-free',
        level: 'warn',
        title: 'Low disk space',
        detail: `${formatPreflightBytes(freeBytes)} free. Leave room for worlds, screenshots and game updates.`,
        action: { kind: 'open-folder', label: 'Open game folder' },
      })
    }
  }

  const memory = installation.memoryOverride || settings.memory
  const totalMemMb = Number(system.totalMemMb)
  const maxMb = Number(memory?.maxMb)
  if (
    Number.isFinite(maxMb) &&
    Number.isFinite(totalMemMb) &&
    totalMemMb > 0 &&
    maxMb > totalMemMb * MEMORY_WARN_RATIO &&
    maxMb <= totalMemMb &&
    !rows.some((row) => row.id === 'memory')
  ) {
    rows.push({
      id: 'memory',
      level: 'warn',
      title: 'Memory allocation is high',
      detail: `${maxMb} MB is more than 70% of the ${Math.round(totalMemMb / 1024)} GB installed. Windows and other apps may stutter.`,
      action: { kind: 'open-settings', label: 'Open memory settings' },
    })
  }

  rows.sort((a, b) => (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9))
  const status = rows.some((row) => row.level === 'error') ? 'error' : rows.length ? 'warn' : 'ok'

  return {
    installationId: installation.id,
    status,
    rows,
    checkedAt: new Date().toISOString(),
  }
}

export function canLaunchPreflight(result) {
  return !result?.rows?.some((row) => row.level === 'error')
}
