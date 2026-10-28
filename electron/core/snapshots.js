import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson, ensureDir, isPathInside, randomId, readJsonFile, sanitizeFileName, slugify } from './util.js'

/**
 * A reusable "zip a folder, keep an index next to the zips" writer.
 *
 * It is deliberately not wired to IPC: world backups (P1.3) and Bedrock backups
 * (P1.4) both consume it so the archive format, retention rules and the
 * zip-slip guard only exist once. Nothing here imports Electron.
 */

export const SNAPSHOT_INDEX_VERSION = 1
export const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/i

const INDEX_FILE = 'index.json'
const MAX_FILES = 100_000
const MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024
const MAX_DEPTH = 32
const MAX_LABEL = 120
const MAX_NOTE = 200
const FOLDER_SUFFIX = /^(.+?)(?:\s\(restored(?:\s(\d+))?\))?$/

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function cleanNote(value) {
  const note = cleanText(value, MAX_NOTE)
  return note || null
}

/** The archive's single top-level folder name, e.g. a world folder id. */
function cleanEntryName(value, fallback = 'snapshot') {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const normalized = value.replace(/\\/g, '/')
  const base = path.basename(normalized).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!base || base === '.' || base === '..') return fallback
  return base.slice(0, 96)
}

function toSize(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return Math.round(numeric)
}

/** `world-20261028143000-1a2b3c4d`, readable when someone opens the folder. */
export function snapshotId(label, at = new Date()) {
  const slug = slugify(label || 'snapshot')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '')
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14)
  const suffix = randomId().replace(/-/g, '').slice(0, 8)
  return `${slug || 'snapshot'}-${stamp}-${suffix}`
}

