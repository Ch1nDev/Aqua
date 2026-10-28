import { execFile, spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { directoryStats } from './worlds.js'
import { createSnapshot, deleteSnapshot, listSnapshots, restoreSnapshot } from './snapshots.js'
import { ensureDir, isPathInside } from './util.js'

const execFileAsync = promisify(execFile)

const MAX_ICON_BYTES = 1024 * 1024
const DETECT_TIMEOUT_MS = 20000
const CACHE_TTL_MS = 30000

/**
 * The two Store editions of Bedrock. Each one writes its data to a GDK folder
 * under Roaming on 1.21.120 and newer, and to its UWP package folder under
 * Local on older builds, so both layouts are probed.
 */
const EDITIONS = [
  {
    id: 'bedrock',
    packageName: 'Microsoft.MinecraftUWP',
    name: 'Minecraft for Windows',
    roamingFolder: 'Minecraft Bedrock',
    packageFamilyName: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  },
  {
    id: 'bedrock-preview',
    packageName: 'Microsoft.MinecraftWindowsBeta',
    name: 'Minecraft Preview',
    roamingFolder: 'Minecraft Bedrock Preview',
    packageFamilyName: 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe',
  },
]

const STORE_URL = 'https://apps.microsoft.com/detail/9nblggh2jhxj'

const DETECT_SCRIPT = [
  '$developerMode = $false',
  'try {',
  "  $unlock = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction Stop",
  '  $developerMode = ([int]$unlock.AllowDevelopmentWithoutDevLicense) -eq 1',
  '} catch { $developerMode = $false }',
  '$packages = @(Get-AppxPackage -Name \'Microsoft.Minecraft*\' | ForEach-Object {',
  '  $pkg = $_',
  '  $appIds = @()',
  '  try { $appIds = @((Get-AppxPackageManifest $pkg).Package.Applications.Application | ForEach-Object { $_.Id }) } catch { $appIds = @() }',
  '  [pscustomobject]@{',
  '    Name = $pkg.Name',
  '    Version = $pkg.Version.ToString()',
  '    PackageFamilyName = $pkg.PackageFamilyName',
  '    InstallLocation = $pkg.InstallLocation',
  '    Status = $pkg.Status.ToString()',
  '    AppIds = $appIds',
  '  }',
  '})',
  '[pscustomobject]@{ DeveloperMode = $developerMode; Packages = $packages } | ConvertTo-Json -Compress -Depth 5',
].join('\n')

function roamingRoot() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return base
}

function localRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return base
}

/**
 * Store package versions pack the game version into the build component:
 * package 1.21.2301.0 is game 1.21.23.01. Unknown shapes return null so the UI
 * can fall back to the raw package version.
 */
export function gameVersionFromPackageVersion(value) {
  const parts = String(value ?? '').trim().split('.')
  if (parts.length < 3 || parts.length > 4) return null
  if (!parts.every((part) => /^\d{1,6}$/.test(part))) return null
  const [major, minor, build] = parts
  if (build.length < 3) return `${major}.${minor}.${build}`
  return `${major}.${minor}.${build.slice(0, 2)}.${build.slice(2)}`
}

/** The published app id, e.g. `Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game`. */
export function appUserModelId(packageFamilyName, appIds) {
  const family = typeof packageFamilyName === 'string' ? packageFamilyName.trim() : ''
  if (!family) return null
  const ids = Array.isArray(appIds) ? appIds.filter((id) => typeof id === 'string' && id.trim()) : []
  return `${family}!${ids[0]?.trim() || 'App'}`
}

/**
 * Starts a Store app through its Activation Manager entry. Anything below exit
 * code 2 means the shell accepted the request.
 */
