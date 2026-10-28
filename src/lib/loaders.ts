import type { LoaderType } from './types'

export const LOADER_OPTIONS: Array<{ id: LoaderType; label: string }> = [
  { id: 'vanilla', label: 'Vanilla' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
]

export const LOADER_LABELS: Record<LoaderType, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

export function loaderLabel(type: LoaderType | undefined | null) {
  if (!type) return 'Vanilla'
  return LOADER_LABELS[type] || 'Vanilla'
}
