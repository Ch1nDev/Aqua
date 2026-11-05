import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson, isPathInside, randomId } from './util.js'

export const RESET_CONFIRMATION = 'RESET'
export const RESET_BACKUP_FILE = 'config.before-reset.json'
export const RESET_MARKER_FILE = 'reset-complete.json'

// A preview must stay responsive even if a cache contains a very large tree.
// Applying the reset is not capped: it always tries to clear every owned entry.
const MAX_PREVIEW_ENTRIES = 50_000

export const RESET_CATEGORY_DEFINITIONS = [
  {
    id: 'settings',
    label: 'Launcher settings',
    description: 'Appearance, Java, memory, downloads, startup and window preferences',
  },
  {
    id: 'profiles',
    label: 'Profile metadata',
    description: 'Profile names and launch settings; game folders stay where they are',
  },
  {
    id: 'servers',
    label: 'Saved servers',
    description: 'Server names and addresses saved in Aqua',
  },
  {
    id: 'history',
    label: 'History and notifications',
    description: 'Activity, playtime sessions, crash records and notifications',
  },
  {
    id: 'caches',
    label: 'Launcher caches',
    description: 'Downloads, artwork and temporary files in the launcher cache',
  },
  {
    id: 'logs',
    label: 'Launcher and game logs',
    description: 'Launcher logs and copies of game logs',
  },
]

export const RESET_PRESERVED = [
  'Accounts and encrypted sign-in tokens',
  'Worlds, mods and other files inside game folders',
  'Backups and world snapshots',
  'Exported configuration JSON files',
  'Minecraft, Bedrock and Horizon installations',
]

function samePath(a, b) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function protectedResetRoots(paths) {
  return ['minecraftRoot', 'instancesRoot', 'backupsRoot', 'bedrockRoot', 'horizonRoot', 'runtimeRoot']
    .map((key) => (typeof paths[key] === 'string' ? path.resolve(paths[key]) : null))
    .filter(Boolean)
}

/**
 * Refuse any path that is not exactly one of the two launcher-owned roots.
 * This is deliberately stricter than a generic isPathInside check so a bad
 * caller cannot turn a reset into a delete-anything helper.
 */
function assertOwnedRoot(root, paths, kind) {
  const key = kind === 'caches' ? 'cacheRoot' : kind === 'logs' ? 'logsRoot' : null
  if (!key || typeof paths[key] !== 'string') throw new Error('That reset category is not supported.')
  const resolved = path.resolve(root)
  if (!samePath(resolved, paths[key])) throw new Error('Refusing to clear an unowned folder.')
  if (samePath(resolved, paths.dataRoot)) throw new Error('Refusing to clear the whole launcher data folder.')
  for (const blocked of protectedResetRoots(paths)) {
    if (isPathInside(resolved, blocked)) throw new Error('Refusing to clear a game-data folder.')
  }
  return { resolved, key }
}

function emptyScan() {
  return { bytes: 0, files: 0, skipped: 0, truncated: false }
}

/**
 * Measure a launcher-owned folder without following symlinks or junctions.
 * Junctions are a Windows reparse point that `lstat` can report as a directory,
 * so containment is checked with `realpath` as well.
 */
export async function measureResetDirectory(root) {
  const result = emptyScan()
  if (typeof root !== 'string' || !root) return result

  let rootStat
  try {
    rootStat = await fsp.lstat(root)
  } catch (error) {
    if (error.code === 'ENOENT') return result
    return { ...result, skipped: 1 }
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { ...result, skipped: 1 }

  let realRoot
  try {
    realRoot = await fsp.realpath(root)
  } catch {
    return { ...result, skipped: 1 }
  }
  if (!samePath(realRoot, root)) return { ...result, skipped: 1 }

  const visited = new Set([realRoot])
  const stack = [root]
  while (stack.length) {
    if (result.files + result.skipped >= MAX_PREVIEW_ENTRIES) {
      result.truncated = true
      break
    }
    const current = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      result.skipped += 1
      continue
    }
    for (const entry of entries) {
      if (result.files + result.skipped >= MAX_PREVIEW_ENTRIES) {
        result.truncated = true
        break
      }
      const target = path.join(current, entry.name)
      let stat
      try {
        stat = await fsp.lstat(target)
      } catch {
        result.skipped += 1
        continue
      }
      if (stat.isSymbolicLink()) {
        result.skipped += 1
        continue
      }
      if (stat.isDirectory()) {
        let real
        try {
          real = await fsp.realpath(target)
        } catch {
          result.skipped += 1
          continue
        }
        if (!isPathInside(real, realRoot) || visited.has(real)) {
          result.skipped += 1
          continue
        }
        visited.add(real)
        stack.push(target)
      } else if (stat.isFile()) {
        result.files += 1
        result.bytes += stat.size
      }
    }
  }
  return result
}

