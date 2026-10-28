import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson, ensureDir, fileExists, isPathInside, readJsonFile } from './util.js'

/**
 * Official block textures for Settings → Appearance → Custom block theme.
 *
 * The launcher bundles no Minecraft art. Instead the client jar of an installed
 * version is read and the 16×16 block textures are copied into the launcher's
 * cache, so the theme uses the player's own game files (mod resource packs in
 * the jar are respected too). Deleted or uninstalled versions simply yield no
 * textures, and the UI asks for an installation.
 */

/** Theme block ids → texture file names, modern first with legacy aliases. */
export const BLOCK_TEXTURE_FILES = {
  grass_block: ['grass_block_side', 'grass_side', 'grass_block_top', 'grass_top'],
  dirt: ['dirt'],
  stone: ['stone'],
  cobblestone: ['cobblestone'],
  mossy_cobblestone: ['mossy_cobblestone'],
  gravel: ['gravel'],
  sand: ['sand'],
  oak_planks: ['oak_planks', 'planks_oak'],
  spruce_planks: ['spruce_planks', 'planks_spruce'],
  oak_log: ['oak_log', 'log_oak'],
  leaves: ['oak_leaves', 'leaves_oak'],
  glass: ['glass'],
  netherrack: ['netherrack'],
  nether_bricks: ['nether_bricks', 'nether_brick'],
  soul_sand: ['soul_sand'],
  end_stone: ['end_stone'],
  purpur_block: ['purpur_block'],
  obsidian: ['obsidian'],
  bedrock: ['bedrock'],
  deepslate: ['deepslate'],
  sculk: ['sculk'],
  amethyst_block: ['amethyst_block'],
  diamond_ore: ['diamond_ore'],
  gold_ore: ['gold_ore'],
  redstone_ore: ['redstone_ore'],
  emerald_ore: ['emerald_ore'],
  diamond_block: ['diamond_block'],
  gold_block: ['gold_block'],
  emerald_block: ['emerald_block'],
  netherite_block: ['netherite_block'],
  prismarine: ['prismarine'],
  ice: ['ice'],
}

/** 1.13+ uses `textures/block`; older jars use the plural directory. */
const TEXTURE_DIRECTORIES = ['assets/minecraft/textures/block', 'assets/minecraft/textures/blocks']
const MAX_TEXTURE_BYTES = 512 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const VERSION_ID = /^[A-Za-z0-9._+-]{1,96}$/

export function looksLikePng(data) {
  return Buffer.isBuffer(data) && data.length > PNG_SIGNATURE.length && data.subarray(0, 8).equals(PNG_SIGNATURE)
}

/** First matching PNG entry for a theme block, modern directory first. */
export function findBlockTexture(entries, blockId) {
  const names = BLOCK_TEXTURE_FILES[blockId]
  if (!names) return null
  for (const directory of TEXTURE_DIRECTORIES) {
    for (const name of names) {
      const entry = entries.get(`${directory}/${name}.png`)
      if (entry) return entry
    }
  }
  return null
}

function textureDataUrl(data) {
  return `data:image/png;base64,${data.toString('base64')}`
}

function emptyResult() {
  return { available: false, versionId: null, textures: {}, missing: Object.keys(BLOCK_TEXTURE_FILES) }
}

function cacheKey(versionId) {
  return versionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'unknown'
}

export class BlockTextureService {
  constructor({ paths, installationService, logger }) {
    this.paths = paths
    this.installationService = installationService
    this.logger = logger
    this.cacheRoot = path.join(paths.cacheRoot, 'block-textures')
    this.pending = null
  }

