import fsp from 'node:fs/promises'
import { randomId } from './util.js'

export const MAX_TAIL_LINES = 500
export const TAIL_READ_BYTES = 600_000
export const TAIL_POLL_MS = 250

const ERROR_PATTERN = /\bERROR\b|\bSEVERE\b|\bFATAL\b|Exception|Caused by:/i
const WARN_PATTERN = /\bWARN(?:ING)?\b/i
const DEBUG_PATTERN = /\bDEBUG\b|\bTRACE\b/i

export function lineLevel(text) {
  const line = String(text || '')
  if (ERROR_PATTERN.test(line)) return 'error'
  if (WARN_PATTERN.test(line)) return 'warn'
  if (DEBUG_PATTERN.test(line)) return 'debug'
  return 'info'
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function addToken(tokens, value) {
  const normalized = normalizeToken(value)
  if (normalized.length >= 3) tokens.add(normalized)
}

function lineTokens(text) {
  const tokens = new Set()
  const loggers = []
  for (const match of String(text).matchAll(/\[([^\]]{1,200})\]/g)) {
    const raw = match[1].trim()
    const logger = raw.split('/')[0].trim()
    if (logger) loggers.push(logger.toLowerCase())
    for (const part of raw.split(/[/:]/)) {
      addToken(tokens, part)
      for (const segment of part.split('.')) addToken(tokens, segment)
    }
  }
  for (const match of String(text).matchAll(/\b(?:[A-Za-z_$][\w$]*\.){2,}[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
    for (const segment of match[0].split('.')) addToken(tokens, segment)
  }
  return { tokens, loggers }
}

function modIdentifiers(mod) {
  const filename = String(mod.filename || '').replace(/\.jar(?:\.disabled)?$/i, '')
  const values = new Set([
    normalizeToken(mod.id),
    normalizeToken(mod.name),
    normalizeToken(filename),
  ])
  for (const part of String(mod.name || '').split(/[\s._-]+/)) {
    const normalized = normalizeToken(part)
    if (normalized.length >= 3) values.add(normalized)
  }
  for (const part of filename.split(/[\s._-]+/)) {
    const normalized = normalizeToken(part)
    if (normalized.length >= 3) values.add(normalized)
  }
  values.delete('')
  return [...values]
}

/**
 * Match a log line's logger or package segments to the enabled mods. Matching is
 * token-based on purpose: a stack trace may name `net.example.create`, while
 * unrelated prose mentioning `creative` must not become a false attribution.
 */
export function attributeLogLine(text, mods = []) {
  if (!text || !Array.isArray(mods) || mods.length === 0) return null
  const { tokens, loggers } = lineTokens(text)
  if (!tokens.size && !loggers.length) return null
  const candidates = mods
    .map((mod) => {
      const id = normalizeToken(mod?.id)
      const name = normalizeToken(mod?.name)
      const identifiers = modIdentifiers(mod || {})
      return {
        mod,
        id,
        name,
        identifiers,
        longest: Math.max(0, ...identifiers.map((value) => value.length)),
      }
    })
    .filter((candidate) => candidate.id || candidate.name)
    .sort((a, b) => b.longest - a.longest)

  for (const candidate of candidates) {
    if (
      loggers.some(
        (logger) =>
          logger === candidate.id ||
          logger === candidate.name ||
          logger.startsWith(`${candidate.id}.`) ||
          logger.includes(`.${candidate.id}`),
      )
    ) {
      return {
        id: candidate.mod.id || candidate.mod.name,
        name: candidate.mod.name || candidate.mod.id,
        filename: candidate.mod.filename || null,
      }
    }
    if (candidate.identifiers.some((identifier) => tokens.has(identifier))) {
      return {
        id: candidate.mod.id || candidate.mod.name,
        name: candidate.mod.name || candidate.mod.id,
        filename: candidate.mod.filename || null,
      }
    }
  }
  return null
}

export function splitCompleteLines(text) {
  const value = String(text || '')
  if (!value) return { lines: [], pending: '' }
  const parts = value.split('\n')
  const endedWithNewline = value.endsWith('\n')
  if (endedWithNewline) parts.pop()
  const pending = endedWithNewline ? '' : parts.pop() || ''
  return {
    lines: parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)),
    pending,
  }
}

