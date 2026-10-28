import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  applicableLibraries,
  getPlatformContext,
  mavenPath,
  mergeVersions,
  nativeClassifier,
} from './minecraft-rules.js'
import { downloadFiles } from './downloader.js'
import {
  atomicWriteJson,
  ensureDir,
  fileExists,
  formatBytes,
  isPathInside,
  readJsonFile,
  safeSegment,
} from './util.js'

const ASSET_OBJECT_URL = 'https://resources.download.minecraft.net'

function safeJoin(root, relative, label = 'File') {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error(`${label} path is missing.`)
  if (relative.includes('\0')) throw new Error(`${label} path is invalid.`)
  const destination = path.resolve(root, relative)
  if (!isPathInside(destination, root)) throw new Error(`${label} path escapes the Minecraft directory.`)
  return destination
}

/**
 * Loader profiles reference Maven entries with their own repository in `url`.
 * Mojang libraries omit it and come from libraries.minecraft.net.
 */
function libraryBaseUrl(library) {
  const raw = typeof library?.url === 'string' ? library.url.trim() : ''
  if (!raw) return 'https://libraries.minecraft.net/'
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return 'https://libraries.minecraft.net/'
    const base = url.toString()
    return base.endsWith('/') ? base : `${base}/`
  } catch {
    return 'https://libraries.minecraft.net/'
  }
}

function dedupeFiles(files) {
  const map = new Map()
  for (const file of files) {
    const existing = map.get(file.destination)
    if (!existing) map.set(file.destination, file)
    else if ((existing.sha1 && file.sha1 && existing.sha1 !== file.sha1) || (existing.size != null && file.size != null && existing.size !== file.size)) {
      throw new Error(`Conflicting download paths were found for ${file.destination}.`)
    }
  }
  return [...map.values()]
}

export function libraryDownload(library, libraryRoot, context) {
  const entries = []
  const artifact = library.downloads?.artifact
  let artifactDestination = null
  if (artifact?.url) {
    artifactDestination = safeJoin(libraryRoot, artifact.path || mavenPath(library.name), 'Library')
    entries.push({
      url: artifact.url,
      destination: artifactDestination,
      sha1: artifact.sha1 || null,
      size: artifact.size ?? null,
    })
  } else if (library.name && !library.downloads) {
    // Older metadata predates the downloads block, so the Maven coordinate is the
    // only way to locate a base jar. When metadata exists it is authoritative:
    // native-only entries such as lwjgl-platform have no unclassified artifact.
    try {
      const relative = mavenPath(library.name)
      artifactDestination = safeJoin(libraryRoot, relative, 'Library')
      entries.push({
        url: `${libraryBaseUrl(library)}${relative}`,
        destination: artifactDestination,
        sha1: null,
        size: null,
      })
    } catch {
      // A malformed optional library should not prevent installation.
    }
  }

  const classifier = nativeClassifier(library, context)
  let nativeEntry = null
  if (classifier) {
    const native = library.downloads?.classifiers?.[classifier]
    if (native?.url) {
      const destination = safeJoin(libraryRoot, native.path || mavenPath(`${library.name}:${classifier}`), 'Native library')
      nativeEntry = {
        url: native.url,
        destination,
        sha1: native.sha1 || null,
        size: native.size ?? null,
        extract: library.extract || null,
      }
      entries.push(nativeEntry)
    } else {
      try {
        const coords = library.name.split(':')
        if (coords.length === 3) coords.push(classifier)
        else if (coords.length >= 4) coords[3] = classifier
        const relative = mavenPath(coords.join(':'))
        const destination = safeJoin(libraryRoot, relative, 'Native library')
        nativeEntry = {
          url: `${libraryBaseUrl(library)}${relative}`,
          destination,
          sha1: null,
          size: null,
          extract: library.extract || null,
        }
        entries.push(nativeEntry)
      } catch {
        // Skip unusable native coordinates.
      }
    }
  }

  return { entries, artifactDestination, nativeEntry }
}