  /** Textures for the newest installed client jar, cached on disk. */
  async list(options = {}) {
    if (this.pending) return this.pending
    this.pending = this.load(options.force === true).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async load(force) {
    const candidates = await this.candidates()
    for (const candidate of candidates) {
      try {
        const result = await this.extract(candidate, force)
        if (Object.keys(result.textures).length > 0) {
          return { available: true, versionId: candidate.versionId, textures: result.textures, missing: result.missing }
        }
      } catch (error) {
        this.logger?.warn('Could not read Minecraft block textures', {
          version: candidate.versionId,
          message: error.message,
        })
      }
    }
    return emptyResult()
  }

  /** Installed profiles first, then any version folder that still has a jar. */
  async candidates() {
    let installations = []
    if (this.installationService) {
      installations = await this.installationService.list().catch(() => [])
    }
    const ordered = []
    if (Array.isArray(installations)) {
      const active = installations.find((installation) => installation.isActive)
      if (active) ordered.push(active)
      for (const installation of installations) if (installation !== active) ordered.push(installation)
    }

    const result = []
    const seen = new Set()
    for (const installation of ordered) {
      const candidate = await this.resolveJar(installation?.effectiveVersionId)
      if (candidate && !seen.has(candidate.jarPath)) {
        seen.add(candidate.jarPath)
        result.push(candidate)
      }
    }

    const entries = await fsp.readdir(this.paths.versionsRoot, { withFileTypes: true }).catch(() => [])
    const jars = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !VERSION_ID.test(entry.name)) continue
      const jarPath = path.join(this.paths.versionsRoot, entry.name, `${entry.name}.jar`)
      if (!isPathInside(jarPath, this.paths.versionsRoot)) continue
      const stat = await fsp.stat(jarPath).catch(() => null)
      if (stat?.isFile()) jars.push({ versionId: entry.name, jarPath, mtimeMs: stat.mtimeMs })
    }
    jars.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const jar of jars) {
      if (seen.has(jar.jarPath)) continue
      seen.add(jar.jarPath)
      result.push({ versionId: jar.versionId, jarPath: jar.jarPath })
    }
    return result
  }

  /** Loader profiles inherit a vanilla client jar through `jarVersionId`. */
  async resolveJar(versionId) {
    if (typeof versionId !== 'string' || !VERSION_ID.test(versionId)) return null
    const meta = await readJsonFile(path.join(this.paths.versionsRoot, versionId, `${versionId}.json`), null)
    const jarVersionId =
      typeof meta?.jarVersionId === 'string' && VERSION_ID.test(meta.jarVersionId) ? meta.jarVersionId : versionId
    const jarPath = path.join(this.paths.versionsRoot, jarVersionId, `${jarVersionId}.jar`)
    if (!isPathInside(jarPath, this.paths.versionsRoot)) return null
    if (!(await fileExists(jarPath))) return null
    return { versionId: jarVersionId, jarPath }
  }

  async extract(candidate, force) {
    const stat = await fsp.stat(candidate.jarPath)
    const cacheDir = path.join(this.cacheRoot, cacheKey(candidate.versionId))
    const manifestPath = path.join(cacheDir, 'manifest.json')

    if (!force) {
      const manifest = await readJsonFile(manifestPath, null)
      const cached = await this.readCache(cacheDir, manifest, stat)
      if (cached) return cached
    }

    const zip = new AdmZip(candidate.jarPath)
    const entries = new Map()
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory) entries.set(entry.entryName, entry)
    }

    await ensureDir(cacheDir)
    const textures = {}
    const files = {}
    for (const blockId of Object.keys(BLOCK_TEXTURE_FILES)) {
      const entry = findBlockTexture(entries, blockId)
      if (!entry) continue
      try {
        const data = entry.getData()
        if (!looksLikePng(data) || data.length > MAX_TEXTURE_BYTES) continue
        await fsp.writeFile(path.join(cacheDir, `${blockId}.png`), data)
        files[blockId] = `${blockId}.png`
        textures[blockId] = textureDataUrl(data)
      } catch (error) {
        this.logger?.debug('Skipped an unreadable block texture', { blockId, message: error.message })
      }
    }

    await atomicWriteJson(manifestPath, {
      versionId: candidate.versionId,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      files,
      extractedAt: new Date().toISOString(),
    })

    return { textures, missing: Object.keys(BLOCK_TEXTURE_FILES).filter((blockId) => !textures[blockId]) }
  }

  /** Cached PNGs are only trusted while the jar they came from is unchanged. */
  async readCache(cacheDir, manifest, stat) {
    if (!manifest || manifest.size !== stat.size || manifest.mtimeMs !== stat.mtimeMs) return null
    if (!manifest.files || typeof manifest.files !== 'object') return null
    const textures = {}
    for (const [blockId, file] of Object.entries(manifest.files)) {
      if (typeof file !== 'string' || !/^[a-z0-9_]+\.png$/.test(file)) return null
      const data = await fsp.readFile(path.join(cacheDir, file)).catch(() => null)
      if (!looksLikePng(data)) return null
      textures[blockId] = textureDataUrl(data)
    }
    return { textures, missing: Object.keys(BLOCK_TEXTURE_FILES).filter((blockId) => !textures[blockId]) }
  }
}