export async function readTailFile(filePath, maxBytes = TAIL_READ_BYTES) {
  const stat = await fsp.stat(filePath)
  const start = Math.max(0, stat.size - maxBytes)
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(stat.size - start)
    if (buffer.length) await handle.read(buffer, 0, buffer.length, start)
    return {
      content: buffer.toString('utf8'),
      truncated: start > 0,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      stat,
    }
  } finally {
    await handle.close()
  }
}

/** Read only the bytes after `offset`; never re-read the earlier part of the file. */
export async function readIncremental(filePath, offset, size) {
  if (size <= offset) return ''
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    await handle.read(buffer, 0, buffer.length, offset)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

export function classifyTailChange(previous, next) {
  const previousSize = Number(previous?.size) || 0
  const offset = Number(previous?.offset) || previousSize
  const nextSize = Number(next?.size) || 0
  if (nextSize < previousSize || nextSize < offset) return 'truncated'
  const identityChanged =
    (previous?.ino && next?.ino && previous.ino !== next.ino) ||
    (previous?.dev != null && next?.dev != null && previous.dev !== next.dev) ||
    (previous?.birthtimeMs && next?.birthtimeMs && previous.birthtimeMs !== next.birthtimeMs)
  if (identityChanged) return 'rotated'
  return nextSize > offset ? 'append' : 'idle'
}

export function takeTailBatch(lines) {
  const visible = lines.slice(-MAX_TAIL_LINES)
  return {
    lines: visible,
    dropped: Math.max(0, lines.length - visible.length),
  }
}

function linesFor(mods, texts) {
  return texts.map((text) => ({
    text,
    level: lineLevel(text),
    mod: attributeLogLine(text, mods),
  }))
}

/**
 * Polls one selected log file and emits only the appended lines. A changed
 * inode, a smaller file, or a new creation time resets the offset instead of
 * streaming bytes from the old file into the new one.
 */
export class LogTail {
  constructor({
    logService,
    contentIndexService,
    logger = null,
    emit = () => {},
    pollMs = TAIL_POLL_MS,
  } = {}) {
    this.logService = logService
    this.contentIndexService = contentIndexService
    this.logger = logger
    this.emitCallback = emit
    this.pollMs = pollMs
    this.current = null
    this.timer = null
  }

  emit(payload) {
    this.emitCallback(payload)
  }

  async modsFor(resolved) {
    if (resolved.category !== 'game' || !resolved.installation?.gameDir) return []
    try {
      const index = await this.contentIndexService.list(resolved.installation.gameDir, 'mod')
      return index.files
        .filter((file) => file.enabled && file.metadata)
        .map((file) => ({
          id: file.metadata.modId || file.metadata.name,
          name: file.metadata.name || file.metadata.modId,
          filename: file.filename,
        }))
        .filter((mod) => mod.id || mod.name)
    } catch (error) {
      this.logger?.warn?.('Could not build mod attribution for the log tail', { message: error.message })
      return []
    }
  }

  async start({ category, file, installationId } = {}) {
    this.stop(null, { reason: 'selection-changed' })
    const resolved = await this.logService.resolve({ category, file, installationId })
    const initial = await readTailFile(resolved.filePath)
    const parsed = splitCompleteLines(initial.content)
    // A byte-limited tail can start in the middle of a line. Drop that fragment.
    const texts = initial.truncated ? parsed.lines.slice(1) : parsed.lines
    const visible = takeTailBatch(texts)
    const mods = await this.modsFor(resolved)
    const id = randomId()
    this.current = {
      id,
      filePath: resolved.filePath,
      category: resolved.category,
      file: resolved.file,
      installationId: resolved.installationId,
      offset: initial.size,
      size: initial.size,
      modified: initial.modified,
      ino: initial.stat.ino,
      dev: initial.stat.dev,
      birthtimeMs: initial.stat.birthtimeMs,
      mtimeMs: initial.stat.mtimeMs,
      pending: parsed.pending,
      mods,
      polling: false,
    }
    this.timer = setInterval(() => void this.poll(), this.pollMs)
    this.timer.unref?.()
    return {
      id,
      stopped: false,
      category: resolved.category,
      file: resolved.file,
      lines: linesFor(mods, visible.lines),
      size: initial.size,
      modified: initial.modified,
      truncated: initial.truncated || visible.dropped > 0,
    }
  }

  async poll() {
    const tail = this.current
    if (!tail || tail.polling) return
    tail.polling = true
    try {
      const stat = await fsp.stat(tail.filePath)
      const change = classifyTailChange(tail, stat)
      if (change === 'truncated' || change === 'rotated') {
        const initial = await readTailFile(tail.filePath)
        const parsed = splitCompleteLines(initial.content)
        const texts = initial.truncated ? parsed.lines.slice(1) : parsed.lines
        const visible = takeTailBatch(texts)
        tail.offset = initial.size
        tail.size = initial.size
        tail.modified = initial.modified
        tail.ino = initial.stat.ino
        tail.dev = initial.stat.dev
        tail.birthtimeMs = initial.stat.birthtimeMs
        tail.mtimeMs = initial.stat.mtimeMs
        tail.pending = parsed.pending
        this.emit({
          id: tail.id,
          reset: true,
          lines: linesFor(tail.mods, visible.lines),
          size: tail.size,
          modified: tail.modified,
          dropped: visible.dropped + (initial.truncated ? 1 : 0),
        })
        return
      }
      if (change !== 'append') {
        tail.size = stat.size
        tail.mtimeMs = stat.mtimeMs
        return
      }

      const text = await readIncremental(tail.filePath, tail.offset, stat.size)
      if (!text) {
        tail.size = stat.size
        return
      }
      const parsed = splitCompleteLines(tail.pending + text)
      tail.pending = parsed.pending
      tail.offset = stat.size
      tail.size = stat.size
      tail.modified = stat.mtime.toISOString()
      tail.mtimeMs = stat.mtimeMs
      if (!parsed.lines.length) return
      const visible = takeTailBatch(parsed.lines)
      this.emit({
        id: tail.id,
        lines: linesFor(tail.mods, visible.lines),
        size: tail.size,
        modified: tail.modified,
        dropped: visible.dropped,
      })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.stop(tail.id, {
          reason: 'file-missing',
          error: 'The log file was removed.',
        })
      } else {
        this.logger?.warn?.('Log tail read failed', { message: error?.message })
        this.stop(tail.id, {
          reason: 'read-error',
          error: 'The log tail stopped because the file could not be read.',
        })
      }
    } finally {
      tail.polling = false
    }
  }

  stop(id = null, { reason = 'stopped', error = null } = {}) {
    const tail = this.current
    if (!tail) return { id: id || null, stopped: false }
    if (id && tail.id !== id) return { id, stopped: false }
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.current = null
    this.emit({
      id: tail.id,
      lines: [],
      size: tail.size,
      modified: tail.modified,
      stopped: true,
      reason,
      ...(error ? { error } : {}),
    })
    return { id: tail.id, stopped: true }
  }

  stopGame(installationId) {
    if (!this.current || this.current.category !== 'game') return { stopped: false }
    if (installationId && this.current.installationId !== installationId) return { stopped: false }
    return this.stop(this.current.id, { reason: 'game-exit' })
  }

  stopAll() {
    return this.stop(null, { reason: 'window-closed' })
  }
}
