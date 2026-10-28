import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWriteFile, atomicWriteJson, fetchJson, fetchWithRetry, readJsonFile, safeSegment } from './util.js'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const CACHE_TTL_MS = 10 * 60 * 1000

function normalizeManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.versions) || !manifest.latest) {
    throw new Error('Minecraft returned an unexpected version manifest.')
  }
  const versions = manifest.versions
    .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.url === 'string')
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      url: entry.url,
      time: entry.time,
      releaseTime: entry.releaseTime,
      sha1: entry.sha1 || null,
      complianceLevel: entry.complianceLevel ?? 0,
    }))
  return { latest: manifest.latest, versions }
}

export class VersionService {
  constructor({ paths, logger }) {
    this.paths = paths
    this.logger = logger
    this.memoryManifest = null
    this.pendingFetch = null
  }

  getCachedManifestSync() {
    try {
      const cached = JSON.parse(fs.readFileSync(this.paths.manifestCacheFile, 'utf8'))
      if (!cached?.manifest) return null
      const normalized = normalizeManifest(cached.manifest)
      const fetchedAt = cached.fetchedAt || null
      return {
        ...normalized,
        fetchedAt,
        fromCache: true,
        stale: !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > CACHE_TTL_MS,
      }
    } catch {
      return null
    }
  }

  async getManifest({ force = false } = {}) {
    const cached = await readJsonFile(this.paths.manifestCacheFile, null)
    const cachedManifest = cached?.manifest ? normalizeManifest(cached.manifest) : null
    const fetchedAt = cached?.fetchedAt || null
    const fresh = fetchedAt && Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS

    if (!force && cachedManifest && fresh) {
      return { ...cachedManifest, fetchedAt, fromCache: true, stale: false }
    }
    if (!force && this.memoryManifest && Date.now() - this.memoryManifest.fetchedAtMs < CACHE_TTL_MS) {
      return { ...this.memoryManifest.value, fetchedAt: this.memoryManifest.fetchedAt, fromCache: true, stale: false }
    }
    if (this.pendingFetch) return this.pendingFetch

    this.pendingFetch = (async () => {
      try {
        const manifest = normalizeManifest(await fetchJson(MANIFEST_URL, {}, { attempts: 2, timeoutMs: 25_000, logger: this.logger }))
        const stamp = new Date().toISOString()
        await atomicWriteJson(this.paths.manifestCacheFile, { fetchedAt: stamp, manifest })
        this.memoryManifest = { value: manifest, fetchedAt: stamp, fetchedAtMs: Date.now() }
        this.logger.info('Fetched Minecraft version manifest', { versions: manifest.versions.length })
        return { ...manifest, fetchedAt: stamp, fromCache: false, stale: false }
      } catch (error) {
        if (cachedManifest) {
          this.logger.warn('Using cached Minecraft version manifest after a network error', {
            message: error.message,
          })
          return {
            ...cachedManifest,
            fetchedAt,
            fromCache: true,
            stale: true,
            error: 'Could not reach Mojang. Showing the last saved version list.',
          }
        }
        throw new Error(`Could not load Minecraft versions: ${error.message}`)
      } finally {
        this.pendingFetch = null
      }
    })()
    return this.pendingFetch
  }

  async getVersionJson(versionId, { manifest = null, force = false } = {}) {
    const safeId = safeSegment(versionId, 'Version ID')
    const versionManifest = manifest || (await this.getManifest())
    const entry = versionManifest.versions.find((version) => version.id === safeId)
    if (!entry) throw new Error(`Minecraft version "${safeId}" was not found in the version manifest.`)
    const cachePath = path.join(this.paths.versionCacheRoot, `${safeId}.json`)

    if (!force) {
      const text = await fsp.readFile(cachePath, 'utf8').catch(() => null)
      if (text) {
        const hash = crypto.createHash('sha1').update(text).digest('hex')
        if (!entry.sha1 || hash === entry.sha1) {
          try {
            const parsed = JSON.parse(text)
            if (parsed.id === safeId) return parsed
          } catch {
            // Cache is corrupt, fetch a fresh copy.
          }
        }
      }
    }

    try {
      const response = await fetchWithRetry(
        entry.url,
        { headers: { Accept: 'application/json', 'User-Agent': 'AquaLauncher/1.0.0' } },
        { attempts: 2, timeoutMs: 30_000, logger: this.logger },
      )
      const text = await response.text()
      if (entry.sha1) {
        const hash = crypto.createHash('sha1').update(text).digest('hex')
        if (hash !== entry.sha1) throw new Error('Version metadata failed its integrity check.')
      }
      const parsed = JSON.parse(text)
      if (!parsed || parsed.id !== safeId) throw new Error('Minecraft returned mismatched version metadata.')
      await atomicWriteFile(cachePath, text, 'utf8')
      this.logger.info('Downloaded Minecraft version metadata', { version: safeId })
      return parsed
    } catch (error) {
      this.logger.error('Failed to fetch Minecraft version metadata', { version: safeId, message: error.message })
      throw new Error(`Could not load Minecraft ${safeId}: ${error.message}`)
    }
  }

  async getInheritanceChain(versionJson, { manifest = null } = {}) {
    const chain = [versionJson]
    let current = versionJson
    const seen = new Set([versionJson.id])
    while (current.inheritsFrom) {
      const parentId = safeSegment(current.inheritsFrom, 'Parent version')
      if (seen.has(parentId)) throw new Error('The version inheritance chain is circular.')
      seen.add(parentId)
      current = await this.getVersionJson(parentId, { manifest })
      chain.push(current)
    }
    return chain
  }
}

export { MANIFEST_URL }
