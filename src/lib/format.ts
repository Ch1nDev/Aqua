export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || bytesPerSecond < 1) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 5) return 'a few seconds'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatPlaytime(ms: number): string {
  if (!ms || ms < 60_000) return ms > 0 ? '<1m' : '0m'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return 'Never'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Unknown'
  const diff = Date.now() - time
  const future = diff < 0
  const seconds = Math.abs(diff) / 1000
  if (seconds < 60) return future ? 'In a moment' : 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return future ? `In ${minutes}m` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return future ? `In ${hours}h` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return future ? `In ${days}d` : `${days}d ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function elapsedSince(value: string | null | undefined): string {
  if (!value) return '0:00'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function versionTypeLabel(type: string): string {
  switch (type) {
    case 'release':
      return 'Release'
    case 'snapshot':
      return 'Snapshot'
    case 'old_beta':
      return 'Beta'
    case 'old_alpha':
      return 'Alpha'
    default:
      return type
  }
}

export function shortPath(value: string, maxLength = 48): string {
  if (value.length <= maxLength) return value
  const parts = value.split(/[\\/]/).filter(Boolean)
  const name = parts.at(-1) || value
  const parent = parts.at(-2)
  const tail = parent ? `${parent}\\${name}` : name
  if (tail.length + 2 <= maxLength) return `…\\${tail}`
  if (name.length <= maxLength) return name
  return `${name.slice(0, Math.max(maxLength - 1, 1))}…`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
