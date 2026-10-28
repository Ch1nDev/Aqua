import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { downloadFiles } from './downloader.js'
import { atomicWriteJson, ensureDir, fetchJson, fetchWithRetry, fileExists, isPathInside, parseJavaMajorVersion } from './util.js'

const RUNTIME_MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

function javaExecutableName() {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

function runtimePlatformKey() {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return 'windows-arm64'
    if (process.arch === 'ia32') return 'windows-x86'
    return 'windows-x64'
  }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return process.arch === 'ia32' ? 'linux-i386' : 'linux'
}

function parseProperties(output) {
  const properties = {}
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/)
    if (match) properties[match[1]] = match[2]
    const versionMatch = line.match(/version "([^"]+)"/)
    if (versionMatch && !properties['java.version']) properties['java.version'] = versionMatch[1]
  }
  return properties
}

export function probeJava(javaPath, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const child = spawn(javaPath, ['-XshowSettings:properties', '-version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('Java did not respond in time.'))
    }, timeoutMs)

    const append = (chunk) => {
      output += chunk.toString()
      if (output.length > 200_000) output = output.slice(-200_000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' ? 'Java executable not found.' : error.message))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const properties = parseProperties(output)
      const version = properties['java.version'] || ''
      if (!version) {
        reject(new Error(`This executable did not respond like Java (exit code ${code}).`))
        return
      }
      resolve({
        path: javaPath,
        home: properties['java.home'] || path.dirname(path.dirname(javaPath)),
        version,
        major: parseJavaMajorVersion(version),
        vendor: properties['java.vendor'] || 'Unknown vendor',
        arch: properties['os.arch'] || process.arch,
      })
    })
  })
}

async function addIfJava(candidate, candidates) {
  try {
    const stat = await fsp.stat(candidate)
    if (!stat.isFile()) return
    candidates.add(path.resolve(candidate))
  } catch {
    // Not present.
  }
}

async function scanDirectoryForJava(root, candidates, depth = 4) {
  if (!root || depth < 0) return
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  const executableName = javaExecutableName()
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'bin') {
        await addIfJava(path.join(fullPath, executableName), candidates)
      } else if (!entry.name.startsWith('.') || entry.name === '.jdks') {
        if (depth > 0) await scanDirectoryForJava(fullPath, candidates, depth - 1)
      }
    } else if (entry.isFile() && entry.name.toLowerCase() === executableName.toLowerCase()) {
      await addIfJava(fullPath, candidates)
    }
  }
}