function globSegment(value, pattern) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${source}$`, 'i').test(value)
}

function matchSegments(patternSegments, targetSegments, patternIndex, targetIndex) {
  if (patternIndex === patternSegments.length) return targetIndex === targetSegments.length
  const segment = patternSegments[patternIndex]
  if (segment === '**') {
    if (patternIndex === patternSegments.length - 1) return targetIndex <= targetSegments.length
    for (let skip = targetIndex; skip <= targetSegments.length; skip += 1) {
      if (matchSegments(patternSegments, targetSegments, patternIndex + 1, skip)) return true
    }
    return false
  }
  if (targetIndex >= targetSegments.length) return false
  if (!globSegment(targetSegments[targetIndex], segment)) return false
  return matchSegments(patternSegments, targetSegments, patternIndex + 1, targetIndex + 1)
}

/**
 * Matches a relative POSIX path against a small pattern subset: `*` and `?`
 * inside one segment, `**` across segments. A pattern without a slash is
 * matched against the file name anywhere in the tree.
 */
export function matchesPattern(relativePath, pattern) {
  if (typeof relativePath !== 'string' || typeof pattern !== 'string') return false
  const target = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '')
  const source = pattern.replace(/\\/g, '/').replace(/^\.?\//, '').trim()
  if (!target || !source) return false
  const targetSegments = target.split('/').filter((segment) => segment && segment !== '.')
  const patternSegments = source.split('/').filter((segment) => segment && segment !== '.')
  if (!patternSegments.length) return false
  if (patternSegments.length === 1) {
    return globSegment(targetSegments[targetSegments.length - 1] || '', patternSegments[0])
  }
  return matchSegments(patternSegments, targetSegments, 0, 0)
}

function normalizePatterns(value) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  return list.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
}

/**
 * Rejects archive entries that could write outside the extraction root:
 * absolute paths, drive letters, NUL bytes and `..` segments.
 */
export function isUnsafeEntryName(entryName) {
  if (typeof entryName !== 'string' || !entryName.trim()) return true
  if (entryName.includes('\0')) return true
  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.startsWith('//')) return true
  if (/^[a-z]:/i.test(normalized)) return true
  return normalized.split('/').some((part) => part === '..')
}

/** Zip entries keep unix modes in the high bits of the external attributes. */
function isSymbolicLinkEntry(entry) {
  const attr = Number(entry?.header?.attr ?? entry?.attr ?? 0)
  if (!Number.isFinite(attr) || attr === 0) return false
  return ((attr >>> 16) & 0o170000) === 0o120000
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!SNAPSHOT_ID_PATTERN.test(id)) return null
  const createdAt =
    typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
      ? new Date(raw.createdAt).toISOString()
      : new Date(0).toISOString()
  return {
    id,
    label: cleanText(raw.label, MAX_LABEL) || id,
    entry: cleanEntryName(raw.entry, id),
    createdAt,
    sizeBytes: toSize(raw.sizeBytes),
    bytes: toSize(raw.bytes),
    files: toSize(raw.files),
    note: cleanNote(raw.note),
    pinned: raw.pinned === true,
  }
}

function indexPath(directory) {
  return path.join(directory, INDEX_FILE)
}

export async function readSnapshotIndex(directory) {
  if (typeof directory !== 'string' || !directory) return []
  const raw = await readJsonFile(indexPath(directory), null)
  if (!raw || raw.version !== SNAPSHOT_INDEX_VERSION || !Array.isArray(raw.snapshots)) return []
  const seen = new Set()
  const records = []
  for (const item of raw.snapshots) {
    const record = normalizeRecord(item)
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    records.push(record)
  }
  return records
}

export async function writeSnapshotIndex(directory, snapshots) {
  await ensureDir(directory)
  await atomicWriteJson(indexPath(directory), {
    version: SNAPSHOT_INDEX_VERSION,
    snapshots,
  })
}

/**
 * Zips `sourceDir` into `destinationDir/<id>.zip` and records it in the index.
 * Everything is written under the archive's single top-level folder so restores
 * can move that folder into place in one step.
 */
export async function createSnapshot({
  sourceDir,
  destinationDir,
  label = null,
  include = null,
  exclude = null,
  note = null,
  entryName = null,
  at = new Date(),
} = {}) {
  if (typeof sourceDir !== 'string' || !sourceDir.trim()) throw new Error('Choose a folder to snapshot.')
  if (typeof destinationDir !== 'string' || !destinationDir.trim()) {
    throw new Error('A snapshot destination folder is required.')
  }
  const stat = await fsp.stat(sourceDir).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('That folder no longer exists.')

  const entry = cleanEntryName(entryName || path.basename(sourceDir))
  const includePatterns = normalizePatterns(include)
  const excludePatterns = normalizePatterns(exclude)
  const collected = await collectFiles(sourceDir, { includePatterns, excludePatterns })
  if (!collected.files.length) throw new Error('That folder is empty, so there is nothing to back up.')

  const zip = new AdmZip()
  for (const file of collected.files) {
    let data
    try {
      data = await fsp.readFile(file.absolute)
    } catch (error) {
      throw new Error(`Could not read ${file.relative} for the backup: ${error.message}`)
    }
    zip.addFile(`${entry}/${file.relative}`, data)
  }

  await ensureDir(destinationDir)
  const id = snapshotId(label || entry, at)
  const archive = path.join(destinationDir, `${id}.zip`)
  const temp = `${archive}.${process.pid}.tmp`
  try {
    await fsp.writeFile(temp, zip.toBuffer())
    // Rename last, so an interrupted write never leaves a half archive behind.
    await fsp.rename(temp, archive)
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {})
    await fsp.rm(archive, { force: true }).catch(() => {})
    throw new Error(`Could not write the snapshot: ${error.message}`)
  }

  const written = await fsp.stat(archive).catch(() => null)
  const record = {
    id,
    label: cleanText(label || entry, MAX_LABEL) || entry,
    entry,
    createdAt: at.toISOString(),
    sizeBytes: written?.size || 0,
    bytes: collected.bytes,
    files: collected.files.length,
    note: cleanNote(note),
    pinned: false,
  }
  const existing = await readSnapshotIndex(destinationDir)
  await writeSnapshotIndex(destinationDir, [record, ...existing.filter((item) => item.id !== id)])
  return { ...record, archive, skipped: collected.skipped }
}

async function collectFiles(root, { includePatterns, excludePatterns }) {
  const files = []
  let bytes = 0
  let skipped = 0
  const isExcluded = (relative) => excludePatterns.some((pattern) => matchesPattern(relative, pattern))

  const walk = async (current, depth) => {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of entries) {
      // Symlinks are skipped rather than followed, so a link cannot pull files
      // from outside the folder into the archive.
      if (dirent.isSymbolicLink()) {
        skipped += 1
        continue
      }
      const absolute = path.join(current, dirent.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (isExcluded(relative)) {
        skipped += 1
        continue
      }
      if (dirent.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!dirent.isFile()) {
        skipped += 1
        continue
      }
      if (includePatterns.length && !includePatterns.some((pattern) => matchesPattern(relative, pattern))) {
        skipped += 1
        continue
      }
      const stat = await fsp.stat(absolute).catch(() => null)
      if (!stat?.isFile()) continue
      if (files.length >= MAX_FILES) throw new Error('That folder holds too many files to back up at once.')
      if (bytes + stat.size > MAX_TOTAL_BYTES) throw new Error('That folder is too large to back up at once.')
      bytes += stat.size
      files.push({ absolute, relative })
    }
  }

  await walk(root, 0)
  files.sort((a, b) => a.relative.localeCompare(b.relative))
  return { files, bytes, skipped }
}

/** Index rows whose archive is gone are not returned. */
export async function listSnapshots(directory) {
  const records = await readSnapshotIndex(directory)
  const result = []
  for (const record of records) {
    const archive = path.join(directory, `${record.id}.zip`)
    const stat = await fsp.stat(archive).catch(() => null)
    if (!stat?.isFile()) continue
    result.push({ ...record, sizeBytes: stat.size, archive })
  }
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function snapshotArchive(directory, id) {
  if (typeof id !== 'string' || !SNAPSHOT_ID_PATTERN.test(id)) throw new Error('That snapshot is invalid.')
  const archive = path.resolve(directory, `${id}.zip`)
  if (!isPathInside(archive, directory)) throw new Error('That snapshot is invalid.')
  return archive
}

/**
 * Pure retention plan: newest first, pinned snapshots are exempt when
 * `pinnedFirst` is on, then the count limit, then the total size limit.
 */
export function planPrune(snapshots, policy = {}) {
  const list = Array.isArray(snapshots) ? snapshots.filter((item) => item && typeof item.id === 'string') : []
  const keepCount = Number.isFinite(Number(policy.keepCount)) ? Math.max(0, Math.floor(Number(policy.keepCount))) : 5
  const maxTotalBytes = Number.isFinite(Number(policy.maxTotalBytes)) ? Math.max(0, Math.floor(Number(policy.maxTotalBytes))) : 0
  const pinnedFirst = policy.pinnedFirst !== false
  const ordered = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const kept = []
  const deleteIds = []
  let keptBytes = 0
  for (const entry of ordered) {
    const size = toSize(entry.sizeBytes)
    const pinned = pinnedFirst && entry.pinned === true
    if (!pinned && kept.length >= keepCount) {
      deleteIds.push(entry.id)
      continue
    }
    if (!pinned && maxTotalBytes > 0 && keptBytes + size > maxTotalBytes) {
      deleteIds.push(entry.id)
      continue
    }
    kept.push(entry.id)
    keptBytes += size
  }

  return {
    deleteIds,
    keptIds: kept,
    freedBytes: ordered.filter((entry) => deleteIds.includes(entry.id)).reduce((sum, entry) => sum + toSize(entry.sizeBytes), 0),
  }
}

export async function pruneSnapshots(directory, policy = {}) {
  const snapshots = await listSnapshots(directory)
  const plan = planPrune(snapshots, policy)
  for (const id of plan.deleteIds) {
    await fsp.rm(snapshotArchive(directory, id), { force: true }).catch(() => {})
  }
  if (plan.deleteIds.length) {
    const remaining = (await readSnapshotIndex(directory)).filter((item) => !plan.deleteIds.includes(item.id))
    await writeSnapshotIndex(directory, remaining)
  }
  return plan
}

export async function deleteSnapshot(directory, id) {
  const archive = snapshotArchive(directory, id)
  await fsp.rm(archive, { force: true })
  const remaining = (await readSnapshotIndex(directory)).filter((item) => item.id !== id)
  await writeSnapshotIndex(directory, remaining)
  return { id }
}

async function exists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

async function uniqueFolderName(directory, base) {
  const match = FOLDER_SUFFIX.exec(base)
  const root = match?.[1]?.trim() || base
  let candidate = root
  if (!(await exists(path.join(directory, candidate)))) return candidate
  candidate = `${root} (restored)`
  let index = 2
  while (await exists(path.join(directory, candidate))) {
    candidate = `${root} (restored ${index})`
    index += 1
  }
  return candidate
}

async function moveDirectory(source, destination) {
  try {
    await fsp.rename(source, destination)
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') throw error
    await fsp.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
    await fsp.rm(source, { recursive: true, force: true })
  }
}

/**
 * Extracts a snapshot next to the live folder and moves it into place under a
 * new name. The live folder is never written to.
 */
export async function restoreSnapshot({
  archive,
  destinationDir,
  folderName = null,
  tempRoot = null,
  maxFiles = MAX_FILES,
  maxTotalBytes = MAX_TOTAL_BYTES,
} = {}) {
  if (typeof archive !== 'string' || !archive.trim()) throw new Error('Choose a snapshot to restore.')
  if (typeof destinationDir !== 'string' || !destinationDir.trim()) throw new Error('A restore folder is required.')
  const stat = await fsp.stat(archive).catch(() => null)
  if (!stat?.isFile()) throw new Error('That snapshot archive is missing.')

  let zip
  try {
    zip = new AdmZip(archive)
  } catch {
    throw new Error('That snapshot archive could not be opened.')
  }

  // Validate the whole archive before writing anything, so a bad entry leaves
  // no partial restore behind.
  const planned = []
  let totalBytes = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = String(entry.entryName || '')
    if (isUnsafeEntryName(name)) {
      throw new Error('That snapshot points outside its folder, so it was not restored.')
    }
    if (isSymbolicLinkEntry(entry)) {
      throw new Error('That snapshot contains a link, so it was not restored.')
    }
    const size = Number(entry.header?.size) || 0
    totalBytes += size
    if (planned.length + 1 > maxFiles) throw new Error('That snapshot holds too many files to restore safely.')
    if (totalBytes > maxTotalBytes) throw new Error('That snapshot is larger than a safe restore allows.')
    planned.push({ name: name.replace(/\\/g, '/'), size, entry })
  }
  if (!planned.length) throw new Error('That snapshot is empty.')

  await ensureDir(destinationDir)
  const root = tempRoot || path.join(destinationDir, `.restore-${randomId().replace(/-/g, '').slice(0, 8)}`)
  await fsp.rm(root, { recursive: true, force: true }).catch(() => {})
  await ensureDir(root)

  try {
    for (const item of planned) {
      const destination = path.resolve(root, item.name)
      if (!isPathInside(destination, root)) {
        throw new Error('That snapshot points outside its folder, so it was not restored.')
      }
      await ensureDir(path.dirname(destination))
      await fsp.writeFile(destination, item.entry.getData())
    }

    const topLevel = await fsp.readdir(root, { withFileTypes: true })
    const single = topLevel.length === 1 && topLevel[0].isDirectory() ? topLevel[0] : null
    const source = single ? path.join(root, single.name) : root
    const requested = typeof folderName === 'string' ? sanitizeFileName(folderName, '') : ''
    const fallback = single?.name || path.basename(archive, path.extname(archive))
    const base = requested || sanitizeFileName(fallback, 'restored')
    const folder = await uniqueFolderName(destinationDir, base)
    const target = path.join(destinationDir, folder)
    if (!isPathInside(target, destinationDir) || target === path.resolve(destinationDir)) {
      throw new Error('That restore folder is invalid.')
    }
    if (await exists(target)) throw new Error('A folder with that name already exists; the restore was not applied.')
    await moveDirectory(source, target)
    return { folder, name: folder, files: planned.length, bytes: totalBytes }
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {})
  }
}
