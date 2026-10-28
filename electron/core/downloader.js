import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assertPathInside, ensureDir, sha1File, sleep } from './util.js'

export class DownloadError extends Error {
  constructor(message, failures = []) {
    super(message)
    this.name = 'DownloadError'
    this.failures = failures
  }
}

export class BandwidthLimiter {
  constructor(kilobytesPerSecond = 0) {
    this.rate = Math.max(0, Number(kilobytesPerSecond) || 0) * 1024
    this.tokens = this.rate
    this.lastRefill = Date.now()
  }

  async consume(bytes) {
    if (!this.rate || bytes <= 0) return
    let remaining = bytes
    while (remaining > 0) {
      this.refill()
      if (this.tokens >= remaining) {
        this.tokens -= remaining
        return
      }
      const available = Math.floor(this.tokens)
      this.tokens -= available
      remaining -= available
      const waitMs = Math.min(1000, Math.ceil(((remaining - this.tokens) / this.rate) * 1000))
      await sleep(Math.max(15, waitMs))
    }
  }

  refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.lastRefill = now
    if (this.rate > 0) {
      this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate)
    }
  }
}

export class SpeedMeter {
  constructor() {
    this.speed = 0
    this.lastBytes = 0
    this.lastTime = Date.now()
  }

  update(bytes) {
    const now = Date.now()
    const elapsed = (now - this.lastTime) / 1000
    if (elapsed >= 0.2) {
      const delta = Math.max(0, bytes - this.lastBytes)
      const instantaneous = delta / elapsed
      this.speed = this.speed === 0 ? instantaneous : this.speed * 0.7 + instantaneous * 0.3
      this.lastBytes = bytes
      this.lastTime = now
    }
    return this.speed
  }

  reset() {
    this.speed = 0
    this.lastBytes = 0
    this.lastTime = Date.now()
  }
}