/**
 * Remove one entry without following a link out of `root`. A junction to a
 * folder outside the tree has its link removed, never its target.
 */
async function removeEntry(target, root, visited, warnings) {
  let stat
  try {
    stat = await fsp.lstat(target)
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push(`Could not inspect a file: ${error.code || error.message}`)
    return { bytes: 0, files: 0 }
  }

  if (stat.isSymbolicLink()) {
    try {
      await fsp.unlink(target)
    } catch (error) {
      warnings.push(`Could not remove a symbolic link: ${error.code || error.message}`)
    }
    return { bytes: 0, files: 0 }
  }

  if (stat.isDirectory()) {
    let real
    try {
      real = await fsp.realpath(target)
    } catch (error) {
      warnings.push(`Could not inspect a folder: ${error.code || error.message}`)
      return { bytes: 0, files: 0 }
    }
    if (!isPathInside(real, root) || visited.has(real)) {
      // Remove the junction itself (rmdir does not recurse) and leave its
      // target untouched. A mount point that refuses removal is reported.
      try {
        await fsp.rmdir(target)
      } catch (error) {
        warnings.push(`Could not remove a linked folder: ${error.code || error.message}`)
      }
      return { bytes: 0, files: 0 }
    }
    visited.add(real)
    let entries = []
    try {
      entries = await fsp.readdir(target, { withFileTypes: true })
    } catch (error) {
      warnings.push(`Could not read a folder: ${error.code || error.message}`)
      return { bytes: 0, files: 0 }
    }
    const total = { bytes: 0, files: 0 }
    for (const entry of entries) {
      const child = await removeEntry(path.join(target, entry.name), root, visited, warnings)
      total.bytes += child.bytes
      total.files += child.files
    }
    try {
      await fsp.rmdir(target)
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`Could not remove a folder: ${error.code || error.message}`)
    }
    return total
  }

  try {
    await fsp.unlink(target)
    return { bytes: stat.size, files: 1 }
  } catch (error) {
    warnings.push(`Could not remove a file: ${error.code || error.message}`)
    return { bytes: 0, files: 0 }
  }
}

/**
 * Clear only the launcher cache or log root. Missing folders are a no-op, and
 * every unreadable or linked entry is skipped with a warning rather than
 * followed out of the data root.
 */
export async function clearResetDirectory(root, paths, kind) {
  const { resolved } = assertOwnedRoot(root, paths, kind)
  const totals = { bytes: 0, files: 0, warnings: [] }

  let stat
  try {
    stat = await fsp.lstat(resolved)
  } catch (error) {
    if (error.code === 'ENOENT') return totals
    totals.warnings.push(`Could not inspect the ${kind} folder: ${error.code || error.message}`)
    return totals
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    totals.warnings.push(`The ${kind} folder is a link; it was left untouched.`)
    return totals
  }

  let realRoot
  try {
    realRoot = await fsp.realpath(resolved)
  } catch (error) {
    totals.warnings.push(`Could not inspect the ${kind} folder: ${error.code || error.message}`)
    return totals
  }
  if (!samePath(realRoot, resolved)) {
    totals.warnings.push(`The ${kind} folder is a link; it was left untouched.`)
    return totals
  }

  let entries
  try {
    entries = await fsp.readdir(resolved, { withFileTypes: true })
  } catch (error) {
    totals.warnings.push(`Could not read the ${kind} folder: ${error.code || error.message}`)
    return totals
  }
  const visited = new Set([realRoot])
  for (const entry of entries) {
    const removed = await removeEntry(path.join(resolved, entry.name), realRoot, visited, totals.warnings)
    totals.bytes += removed.bytes
    totals.files += removed.files
  }
  return totals
}

/**
 * Build the read-only preview used by the renderer. It only reads the store's
 * in-memory metadata and the two owned folders; it never writes anything.
 */
