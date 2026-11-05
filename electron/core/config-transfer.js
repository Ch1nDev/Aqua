import { normalizeBackupPolicy } from './backup-scheduler.js'
import { normalizeColor, normalizeSortIndex, normalizeTags } from './installation-meta.js'
import { normalizeServerAddress } from './servers.js'
import { normalizeSettings } from './settings.js'

export const CONFIG_FORMAT = 'aqua-config'
export const CONFIG_VERSION = 1
export const MAX_CONFIG_BYTES = 5 * 1024 * 1024
const MAX_INSTALLATIONS = 50
const MAX_SERVERS = 100
const LOADER_TYPES = new Set(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'])
const SERVER_EDITIONS = new Set(['java', 'bedrock'])
const MAX_PROFILE_NAME_LENGTH = 48
const MAX_SERVER_NAME_LENGTH = 60
const MAX_ARGUMENT_LENGTH = 4000

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value, maxLength) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
const optionalText = (value, maxLength) => {
  const result = text(value, maxLength)
  return result || null
}
const integer = (value, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const clone = (value) => (isObject(value) || Array.isArray(value) ? structuredClone(value) : null)

/**
 * Only portable preferences are copied. Machine bindings (Java path, game
 * directory, dashboard image, client id and window placement) stay local.
 */
export function sanitizePortablePreferences(raw) {
  const source = isObject(raw) ? raw : {}
  const result = {}

  for (const key of ['onboardingComplete', 'roundedCorners', 'roundedCornersLinked', 'chunkyChrome', 'chunkyChromeLinked']) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  for (const key of ['reduceMotion', 'highContrast', 'reduceTransparency', 'ambient']) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  for (const key of ['theme', 'accent', 'fontFamily']) {
    if (typeof source[key] === 'string') result[key] = source[key]
  }
  if (Number.isFinite(source.uiScale)) result.uiScale = source.uiScale
  if (typeof source.jvmArgs === 'string') result.jvmArgs = source.jvmArgs.slice(0, MAX_ARGUMENT_LENGTH)
  if (typeof source.gameArgs === 'string') result.gameArgs = source.gameArgs.slice(0, MAX_ARGUMENT_LENGTH)
  if (isObject(source.customTheme)) result.customTheme = clone(source.customTheme)

  if (isObject(source.memory)) {
    result.memory = {
      minMb: integer(source.memory.minMb, 512),
      maxMb: integer(source.memory.maxMb, 2048),
    }
  }
  if (isObject(source.downloads)) {
    result.downloads = {
      concurrency: integer(source.downloads.concurrency, 8),
      bandwidthKbps: integer(source.downloads.bandwidthKbps, 0),
    }
  }
  if (isObject(source.window)) {
    result.window = {
      width: integer(source.window.width, 1280),
      height: integer(source.window.height, 720),
      fullscreen: source.window.fullscreen === true,
    }
  }
  if (isObject(source.minecraftSettings)) {
    result.minecraftSettings = { sync: source.minecraftSettings.sync !== false }
  }
  if (isObject(source.backups)) result.backups = clone(source.backups)
  if (isObject(source.contentFilters)) result.contentFilters = clone(source.contentFilters)
  if (isObject(source.notifications)) {
    const levels = isObject(source.notifications.levels) ? source.notifications.levels : {}
    result.notifications = {
      enabled: source.notifications.enabled !== false,
      native: source.notifications.native !== false,
      levels: {
        success: levels.success !== false,
        info: levels.info !== false,
        warning: levels.warning !== false,
        error: levels.error !== false,
      },
    }
  }
  if (isObject(source.discord)) {
    result.discord = {
      enabled: source.discord.enabled === true,
      showServer: source.discord.showServer === true,
    }
  }
  if (isObject(source.startup)) {
    result.startup = {
      startMinimized: source.startup.startMinimized === true,
      reopenOnGameExit: source.startup.reopenOnGameExit !== false,
      refreshJavaOnStart: source.startup.refreshJavaOnStart !== false,
    }
  }
  if (isObject(source.logging)) {
    result.logging = {
      level: ['debug', 'info', 'warn', 'error'].includes(source.logging.level) ? source.logging.level : 'info',
      keepGameLogs: integer(source.logging.keepGameLogs, 20),
    }
  }
  return result
}

function sanitizeLoader(raw) {
  if (!isObject(raw) || !LOADER_TYPES.has(raw.type)) return null
  return {
    type: raw.type,
    version: optionalText(raw.version, 64),
  }
}

function sanitizeModpack(raw) {
  if (!isObject(raw)) return null
  return {
    projectId: text(raw.projectId, 128),
    name: text(raw.name, 120),
    iconUrl: optionalText(raw.iconUrl, 1000),
    versionId: optionalText(raw.versionId, 64),
  }
}

function memoryShape(raw) {
  if (!isObject(raw)) return null
  const minMb = integer(raw.minMb, 0)
  const maxMb = integer(raw.maxMb, 0)
  if (minMb <= 0 || maxMb <= 0 || minMb > maxMb) return null
  return { minMb, maxMb }
}

function windowShape(raw) {
  if (!isObject(raw)) return null
  const width = integer(raw.width, 0)
  const height = integer(raw.height, 0)
  if (width < 320 || width > 7680 || height < 240 || height > 4320) return null
  return { width, height, fullscreen: raw.fullscreen === true }
}

export function sanitizeInstallation(raw) {
  if (!isObject(raw)) return null
  const name = text(raw.name, MAX_PROFILE_NAME_LENGTH)
  const versionId = text(raw.versionId, 64)
  if (!name || !versionId) return null
  const loader = sanitizeLoader(raw.loader)
  return {
    sourceId: text(raw.sourceId ?? raw.id, 128),
    name,
    versionId,
    loader,
    memoryOverride: memoryShape(raw.memoryOverride),
    windowOverride: windowShape(raw.windowOverride),
    jvmArgsOverride: optionalText(raw.jvmArgsOverride, MAX_ARGUMENT_LENGTH),
    gameArgsOverride: optionalText(raw.gameArgsOverride, MAX_ARGUMENT_LENGTH),
    backupPolicy: isObject(raw.backupPolicy) ? normalizeBackupPolicy(raw.backupPolicy) : null,
    pinned: raw.pinned === true,
    tags: normalizeTags(raw.tags),
    color: normalizeColor(raw.color),
    sortIndex: normalizeSortIndex(raw.sortIndex),
    modpack: sanitizeModpack(raw.modpack),
  }
}

export function sanitizeServer(raw) {
  if (!isObject(raw)) return null
  const address = text(raw.address, 300)
  if (!address) return null
  return {
    sourceId: text(raw.sourceId ?? raw.id, 128),
    name: text(raw.name, MAX_SERVER_NAME_LENGTH) || address,
    address,
    edition: SERVER_EDITIONS.has(raw.edition) ? raw.edition : 'java',
    sourceInstallationId: optionalText(raw.sourceInstallationId ?? raw.installationId, 128),
  }
}

export function buildConfigDocument({
  settings,
  installations = [],
  servers = [],
  appVersion = '',
  exportedAt = new Date().toISOString(),
}) {
  const portableInstallations = installations
    .slice(0, MAX_INSTALLATIONS)
    .map(sanitizeInstallation)
    .filter(Boolean)
  const portableServers = servers.slice(0, MAX_SERVERS).map(sanitizeServer).filter(Boolean)
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: typeof exportedAt === 'string' ? exportedAt : new Date().toISOString(),
    app: {
      name: 'Aqua Launcher',
      version: text(appVersion, 32),
    },
    preferences: sanitizePortablePreferences(settings),
    installations: portableInstallations,
    servers: portableServers,
  }
}

