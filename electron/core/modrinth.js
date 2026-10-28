import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { downloadFiles } from './downloader.js'
import { ensureDir, fetchJson, fileExists, isPathInside, randomId, uniqueName } from './util.js'

const API = 'https://api.modrinth.com/v2'
const MOD_LOADER_CATEGORIES = new Set(['fabric', 'quilt', 'forge', 'neoforge'])

/**
 * Modrinth project types that install into a folder inside the game directory.
 * Modpacks are handled separately: they become their own installation.
 */
const CONTENT_TYPES = {
  mod: { label: 'mod', directory: 'mods', extension: '.jar', needsLoader: true },
  resourcepack: { label: 'resource pack', directory: 'resourcepacks', extension: '.zip', needsLoader: false },
  shader: { label: 'shader pack', directory: 'shaderpacks', extension: '.zip', needsLoader: false },
}

const CONTENT_TYPE_IDS = ['mod', 'modpack', 'resourcepack', 'shader']

function normalizeContentType(value) {
  const type = typeof value === 'string' && value ? value : 'mod'
  if (!CONTENT_TYPE_IDS.includes(type)) throw new Error('That Modrinth content type is not supported.')
  return type
}

function modrinthLoader(installation) {
  const type = installation.loader?.type || 'vanilla'
  return MOD_LOADER_CATEGORIES.has(type) ? type : null
}

/** Modpacks declare their loader in `dependencies`, e.g. `fabric-loader` or `neoforge`. */
function resolvePackLoader(dependencies) {
  const candidates = [
    ['fabric', dependencies['fabric-loader']],
    ['quilt', dependencies['quilt-loader']],
    ['neoforge', dependencies.neoforge],
    ['forge', dependencies.forge],
  ]
  for (const [type, version] of candidates) {
    if (typeof version === 'string' && version.trim()) return { type, version: version.trim() }
  }
  return { type: 'vanilla', version: null }
}

function normalizeModFiles(version) {
  const files = Array.isArray(version?.files) ? version.files : []
  const primary = files.find((file) => file.primary) || files[0]
  if (!primary?.url || !primary?.filename) throw new Error('That Modrinth version has no downloadable file.')
  return {
    url: primary.url,
    filename: path.basename(primary.filename),
    sha1: primary.hashes?.sha1 || null,
    size: Number.isFinite(primary.size) ? primary.size : null,
  }
}