async function copyLegacyAssets(objects, sourceRoot, targetRoot, label, onProgress) {
  await ensureDir(targetRoot)
  const entries = Object.entries(objects)
  let completed = 0
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, entries.length) }, async () => {
    while (cursor < entries.length) {
      const [name, object] = entries[cursor]
      cursor += 1
      const source = safeJoin(sourceRoot, `${object.hash.slice(0, 2)}/${object.hash}`, 'Asset')
      const target = safeJoin(targetRoot, name, 'Legacy asset')
      try {
        const stat = await fsp.stat(target)
        if (stat.size !== object.size) {
          await fsp.copyFile(source, target)
        }
      } catch {
        await ensureDir(path.dirname(target))
        await fsp.copyFile(source, target)
      }
      completed += 1
      if (completed % 100 === 0) {
        onProgress?.({
          stage: label,
          progress: Math.round((completed / entries.length) * 100),
          filesDone: completed,
          filesTotal: entries.length,
          speedBps: 0,
          etaSeconds: null,
        })
      }
    }
  })
  await Promise.all(workers)
  onProgress?.({ stage: label, progress: 100, filesDone: completed, filesTotal: entries.length })
}

export class Installer {
  constructor({ paths, versionService, loaderService, logger }) {
    this.paths = paths
    this.versionService = versionService
    this.loaderService = loaderService
    this.logger = logger
  }

  async resolveVersion(versionId) {
    const safeId = safeSegment(versionId, 'Version ID')
    const localPath = path.join(this.paths.versionsRoot, safeId, `${safeId}.json`)
    const localJson = await readJsonFile(localPath, null)
    const manifest = await this.versionService.getManifest()
    // Mod loader profiles live in the versions folder and inherit from a Mojang version.
    const child = localJson || (await this.versionService.getVersionJson(safeId, { manifest }))
    const chain = await this.versionService.getInheritanceChain(child, { manifest })
    let merged = child
    for (const parent of chain.slice(1)) {
      merged = mergeVersions(parent, merged)
    }
    return { merged, chain }
  }