/**
 * Parse and sanitize an untrusted JSON document. Malformed entries are skipped
 * instead of failing the whole transfer; an unknown format or version is fatal.
 */
export function parseConfigDocument(raw) {
  if (!isObject(raw)) throw new Error('That file is not an Aqua configuration export.')
  if (raw.format !== CONFIG_FORMAT) throw new Error('That file is not an Aqua configuration export.')
  if (raw.version !== CONFIG_VERSION) {
    throw new Error(`This configuration uses format version ${String(raw.version)}, which this Aqua build cannot import.`)
  }

  const warnings = []
  const rawInstallations = Array.isArray(raw.installations) ? raw.installations : []
  const rawServers = Array.isArray(raw.servers) ? raw.servers : []
  const installations = rawInstallations
    .slice(0, MAX_INSTALLATIONS)
    .map(sanitizeInstallation)
    .filter(Boolean)
  const servers = rawServers.slice(0, MAX_SERVERS).map(sanitizeServer).filter(Boolean)

  const skippedInstallations = rawInstallations.length - installations.length
  const skippedServers = rawServers.length - servers.length
  if (skippedInstallations > 0) {
    warnings.push(`Skipped ${skippedInstallations} invalid or over-limit profile${skippedInstallations === 1 ? '' : 's'}.`)
  }
  if (skippedServers > 0) {
    warnings.push(`Skipped ${skippedServers} invalid or over-limit server${skippedServers === 1 ? '' : 's'}.`)
  }

  return {
    document: {
      format: CONFIG_FORMAT,
      version: CONFIG_VERSION,
      exportedAt: text(raw.exportedAt, 40) || null,
      app: isObject(raw.app) ? { name: text(raw.app.name, 40), version: text(raw.app.version, 32) } : null,
      preferences: sanitizePortablePreferences(raw.preferences),
      installations,
      servers,
    },
    warnings,
  }
}

function fitName(name, suffix) {
  return `${name.slice(0, MAX_PROFILE_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`
}

