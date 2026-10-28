import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { downloadFiles } from './downloader.js'
import {
  atomicWriteJson,
  ensureDir,
  fetchJson,
  fetchWithRetry,
  isPathInside,
  readJsonFile,
  safeSegment,
} from './util.js'

export const LOADER_TYPES = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

const LABELS = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'
const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'

function loaderLabel(type) {
  return LABELS[type] || type
}

/**
 * NeoForge numbers its builds after the Minecraft version, but the scheme differs by era:
 * 1.21.1 → 21.1.x, while year-based versions keep the whole number: 26.3 → 26.3.0.x.
 */
export function neoForgeSeries(minecraftVersion) {
  const [major, minor = '0', patch] = String(minecraftVersion).split('.')
  if (major === '1') return `${minor}.${patch || 0}.`
  return `${minecraftVersion}.`
}

export function loaderProfileId(type, minecraftVersion, loaderVersion) {
  const mc = safeSegment(minecraftVersion, 'Minecraft version')
  const version = safeSegment(loaderVersion, 'Loader version')
  switch (type) {
    case 'fabric':
      return `fabric-loader-${version}-${mc}`
    case 'quilt':
      return `quilt-loader-${version}-${mc}`
    case 'forge':
      return `${mc}-forge-${version}`
    case 'neoforge':
      return version.startsWith(`${mc}-`) ? `${mc}-forge-${version.slice(mc.length + 1)}` : `neoforge-${version}`
    default:
      throw new Error('Only modded installations need a loader profile.')
  }
}

function compareVersionsDesc(a, b) {
  const left = String(a).split(/[.-]/)
  const right = String(b).split(/[.-]/)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = Number.parseInt(left[index] ?? '0', 10)
    const r = Number.parseInt(right[index] ?? '0', 10)
    if (Number.isFinite(l) && Number.isFinite(r) && l !== r) return r - l
  }
  return 0
}

function uniqueVersions(list) {
  const seen = new Set()
  const output = []
  for (const entry of list) {
    if (!entry?.version || seen.has(entry.version)) continue
    seen.add(entry.version)
    output.push(entry)
  }
  return output
}

export class LoaderService {
  constructor({ paths, versionService, javaService, logger }) {
    this.paths = paths
    this.versionService = versionService
    this.javaService = javaService
    this.logger = logger
    this.cache = new Map()
  }

  listTypes() {
    return LOADER_TYPES.map((type) => ({ id: type, label: loaderLabel(type) }))
  }