  async install(installation, { settings, onUpdate = () => {}, signal }) {
    const context = getPlatformContext()
    onUpdate({ stage: 'Resolving version metadata', progress: null })
    const prepared = this.loaderService
      ? await this.loaderService.prepare(installation, { onUpdate, signal })
      : null
    const targetVersionId = prepared?.profileId || installation.versionId
    const { merged } = await this.resolveVersion(targetVersionId)
    if (signal?.aborted) throw Object.assign(new Error('Installation cancelled.'), { name: 'AbortError' })

    const versionId = safeSegment(targetVersionId, 'Version ID')
    const versionDir = path.join(this.paths.versionsRoot, versionId)
    const jarVersionId = safeSegment(merged.jarVersionId || merged.id, 'Client version ID')
    const jarDir = path.join(this.paths.versionsRoot, jarVersionId)
    const assetsRoot = this.paths.assetsRoot
    const librariesRoot = this.paths.librariesRoot
    await Promise.all([
      ensureDir(versionDir),
      ensureDir(jarDir),
      ensureDir(librariesRoot),
      ensureDir(path.join(assetsRoot, 'objects')),
      ensureDir(path.join(assetsRoot, 'indexes')),
      ensureDir(path.join(assetsRoot, 'log_configs')),
      ensureDir(installation.gameDir),
    ])

    const files = []
    const nativeEntries = []
    let assetIndex = null

    if (!merged.downloads?.client?.url) {
      throw new Error(`Minecraft ${versionId} does not publish a client jar.`)
    }
    const clientDestination = path.join(jarDir, `${jarVersionId}.jar`)
    files.push({
      url: merged.downloads.client.url,
      destination: clientDestination,
      sha1: merged.downloads.client.sha1 || null,
      size: merged.downloads.client.size ?? null,
    })

    const libraries = applicableLibraries(merged, context)
    for (const library of libraries) {
      const { entries, nativeEntry } = libraryDownload(library, librariesRoot, context)
      files.push(...entries)
      if (nativeEntry) nativeEntries.push(nativeEntry)
    }

    if (merged.logging?.client?.file?.url) {
      const loggingFile = merged.logging.client.file
      const id = safeSegment(loggingFile.id || 'client-logging.xml', 'Logging config', 120)
      const destination = path.join(assetsRoot, 'log_configs', id)
      files.push({
        url: loggingFile.url,
        destination,
        sha1: loggingFile.sha1 || null,
        size: loggingFile.size ?? null,
      })
    }

    onUpdate({ stage: 'Fetching asset index', progress: null })
    if (!merged.assetIndex?.url || !merged.assetIndex?.id) {
      throw new Error(`Minecraft ${versionId} does not include an asset index.`)
    }
    const assetIndexId = safeSegment(merged.assetIndex.id, 'Asset index ID', 64)
    const assetIndexPath = path.join(assetsRoot, 'indexes', `${assetIndexId}.json`)
    await downloadFiles(
      [
        {
          url: merged.assetIndex.url,
          destination: assetIndexPath,
          sha1: merged.assetIndex.sha1 || null,
          size: merged.assetIndex.size ?? null,
        },
      ],
      {
        concurrency: 1,
        bandwidthKbps: 0,
        signal,
        logger: this.logger,
        attempts: 3,
        onProgress: (progress) => {
          onUpdate({
            stage: 'Fetching asset index',
            progress: progress.bytesTotal ? Math.round((progress.bytesDone / progress.bytesTotal) * 100) : null,
          })
        },
      },
    )
    assetIndex = await readJsonFile(assetIndexPath, null)
    if (!assetIndex?.objects) throw new Error('The Minecraft asset index could not be read.')
    const objects = assetIndex.objects
    const objectEntries = Object.values(objects)
    const totalAssetBytes = objectEntries.reduce((sum, object) => sum + (Number(object.size) || 0), 0)
    for (const object of objectEntries) {
      if (!object?.hash) continue
      const destination = path.join(assetsRoot, 'objects', object.hash.slice(0, 2), object.hash)
      files.push({
        url: `${ASSET_OBJECT_URL}/${object.hash.slice(0, 2)}/${object.hash}`,
        destination,
        sha1: object.hash,
        size: object.size ?? null,
      })
    }

    let uniqueFiles
    try {
      uniqueFiles = dedupeFiles(files)
    } catch (error) {
      throw new Error(`Invalid Minecraft file list: ${error.message}`)
    }

    const totalBytes = uniqueFiles.reduce((sum, file) => sum + (file.size || 0), 0)
    this.logger.info('Starting Minecraft file download', {
      version: versionId,
      files: uniqueFiles.length,
      assets: objectEntries.length,
      bytes: totalBytes,
    })

    await downloadFiles(uniqueFiles, {
      concurrency: settings.downloads.concurrency,
      bandwidthKbps: settings.downloads.bandwidthKbps,
      signal,
      logger: this.logger,
      attempts: 3,
      onProgress: (progress) => {
        const isVerifying = progress.phase === 'verify'
        onUpdate({
          stage: isVerifying ? 'Verifying files' : 'Downloading game files',
          progress:
            progress.bytesTotal > 0
              ? Math.min(99, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
              : null,
          filesDone: progress.filesDone,
          filesTotal: progress.filesTotal,
          bytesDone: progress.bytesDone,
          bytesTotal: progress.bytesTotal,
          speedBps: progress.speedBps,
          etaSeconds: progress.etaSeconds,
          currentFile: progress.currentFile ? path.basename(progress.currentFile) : null,
          indeterminate: false,
        })
      },
    })

    if (signal?.aborted) throw Object.assign(new Error('Installation cancelled.'), { name: 'AbortError' })

    onUpdate({ stage: 'Preparing game files', progress: null })
    const nativesDir = path.join(versionDir, 'natives')
    await fsp.rm(nativesDir, { recursive: true, force: true }).catch(() => {})
    for (const name of ['', 'java', 'jna', 'lwjgl', 'netty']) {
      await ensureDir(path.join(nativesDir, name))
    }
    if (nativeEntries.length) {
      await this.extractNatives(nativeEntries, nativesDir)
    }

    if (assetIndex.virtual) {
      await copyLegacyAssets(
        objects,
        path.join(assetsRoot, 'objects'),
        path.join(assetsRoot, 'virtual', assetIndexId),
        'Preparing legacy assets',
        onUpdate,
      )
    }
    if (assetIndex.map_to_resources) {
      await copyLegacyAssets(
        objects,
        path.join(assetsRoot, 'objects'),
        path.join(installation.gameDir, 'resources'),
        'Preparing legacy resources',
        onUpdate,
      )
    }

    const installedAt = new Date().toISOString()
    await atomicWriteJson(path.join(versionDir, `${versionId}.json`), merged)
    await atomicWriteJson(path.join(versionDir, '.aqua-install.json'), {
      installedAt,
      versionId,
      jarVersionId,
      versionJson: path.relative(this.paths.minecraftRoot, path.join(versionDir, `${versionId}.json`)),
      clientJar: path.relative(this.paths.minecraftRoot, clientDestination),
      assetIndex: path.relative(this.paths.minecraftRoot, assetIndexPath),
      assetIndexId,
      files: uniqueFiles.length,
      bytes: totalBytes,
      assetBytes: totalAssetBytes,
    })
    onUpdate({
      stage: 'Installation complete',
      progress: 100,
      bytesDone: totalBytes,
      bytesTotal: totalBytes,
      filesDone: uniqueFiles.length,
      filesTotal: uniqueFiles.length,
      speedBps: 0,
      etaSeconds: 0,
    })
    this.logger.info('Minecraft installation complete', {
      version: versionId,
      files: uniqueFiles.length,
      size: formatBytes(totalBytes),
    })
    return {
      installedAt,
      versionDir,
      versionId,
      loaderProfileId: prepared?.profileId || null,
      versionJson: merged,
      clientJar: clientDestination,
      assetIndexPath,
      bytes: totalBytes,
      files: uniqueFiles.length,
    }
  }

  async extractNatives(nativeEntries, nativesDir) {
    for (const entry of nativeEntries) {
      if (!(await fileExists(entry.destination))) continue
      const excludes = new Set([...(entry.extract?.exclude || []), 'META-INF/'])
      let zip
      try {
        zip = new AdmZip(entry.destination)
      } catch (error) {
        throw new Error(`Could not open native library ${path.basename(entry.destination)}: ${error.message}`)
      }
      for (const zipEntry of zip.getEntries()) {
        if (zipEntry.isDirectory) continue
        const entryName = zipEntry.entryName.replace(/\\/g, '/')
        if (!entryName || entryName.startsWith('/') || entryName.split('/').includes('..')) continue
        if ([...excludes].some((prefix) => entryName.startsWith(prefix))) continue
        const target = path.resolve(nativesDir, entryName)
        if (!isPathInside(target, nativesDir)) continue
        await ensureDir(path.dirname(target))
        await fsp.writeFile(target, zipEntry.getData())
      }
    }
  }
}

export async function readInstallMarker(paths, versionId) {
  try {
    const safeId = safeSegment(versionId, 'Version ID')
    return await readJsonFile(path.join(paths.versionsRoot, safeId, '.aqua-install.json'), null)
  } catch {
    return null
  }
}

export async function getInstallationState(paths, versionId) {
  const marker = await readInstallMarker(paths, versionId)
  if (!marker) return { installed: false, installedAt: null, assetIndexId: null }
  const versionJsonPath = path.resolve(paths.minecraftRoot, marker.versionJson || '')
  const clientJarPath = path.resolve(paths.minecraftRoot, marker.clientJar || '')
  const assetIndexPath = path.resolve(paths.minecraftRoot, marker.assetIndex || '')
  if (
    !isPathInside(versionJsonPath, paths.minecraftRoot) ||
    !isPathInside(clientJarPath, paths.minecraftRoot) ||
    !isPathInside(assetIndexPath, paths.minecraftRoot)
  ) {
    return { installed: false, installedAt: null, assetIndexId: null }
  }
  const [versionOk, clientOk, assetsOk] = await Promise.all([
    fileExists(versionJsonPath),
    fileExists(clientJarPath),
    fileExists(assetIndexPath),
  ])
  return {
    installed: versionOk && clientOk && assetsOk,
    installedAt: versionOk && clientOk && assetsOk ? marker.installedAt : null,
    assetIndexId: marker.assetIndexId || null,
  }
}
