import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInside } from './util.js'
import { effectiveVersionId } from './installations.js'

/**
 * Disk usage accounting for the launcher data folder.
 *
 * Nothing here imports Electron: the recycle bin is injected as `trashItem` so the
 * module stays testable with plain temp directories. Permanent deletion is
 * deliberately not implemented — cleanup always goes through the OS recycle bin.
 *
 * Two ground rules are enforced here rather than in the UI: worlds, mods,
 * resource packs and configs are never cleanup candidates, and the renderer never
 * sends a path. It sends candidate ids, and the service recomputes which paths it
 * is willing to touch.
 */

/** Files counted before a scan gives up and reports itself as truncated. */
const MAX_ENTRIES = 500_000
/** Game and rotated launcher logs older than this are offered for cleanup. */
const MAX_LOG_AGE_DAYS = 7
/** Backups per installation that cleanup keeps even when asked. */
const BACKUP_KEEP = 5
/** Partial downloads younger than this may still be in flight. */
const PARTIAL_MIN_AGE_MS = 60 * 60 * 1000
/** How long a finished scan is reused before the next request rescans. */
const SCAN_CACHE_MS = 60_000
const PROGRESS_INTERVAL_MS = 250
const MAX_CLEAN_IDS = 50

const PARTIAL_SUFFIXES = ['.part', '.tmp', '.partial', '.download', '.crdownload']

/** Category definitions in display order. Roots are resolved per scan. */
const CATEGORY_LAYOUT = [
  {
    id: 'instances',
    label: 'Installations',
    explanation: 'Every profile game folder: worlds, mods, resource packs, screenshots and configs.',
  },
  {
    id: 'versions',
    label: 'Game versions',
    explanation: 'Downloaded Minecraft version folders, including loader profiles.',
  },
  {
    id: 'libraries',
    label: 'Libraries',
    explanation: 'Java libraries and natives the game loads at startup.',
  },
  {
    id: 'assets',
    label: 'Assets',
    explanation: 'Sounds, languages and textures shared by every version.',
  },
  {
    id: 'backups',
    label: 'World backups',
    explanation: 'ZIP backups created by the launcher. Restoring an old world needs these.',
  },
  {
    id: 'game-logs',
    label: 'Game logs',
    explanation: 'Logs Minecraft wrote during your sessions. Useful when reporting a crash.',
  },
  {
    id: 'launcher-logs',
    label: 'Launcher log',
    explanation: 'What the launcher itself recorded. Handy for support, safe to clear.',
  },
  {
    id: 'caches',
    label: 'Caches',
    explanation: 'Artwork, avatars and version metadata. Everything here is rebuilt on demand.',
  },
  {
    id: 'bedrock',
    label: 'Bedrock files',
    explanation: 'Bedrock Store downloads and registered version packages.',
  },
]

function emptyTally() {
  return { bytes: 0, files: 0 }
}

function emptyRun(service) {
  return {
    seen: new Set(),
    entries: 0,
    unreadable: 0,
    truncated: false,
    get aborted() {
      return Boolean(service?.aborted)
    },
  }
}

/**
 * Adds one file to a tally. Hardlinks are counted once per scan, so totals stay
 * close to what the disk holds; the first category to see a file claims its bytes.
 */
function addToTally(tally, stat, run) {
  const key = stat.ino ? `${stat.dev}:${stat.ino}` : null
  if (key) {
    if (run.seen.has(key)) return
    run.seen.add(key)
  }
  tally.bytes += stat.size
  tally.files += 1
}

/**
 * Walks a file or directory into `tally`. Never follows symlinks and never throws
 * for an entry it cannot read; unreadable folders are counted instead.
 */
async function measureTree(root, tally, run) {
  if (!root) return tally
  let stat
  try {
    stat = await fsp.stat(root)
  } catch {
    return tally
  }
  if (stat.isFile()) {
    run.entries += 1
    addToTally(tally, stat, run)
    return tally
  }
  if (!stat.isDirectory()) return tally

  const stack = [root]
  while (stack.length) {
    if (run.aborted || run.truncated) return tally
    const dir = stack.pop()
    let handle
    try {
      handle = await fsp.opendir(dir)
    } catch {
      run.unreadable += 1
      continue
    }
    try {
      for await (const entry of handle) {
        if (run.aborted || run.truncated) break
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (!entry.isFile()) continue
        let fileStat
        try {
          fileStat = await fsp.lstat(full)
        } catch {
          run.unreadable += 1
          continue
        }
        if (!fileStat.isFile()) continue
        run.entries += 1
        if (run.entries > MAX_ENTRIES) {
          run.truncated = true
          break
        }
        addToTally(tally, fileStat, run)
      }
    } finally {
      await handle.close().catch(() => {})
    }
  }
  return tally
}