export async function buildResetPreview({ paths, store, blockedReason = null } = {}) {
  if (!paths || !store) throw new Error('Reset preview is not available.')
  const [cache, logs] = await Promise.all([
    measureResetDirectory(paths.cacheRoot),
    measureResetDirectory(paths.logsRoot),
  ])
  const historyCount =
    store.activity.length + store.sessions.length + store.notifications.length + store.crashes.length
  const categories = RESET_CATEGORY_DEFINITIONS.map((category) => {
    if (category.id === 'settings') return { ...category, count: null, bytes: 0, files: 0 }
    if (category.id === 'profiles') {
      return { ...category, count: store.installations.length, bytes: 0, files: 0 }
    }
    if (category.id === 'servers') return { ...category, count: store.servers.length, bytes: 0, files: 0 }
    if (category.id === 'history') return { ...category, count: historyCount, bytes: 0, files: 0 }
    if (category.id === 'caches') return { ...category, count: cache.files, bytes: cache.bytes, files: cache.files }
    return { ...category, count: logs.files, bytes: logs.bytes, files: logs.files }
  })

  return {
    generatedAt: new Date().toISOString(),
    confirmationWord: RESET_CONFIRMATION,
    categories,
    totalBytes: cache.bytes + logs.bytes,
    totalFiles: cache.files + logs.files,
    accountsPreserved: store.accounts.length,
    preserved: [...RESET_PRESERVED],
    skippedLinks: cache.skipped + logs.skipped,
    truncated: cache.truncated || logs.truncated,
    blockedReason: blockedReason ? String(blockedReason).slice(0, 400) : null,
    backupPath: path.join(paths.dataRoot, RESET_BACKUP_FILE),
  }
}

/**
 * Apply the reset after the service has validated the preview token and the
 * typed confirmation. The config backup happens before the store is changed,
 * so a failed write leaves the previous launcher configuration in place.
 */
export async function applySafeReset({ paths, store } = {}) {
  if (!paths || !store) throw new Error('Reset is not available.')
  const dataRoot = path.resolve(paths.dataRoot)
  const backupPath = path.join(dataRoot, RESET_BACKUP_FILE)

  try {
    await fsp.copyFile(paths.configFile, backupPath)
  } catch (error) {
    throw new Error(`Could not save the pre-reset configuration: ${error.code || error.message}`)
  }

  await store.resetLauncherData(structuredClone(store.defaults))

  const cache = await clearResetDirectory(paths.cacheRoot, paths, 'caches')
  const logs = await clearResetDirectory(paths.logsRoot, paths, 'logs')
  const warnings = [...cache.warnings, ...logs.warnings]
  const clearedAt = new Date().toISOString()
  let markerPath = null
  try {
    markerPath = path.join(dataRoot, RESET_MARKER_FILE)
    await atomicWriteJson(markerPath, {
      format: 'aqua-reset',
      version: 1,
      at: clearedAt,
      backup: RESET_BACKUP_FILE,
      removed: { bytes: cache.bytes + logs.bytes, files: cache.files + logs.files },
    })
  } catch (error) {
    markerPath = null
    warnings.push(`The reset finished, but its marker could not be written: ${error.code || error.message}`)
  }

  return {
    backupPath,
    markerPath,
    clearedAt,
    settings: store.settings,
    removed: { bytes: cache.bytes + logs.bytes, files: cache.files + logs.files },
    warnings,
  }
}

/**
 * Stateful guard around a preview. A reset can only be applied with the token
 * from the immediately preceding preview and the exact confirmation word.
 */
export class FactoryResetService {
  constructor({ paths, store, getBlockingActivity = () => null } = {}) {
    this.paths = paths
    this.store = store
    this.getBlockingActivity = getBlockingActivity
    this.pendingToken = null
  }

  async preview() {
    const blockedReason = await this.getBlockingActivity()
    const preview = await buildResetPreview({ paths: this.paths, store: this.store, blockedReason })
    this.pendingToken = randomId()
    return { ...preview, token: this.pendingToken }
  }

  async apply({ token, confirmation } = {}) {
    if (!this.pendingToken || typeof token !== 'string' || token !== this.pendingToken) {
      throw new Error('Review the reset again before applying it.')
    }
    if (confirmation !== RESET_CONFIRMATION) {
      throw new Error(`Type ${RESET_CONFIRMATION} exactly to confirm the reset.`)
    }
    const blockedReason = await this.getBlockingActivity()
    if (blockedReason) {
      this.pendingToken = null
      throw new Error(String(blockedReason).slice(0, 400))
    }
    this.pendingToken = null
    return applySafeReset({ paths: this.paths, store: this.store })
  }

  cancel() {
    const hadPreview = Boolean(this.pendingToken)
    this.pendingToken = null
    return hadPreview
  }
}
