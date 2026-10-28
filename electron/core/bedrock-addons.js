import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, isPathInside, sanitizeFileName, slugify } from './util.js'

/**
 * Bedrock add-ons are ZIP containers (.mcpack / .mcaddon) holding one or more
 * packs, each with a manifest.json. The game reads them from these folders inside
 * com.mojang, so installing is a matter of unpacking them in the right place.
 */
export const ADDON_KINDS = [
  { id: 'behavior_pack', folder: 'behavior_packs', label: 'Behavior pack', moduleType: 'data' },
  { id: 'resource_pack', folder: 'resource_packs', label: 'Resource pack', moduleType: 'resources' },
  { id: 'skin_pack', folder: 'skin_packs', label: 'Skin pack', moduleType: 'skin' },
]

const MAX_PACKAGE_BYTES = 512 * 1024 * 1024

/** Files the Bedrock sites hand out; the launcher can install all three. */
export const ADDON_EXTENSIONS = ['.mcpack', '.mcaddon', '.mcworld']

export function isAddonFileName(name) {
  const lower = String(name || '').toLowerCase()
  return ADDON_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** `pack.name` style keys point into the pack's own language files. */
export function resolveText(value, translations) {
  if (typeof value === 'string') {
    const key = value.trim()
    if (key && translations && Object.prototype.hasOwnProperty.call(translations, key)) return translations[key]
    return key
  }
  if (value && typeof value === 'object') {
    const preferred = value.en_US || value.en_GB || Object.values(value)[0]
    return typeof preferred === 'string' ? preferred : ''
  }
  return ''
}

export function parseLangFile(text) {
  const translations = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 1) continue
    translations[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return translations
}

export function addonKindForModules(modules) {
  const types = (Array.isArray(modules) ? modules : []).map((module) => String(module?.type || '').toLowerCase())
  if (types.includes('data') || types.includes('script')) return 'behavior_pack'
  if (types.includes('resources')) return 'resource_pack'
  if (types.includes('skin')) return 'skin_pack'
  return null
}

/** The shape the launcher shows for one installed pack. */
export function parsePackManifest(manifestText, translations = {}) {
  let raw
  try {
    raw = JSON.parse(manifestText)
  } catch {
    return null
  }
  const header = raw?.header || {}
  const kind = addonKindForModules(raw?.modules)
  const name = resolveText(header.name, translations).slice(0, 120)
  if (!name) return null
  const version = Array.isArray(header.version) ? header.version.join('.') : null
  return {
    name,
    description: resolveText(header.description, translations).slice(0, 400) || null,
    uuid: typeof header.uuid === 'string' ? header.uuid : null,
    version,
    kind,
  }
}

/** Every folder inside the archive that holds a manifest.json. */
export function manifestRoots(entries) {
  const roots = new Set()
  for (const entry of entries) {
    const name = String(entry.entryName || '').replace(/\\/g, '/')
    const match = /^(.*?)(?:^|\/)manifest\.json$/i.exec(name)
    if (!match) continue
    roots.add(match[1] ? `${match[1].replace(/\/+$/, '')}/` : '')
  }
  return [...roots]
}

function entryName(entry) {
  return String(entry.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function folderNameFor(pack) {
  const base = slugify(pack.name) || 'pack'
  const suffix = pack.uuid ? pack.uuid.replace(/[^a-z0-9]/gi, '').slice(0, 8) : ''
  return sanitizeFileName(suffix ? `${base}-${suffix}` : base, 'pack')
}

async function readManifest(zip, root) {
  const entry = zip.getEntry(`${root}manifest.json`) || zip.getEntry(`${root}Manifest.json`)
  if (!entry) return null
  const text = entry.getData().toString('utf8')
  const lang = zip.getEntry(`${root}texts/en_US.lang`) || zip.getEntry(`${root}texts/en_GB.lang`)
  const translations = lang ? parseLangFile(lang.getData().toString('utf8')) : {}
  return parsePackManifest(text, translations)
}

async function writeEntry(target, data) {
  await ensureDir(path.dirname(target))
  await fsp.writeFile(target, data)
}

async function extractPrefix(zip, root, destination) {
  const rootPath = path.resolve(destination)
  let files = 0
  for (const entry of zip.getEntries()) {
    const name = entryName(entry)
    if (root && !name.startsWith(root)) continue
    const relative = root ? name.slice(root.length) : name
    if (!relative || entry.isDirectory) continue
    const target = path.resolve(rootPath, relative)
    if (target === rootPath || !isPathInside(target, rootPath)) continue
    await writeEntry(target, entry.getData())
    files += 1
    if (files % 8 === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  return files
}

async function directoryStats(root) {
  let files = 0
  let bytes = 0
  const walk = async (current, depth) => {
    if (depth > 5) return
    let entries = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1)
      } else if (entry.isFile()) {
        const stat = await fsp.stat(entryPath).catch(() => null)
        if (stat) {
          files += 1
          bytes += stat.size
        }
      }
    }
  }
  await walk(root, 0)
  return { files, bytes }
}

export class BedrockAddonsService {
  constructor({ logger, bedrockService }) {
    this.logger = logger
    this.bedrockService = bedrockService
  }

  async editionRoot(editionId) {
    const edition = await this.bedrockService.find(editionId)
    await ensureDir(edition.dataRoot).catch(() => {})
    return edition
  }

  kindFolder(dataRoot, kind) {
    const found = ADDON_KINDS.find((item) => item.id === kind)
    if (!found) throw new Error('That add-on type is not supported.')
    const folder = path.resolve(dataRoot, found.folder)
    if (!isPathInside(folder, path.resolve(dataRoot))) throw new Error('That add-on folder is invalid.')
    return folder
  }

  async list(editionId) {
    const edition = await this.editionRoot(editionId)
    const packs = []
    for (const kind of ADDON_KINDS) {
      const directory = path.join(edition.dataRoot, kind.folder)
      let entries = []
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const packDir = path.join(directory, entry.name)
        const manifest = await fsp.readFile(path.join(packDir, 'manifest.json'), 'utf8').catch(() => null)
        if (!manifest) continue
        const lang = await fsp.readFile(path.join(packDir, 'texts', 'en_US.lang'), 'utf8').catch(() => null)
        const pack = parsePackManifest(manifest, lang ? parseLangFile(lang) : {})
        if (!pack) continue
        const [stats, stat] = await Promise.all([directoryStats(packDir), fsp.stat(packDir).catch(() => null)])
        packs.push({
          folder: entry.name,
          kind: kind.id,
          packKind: pack.kind,
          name: pack.name,
          description: pack.description,
          uuid: pack.uuid,
          version: pack.version,
          sizeBytes: stats.bytes,
          files: stats.files,
          modified: stat?.mtime?.toISOString() || null,
        })
      }
    }
    packs.sort((a, b) => a.name.localeCompare(b.name))
    return {
      editionId,
      editionName: edition.name,
      dataRoot: edition.dataRoot,
      worldsDirectory: edition.worldsDirectory,
      packs,
    }
  }

  /** Installs .mcpack / .mcaddon (packs) or .mcworld (a world) files. */
  async import(editionId, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Choose an add-on file first.')
    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('That file could not be read.')
    if (stat.size > MAX_PACKAGE_BYTES) throw new Error('That file is too large to be an add-on.')

    const edition = await this.editionRoot(editionId)
    let zip
    try {
      zip = new AdmZip(filePath)
    } catch {
      throw new Error('That file is not a Bedrock add-on. Use a .mcpack, .mcaddon, or .mcworld file.')
    }

    const entries = zip.getEntries()
    const isWorld = /\.mcworld$/i.test(filePath) || entries.some((entry) => entryName(entry) === 'level.dat')
    if (isWorld) {
      const name = path.basename(filePath, path.extname(filePath))
      const folder = sanitizeFileName(slugify(name) || 'imported-world', 'imported-world')
      const destination = path.join(edition.worldsDirectory, folder)
      if (!isPathInside(path.resolve(destination), path.resolve(edition.worldsDirectory))) {
        throw new Error('That world name is invalid.')
      }
      await fsp.rm(destination, { recursive: true, force: true }).catch(() => {})
      await extractPrefix(zip, '', destination)
      this.logger?.info('Imported a Bedrock world', { editionId, folder })
      return { installed: [], skipped: [], worlds: [folder] }
    }

    const roots = manifestRoots(entries)
    if (!roots.length) throw new Error('That file does not contain a Bedrock pack (no manifest.json).')
    const installed = []
    const skipped = []
    for (const root of roots) {
      const pack = await readManifest(zip, root)
      if (!pack) {
        skipped.push(root ? root.replace(/\/$/, '') : 'root')
        continue
      }
      const kind = ADDON_KINDS.find((item) => item.id === pack.kind)
      if (!kind) {
        skipped.push(pack.name)
        continue
      }
      const directory = this.kindFolder(edition.dataRoot, kind.id)
      const folder = folderNameFor(pack)
      const destination = path.join(directory, folder)
      if (!isPathInside(path.resolve(destination), path.resolve(directory))) {
        skipped.push(pack.name)
        continue
      }
      await fsp.rm(destination, { recursive: true, force: true }).catch(() => {})
      const files = await extractPrefix(zip, root, destination)
      if (!files) {
        skipped.push(pack.name)
        continue
      }
      installed.push({ kind: kind.id, kindLabel: kind.label, name: pack.name, folder, version: pack.version })
    }

    if (!installed.length) throw new Error('That file did not contain a pack the game can read.')
    this.logger?.info('Imported Bedrock add-ons', { editionId, count: installed.length })
    return { installed, skipped, worlds: [] }
  }

  async remove(editionId, kind, folder) {
    const edition = await this.editionRoot(editionId)
    if (typeof folder !== 'string' || !folder || folder !== path.basename(folder) || folder === '.' || folder === '..') {
      throw new Error('That pack folder is invalid.')
    }
    const directory = this.kindFolder(edition.dataRoot, kind)
    const target = path.resolve(directory, folder)
    if (!isPathInside(target, path.resolve(directory)) || target === path.resolve(directory)) {
      throw new Error('That pack folder is outside the add-ons directory.')
    }
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('That pack is no longer installed.')
    await fsp.rm(target, { recursive: true, force: true })
    this.logger?.info('Removed a Bedrock add-on', { editionId, kind, folder })
    return { folder, kind }
  }

  async folderPath(editionId, kind = null) {
    const edition = await this.editionRoot(editionId)
    if (!kind) {
      await ensureDir(edition.dataRoot).catch(() => {})
      return edition.dataRoot
    }
    const directory = this.kindFolder(edition.dataRoot, kind)
    await ensureDir(directory).catch(() => {})
    return directory
  }
}