function platformSearchRoots(paths) {
  const env = process.env
  const roots = new Set([
    paths.runtimeRoot,
    env.JAVA_HOME,
    env.JDK_HOME,
    path.join(os.homedir(), '.jdks'),
    path.join(os.homedir(), '.gradle', 'jdks'),
  ])
  if (process.platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    for (const root of [
      path.join(programFiles, 'Java'),
      path.join(programFiles, 'Eclipse Adoptium'),
      path.join(programFiles, 'Microsoft'),
      path.join(programFiles, 'Zulu'),
      path.join(programFiles, 'Amazon Corretto'),
      path.join(programFiles, 'BellSoft'),
      path.join(programFiles, 'Semeru'),
      path.join(programFiles, 'RedHat'),
      path.join(programFiles, 'JetBrains'),
      path.join(localAppData, 'Programs', 'Eclipse Adoptium'),
      path.join(localAppData, 'Programs', 'Microsoft'),
    ]) {
      roots.add(root)
    }
  } else if (process.platform === 'darwin') {
    roots.add('/Library/Java/JavaVirtualMachines')
    roots.add('/System/Library/Java/JavaVirtualMachines')
    roots.add(path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines'))
  } else {
    roots.add('/usr/lib/jvm')
    roots.add('/usr/java')
    roots.add('/opt/java')
  }
  return [...roots].filter(Boolean)
}

async function runtimeCandidatePaths(paths, candidates) {
  let entries
  try {
    entries = await fsp.readdir(paths.runtimeRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const componentEntry of entries) {
    if (!componentEntry.isDirectory()) continue
    const componentRoot = path.join(paths.runtimeRoot, componentEntry.name)
    let platforms
    try {
      platforms = await fsp.readdir(componentRoot, { withFileTypes: true })
    } catch {
      continue
    }
    for (const platformEntry of platforms) {
      if (!platformEntry.isDirectory()) continue
      await addIfJava(path.join(componentRoot, platformEntry.name, 'bin', javaExecutableName()), candidates)
    }
  }
}

export class JavaService {
  constructor({ paths, logger }) {
    this.paths = paths
    this.logger = logger
    this.cache = null
    this.cacheAt = 0
    this.pendingDetection = null
    this.runtimeManifest = null
    this.runtimeManifestAt = 0
  }

  componentPath(component, platform = runtimePlatformKey()) {
    return path.join(this.paths.runtimeRoot, component, platform)
  }

  async detect({ force = false } = {}) {
    if (!force && this.cache && Date.now() - this.cacheAt < 2 * 60 * 1000) {
      return this.cache
    }
    if (this.pendingDetection) return this.pendingDetection
    this.pendingDetection = (async () => {
      const candidates = new Set()
      const executableName = javaExecutableName()
      if (process.env.JAVA_HOME) {
        await addIfJava(path.join(process.env.JAVA_HOME, 'bin', executableName), candidates)
        await addIfJava(path.join(process.env.JAVA_HOME, executableName), candidates)
      }
      const pathSeparator = process.platform === 'win32' ? ';' : ':'
      for (const entry of (process.env.PATH || '').split(pathSeparator)) {
        if (!entry) continue
        await addIfJava(path.join(entry, executableName), candidates)
      }
      for (const root of platformSearchRoots(this.paths)) {
        if (!root) continue
        if (root.toLowerCase().endsWith(javaExecutableName())) {
          await addIfJava(root, candidates)
        } else {
          await scanDirectoryForJava(root, candidates, root === this.paths.runtimeRoot ? 4 : 3)
        }
      }
      await runtimeCandidatePaths(this.paths, candidates)
      const uniquePaths = [...candidates].slice(0, 60)
      const runtimes = []
      const seenHomes = new Set()
      let cursor = 0
      const workers = Array.from({ length: Math.min(6, uniquePaths.length) }, async () => {
        while (cursor < uniquePaths.length) {
          const candidate = uniquePaths[cursor]
          cursor += 1
          try {
            const info = await probeJava(candidate)
            const homeKey = path.resolve(info.home).toLowerCase()
            if (seenHomes.has(homeKey)) continue
            seenHomes.add(homeKey)
            const isMojang = isPathInside(candidate, this.paths.runtimeRoot)
            runtimes.push({
              ...info,
              source: isMojang ? 'Mojang runtime' : 'System',
              component: isMojang
                ? path.relative(this.paths.runtimeRoot, candidate).split(path.sep)[0]
                : null,
            })
          } catch (error) {
            this.logger.debug('Skipping invalid Java candidate', { path: candidate, message: error.message })
          }
        }
      })
      await Promise.all(workers)
      runtimes.sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
      this.cache = runtimes
      this.cacheAt = Date.now()
      this.logger.info('Java detection complete', {
        found: runtimes.length,
        versions: runtimes.map((runtime) => runtime.major),
      })
      return runtimes
    })().finally(() => {
      this.pendingDetection = null
    })
    return this.pendingDetection
  }

  async validateJavaPath(inputPath) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('Choose a Java executable.')
    let resolved = path.resolve(inputPath.trim())
    let stat
    try {
      stat = await fsp.stat(resolved)
    } catch {
      throw new Error('The selected Java path does not exist.')
    }
    if (stat.isDirectory()) {
      resolved = path.join(resolved, 'bin', javaExecutableName())
      if (!(await fileExists(resolved))) throw new Error('No Java executable was found in that folder.')
    }
    const info = await probeJava(resolved)
    return { ...info, source: 'System', component: null }
  }

  async chooseJava(versionJson, settings, installation) {
    const required = Number(versionJson?.javaVersion?.majorVersion) || 8
    const label = versionJson?.id || 'This Minecraft version'
    // launchwrapper versions (Minecraft 1.12.2 and older, plus their mod loaders)
    // cast the system classloader to URLClassLoader, which Java 9 removed. Running
    // them on a newer runtime cannot work, so refuse instead of crashing the game.
    const assertLaunchwrapperRuntime = (major) => {
      if (!/launchwrapper/i.test(String(versionJson?.mainClass || ''))) return null
      if (major <= 8) return null
      return new Error(
        `Minecraft ${label} needs Java 8. Its launchwrapper loader cannot run on Java ${major}, which is why the game exits immediately. ` +
          'Install the Java 8 runtime from Settings → Java (or select one for this profile), then launch again.',
      )
    }
    const preferred =
      (installation?.javaPath && installation.javaPath.trim()) ||
      (settings.java.mode === 'path' ? settings.java.path : null)
    if (preferred) {
      const info = await this.validateJavaPath(preferred)
      if (info.major < required) {
        throw new Error(
          `Minecraft ${versionJson.id} needs Java ${required} or newer, but ${info.path} is Java ${info.major}. Choose another runtime in Settings.`,
        )
      }
      const incompatible = assertLaunchwrapperRuntime(info.major)
      if (incompatible) throw incompatible
      return {
        ...info,
        required,
        warning:
          info.major > required + 1 && required <= 8
            ? `Java ${info.major} may not be compatible with this older Minecraft version; Java ${required} is recommended.`
            : null,
      }
    }

    const runtimes = await this.detect()
    if (!runtimes.length) {
      throw new Error(
        `No Java runtime was found. Minecraft ${versionJson.id} requires Java ${required}. Install it from Settings → Java.`,
      )
    }
    const exact = runtimes.filter((runtime) => runtime.major === required)
    const compatible = runtimes
      .filter((runtime) => runtime.major >= required)
      .sort((a, b) => a.major - b.major)
    const chosen = exact[0] || compatible[0]
    if (!chosen) {
      throw new Error(
        `Minecraft ${versionJson.id} requires Java ${required}, but the newest installed runtime is Java ${runtimes[0]?.major || 'unknown'}. Install Java ${required} in Settings.`,
      )
    }
    const incompatible = assertLaunchwrapperRuntime(chosen.major)
    if (incompatible) throw incompatible

    return {
      ...chosen,
      required,
      warning:
        !exact[0] && chosen.major > required
          ? `Java ${chosen.major} was selected, but this version targets Java ${required}.`
          : null,
    }
  }

  async getRuntimeManifest({ force = false } = {}) {
    if (!force && this.runtimeManifest && Date.now() - this.runtimeManifestAt < 60 * 60 * 1000) {
      return this.runtimeManifest
    }
    const manifest = await fetchJson(RUNTIME_MANIFEST, {}, { attempts: 2, timeoutMs: 25_000, logger: this.logger })
    this.runtimeManifest = manifest
    this.runtimeManifestAt = Date.now()
    return manifest
  }

  async listRuntimeOptions() {
    const manifest = await this.getRuntimeManifest()
    const platform = runtimePlatformKey()
    const components = manifest?.[platform] || {}
    const installed = new Set()
    try {
      const entries = await fsp.readdir(this.paths.runtimeRoot, { withFileTypes: true })
      for (const entry of entries) if (entry.isDirectory()) installed.add(entry.name)
    } catch {
      // Runtime folder may not exist yet.
    }
    const byMajor = new Map()
    for (const [component, entries] of Object.entries(components)) {
      const available = Array.isArray(entries) ? entries.find((entry) => entry?.manifest?.url) : null
      if (!available) continue
      const versionName = available.version?.name || ''
      const major = parseJavaMajorVersion(versionName)
      if (!major) continue
      const existing = byMajor.get(major)
      if (!existing || new Date(available.version?.released || 0) > new Date(existing.released || 0)) {
        byMajor.set(major, {
          component,
          versionName,
          major,
          released: available.version?.released || null,
          installed: installed.has(component),
          path: this.componentPath(component, platform),
          recommended: major >= 21,
          // Java 8 cannot be substituted by a newer runtime: launchwrapper versions
          // (Minecraft 1.12.2 and older, and their mod loaders) only start on it.
          legacy: major <= 8,
        })
      }
    }
    return [...byMajor.values()].sort((a, b) => b.major - a.major)
  }

  async installRuntime(component, { settings, onProgress, signal, logger = this.logger }) {
    const platform = runtimePlatformKey()
    const manifest = await this.getRuntimeManifest({ force: true })
    const entries = manifest?.[platform]?.[component]
    if (!Array.isArray(entries) || !entries[0]?.manifest?.url) {
      throw new Error(`Java runtime ${component} is not available for ${platform}.`)
    }
    const entry = entries[0]
    const targetRoot = this.componentPath(component, platform)
    onProgress?.({ stage: 'Fetching Java runtime manifest', progress: null })
    const response = await fetchWithRetry(
      entry.manifest.url,
      { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
      { attempts: 3, timeoutMs: 30_000, logger },
    )
    const text = await response.text()
    if (entry.manifest.sha1) {
      const hash = crypto.createHash('sha1').update(text).digest('hex')
      if (hash !== entry.manifest.sha1) throw new Error('The Java runtime manifest failed its integrity check.')
    }
    const runtimeManifest = JSON.parse(text)
    if (!runtimeManifest?.files) throw new Error('The Java runtime manifest is incomplete.')

    const files = []
    for (const [relativePath, file] of Object.entries(runtimeManifest.files)) {
      if (!file || file.type !== 'file') continue
      const destination = path.resolve(targetRoot, relativePath)
      if (!isPathInside(destination, targetRoot)) {
        throw new Error('The Java runtime manifest contains an unsafe file path.')
      }
      const raw = file.downloads?.raw
      if (!raw?.url) continue
      files.push({
        url: raw.url,
        destination,
        sha1: raw.sha1,
        size: raw.size,
        executable: Boolean(file.executable),
      })
    }
    await ensureDir(targetRoot)
    onProgress?.({
      stage: `Downloading Java ${parseJavaMajorVersion(entry.version?.name)}`,
      progress: null,
      filesTotal: files.length,
    })
    const result = await downloadFiles(files, {
      concurrency: settings.downloads.concurrency,
      bandwidthKbps: settings.downloads.bandwidthKbps,
      signal,
      logger,
      root: targetRoot,
      onProgress: (progress) => {
        onProgress?.({
          ...progress,
          stage: `Downloading Java ${parseJavaMajorVersion(entry.version?.name)}`,
        })
      },
    })
    const javaPath = path.join(targetRoot, 'bin', javaExecutableName())
    const info = await probeJava(javaPath)
    await atomicWriteJson(path.join(targetRoot, 'runtime.json'), {
      component,
      platform,
      versionName: entry.version?.name || null,
      installedAt: new Date().toISOString(),
      javaPath,
    })
    this.cacheAt = 0
    logger.info('Official Java runtime installed', { component, version: info.version, path: javaPath })
    return { ...info, source: 'Mojang runtime', component, bytes: result.bytes }
  }
}

export { RUNTIME_MANIFEST, runtimePlatformKey }