async function runPool(items, concurrency, worker, signal) {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' })
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

async function verifyExisting(file, signal) {
  try {
    const stat = await fsp.stat(file.destination)
    if (!stat.isFile()) return false
    // A SHA-1 hash is authoritative, so a stale size from a pack manifest must
    // not force a redownload of a file that is already intact.
    if (!file.sha1) return file.size == null || stat.size === file.size
    if (signal?.aborted) throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' })
    const actual = await sha1File(file.destination)
    return actual.toLowerCase() === file.sha1.toLowerCase()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return false
  }
}

async function fetchAttempt(file, context) {
  const { signal, limiter, onChunk, logger } = context
  const response = await fetch(file.url, {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': 'AquaLauncher/1.0.0 (Minecraft Java launcher)',
      Accept: '*/*',
    },
  }).catch((error) => {
    if (error?.name === 'AbortError') throw error
    throw new Error(`Network error: ${error.message}`)
  })
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status} for ${new URL(file.url).host}`), {
      status: response.status,
    })
  }
  if (!response.body) throw new Error('The server returned an empty response.')

  await ensureDir(path.dirname(file.destination))
  const tempPath = `${file.destination}.part`
  await fsp.rm(tempPath, { force: true }).catch(() => {})
  const hash = crypto.createHash('sha1')
  let received = 0
  const meter = new Transform({
    async transform(chunk, _encoding, callback) {
      try {
        await limiter.consume(chunk.length)
        if (signal?.aborted) throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' })
        hash.update(chunk)
        received += chunk.length
        onChunk(chunk.length)
        callback(null, chunk)
      } catch (error) {
        callback(error)
      }
    },
  })

  // The server's Content-Length describes the transfer we actually asked for,
  // while `file.size` comes from package metadata that can be stale (modpack
  // manifests in particular often list wrong sizes). Prefer the transfer length
  // for truncation detection and let the SHA-1 hash decide the file is correct.
  const declaredLength = Number(response.headers.get('content-length'))
  const encoding = String(response.headers.get('content-encoding') || 'identity').trim().toLowerCase()
  const expectedBytes =
    Number.isFinite(declaredLength) && declaredLength > 0 && (encoding === 'identity' || encoding === '')
      ? declaredLength
      : file.size

  try {
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(tempPath))
    if (file.sha1) {
      if (hash.digest('hex').toLowerCase() !== file.sha1.toLowerCase()) {
        throw new Error('Downloaded file failed its SHA-1 integrity check.')
      }
    } else if (expectedBytes != null && received !== expectedBytes) {
      throw new Error(`Incomplete download (received ${received} of ${expectedBytes} bytes).`)
    }
    await fsp.rm(file.destination, { force: true }).catch(() => {})
    await fsp.rename(tempPath, file.destination)
    if (file.executable) await fsp.chmod(file.destination, 0o755).catch(() => {})
    return received
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    logger?.debug?.('Download attempt failed', { message: error.message, destination: file.destination })
    throw error
  }
}

/**
 * Download a batch of files with verification, bounded concurrency and retries.
 * Existing files with matching size/hash are reused, which makes interrupted installs resumable.
 */
export async function downloadFiles(files, options = {}) {
  const {
    concurrency = 8,
    bandwidthKbps = 0,
    signal,
    onProgress = () => {},
    logger = null,
    root = null,
    attempts = 3,
  } = options

  if (!Array.isArray(files) || files.length === 0) {
    return { bytes: 0, files: 0 }
  }

  const unique = new Map()
  for (const raw of files) {
    if (!raw?.url || !raw?.destination) throw new Error('Invalid download entry.')
    let destination
    try {
      destination = path.resolve(raw.destination)
      if (root) assertPathInside(destination, root, 'Download')
      const parsed = new URL(raw.url)
      if (parsed.protocol !== 'https:') throw new Error(`Refusing non-HTTPS download: ${raw.url}`)
    } catch (error) {
      throw new Error(`Invalid download entry: ${error.message}`)
    }
    const file = {
      url: raw.url,
      destination,
      size: Number.isFinite(raw.size) ? raw.size : null,
      sha1: raw.sha1 || null,
      executable: Boolean(raw.executable),
    }
    const existing = unique.get(destination)
    if (existing && (existing.sha1 !== file.sha1 || existing.size !== file.size)) {
      throw new Error(`Conflicting downloads target ${destination}.`)
    }
    unique.set(destination, file)
  }

  const list = [...unique.values()]
  const totalBytes = list.reduce((sum, file) => sum + (file.size || 0), 0)
  const totalFiles = list.length
  let verifiedBytes = 0
  let completedBytes = 0
  let completedFiles = 0
  let networkBytes = 0
  let currentFile = ''
  const speedMeter = new SpeedMeter()
  const startedAt = Date.now()
  let lastEmit = 0

  const progress = (phase, force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < 200) return
    lastEmit = now
    const seconds = Math.max(0.001, (now - startedAt) / 1000)
    const speedBps = speedMeter.speed
    const overallDone = completedBytes
    const remaining = Math.max(0, totalBytes - overallDone)
    const etaSeconds = speedBps > 0 && remaining > 0 ? Math.round(remaining / speedBps) : null
    onProgress({
      phase,
      bytesDone: overallDone,
      bytesTotal: totalBytes,
      filesDone: completedFiles,
      filesTotal: totalFiles,
      speedBps,
      etaSeconds,
      currentFile,
      elapsedSeconds: seconds,
    })
  }

  progress('verify', true)
  const validity = new Map()
  await runPool(
    list,
    Math.min(concurrency, 8),
    async (file) => {
      const exists = await verifyExisting(file, signal)
      validity.set(file, exists)
      if (exists) {
        completedFiles += 1
        verifiedBytes += file.size || 0
        completedBytes += file.size || 0
      }
      progress('verify')
    },
    signal,
  )

  progress('download', true)
  speedMeter.reset()
  const limiter = new BandwidthLimiter(bandwidthKbps)
  const failures = []
  const downloadQueue = list.filter((file) => !validity.get(file))

  speedMeter.lastTime = Date.now()
  await runPool(
    downloadQueue,
    concurrency,
    async (file) => {
      currentFile = file.destination
      let success = false
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (signal?.aborted) throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' })
        let partialBytes = 0
        try {
          await fetchAttempt(file, {
            signal,
            limiter,
            logger,
            onChunk: (chunkBytes) => {
              networkBytes += chunkBytes
              partialBytes += chunkBytes
              completedBytes += chunkBytes
              speedMeter.update(networkBytes)
              progress('download')
            },
          })
          success = true
          completedFiles += 1
          currentFile = ''
          progress('download')
          break
        } catch (error) {
          completedBytes = Math.max(verifiedBytes, completedBytes - partialBytes)
          if (error?.name === 'AbortError' || signal?.aborted) throw error
          logger?.warn?.('Download failed, retrying', {
            attempt,
            attempts,
            message: error.message,
            file: path.basename(file.destination),
          })
          if (attempt < attempts) await sleep(500 * attempt)
          else failures.push({ file: file.destination, message: error.message, url: file.url })
        }
      }
      if (!success) progress('download', true)
    },
    signal,
  )

  progress('complete', true)
  if (failures.length) {
    const detail = failures
      .slice(0, 3)
      .map((failure) => `${path.basename(failure.file)} (${failure.message})`)
      .join(', ')
    throw new DownloadError(
      `Could not download ${failures.length} file${failures.length === 1 ? '' : 's'}: ${detail}`,
      failures,
    )
  }

  return {
    bytes: totalBytes,
    files: totalFiles,
    downloadedBytes: networkBytes,
    elapsedSeconds: Math.max(0.001, (Date.now() - startedAt) / 1000),
  }
}
