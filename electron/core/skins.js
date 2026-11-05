import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { privateDirectoryCandidates } from './private-credentials.js'
import { fetchWithRetry } from './util.js'

const API_BASE = 'https://mcstat.org/api/v1'
// The key file ships outside the packaged app, exactly like the Microsoft app
// credentials: the renderer never sees the key.
const KEY_FILES = ['skin.txt', 'mcstat.txt', 'mcstat.json']
const KEY_PATTERN = /^mcs_[A-Za-z0-9_-]{4,}$/
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,120}$/
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_SKIN_BYTES = 1024 * 1024
const CACHED_TEXTURES = 80
const DEFAULT_LIMIT = 24
const SORTS = ['recent', 'popular', 'trending']

function findApiKey(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null
  if (KEY_PATTERN.test(text)) return text
  if (!text.startsWith('{')) return null
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  for (const value of Object.values(parsed)) {
    if (typeof value === 'string' && KEY_PATTERN.test(value.trim())) return value.trim()
  }
  return null
}

/**
 * Reads the MCStat API key from `private/skin.txt` on every call, so the key can
 * be rotated without restarting the launcher. Returns null when it is missing.
 */
export function readSkinApiKey({ directory = null } = {}) {
  const candidates = directory ? [path.resolve(directory)] : privateDirectoryCandidates()
  for (const dir of candidates) {
    for (const name of KEY_FILES) {
      try {
        const key = findApiKey(fs.readFileSync(path.join(dir, name), 'utf8'))
        if (key) return key
      } catch {
        // Try the next candidate file.
      }
    }
  }
  return null
}

function isSkinPngUrl(value) {
  try {
    const url = new URL(String(value))
    return (
      url.protocol === 'https:' &&
      url.hostname === 'mcstat.org' &&
      url.pathname.startsWith('/media/skins/') &&
      url.pathname.toLowerCase().endsWith('.png')
    )
  } catch {
    return false
  }
}

function pngDataUrl(buffer) {
  if (!buffer?.length || buffer.length > MAX_SKIN_BYTES) return null
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null
  return `data:image/png;base64,${buffer.toString('base64')}`
}

/** Only the fields the launcher needs, and only from mcstat.org. */
export function normalizeSkinSummary(raw) {
  if (!raw || typeof raw !== 'object') return null
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : ''
  const pngPath = typeof raw.pngPath === 'string' ? raw.pngPath.trim() : ''
  if (!SLUG_PATTERN.test(slug) || !isSkinPngUrl(pngPath)) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : slug,
    slug,
    name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : slug).slice(0, 80),
    model: raw.model === 'slim' ? 'slim' : 'classic',
    pngPath,
  }
}

/**
 * Browses the community skin library and stores the chosen skin on the player
 * profile. Skins are downloaded in the main process, so the API key and the
 * texture bytes never pass through the renderer's network stack.
 */
export class SkinService {
  constructor({ paths, store, logger, onAccountsChanged = null, snapshot = null, fetchImpl = null }) {
    this.paths = paths
    this.store = store
    this.logger = logger
    this.onAccountsChanged = onAccountsChanged
    this.snapshot = snapshot
    this.fetchImpl = fetchImpl || ((url, options) => fetch(url, options))
    this.textures = new Map()
  }

  cacheDirectory() {
    return path.join(this.paths.cacheRoot, 'skins')
  }

  remember(key, dataUrl) {
    if (this.textures.size >= CACHED_TEXTURES) {
      const oldest = this.textures.keys().next().value
      if (oldest !== undefined) this.textures.delete(oldest)
    }
    this.textures.set(key, dataUrl)
  }

