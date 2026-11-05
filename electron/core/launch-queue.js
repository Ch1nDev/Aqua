import { randomId } from './util.js'

export const MAX_LAUNCH_QUEUE_ENTRIES = 20
export const LAUNCH_QUEUE_REASONS = ['game-running', 'preparing', 'install', 'manual']

function cleanReason(reason) {
  return LAUNCH_QUEUE_REASONS.includes(reason) ? reason : 'manual'
}

/**
 * A small FIFO queue for launch requests made while the launcher is busy.
 *
 * Entries are kept in memory only: a queued launch belongs to this launcher
 * session, so quitting Aqua clears the queue instead of surprising the player
 * with a game launch on the next start.
 */
export class LaunchQueue {
  constructor({ emit = () => {} } = {}) {
    this.emitCallback = emit
    this.entries = []
    this.paused = false
    this.pauseReason = null
  }

  snapshot() {
    return {
      entries: this.entries.map((entry) => ({ ...entry })),
      paused: this.paused,
      reason: this.pauseReason,
    }
  }

  emit() {
    this.emitCallback(this.snapshot())
  }

  enqueue({ installationId, installationName = null, safeMode = false, reason = 'manual' }) {
    if (!installationId || typeof installationId !== 'string') {
      throw new Error('Installation ID is required to queue a launch.')
    }
    if (this.entries.some((entry) => entry.installationId === installationId)) {
      return this.snapshot()
    }
    this.entries.push({
      id: randomId(),
      installationId,
      installationName: installationName ? String(installationName) : null,
      safeMode: safeMode === true,
      requestedAt: new Date().toISOString(),
      reason: cleanReason(reason),
    })
    if (this.entries.length > MAX_LAUNCH_QUEUE_ENTRIES) {
      this.entries = this.entries.slice(-MAX_LAUNCH_QUEUE_ENTRIES)
    }
    this.emit()
    return this.snapshot()
  }

  remove(entryId) {
    const next = this.entries.filter((entry) => entry.id !== entryId)
    if (next.length !== this.entries.length) {
      this.entries = next
      this.emit()
    }
    return this.snapshot()
  }

  peek() {
    return this.entries[0] || null
  }

  shift() {
    const entry = this.entries.shift() || null
    if (entry) this.emit()
    return entry
  }

  /** Put an entry back at the front when its launch could not start. */
  restore(entry) {
    if (!entry || !entry.installationId) return this.snapshot()
    if (this.entries.some((existing) => existing.installationId === entry.installationId)) {
      return this.snapshot()
    }
    this.entries.unshift(entry)
    if (this.entries.length > MAX_LAUNCH_QUEUE_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_LAUNCH_QUEUE_ENTRIES)
    }
    this.emit()
    return this.snapshot()
  }

  pause(reason = 'The queue was paused.') {
    this.paused = true
    this.pauseReason = String(reason).slice(0, 400)
    this.emit()
    return this.snapshot()
  }

  resume() {
    this.paused = false
    this.pauseReason = null
    this.emit()
    return this.snapshot()
  }

  clear() {
    this.entries = []
    this.paused = false
    this.pauseReason = null
    this.emit()
    return this.snapshot()
  }
}
