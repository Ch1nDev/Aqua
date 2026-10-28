import fs from 'node:fs'
import path from 'node:path'
import { ensureDir } from './util.js'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET_KEYS = new Set([
  'token',
  'accessToken',
  'refreshToken',
  'identityToken',
  'authorization',
  'clientSecret',
  'password',
])

function sanitizeMeta(meta, depth = 0) {
  if (meta == null || depth > 4) return meta
  if (Array.isArray(meta)) return meta.map((item) => sanitizeMeta(item, depth + 1))
  if (typeof meta === 'object') {
    const output = {}
    for (const [key, value] of Object.entries(meta)) {
      if (SECRET_KEYS.has(key)) {
        output[key] = '<redacted>'
      } else if (typeof value === 'string' && value.length > 2000) {
        output[key] = `${value.slice(0, 2000)}…`
      } else {
        output[key] = sanitizeMeta(value, depth + 1)
      }
    }
    return output
  }
  return meta
}

export class Logger {
  constructor({ filePath, level = 'info', echoToConsole = true }) {
    this.filePath = filePath
    this.level = LEVELS[level] ? level : 'info'
    this.echoToConsole = echoToConsole
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.rotateIfNeeded()
  }

  setLevel(level) {
    if (LEVELS[level]) this.level = level
  }

  rotateIfNeeded() {
    try {
      const stat = fs.statSync(this.filePath)
      if (stat.size > 5 * 1024 * 1024) {
        const archive = this.filePath.replace(/\.log$/, '.1.log')
        fs.rmSync(archive, { force: true })
        fs.renameSync(this.filePath, archive)
      }
    } catch {
      // File does not exist yet.
    }
  }

  write(level, message, meta) {
    if ((LEVELS[level] || 20) < (LEVELS[this.level] || 20)) return
    const timestamp = new Date().toISOString()
    let text = String(message)
    if (meta !== undefined) {
      try {
        const payload = sanitizeMeta(meta)
        const serialized =
          typeof payload === 'string' ? payload : JSON.stringify(payload, (key, value) => {
            if (SECRET_KEYS.has(key)) return '<redacted>'
            return value
          })
        if (serialized && serialized !== '{}') text += ` ${serialized}`
      } catch {
        text += ' [unserializable metadata]'
      }
    }
    const line = `${timestamp} ${level.toUpperCase().padEnd(5)} ${text.replace(/[\r\n]+/g, ' ')}\n`
    try {
      this.rotateIfNeeded()
      fs.appendFileSync(this.filePath, line, 'utf8')
    } catch {
      // Logging must never crash the launcher.
    }
    if (this.echoToConsole) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
      console[method](line.trimEnd())
    }
  }

  debug(message, meta) {
    this.write('debug', message, meta)
  }

  info(message, meta) {
    this.write('info', message, meta)
  }

  warn(message, meta) {
    this.write('warn', message, meta)
  }

  error(message, meta) {
    this.write('error', message, meta)
  }

  async tail(maxBytes = 300_000) {
    try {
      const stat = await fs.promises.stat(this.filePath)
      const start = Math.max(0, stat.size - maxBytes)
      const handle = await fs.promises.open(this.filePath, 'r')
      try {
        const buffer = Buffer.alloc(stat.size - start)
        await handle.read(buffer, 0, buffer.length, start)
        return buffer.toString('utf8')
      } finally {
        await handle.close()
      }
    } catch {
      return ''
    }
  }
}

export function createLogger(paths, level) {
  return new Logger({ filePath: paths.launcherLog, level })
}

export { LEVELS }