function activateApp(userModelId) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${userModelId}`], {
      windowsHide: true,
      stdio: 'ignore',
    })
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: true, code: null })
    }, 15000)
    child.once('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, error: error.message })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      finish(code == null || code < 2 ? { ok: true, code } : { ok: false, error: `explorer.exe exited with code ${code}` })
    })
  })
}

async function exists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

function cleanText(value, maxLength = 120) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * Every place a Bedrock edition keeps `com.mojang`, in the order the launcher
 * should prefer them: this player's GDK folder, shared GDK data, the GDK root,
 * then the older UWP package folder.
 */
/** Builds before 1.21.120 keep their data in the UWP package folder, not the GDK one. */
export function usesUwpDataFolder(packageVersion) {
  const version = gameVersionFromPackageVersion(packageVersion)
  if (!version) return false
  const parts = version.split('.').map((part) => Number(part) || 0)
  const reference = [1, 21, 120]
  for (let index = 0; index < reference.length; index += 1) {
    const left = parts[index] ?? 0
    if (left !== reference[index]) return left < reference[index]
  }
  return false
}

export async function dataRootCandidates(
  edition,
  { appData = roamingRoot(), localAppData = localRoot(), preferUwp = false } = {},
) {
  const candidates = []
  const gdkRoot = path.join(appData, edition.roamingFolder)
  const usersRoot = path.join(gdkRoot, 'Users')

  let userFolders = []
  try {
    const entries = await fsp.readdir(usersRoot, { withFileTypes: true })
    userFolders = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
  } catch {
    userFolders = []
  }

  const players = userFolders.filter((folder) => !/^shared$/i.test(folder))
  const shared = userFolders.filter((folder) => /^shared$/i.test(folder))
  for (const folder of players) candidates.push(path.join(usersRoot, folder, 'games', 'com.mojang'))
  for (const folder of shared) candidates.push(path.join(usersRoot, folder, 'games', 'com.mojang'))
  candidates.push(path.join(gdkRoot, 'games', 'com.mojang'))
  const uwp = path.join(localAppData, 'Packages', edition.packageFamilyName, 'LocalState', 'games', 'com.mojang')
  // Older builds never wrote to the GDK folder, so theirs comes first for them.
  return preferUwp ? [uwp, ...candidates] : [...candidates, uwp]
}

/** The data folder in use, preferring one that Minecraft already created. */
export async function resolveDataRoot(edition, options = {}) {
  const candidates = await dataRootCandidates(edition, options)
  for (const candidate of candidates) {
    if (await exists(candidate)) return { dataRoot: candidate, exists: true }
  }
  return { dataRoot: candidates[0], exists: false }
}

async function readWorldIcon(worldDir) {
  for (const [file, type] of [
    ['world_icon.jpeg', 'image/jpeg'],
    ['world_icon.jpg', 'image/jpeg'],
    ['world_icon.png', 'image/png'],
  ]) {
    const iconPath = path.join(worldDir, file)
    try {
      const stat = await fsp.stat(iconPath)
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ICON_BYTES) continue
      const bytes = await fsp.readFile(iconPath)
      return `data:${type};base64,${bytes.toString('base64')}`
    } catch {
      // Fall through to the next icon name.
    }
  }
  return null
}

async function readWorldName(worldDir) {
  try {
    const raw = await fsp.readFile(path.join(worldDir, 'levelname.txt'), 'utf8')
    const name = cleanText(raw, 80)
    if (name) return name
  } catch {
    // Exported or in-progress worlds can be missing the file.
  }
  return null
}

/** Newest mtime in the world folder, which tracks the last save. */
async function newestTimestamp(worldDir) {
  let newest = 0
  for (const target of [worldDir, path.join(worldDir, 'level.dat'), path.join(worldDir, 'db')]) {
    try {
      const stat = await fsp.stat(target)
      if (Number.isFinite(stat.mtimeMs) && stat.mtimeMs > newest) newest = stat.mtimeMs
    } catch {
      // Missing pieces simply do not contribute a timestamp.
    }
  }
  try {
    const entries = await fsp.readdir(path.join(worldDir, 'db'), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        const stat = await fsp.stat(path.join(worldDir, 'db', entry.name))
        if (stat.mtimeMs > newest) newest = stat.mtimeMs
      } catch {
        // The world may be saving; skip the file.
      }
    }
  } catch {
    // No database folder.
  }
  return newest ? new Date(newest).toISOString() : null
}

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

async function detectState() {
  if (process.platform !== 'win32') return { packages: [], developerMode: null }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', DETECT_SCRIPT],
      { windowsHide: true, timeout: DETECT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    )
    const text = String(stdout || '').trim()
    if (!text) return { packages: [], developerMode: null }
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return { packages: parsed, developerMode: null }
    return { packages: asArray(parsed.Packages), developerMode: parsed.DeveloperMode === true }
  } catch (error) {
    throw new Error(`Could not query the Microsoft Store packages: ${error.message}`)
  }
}

function toEdition(edition, record, dataRoot) {
  const packageVersion = cleanText(record.Version, 40)
  const appIds = record.AppIds == null ? [] : Array.isArray(record.AppIds) ? record.AppIds : [record.AppIds]
  return {
    id: edition.id,
    edition: 'bedrock',
    name: edition.name,
    packageName: cleanText(record.Name, 120) || edition.packageName,
    packageFamilyName: cleanText(record.PackageFamilyName, 120) || edition.packageFamilyName,
    packageVersion,
    version: gameVersionFromPackageVersion(packageVersion) || packageVersion || null,
    installLocation: typeof record.InstallLocation === 'string' ? record.InstallLocation : null,
    status: cleanText(record.Status, 40) || null,
    appUserModelId: appUserModelId(record.PackageFamilyName || edition.packageFamilyName, appIds),
    dataRoot: dataRoot.dataRoot,
    dataRootExists: dataRoot.exists,
    worldsDirectory: path.join(dataRoot.dataRoot, 'minecraftWorlds'),
  }
}

export class BedrockService {
  constructor({ logger, openExternal, openPath, store = null, emitActivity = null, paths = null }) {
    this.logger = logger
    this.openExternal = openExternal
    this.openPath = openPath
    this.store = store
    this.emitActivity = emitActivity
    this.paths = paths
    this.cache = null
    this.pending = null
  }

  /** Bedrock runs outside the launcher, so its launches only show up in activity. */
  async recordLaunch(edition, serverAddress = null) {
    if (!this.store?.addActivity) return
    try {
      await this.store.addActivity({
        type: 'game',
        title: serverAddress ? `Joined ${serverAddress}` : `Launched ${edition.name}`,
        detail: serverAddress
          ? `Bedrock server · ${edition.name}`
          : edition.version
            ? `Minecraft Bedrock ${edition.version} · Store edition`
            : 'Microsoft Store edition',
        installationId: null,
        status: serverAddress ? 'info' : 'success',
      })
      this.emitActivity?.()
    } catch (error) {
      this.logger?.warn('Could not record the Bedrock launch', { message: error.message })
    }
  }

  /** Detected Store editions, cached briefly because the query spawns PowerShell. */
  async status({ force = false } = {}) {
    const now = Date.now()
    if (!force && this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return {
        supported: process.platform === 'win32',
        editions: this.cache.editions,
        developerMode: this.cache.developerMode,
        storeUrl: STORE_URL,
      }
    }
    if (this.pending) return this.pending
    this.pending = this.detect().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async detect() {
    const supported = process.platform === 'win32'
    if (!supported) {
      return { supported: false, editions: [], developerMode: null, storeUrl: STORE_URL }
    }
    const { packages: records, developerMode } = await detectState()
    const editions = []
    for (const edition of EDITIONS) {
      const record = records.find((item) => String(item?.Name || '').toLowerCase() === edition.packageName.toLowerCase())
      if (!record) continue
      const dataRoot = await resolveDataRoot(edition, {
        preferUwp: usesUwpDataFolder(record.Version),
      })
      editions.push(toEdition(edition, record, dataRoot))
    }
    this.cache = { at: Date.now(), editions, developerMode }
    return { supported, editions, developerMode, storeUrl: STORE_URL }
  }

  async find(id) {
    const state = await this.status()
    const edition = state.editions.find((item) => item.id === id)
    if (!edition) throw new Error('That Bedrock edition is not installed on this device.')
    return edition
  }

  /**
   * Starts Bedrock, or hands a server address to the game's deep link handler so
   * it connects on load.
   */
  async launch(id, { serverAddress = null } = {}) {
    const edition = await this.find(id)
    if (serverAddress) {
      const url = bedrockDeepLink(serverAddress)
      await this.openExternal(url)
      this.logger?.info('Joining Bedrock server', { edition: edition.name, address: serverAddress })
      await this.recordLaunch(edition, serverAddress)
      return { mode: 'join', address: serverAddress, url, editionId: edition.id }
    }

    if (edition.appUserModelId) {
      // explorer.exe reports exit code 1 even when it activates the app, so the
      // exit code alone cannot be used to detect a real failure.
      const activation = await activateApp(edition.appUserModelId)
      if (activation.ok) {
        this.logger?.info('Launched Bedrock', {
          edition: edition.name,
          appUserModelId: edition.appUserModelId,
          exitCode: activation.code,
        })
        await this.recordLaunch(edition)
        return { mode: 'launch', editionId: edition.id, appUserModelId: edition.appUserModelId }
      }
      this.logger?.warn('Could not activate Bedrock through the shell', { message: activation.error })
    }

    // A registered URI handler is the fallback when the app cannot be activated.
    await this.openExternal('minecraft://')
    await this.recordLaunch(edition)
    return { mode: 'launch', editionId: edition.id, appUserModelId: null }
  }

  async worlds(id) {
    const edition = await this.find(id)
    const directory = edition.worldsDirectory
    let entries = []
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      entries = []
    }

    const worlds = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const worldDir = path.join(directory, entry.name)
      const stat = await fsp.stat(worldDir).catch(() => null)
      if (!stat?.isDirectory()) continue
      const [name, size, iconDataUrl, lastPlayed] = await Promise.all([
        readWorldName(worldDir),
        directoryStats(worldDir),
        readWorldIcon(worldDir),
        newestTimestamp(worldDir),
      ])
      worlds.push({
        folder: entry.name,
        name: name || entry.name,
        sizeBytes: size.bytes,
        files: size.files,
        iconDataUrl,
        lastPlayed: lastPlayed || stat.mtime.toISOString(),
      })
    }
    worlds.sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime())
    // A service built without a data folder (tests, early boot) simply has no backups.
    const backups = this.paths?.backupsRoot ? (await this.listBackups(edition.id)).backups : []
    return { directory, exists: entries.length > 0, worlds, backups }
  }

  async folderPath(id, folder = null) {
    const edition = await this.find(id)
    if (folder == null || folder === '') {
      await ensureDir(edition.dataRoot).catch(() => {})
      return edition.dataRoot
    }
    if (typeof folder !== 'string' || folder !== path.basename(folder) || folder === '.' || folder === '..') {
      throw new Error('That world folder is invalid.')
    }
    const root = path.resolve(edition.worldsDirectory)
    const target = path.resolve(root, folder)
    if (!isPathInside(target, root) || target === root) throw new Error('That world is outside the worlds folder.')
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('That world folder no longer exists.')
    return target
  }

  async openFolder(id, folder = null) {
    const target = await this.folderPath(id, folder)
    const error = await this.openPath(target)
    if (error) throw new Error(error)
    return target
  }

  /** Bedrock archives live beside the Java ones, one folder per edition. */
  backupsDirectory(editionId) {
    if (!this.paths?.backupsRoot) throw new Error('The launcher data folder is not available.')
    if (typeof editionId !== 'string' || !/^[a-z0-9-]{2,64}$/.test(editionId)) {
      throw new Error('That Bedrock edition is invalid.')
    }
    return path.join(this.paths.backupsRoot, `bedrock-${editionId}`)
  }

  async listBackups(id) {
    const edition = await this.find(id)
    const directory = this.backupsDirectory(edition.id)
    const snapshots = await listSnapshots(directory)
    return {
      editionId: edition.id,
      editionName: edition.name,
      directory,
      backups: snapshots.map((snapshot) => toBackup(edition, snapshot)),
    }
  }

  /** Zips one `minecraftWorlds/<folder>` without touching the live world. */
  async backupWorld(id, folder, { note = null } = {}) {
    const edition = await this.find(id)
    const worldDir = await this.folderPath(edition.id, folder)
    const level = await fsp.stat(path.join(worldDir, 'level.dat')).catch(() => null)
    // A world without level.dat is not playable, so refuse before writing a ZIP
    // that would only restore as a broken folder.
    if (!level?.isFile()) throw new Error('That world has no level.dat, so it cannot be backed up.')

    const name = (await readWorldName(worldDir)) || folder
    const snapshot = await createSnapshot({
      sourceDir: worldDir,
      destinationDir: this.backupsDirectory(edition.id),
      label: name,
      entryName: folder,
      note,
    })
    this.logger?.info('Created Bedrock world backup', {
      edition: edition.name,
      world: folder,
      backup: snapshot.id,
    })
    return toBackup(edition, snapshot)
  }

  /** Restores as a new world folder, so the live world is never replaced. */
  async restoreBackup(id, backupId) {
    const edition = await this.find(id)
    if (typeof backupId !== 'string' || !backupId.trim()) throw new Error('Choose a backup to restore.')
    const directory = this.backupsDirectory(edition.id)
    const snapshot = (await listSnapshots(directory)).find((item) => item.id === backupId)
    if (!snapshot) throw new Error('That backup is no longer available.')

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14)
    const result = await restoreSnapshot({
      archive: snapshot.archive,
      destinationDir: edition.worldsDirectory,
      folderName: `${snapshot.entry || 'world'}-restored-${stamp}`,
    })
    this.logger?.info('Restored Bedrock world backup', {
      edition: edition.name,
      folder: result.folder,
      backup: backupId,
    })
    return { ...result, editionId: edition.id, name: snapshot.label }
  }

  async deleteBackup(id, backupId) {
    const edition = await this.find(id)
    if (typeof backupId !== 'string' || !backupId.trim()) throw new Error('That backup is invalid.')
    await deleteSnapshot(this.backupsDirectory(edition.id), backupId)
    return { id: backupId, editionId: edition.id }
  }
}

function toBackup(edition, snapshot) {
  return {
    id: snapshot.id,
    editionId: edition.id,
    editionName: edition.name,
    name: snapshot.label,
    worldFolder: snapshot.entry,
    createdAt: snapshot.createdAt,
    sizeBytes: snapshot.sizeBytes,
    files: snapshot.files,
    note: snapshot.note,
  }
}

/** `minecraft://connect?serverUrl=host&serverPort=port` is the documented join link. */
export function bedrockDeepLink(address) {
  const value = String(address ?? '').trim()
  if (!value) throw new Error('Enter a server address.')
  const withoutScheme = value.replace(/^minecraft:\/\//i, '')
  let host = withoutScheme
  let port = 19132
  const ipv6 = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(withoutScheme)
  const plain = /^([^:]+):(\d{1,5})$/.exec(withoutScheme)
  if (ipv6) {
    host = ipv6[1]
    if (ipv6[2]) port = Number(ipv6[2])
  } else if (plain) {
    host = plain[1]
    port = Number(plain[2])
  }
  if (!host || !/^[a-z0-9._:-]+$/i.test(host)) throw new Error('That server address is invalid.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('That server port is invalid.')
  return `minecraft://connect?serverUrl=${host}&serverPort=${port}`
}

export { EDITIONS }