async function sha1OfFile(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', () => resolve(null))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export class ModrinthService {
  constructor({ logger, installationService = null, jobManager = null, store = null, paths = null }) {
    this.logger = logger
    this.installationService = installationService
    this.jobManager = jobManager
    this.store = store
    this.paths = paths
  }

  headers() {
    return { Accept: 'application/json', 'User-Agent': 'AquaLauncher/1.0.0 (github.com/aqua-launcher)' }
  }

  ensureModdable(installation) {
    const loader = modrinthLoader(installation)
    if (!loader) {
      throw new Error('Add Fabric, Quilt, Forge, or NeoForge to this installation before using mods.')
    }
    return loader
  }

  contentDirectory(installation, contentType) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks do not install into a folder.')
    return path.join(installation.gameDir, spec.directory)
  }

  /** Reject anything that is not a plain file name inside the content folder. */
  resolveContentFile(installation, contentType, filename) {
    if (typeof filename !== 'string' || !filename.trim()) throw new Error('A file name is required.')
    if (filename !== path.basename(filename)) throw new Error('That file is outside the content folder.')
    const directory = this.contentDirectory(installation, contentType)
    const target = path.resolve(directory, filename)
    if (!isPathInside(target, directory)) throw new Error('That file is outside the content folder.')
    return target
  }

  resolveModFile(installation, filename) {
    return this.resolveContentFile(installation, 'mod', filename)
  }

  async search(installation, { query = '', offset = 0, limit = 20, contentType = 'mod' } = {}) {
    const type = normalizeContentType(contentType)
    // Modpacks carry their own Minecraft version and loader — installing one creates a
    // profile — so they can be browsed before any installation exists.
    if (type !== 'modpack' && !installation) {
      throw new Error('Choose an installation before browsing this content.')
    }
    const facets = [[`project_type:${type}`]]
    let loader = null
    if (type === 'mod') {
      loader = this.ensureModdable(installation)
      facets.push([`categories:${loader}`])
    }
    // Modpacks ship their own Minecraft version and loader, so they are not filtered
    // by the currently selected installation.
    if (type !== 'modpack') facets.push([`versions:${installation.versionId}`])

    const params = new URLSearchParams({
      query: String(query || '').slice(0, 120),
      facets: JSON.stringify(facets),
      index: 'relevance',
      limit: String(Math.min(Math.max(Number(limit) || 20, 1), 40)),
      offset: String(Math.max(Number(offset) || 0, 0)),
    })
    const payload = await fetchJson(`${API}/search?${params.toString()}`, { headers: this.headers() }, { logger: this.logger })
    const hits = Array.isArray(payload?.hits) ? payload.hits : []
    return {
      contentType: type,
      total: Number(payload?.total_hits) || 0,
      offset: Number(payload?.offset) || 0,
      limit: Number(payload?.limit) || hits.length,
      loader,
      minecraftVersion: type === 'modpack' ? null : installation.versionId,
      hits: hits.map((hit) => ({
        id: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        author: hit.author,
        iconUrl: hit.icon_url || null,
        downloads: Number(hit.downloads) || 0,
        follows: Number(hit.follows) || 0,
        projectType: hit.project_type || type,
        categories: Array.isArray(hit.categories) ? hit.categories : [],
        versions: Array.isArray(hit.versions) ? hit.versions : [],
        updated: hit.date_modified || null,
      })),
    }
  }

  async versions(projectId, { loader, minecraftVersion } = {}) {
    const params = new URLSearchParams()
    if (loader) params.set('loaders', JSON.stringify([loader]))
    if (minecraftVersion) params.set('game_versions', JSON.stringify([minecraftVersion]))
    const query = params.toString()
    const list = await fetchJson(
      `${API}/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ''}`,
      { headers: this.headers() },
      { logger: this.logger },
    )
    return Array.isArray(list) ? list : []
  }

  async install(installation, { projectId, versionId = null, contentType = 'mod' } = {}) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks are installed as their own installation.')
    if (!projectId) throw new Error(`Choose a ${spec.label} to install.`)

    const loader = spec.needsLoader ? this.ensureModdable(installation) : modrinthLoader(installation)
    const minecraftVersion = installation.versionId
    const contentDir = this.contentDirectory(installation, type)
    await ensureDir(contentDir)

    const candidates = await this.versions(projectId, {
      loader: spec.needsLoader ? loader : null,
      minecraftVersion,
    })
    if (!candidates.length) {
      throw new Error(`No ${spec.label} file is available for Minecraft ${minecraftVersion}${loader ? ` on ${loader}` : ''}.`)
    }

    const queue = []
    const seenProjects = new Set()
    const skipped = []

    const collect = async (id, wantedVersionId = null, depth = 0) => {
      if (!id || seenProjects.has(id) || depth > 4) return
      seenProjects.add(id)
      let pool = await this.versions(id, {
        loader: spec.needsLoader ? loader : null,
        minecraftVersion,
      })
      if (!pool.length) {
        skipped.push(id)
        return
      }
      let chosen = wantedVersionId ? pool.find((version) => version.id === wantedVersionId) : null
      chosen = chosen || pool[0]
      const files = normalizeModFiles(chosen)
      queue.push({
        projectId: id,
        versionId: chosen.id,
        name: chosen.name || chosen.version_number || files.filename,
        versionNumber: chosen.version_number || '',
        file: files,
      })
      // Only mods pull in required dependencies; packs are standalone files.
      if (!spec.needsLoader) return
      for (const dependency of Array.isArray(chosen.dependencies) ? chosen.dependencies : []) {
        if (dependency?.dependency_type !== 'required' || !dependency?.project_id) continue
        await collect(dependency.project_id, dependency.version_id || null, depth + 1)
      }
    }

    await collect(projectId, versionId)

    const downloads = []
    for (const entry of queue) {
      downloads.push({
        url: entry.file.url,
        destination: this.resolveContentFile(installation, type, entry.file.filename),
        sha1: entry.file.sha1,
        size: entry.file.size,
      })
    }

    if (downloads.length) {
      await downloadFiles(downloads, {
        concurrency: 3,
        logger: this.logger,
        attempts: 3,
      })
    }

    this.logger?.info(`Installed Modrinth ${spec.label}`, {
      installation: installation.name,
      loader,
      minecraftVersion,
      contentType: type,
      files: downloads.length,
    })

    return {
      contentType: type,
      installed: queue.map((entry) => ({
        projectId: entry.projectId,
        versionId: entry.versionId,
        name: entry.name,
        versionNumber: entry.versionNumber,
        filename: entry.file.filename,
      })),
      skipped,
    }
  }

  /**
   * Installs a Modrinth modpack (.mrpack) as a fresh installation:
   * the pack manifest names its Minecraft version, loader, overrides and files.
   */
  async installModpack({ projectId, versionId = null } = {}) {
    if (!projectId) throw new Error('Choose a modpack to install.')
    if (!this.installationService || !this.jobManager || !this.paths) {
      throw new Error('Modpack installation is not available in this build.')
    }
    const versions = await this.versions(projectId)
    const chosen = (versionId && versions.find((version) => version.id === versionId)) || versions[0]
    if (!chosen) throw new Error('That modpack has no downloadable versions.')

    const file = normalizeModFiles(chosen)
    if (!/\.mrpack$/i.test(file.filename)) throw new Error('That modpack does not provide a .mrpack file.')
    const cacheDir = path.join(this.paths.cacheRoot, 'modpacks')
    await ensureDir(cacheDir)
    const archivePath = path.join(cacheDir, `${randomId()}-${path.basename(file.filename)}`)
    await downloadFiles([{ url: file.url, destination: archivePath, sha1: file.sha1, size: file.size }], {
      concurrency: 1,
      logger: this.logger,
      attempts: 3,
    })

    // The pack becomes a profile, so remember which project it came from along
    // with its Modrinth icon; that is what the profile then shows as its logo.
    const projectKey = chosen.project_id || projectId
    const project = projectKey ? (await this.lookupProjects([projectKey]))[projectKey] : null
    const packProject = {
      projectId: project?.id || projectKey || null,
      name: project?.title || chosen.name || null,
      iconUrl: project?.icon_url || null,
      versionId: chosen.id || null,
    }

    try {
      return await this.installModpackArchive(archivePath, chosen, packProject)
    } finally {
      await fsp.rm(archivePath, { force: true }).catch(() => {})
    }
  }

  async installModpackArchive(archivePath, chosenVersion, packProject = null) {
    let zip
    try {
      zip = new AdmZip(archivePath)
    } catch {
      throw new Error('That modpack download is not a valid .mrpack archive.')
    }
    const indexEntry = zip.getEntry('modrinth.index.json')
    if (!indexEntry) throw new Error('That modpack is missing its modrinth.index.json manifest.')
    let index
    try {
      index = JSON.parse(indexEntry.getData().toString('utf8'))
    } catch {
      throw new Error('The modpack manifest could not be read.')
    }

    const dependencies = index?.dependencies && typeof index.dependencies === 'object' ? index.dependencies : {}
    const minecraftVersion = typeof dependencies.minecraft === 'string' ? dependencies.minecraft.trim() : ''
    if (!minecraftVersion) throw new Error('The modpack does not specify a Minecraft version.')
    const loader = resolvePackLoader(dependencies)

    const packVersion = typeof index.versionId === 'string' ? index.versionId : chosenVersion?.version_number || ''
    const preferredName =
      (typeof index.name === 'string' && index.name.trim()) || chosenVersion?.name || 'Modpack'
    const name = uniqueName(
      preferredName.trim().slice(0, 48),
      this.store?.installations?.map((installation) => installation.name) || [],
    )

    // Validate file paths before creating anything so a malformed pack cannot
    // leave a half-made installation behind.
    const packRoot = path.resolve(os.tmpdir(), 'aqua-modpack-root')
    const packFiles = []
    for (const entry of Array.isArray(index.files) ? index.files : []) {
      if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) continue
      if (entry.env?.client === 'unsupported') continue
      const urls = Array.isArray(entry.downloads) ? entry.downloads.filter((url) => typeof url === 'string') : []
      if (!urls.length) continue
      if (!isPathInside(path.resolve(packRoot, entry.path), packRoot)) {
        throw new Error('That modpack tries to write outside the game folder.')
      }
      packFiles.push({
        relativePath: entry.path,
        url: urls[0],
        sha1: entry.hashes?.sha1 || null,
        size: Number.isFinite(entry.fileSize) ? entry.fileSize : null,
      })
    }

    const installation = await this.installationService.create({
      name,
      versionId: minecraftVersion,
      loader: loader.type === 'vanilla' ? null : { type: loader.type, version: loader.version },
      modpack: packProject?.projectId
        ? {
            projectId: packProject.projectId,
            name: (packProject.name || preferredName).trim().slice(0, 80),
            iconUrl: packProject.iconUrl || null,
            versionId: packProject.versionId || null,
          }
        : null,
    })

    const overrides = await this.extractPackOverrides(zip, installation.gameDir)
    const downloads = packFiles.map((entry) => ({
      url: entry.url,
      destination: path.resolve(installation.gameDir, entry.relativePath),
      sha1: entry.sha1,
      size: entry.size,
    }))

    if (downloads.length) {
      await downloadFiles(downloads, { concurrency: 6, logger: this.logger, attempts: 3 })
    }

    // Game files (Minecraft, loader profile, libraries) still need downloading.
    const job = this.jobManager.enqueueInstall(installation.id)
    this.logger?.info('Installed Modrinth modpack', {
      name: installation.name,
      minecraftVersion,
      loader: loader.type,
      files: downloads.length,
      overrides,
    })

    return {
      installation,
      job,
      modpack: {
        name: installation.name,
        packName: preferredName,
        version: packVersion,
        minecraftVersion,
        loader: loader.type,
        loaderVersion: loader.version,
        files: downloads.length,
        overrides,
      },
    }
  }

  /** Copies `overrides/` and `client-overrides/` out of an .mrpack into the game directory. */
  async extractPackOverrides(zip, gameDir) {
    let written = 0
    for (const entry of zip.getEntries()) {
      const entryName = String(entry.entryName || '').replace(/\\/g, '/')
      const match = /^(?:client-)?overrides\/(.+)$/.exec(entryName)
      if (!match || entry.isDirectory) continue
      const relative = match[1]
      if (!relative || relative.endsWith('/') || relative.includes('\0')) continue
      const destination = path.resolve(gameDir, relative)
      if (!isPathInside(destination, gameDir)) continue
      await ensureDir(path.dirname(destination))
      await fsp.writeFile(destination, entry.getData())
      written += 1
    }
    return written
  }

  async listInstalled(installation, contentType = 'mod') {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) return { contentType: type, directory: null, items: [] }
    const directory = this.contentDirectory(installation, type)
    let entries = []
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      return { contentType: type, directory, items: [] }
    }

    const files = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(spec.extension) && !entry.name.toLowerCase().endsWith(`${spec.extension}.disabled`)) {
        continue
      }
      const fullPath = path.join(directory, entry.name)
      const stat = await fsp.stat(fullPath).catch(() => null)
      if (!stat) continue
      files.push({
        filename: entry.name,
        enabled: !entry.name.endsWith('.disabled'),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        sha1: await sha1OfFile(fullPath),
      })
    }

    const metadata = files.length ? await this.lookupHashes(files.map((file) => file.sha1).filter(Boolean)) : {}
    const projects = await this.lookupProjects(Object.values(metadata).map((version) => version.project_id))

    const items = files.map((file) => {
      const version = file.sha1 ? metadata[file.sha1] : null
      const project = version ? projects[version.project_id] : null
      return {
        ...file,
        projectId: project?.id || version?.project_id || null,
        versionId: version?.id || null,
        title: project?.title || file.filename.replace(new RegExp(`\\${spec.extension}(\\.disabled)?$`, 'i'), ''),
        description: project?.description || null,
        iconUrl: project?.icon_url || null,
        versionNumber: version?.version_number || null,
        matched: Boolean(version),
      }
    })

    items.sort((a, b) => a.title.localeCompare(b.title))
    return { contentType: type, directory, items }
  }

  async lookupHashes(hashes) {
    const output = {}
    const unique = [...new Set(hashes)]
    for (let index = 0; index < unique.length; index += 80) {
      const batch = unique.slice(index, index + 80)
      try {
        const payload = await fetchJson(
          `${API}/version_files`,
          {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ hashes: batch, algorithm: 'sha1' }),
          },
          { logger: this.logger },
        )
        if (payload && typeof payload === 'object') Object.assign(output, payload)
      } catch (error) {
        this.logger?.warn('Could not match installed content with Modrinth', { message: error.message })
        break
      }
    }
    return output
  }

  async lookupProjects(ids) {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return {}
    try {
      const list = await fetchJson(
        `${API}/projects?ids=${encodeURIComponent(JSON.stringify(unique.slice(0, 100)))}`,
        { headers: this.headers() },
        { logger: this.logger },
      )
      const map = {}
      for (const project of Array.isArray(list) ? list : []) map[project.id] = project
      return map
    } catch (error) {
      this.logger?.warn('Could not load Modrinth project details', { message: error.message })
      return {}
    }
  }

  /**
   * Asks Modrinth for the newest compatible file behind each installed hash.
   * Mods go through the batch endpoint; packs and shaders are looked up per
   * project because their version loaders are not tied to the mod loader.
   */
  async checkUpdates(installation, contentType = 'mod') {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks are updated by installing a new pack version.')
    const installed = await this.listInstalled(installation, type)
    const candidates = installed.items.filter(
      (item) => item.enabled && item.matched && item.sha1 && item.projectId && item.versionId,
    )
    if (!candidates.length) return { contentType: type, checked: installed.items.length, updates: [] }

    const latestByHash = new Map()
    if (type === 'mod') {
      const loader = this.ensureModdable(installation)
      try {
        const payload = await fetchJson(
          `${API}/version_files/update`,
          {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hashes: candidates.map((item) => item.sha1),
              algorithm: 'sha1',
              loaders: [loader],
              game_versions: [installation.versionId],
            }),
          },
          { logger: this.logger },
        )
        if (payload && typeof payload === 'object') {
          for (const [hash, version] of Object.entries(payload)) latestByHash.set(hash, version)
        }
      } catch (error) {
        this.logger?.warn('Could not check Modrinth updates', { message: error.message })
        throw new Error(`Could not check for updates: ${error.message}`)
      }
    } else {
      const seen = new Set()
      let attempts = 0
      let failures = 0
      let lastError = null
      for (const item of candidates) {
        if (!item.projectId || seen.has(item.projectId)) continue
        seen.add(item.projectId)
        attempts += 1
        try {
          const versions = await this.versions(item.projectId, { minecraftVersion: installation.versionId })
          if (versions[0]) latestByHash.set(item.sha1, versions[0])
        } catch (error) {
          failures += 1
          lastError = error
          this.logger?.debug('Could not check one Modrinth project for updates', {
            projectId: item.projectId,
            message: error.message,
          })
        }
      }
      // A total outage must not be reported as "everything is up to date".
      if (attempts > 0 && failures === attempts) {
        throw new Error(`Could not check for updates: ${lastError?.message || 'Modrinth did not respond.'}`)
      }
    }

    const updates = []
    for (const item of candidates) {
      const latest = latestByHash.get(item.sha1)
      if (!latest || !latest.id || latest.id === item.versionId) continue
      let file
      try {
        file = normalizeModFiles(latest)
      } catch {
        continue
      }
      updates.push({
        filename: item.filename,
        projectId: item.projectId,
        title: item.title,
        iconUrl: item.iconUrl,
        currentVersionId: item.versionId,
        currentVersionNumber: item.versionNumber,
        latestVersionId: latest.id,
        latestVersionNumber: latest.version_number || null,
        latestFilename: file.filename,
        enabled: item.enabled,
      })
    }
    return { contentType: type, checked: candidates.length, updates }
  }

  /** Replaces one installed content file with a specific Modrinth version. */
  async update(installation, { filename, versionId, contentType = 'mod' } = {}) {
    const type = normalizeContentType(contentType)
    const spec = CONTENT_TYPES[type]
    if (!spec) throw new Error('Modpacks are installed as their own profile.')
    if (!versionId || typeof versionId !== 'string') throw new Error('Choose an update to install.')
    const currentPath = this.resolveContentFile(installation, type, filename)
    if (!(await fileExists(currentPath))) throw new Error('That content file is no longer on disk.')

    const version = await fetchJson(
      `${API}/version/${encodeURIComponent(versionId)}`,
      { headers: this.headers() },
      { logger: this.logger },
    )
    if (!version || version.id !== versionId) throw new Error('That Modrinth version is not available.')
    if (Array.isArray(version.game_versions) && !version.game_versions.includes(installation.versionId)) {
      throw new Error(`That update does not support Minecraft ${installation.versionId}.`)
    }
    if (spec.needsLoader) {
      const loader = this.ensureModdable(installation)
      if (Array.isArray(version.loaders) && !version.loaders.includes(loader)) {
        throw new Error(`That update is not compatible with ${loader}.`)
      }
    }

    const file = normalizeModFiles(version)
    if (!file.filename.toLowerCase().endsWith(spec.extension)) {
      throw new Error('That update does not contain the expected file type.')
    }
    const disabled = filename.endsWith('.disabled')
    const destinationName = disabled ? `${file.filename}.disabled` : file.filename
    const destination = this.resolveContentFile(installation, type, destinationName)
    await ensureDir(path.dirname(destination))
    await downloadFiles([{ url: file.url, destination, sha1: file.sha1, size: file.size }], {
      concurrency: 1,
      logger: this.logger,
      attempts: 3,
    })
    if (path.basename(currentPath) !== path.basename(destination)) {
      await fsp.rm(currentPath, { force: true })
    }
    this.logger?.info('Updated Modrinth content', {
      installation: installation.name,
      project: version.project_id,
      from: filename,
      to: destinationName,
      version: version.version_number,
    })
    return {
      contentType: type,
      filename: destinationName,
      previousFilename: filename,
      versionId: version.id,
      versionNumber: version.version_number || null,
      name: version.name || null,
    }
  }

  async toggle(installation, filename, contentType = 'mod') {
    const target = this.resolveContentFile(installation, contentType, filename)
    if (!(await fileExists(target))) throw new Error('That file is no longer on disk.')
    const directory = this.contentDirectory(installation, contentType)
    const next = filename.endsWith('.disabled') ? target.slice(0, -'.disabled'.length) : `${target}.disabled`
    if (!isPathInside(next, directory)) throw new Error('That file is outside the content folder.')
    await fsp.rename(target, next)
    return { filename: path.basename(next), enabled: !path.basename(next).endsWith('.disabled') }
  }

  async remove(installation, filename, contentType = 'mod') {
    const target = this.resolveContentFile(installation, contentType, filename)
    await fsp.rm(target, { force: true })
    return { filename }
  }
}

export { CONTENT_TYPE_IDS, CONTENT_TYPES, MOD_LOADER_CATEGORIES, normalizeContentType }