  async listVersions(type, minecraftVersion) {
    if (!LOADER_TYPES.includes(type) || type === 'vanilla') return []
    const mc = safeSegment(minecraftVersion, 'Minecraft version')
    const key = `${type}:${mc}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.versions

    let versions = []
    if (type === 'fabric') {
      const payload = await fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`, {}, { logger: this.logger })
      versions = (Array.isArray(payload) ? payload : []).map((entry) => ({
        version: entry?.loader?.version,
        stable: Boolean(entry?.loader?.stable),
      }))
    } else if (type === 'quilt') {
      const payload = await fetchJson(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`, {}, { logger: this.logger })
      versions = (Array.isArray(payload) ? payload : []).map((entry) => ({
        version: entry?.loader?.version || entry?.version,
        stable: Boolean(entry?.loader?.stable ?? true),
      }))
    } else if (type === 'forge') {
      versions = await this.fetchMavenVersions(`${FORGE_MAVEN}/net/minecraftforge/forge`, `${mc}-`, true)
    } else if (type === 'neoforge') {
      const series = neoForgeSeries(mc)
      const primary = await this.fetchMavenVersions(`${NEOFORGE_MAVEN}/net/neoforged/neoforge`, series)
      versions = primary
      if (!versions.length) {
        // NeoForge 1.20.1 shipped under the legacy net.neoforged.forge coordinate.
        // Keep the full `1.20.1-47.1.106` build id: it drives the installer URL and profile name.
        versions = await this.fetchMavenVersions(`${NEOFORGE_MAVEN}/net/neoforged/forge`, `${mc}-`)
      }
    }

    const cleaned = uniqueVersions(versions)
      .filter((entry) => typeof entry.version === 'string' && entry.version)
      .sort((a, b) => compareVersionsDesc(a.version, b.version))
    this.cache.set(key, { at: Date.now(), versions: cleaned })
    return cleaned
  }

  async fetchMavenVersions(baseUrl, prefix, stripMinecraftPrefix = false) {
    try {
      const response = await fetchWithRetry(`${baseUrl}/maven-metadata.xml`, {}, { logger: this.logger })
      const text = await response.text()
      const versions = []
      for (const match of text.matchAll(/<version>([^<]+)<\/version>/g)) {
        const raw = match[1].trim()
        if (stripMinecraftPrefix) {
          if (!raw.startsWith(prefix)) continue
          versions.push({ version: raw.slice(prefix.length), stable: true })
        } else if (raw.startsWith(prefix)) {
          versions.push({ version: raw, stable: true })
        }
      }
      return versions
    } catch (error) {
      this.logger?.warn('Could not list NeoForge versions', { message: error.message })
      return []
    }
  }

  versionJsonPath(profileId) {
    const id = safeSegment(profileId, 'Loader profile ID', 120)
    return path.join(this.paths.versionsRoot, id, `${id}.json`)
  }

  async readProfile(profileId) {
    return readJsonFile(this.versionJsonPath(profileId), null)
  }

  async prepare(installation, { onUpdate = () => {}, signal } = {}) {
    const loader = installation.loader
    if (!loader || loader.type === 'vanilla' || !loader.version) return null
    const mc = installation.versionId
    const type = loader.type
    onUpdate({ stage: `Preparing ${loaderLabel(type)} ${loader.version}`, progress: null })
    if (signal?.aborted) throw Object.assign(new Error('Installation cancelled.'), { name: 'AbortError' })

    if (type === 'fabric' || type === 'quilt') {
      return this.prepareMetaProfile(type, mc, loader.version)
    }
    return this.prepareForgeInstaller(type, mc, loader.version, { onUpdate, signal })
  }

  async prepareMetaProfile(type, minecraftVersion, loaderVersion) {
    const base = type === 'fabric' ? FABRIC_META : QUILT_META
    const url = `${base}/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    const profile = await fetchJson(url, {}, { logger: this.logger })
    if (!profile || !Array.isArray(profile.libraries)) {
      throw new Error(`${loaderLabel(type)} did not return a usable profile for Minecraft ${minecraftVersion}.`)
    }
    const profileId = loaderProfileId(type, minecraftVersion, loaderVersion)
    const json = {
      ...profile,
      id: profileId,
      inheritsFrom: minecraftVersion,
      type: 'release',
    }
    await atomicWriteJson(this.versionJsonPath(profileId), json)
    this.logger.info('Prepared mod loader profile', { loader: type, version: loaderVersion, profileId })
    return { profileId, versionJson: json }
  }

  async prepareForgeInstaller(type, minecraftVersion, loaderVersion, { onUpdate, signal }) {
    const minecraftJson = await this.versionService.getVersionJson(minecraftVersion).catch(() => null)
    const requiredJava = Number(minecraftJson?.javaVersion?.majorVersion) || 8
    const java = await this.chooseInstallerJava(requiredJava)

    const downloadUrl =
      type === 'forge'
        ? `${FORGE_MAVEN}/net/minecraftforge/forge/${minecraftVersion}-${loaderVersion}/forge-${minecraftVersion}-${loaderVersion}-installer.jar`
        : loaderVersion.startsWith(`${minecraftVersion}-`)
          ? `${NEOFORGE_MAVEN}/net/neoforged/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`
          : `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`

    await ensureDir(this.paths.cacheRoot)
    const installerPath = path.join(this.paths.cacheRoot, 'loaders', path.basename(new URL(downloadUrl).pathname))
    await ensureDir(path.dirname(installerPath))
    await downloadFiles([{ url: downloadUrl, destination: installerPath, sha1: null, size: null }], {
      concurrency: 1,
      signal,
      logger: this.logger,
      attempts: 2,
      onProgress: (progress) => {
        onUpdate({
          stage: `Downloading ${loaderLabel(type)} installer`,
          progress: progress.bytesTotal ? Math.round((progress.bytesDone / progress.bytesTotal) * 100) : null,
        })
      },
    })

    // The Forge-family installers refuse to run without a launcher profile file.
    const profilesFile = path.join(this.paths.minecraftRoot, 'launcher_profiles.json')
    const existingProfiles = await readJsonFile(profilesFile, null)
    if (!existingProfiles) {
      await atomicWriteJson(profilesFile, {
        profiles: {},
        settings: {},
        version: 3,
        selectedProfile: '',
        clientToken: '',
        authenticationDatabase: {},
      })
    }
    await ensureDir(path.join(this.paths.minecraftRoot, 'versions'))
    await ensureDir(path.join(this.paths.minecraftRoot, 'libraries'))

    onUpdate({ stage: `Running ${loaderLabel(type)} installer`, progress: null })
    const startedAt = Date.now()
    await this.runInstaller(java.path, installerPath, { signal })

    const profile = await this.findInstalledProfile(minecraftVersion, type, startedAt)
    if (!profile) {
      throw new Error(
        `${loaderLabel(type)} finished but did not register a profile for Minecraft ${minecraftVersion}. ` +
          'Check the launcher log, then try again.',
      )
    }
    this.logger.info('Installed Forge-family loader', {
      loader: type,
      version: loaderVersion,
      profileId: profile.id,
    })
    return { profileId: profile.id, versionJson: profile }
  }

  async chooseInstallerJava(requiredMajor) {
    const detected = await this.javaService.detect().catch(() => [])
    const usable = detected
      .filter((java) => Number(java.major) >= Math.max(8, requiredMajor))
      .sort((a, b) => a.major - b.major)
    if (!usable.length) {
      throw new Error(
        `Installing this loader needs Java ${Math.max(8, requiredMajor)} or newer. Add a runtime in Settings → Java first.`,
      )
    }
    return usable[0]
  }

  runInstaller(javaPath, installerPath, { signal } = {}) {
    return new Promise((resolve, reject) => {
      const args = ['-jar', installerPath, '--installClient', this.paths.minecraftRoot]
      const child = spawn(javaPath, args, { cwd: this.paths.minecraftRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      const capture = (chunk) => {
        output = `${output}${chunk.toString()}`.slice(-20000)
      }
      child.stdout.on('data', capture)
      child.stderr.on('data', capture)
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('The mod loader installer timed out after 10 minutes.'))
      }, 10 * 60 * 1000)
      const onAbort = () => {
        child.kill()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`Could not start the loader installer: ${error.message}`))
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (code === 0) {
          resolve(output)
          return
        }
        const tail = output
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .slice(-4)
          .join(' ')
        reject(new Error(`The mod loader installer failed (exit code ${code}).${tail ? ` ${tail}` : ''}`))
      })
    })
  }

  async findInstalledProfile(minecraftVersion, type, since) {
    const pattern = type === 'forge' ? /forge/i : /forge|neoforge/i
    let best = null
    let bestTime = 0
    let entries = []
    try {
      entries = await fsp.readdir(this.paths.versionsRoot, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !pattern.test(entry.name)) continue
      const file = path.join(this.paths.versionsRoot, entry.name, `${entry.name}.json`)
      if (!isPathInside(file, this.paths.versionsRoot)) continue
      const stat = await fsp.stat(file).catch(() => null)
      if (!stat || stat.mtimeMs < since - 5000) continue
      const json = await readJsonFile(file, null)
      if (!json || json.inheritsFrom !== minecraftVersion) continue
      if (stat.mtimeMs > bestTime) {
        best = json
        bestTime = stat.mtimeMs
      }
    }
    return best
  }
}