function uniqueImportName(name, names) {
  if (!names.has(name.toLowerCase())) {
    names.add(name.toLowerCase())
    return name
  }
  let candidate = fitName(name, ' (Imported)')
  let counter = 2
  while (names.has(candidate.toLowerCase())) {
    candidate = fitName(name, ` (Imported ${counter})`)
    counter += 1
  }
  names.add(candidate.toLowerCase())
  return candidate
}

/**
 * Decide which profiles can be added. An exact name/version/loader match is a
 * duplicate; a name collision with different content gets a distinct name.
 */
export function planInstallations(entries, existingInstallations = []) {
  const names = new Set(
    existingInstallations
      .map((entry) => text(entry.name, MAX_PROFILE_NAME_LENGTH).toLowerCase())
      .filter(Boolean),
  )
  const exact = new Map()
  for (const entry of existingInstallations) {
    const loaderType = entry.loader?.type || 'vanilla'
    exact.set(
      `${text(entry.name, MAX_PROFILE_NAME_LENGTH).toLowerCase()}\0${entry.versionId}\0${loaderType}`,
      entry.id,
    )
  }

  return entries.map((entry) => {
    const loaderType = entry.loader?.type || 'vanilla'
    const key = `${entry.name.toLowerCase()}\0${entry.versionId}\0${loaderType}`
    const existingId = exact.get(key)
    if (existingId) {
      return {
        action: 'skip',
        entry,
        sourceId: entry.sourceId,
        targetId: existingId,
        reason: 'This profile already exists.',
      }
    }
    return {
      action: 'add',
      entry,
      sourceId: entry.sourceId,
      name: uniqueImportName(entry.name, names),
      reason: null,
    }
  })
}

/**
 * Validate and de-duplicate servers before applying them. The caller resolves
 * each source installation id after the profile import finishes.
 */
export function planServers(entries, existingServers = []) {
  const seen = new Set()
  for (const entry of existingServers) {
    try {
      const normalized = normalizeServerAddress(entry.address, { edition: entry.edition })
      seen.add(`${entry.edition}:${normalized.address}`)
    } catch {
      // A damaged existing server should not prevent importing a good one.
    }
  }

  return entries.map((entry) => {
    let normalized
    try {
      normalized = normalizeServerAddress(entry.address, { edition: entry.edition })
    } catch (error) {
      return { action: 'skip', entry, sourceId: entry.sourceId, reason: error.message }
    }
    const key = `${entry.edition}:${normalized.address}`
    if (seen.has(key)) {
      return { action: 'skip', entry, sourceId: entry.sourceId, reason: 'This server is already in your list.' }
    }
    seen.add(key)
    return {
      action: 'add',
      entry,
      sourceId: entry.sourceId,
      address: normalized.address,
      connectAddress: normalized.connectAddress,
      edition: entry.edition,
      name: entry.name,
      installationSourceId: entry.sourceInstallationId,
      reason: null,
    }
  })
}

/**
 * Merge portable preferences over the local settings. Machine-specific values
 * and launch-at-login always stay local, and memory/window values are kept in
 * ranges this computer can actually use.
 */
export function mergePortablePreferences(current, imported, { defaults, totalMemMb } = {}) {
  const preferences = sanitizePortablePreferences(imported)
  const base = defaults || current
  const merged = { ...current, ...preferences }

  merged.window = {
    ...current.window,
    ...(preferences.window || {}),
    placement: current.window?.placement,
  }
  merged.startup = {
    ...current.startup,
    ...(preferences.startup || {}),
    launchAtLogin: current.startup?.launchAtLogin === true,
  }
  merged.java = current.java
  merged.defaultGameDir = current.defaultGameDir
  merged.dashboardBackground = current.dashboardBackground

  const memoryCeiling = Math.max(1024, integer(totalMemMb, current.memory?.maxMb || 65536))
  if (preferences.memory) {
    const maxMb = clamp(integer(preferences.memory.maxMb, current.memory?.maxMb || 2048), 1024, memoryCeiling)
    const minMb = clamp(integer(preferences.memory.minMb, current.memory?.minMb || 512), 512, maxMb)
    merged.memory = { minMb, maxMb }
  }
  if (preferences.window) {
    merged.window.width = clamp(integer(preferences.window.width, current.window?.width || 1280), 320, 7680)
    merged.window.height = clamp(integer(preferences.window.height, current.window?.height || 720), 240, 4320)
  }
  if (preferences.downloads) {
    merged.downloads = {
      concurrency: clamp(integer(preferences.downloads.concurrency, 8), 1, 32),
      bandwidthKbps: clamp(integer(preferences.downloads.bandwidthKbps, 0), 0, 1_000_000),
    }
  }
  if (preferences.logging) {
    merged.logging = {
      ...merged.logging,
      keepGameLogs: clamp(integer(preferences.logging.keepGameLogs, 20), 1, 200),
    }
  }

  return normalizeSettings(merged, base)
}