/** Drops roots that sit inside another root, so nothing is measured twice. */
export function uniqueRoots(roots) {
  const absolute = [...new Set((roots || []).filter(Boolean).map((root) => path.resolve(root)))]
  return absolute.filter(
    (candidate) => !absolute.some((other) => other !== candidate && isPathInside(candidate, other)),
  )
}

function categoryRoots(paths, installations) {
  return {
    instances: uniqueRoots(installations.map((installation) => installation.gameDir)),
    versions: [paths.versionsRoot],
    libraries: [paths.librariesRoot],
    assets: [paths.assetsRoot],
    backups: [paths.backupsRoot],
    'game-logs': [paths.gameLogsRoot],
    'launcher-logs': [paths.launcherLog],
    caches: [paths.cacheRoot],
    bedrock: [paths.bedrockRoot],
  }
}

async function listDirectory(target) {
  try {
    return await fsp.readdir(target, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * The current launcher log plus every rolled-over copy. Rotated logs have to be
 * measured here or they would sit on disk without appearing in any category.
 */
async function launcherLogRoots(paths) {
  const roots = [paths.launcherLog]
  for (const entry of await listDirectory(paths.logsRoot)) {
    if (entry.isFile() && entry.name.startsWith('launcher.log.')) {
      roots.push(path.join(paths.logsRoot, entry.name))
    }
  }
  return roots
}

async function statSafe(target) {
  try {
    return await fsp.stat(target)
  } catch {
    return null
  }
}

/** Size of a set of standalone paths, without the scan's shared dedupe set. */
async function measurePaths(roots) {
  const tally = emptyTally()
  const run = emptyRun(null)
  for (const root of roots) await measureTree(root, tally, run)
  return tally
}

export class StorageService {
  constructor({ paths, store, logger, trashItem, emitProgress = () => {} }) {
    this.paths = paths
    this.store = store
    this.logger = logger
    this.trashItem = trashItem
    this.emitProgress = emitProgress
    this.lastScan = null
    this.running = null
    this.aborted = false
    this.lastProgressAt = 0
  }

  get installations() {
    return this.store?.installations || []
  }

  emit(payload) {
    const now = Date.now()
    if (now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return
    this.lastProgressAt = now
    this.emitProgress(payload)
  }

  cancel() {
    this.aborted = true
    return { cancelled: true }
  }

  /**
   * Measures every launcher-owned folder. Concurrent callers share the in-flight
   * scan; a finished scan is reused for a minute unless `force` is set.
   */
  async scan({ force = false } = {}) {
    if (this.running) return this.running
    if (!force && this.lastScan && Date.now() - this.lastScan.finishedAt < SCAN_CACHE_MS) {
      return this.lastScan.result
    }
    this.running = this.runScan().finally(() => {
      this.running = null
    })
    return this.running
  }

  async runScan() {
    const startedAt = Date.now()
    this.aborted = false
    const run = emptyRun(this)
    const roots = categoryRoots(this.paths, this.installations)
    roots['launcher-logs'] = await launcherLogRoots(this.paths)
    const categories = []

    for (const definition of CATEGORY_LAYOUT) {
      if (this.aborted) break
      this.emit({ phase: 'scan', label: definition.label, categories: categories.length })
      const tally = emptyTally()
      const list = roots[definition.id] || []
      for (const root of list) {
        await measureTree(root, tally, run)
        if (this.aborted || run.truncated) break
      }
      categories.push({
        id: definition.id,
        label: definition.label,
        explanation: definition.explanation,
        path: list[0] || null,
        bytes: tally.bytes,
        files: tally.files,
      })
      if (this.aborted || run.truncated) break
    }

    const complete = categories.length === CATEGORY_LAYOUT.length
    const result = {
      scannedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
      files: categories.reduce((sum, category) => sum + category.files, 0),
      categories,
      candidates: complete ? await this.listCleanupCandidates() : [],
      truncated: run.truncated,
      cancelled: this.aborted,
      unreadable: run.unreadable,
    }

    this.emit({ phase: 'scan', done: true, categories: categories.length })
    if (complete) this.lastScan = { finishedAt: Date.now(), result }
    this.logger?.info('Storage scan finished', {
      totalBytes: result.totalBytes,
      files: result.files,
      durationMs: result.durationMs,
      cancelled: result.cancelled,
    })
    return result
  }

  /**
   * Internal candidate list, including the paths each item owns. Measurements are
   * taken at call time so a stale renderer list cannot remove something whose
   * meaning has changed since.
   */
  async collectCandidates({ includeBackups = false } = {}) {
    const candidates = []
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000
    const partialCutoff = Date.now() - PARTIAL_MIN_AGE_MS

    const cacheTargets = [
      {
        id: 'cache:artwork',
        label: 'Artwork cache',
        roots: [this.paths.artworkCacheRoot],
        reason: 'Version and drop artwork. Downloaded again for the next tile you open.',
      },
      {
        id: 'cache:avatars',
        label: 'Avatar cache',
        roots: [this.paths.avatarCacheRoot],
        reason: 'Account profile pictures. Fetched again when an account loads.',
      },
      {
        id: 'cache:version-art',
        label: 'Version art cache',
        roots: [this.paths.versionCacheRoot],
        reason: 'Cached release art. Regenerated when you open the versions page.',
      },
      {
        id: 'cache:metadata',
        label: 'Metadata caches',
        roots: [
          this.paths.manifestCacheFile,
          this.paths.patchNotesCacheFile,
          this.paths.dropsCacheFile,
          this.paths.bedrockVersionsCacheFile,
        ],
        reason: 'Version lists and patch notes. Fetched again from Mojang.',
      },
    ]

    for (const target of cacheTargets) {
      const tally = await measurePaths(target.roots)
      if (!tally.files) continue
      candidates.push({
        id: target.id,
        kind: 'cache',
        label: target.label,
        bytes: tally.bytes,
        files: tally.files,
        safeByDefault: true,
        reason: target.reason,
        root: this.paths.cacheRoot,
        paths: target.roots,
      })
    }

    // Downloads that were interrupted. Anything recent may still be writing.
    const partialFiles = []
    let partialBytes = 0
    for (const entry of await listDirectory(this.paths.cacheRoot)) {
      if (!entry.isFile()) continue
      if (!PARTIAL_SUFFIXES.some((suffix) => entry.name.toLowerCase().endsWith(suffix))) continue
      const full = path.join(this.paths.cacheRoot, entry.name)
      const stat = await statSafe(full)
      if (!stat || stat.mtimeMs >= partialCutoff) continue
      partialFiles.push(full)
      partialBytes += stat.size
    }
    if (partialFiles.length) {
      candidates.push({
        id: 'cache:partial',
        kind: 'cache',
        label: 'Interrupted downloads',
        bytes: partialBytes,
        files: partialFiles.length,
        safeByDefault: true,
        reason: 'Part files left behind by downloads that never finished.',
        root: this.paths.cacheRoot,
        paths: partialFiles,
      })
    }

    const oldGameLogs = []
    let gameLogBytes = 0
    for (const entry of await listDirectory(this.paths.gameLogsRoot)) {
      if (!entry.isFile()) continue
      const full = path.join(this.paths.gameLogsRoot, entry.name)
      const stat = await statSafe(full)
      if (!stat || stat.mtimeMs >= cutoff) continue
      oldGameLogs.push(full)
      gameLogBytes += stat.size
    }
    if (oldGameLogs.length) {
      candidates.push({
        id: 'logs:game',
        kind: 'logs',
        label: `Game logs older than ${MAX_LOG_AGE_DAYS} days`,
        bytes: gameLogBytes,
        files: oldGameLogs.length,
        safeByDefault: true,
        reason: 'Recent sessions keep their logs; these are older than a week.',
        root: this.paths.gameLogsRoot,
        paths: oldGameLogs,
      })
    }

    const rotatedLogs = []
    let rotatedBytes = 0
    for (const entry of await listDirectory(this.paths.logsRoot)) {
      if (!entry.isFile() || !entry.name.startsWith('launcher.log.')) continue
      const full = path.join(this.paths.logsRoot, entry.name)
      const stat = await statSafe(full)
      if (!stat || stat.mtimeMs >= cutoff) continue
      rotatedLogs.push(full)
      rotatedBytes += stat.size
    }
    if (rotatedLogs.length) {
      candidates.push({
        id: 'logs:launcher',
        kind: 'logs',
        label: `Rotated launcher logs older than ${MAX_LOG_AGE_DAYS} days`,
        bytes: rotatedBytes,
        files: rotatedLogs.length,
        safeByDefault: true,
        reason: 'The current launcher log is kept; these are the rolled-over ones.',
        root: this.paths.logsRoot,
        paths: rotatedLogs,
      })
    }

    // Versions no installation points at. Never safe by default: a profile can be
    // re-pointed at one, and the folder is an expensive download.
    const referenced = new Set(this.installations.map((installation) => effectiveVersionId(installation)))
    const unusedVersions = []
    let unusedBytes = 0
    for (const entry of await listDirectory(this.paths.versionsRoot)) {
      if (!entry.isDirectory() || referenced.has(entry.name)) continue
      const full = path.join(this.paths.versionsRoot, entry.name)
      const tally = await measurePaths([full])
      if (!tally.files) continue
      unusedVersions.push(full)
      unusedBytes += tally.bytes
    }
    if (unusedVersions.length) {
      candidates.push({
        id: 'versions:unused',
        kind: 'versions',
        label: 'Versions no installation uses',
        bytes: unusedBytes,
        files: unusedVersions.length,
        safeByDefault: false,
        reason: 'Removing these means downloading them again if a profile needs them.',
        root: this.paths.versionsRoot,
        paths: unusedVersions,
      })
    }

    if (includeBackups) {
      const oldBackups = []
      let backupBytes = 0
      for (const installation of this.installations) {
        const directory = path.join(this.paths.backupsRoot, installation.id)
        const archives = []
        for (const entry of await listDirectory(directory)) {
          if (!entry.isFile() || !entry.name.endsWith('.zip')) continue
          const full = path.join(directory, entry.name)
          const stat = await statSafe(full)
          if (stat) archives.push({ full, stat })
        }
        archives.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
        for (const archive of archives.slice(BACKUP_KEEP)) {
          oldBackups.push(archive.full)
          backupBytes += archive.stat.size
        }
      }
      if (oldBackups.length) {
        candidates.push({
          id: 'backups:old',
          kind: 'backups',
          label: `World backups beyond the newest ${BACKUP_KEEP} per installation`,
          bytes: backupBytes,
          files: oldBackups.length,
          safeByDefault: false,
          reason: 'A deleted backup is the only copy of that world if the world itself is gone.',
          root: this.paths.backupsRoot,
          paths: oldBackups,
        })
      }
    }

    return candidates
  }

  /** Candidate list for the renderer: no filesystem paths, only what it displays. */
  async listCleanupCandidates(options) {
    const candidates = await this.collectCandidates(options)
    return candidates.map(({ paths: _paths, ...candidate }) => candidate)
  }

  /**
   * Moves the selected candidates to the recycle bin. Ids resolve against a fresh
   * candidate list, and every path is re-checked against the launcher data root
   * and the installations' game directories before anything is touched.
   */
  async clean({ ids, includeBackups = false } = {}) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Choose at least one item to clean up.')
    if (ids.length > MAX_CLEAN_IDS) throw new Error('Too many items selected at once.')
    if (typeof this.trashItem !== 'function') throw new Error('Cleanup is not available in this build.')

    const wanted = new Set(ids.map((id) => String(id)))
    const candidates = (await this.collectCandidates({ includeBackups })).filter((candidate) =>
      wanted.has(candidate.id),
    )
    if (!candidates.length) throw new Error('Nothing to clean up — rescan and try again.')

    const dataRoot = path.resolve(this.paths.dataRoot)
    const protectedRoots = uniqueRoots(this.installations.map((installation) => installation.gameDir))
    const removed = []
    const failed = []
    let freedBytes = 0
    let done = 0

    for (const candidate of candidates) {
      let candidateBytes = 0
      let candidateFiles = 0
      for (const target of candidate.paths || []) {
        const resolved = path.resolve(target)
        // Launcher-owned, but never a game directory or anything inside one.
        const allowed =
          isPathInside(resolved, dataRoot) &&
          resolved !== dataRoot &&
          !protectedRoots.some((root) => resolved === root || isPathInside(resolved, root))
        if (!allowed) {
          failed.push({ id: candidate.id, label: candidate.label, error: 'That path is not managed by the launcher.' })
          continue
        }
        const stat = await statSafe(target)
        if (!stat) continue
        const size = stat.isFile() ? stat.size : (await measurePaths([target])).bytes
        try {
          await this.trashItem(target)
          candidateBytes += size
          candidateFiles += 1
        } catch (error) {
          failed.push({ id: candidate.id, label: candidate.label, error: error.message || 'Could not remove it.' })
        }
      }
      done += 1
      this.emit({ phase: 'clean', label: candidate.label, done, total: candidates.length })
      if (candidateBytes > 0) {
        freedBytes += candidateBytes
        removed.push({
          id: candidate.id,
          label: candidate.label,
          bytes: candidateBytes,
          files: statFileCount(candidateFiles, candidate.files),
        })
      }
    }

    this.lastScan = null
    this.logger?.info('Storage cleanup finished', { removed: removed.length, failed: failed.length, freedBytes })
    return { removed, failed, freedBytes }
  }
}

function statFileCount(touched, measured) {
  // Directory candidates are counted by their measured file total; single-file
  // candidates fall back to the number of paths actually moved.
  return Number.isFinite(measured) && measured > 0 ? measured : touched
}