  async request(pathname, params) {
    const apiKey = readSkinApiKey()
    if (!apiKey) {
      throw new Error(
        'Skin browsing is not configured for this build. Add the MCStat API key to private/skin.txt as {"McStat": "mcs_..."}.',
      )
    }
    const url = new URL(`${API_BASE}${pathname}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    let response
    try {
      response = await fetchWithRetry(
        url.toString(),
        {
          headers: {
            'X-API-Key': apiKey,
            Accept: 'application/json',
            'User-Agent': 'AquaLauncher/1.0.0',
          },
        },
        { attempts: 2, timeoutMs: 15_000, logger: this.logger },
      )
    } catch (error) {
      throw new Error(`Could not reach the skin library: ${error.message}`)
    }
    if (response.status === 401) throw new Error('MCStat rejected the skin API key. Check private/skin.txt.')
    if (response.status === 403) throw new Error('This MCStat skin API key is disabled.')
    if (response.status === 429) {
      throw new Error('The skin library rate limit was reached. Try again in a minute.')
    }
    if (!response.ok) throw new Error(`The skin library returned HTTP ${response.status}.`)
    try {
      return await response.json()
    } catch {
      throw new Error('The skin library returned an unreadable response.')
    }
  }

  async list({ page = 1, limit = DEFAULT_LIMIT, search = '', sort = 'popular', model = null } = {}) {
    const safePage = Math.max(1, Math.min(500, Math.floor(Number(page) || 1)))
    const safeLimit = Math.max(1, Math.min(48, Math.floor(Number(limit) || DEFAULT_LIMIT)))
    const safeSort = SORTS.includes(sort) ? sort : 'popular'
    const safeModel = model === 'classic' || model === 'slim' ? model : null
    const query = String(search ?? '').trim().slice(0, 48)

    const body = await this.request('/skins', {
      page: safePage,
      limit: safeLimit,
      sort: safeSort,
      model: safeModel,
      search: query,
    })
    const entries = Array.isArray(body?.data?.skins) ? body.data.skins : []
    const skins = await Promise.all(
      entries.map(async (entry) => {
        const summary = normalizeSkinSummary(entry)
        if (!summary) return null
        const textureDataUrl = await this.texture(summary).catch(() => null)
        return { ...summary, textureDataUrl }
      }),
    )
    const pagination = body?.data?.pagination || {}
    return {
      skins: skins.filter(Boolean),
      page: Number(pagination.page) || safePage,
      totalPages: Math.max(1, Number(pagination.totalPages) || 1),
      total: Number(pagination.total) || 0,
    }
  }

  /** Returns a cached PNG data URL so the renderer can draw the skin off-line. */
  async texture(skin) {
    const key = skin.slug
    const cached = this.textures.get(key)
    if (cached) return cached

    const file = path.join(this.cacheDirectory(), `${skin.slug}.png`)
    const onDisk = await fsp.readFile(file).catch(() => null)
    const cachedDataUrl = onDisk ? pngDataUrl(onDisk) : null
    if (cachedDataUrl) {
      this.remember(key, cachedDataUrl)
      return cachedDataUrl
    }

    let response
    try {
      response = await fetchWithRetry(
        skin.pngPath,
        { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
        { attempts: 2, timeoutMs: 15_000, logger: this.logger },
      )
    } catch (error) {
      throw new Error(`Could not download that skin: ${error.message}`)
    }
    if (!response.ok) throw new Error(`Could not download that skin (HTTP ${response.status}).`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const dataUrl = pngDataUrl(buffer)
    if (!dataUrl) throw new Error('That skin file is not a usable PNG.')

    await fsp.mkdir(this.cacheDirectory(), { recursive: true }).catch(() => {})
    await fsp.writeFile(file, buffer, { mode: 0o600 }).catch(() => {})
    this.remember(key, dataUrl)
    return dataUrl
  }

  account(accountId) {
    const account = this.store.getAccount(accountId)
    if (!account) throw new Error('That player profile no longer exists.')
    return account
  }

  async apply(accountId, skin) {
    const account = this.account(accountId)
    const summary = normalizeSkinSummary(skin)
    if (!summary) throw new Error('That skin is not available from the library.')
    const textureDataUrl = await this.texture(summary)
    await this.store.updateAccount(account.id, {
      skin: {
        id: summary.id,
        slug: summary.slug,
        name: summary.name,
        model: summary.model,
        textureDataUrl,
      },
    })
    this.onAccountsChanged?.()
    this.logger.info('Profile skin updated', { account: account.name, skin: summary.slug })
    return this.snapshot?.() ?? null
  }

  async clear(accountId) {
    const account = this.account(accountId)
    await this.store.updateAccount(account.id, { skin: null })
    this.onAccountsChanged?.()
    this.logger.info('Profile skin removed', { account: account.name })
    return this.snapshot?.() ?? null
  }
}
