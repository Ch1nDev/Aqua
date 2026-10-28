import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomId, atomicWriteJson, readJsonFile, runId } from './util.js'
import { createDefaultSettings, normalizeSettings } from './settings.js'

const SCHEMA_VERSION = 1
const MAX_ACTIVITY = 40
const MAX_SESSIONS = 20
const MAX_SERVERS = 100

/** A profile created from a Modrinth modpack remembers which pack it came from. */
function normalizeModpack(raw) {
  if (!raw || typeof raw !== 'object') return null
  const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim().slice(0, 64) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  if (!projectId || !name) return null
  return {
    projectId,
    name,
    iconUrl:
      typeof raw.iconUrl === 'string' && /^https:\/\//i.test(raw.iconUrl) ? raw.iconUrl.slice(0, 500) : null,
    versionId: typeof raw.versionId === 'string' && raw.versionId ? raw.versionId.slice(0, 64) : null,
  }
}

function normalizeInstallation(raw, defaultGameDir) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.id || !raw.name || !raw.versionId) return null
  const now = new Date().toISOString()
  const windowOverride =
    raw.windowOverride && typeof raw.windowOverride === 'object'
      ? {
          width: Number(raw.windowOverride.width) || 1280,
          height: Number(raw.windowOverride.height) || 720,
          fullscreen: Boolean(raw.windowOverride.fullscreen),
        }
      : null
  const memoryOverride =
    raw.memoryOverride && typeof raw.memoryOverride === 'object'
      ? {
          minMb: Number(raw.memoryOverride.minMb) || 1024,
          maxMb: Number(raw.memoryOverride.maxMb) || 4096,
        }
      : null
  const loaderTypes = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']
  const loader =
    raw.loader && typeof raw.loader === 'object' && loaderTypes.includes(raw.loader.type) && raw.loader.type !== 'vanilla'
      ? {
          type: raw.loader.type,
          version: typeof raw.loader.version === 'string' && raw.loader.version ? raw.loader.version : null,
          profileId: typeof raw.loader.profileId === 'string' && raw.loader.profileId ? raw.loader.profileId : null,
        }
      : { type: 'vanilla', version: null, profileId: null }
  return {
    id: String(raw.id),
    name: String(raw.name).slice(0, 80),
    versionId: String(raw.versionId),
    versionType: ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(raw.versionType)
      ? raw.versionType
      : 'release',
    loader,
    gameDir:
      typeof raw.gameDir === 'string' && path.isAbsolute(raw.gameDir)
        ? path.normalize(raw.gameDir)
        : defaultGameDir,
    managedGameDir: Boolean(raw.managedGameDir),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    lastPlayedAt: raw.lastPlayedAt || null,
    totalPlaytimeMs: Number.isFinite(raw.totalPlaytimeMs) ? raw.totalPlaytimeMs : 0,
    lastInstalledAt: raw.lastInstalledAt || null,
    modpack: normalizeModpack(raw.modpack),
    javaPath: typeof raw.javaPath === 'string' && raw.javaPath ? raw.javaPath : null,
    memoryOverride,
    windowOverride,
    jvmArgsOverride: typeof raw.jvmArgsOverride === 'string' ? raw.jvmArgsOverride : null,
    gameArgsOverride: typeof raw.gameArgsOverride === 'string' ? raw.gameArgsOverride : null,
  }
}

function normalizeServer(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.id || typeof raw.address !== 'string' || !raw.address.trim()) return null
  return {
    id: String(raw.id).slice(0, 64),
    name: String(raw.name || raw.address).slice(0, 60),
    address: raw.address.trim().slice(0, 300),
    connectAddress:
      typeof raw.connectAddress === 'string' && raw.connectAddress.trim()
        ? raw.connectAddress.trim().slice(0, 300)
        : raw.address.trim().slice(0, 300),
    edition: raw.edition === 'bedrock' ? 'bedrock' : 'java',
    addedAt: raw.addedAt || new Date().toISOString(),
    lastJoinedAt: raw.lastJoinedAt || null,
  }
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.id || !raw.name || !raw.uuid) return null
  const type = raw.type === 'offline' ? 'offline' : 'microsoft'
  return {
    id: String(raw.id),
    type,
    name: String(raw.name).slice(0, 64),
    uuid: String(raw.uuid),
    xuid: type === 'microsoft' && typeof raw.xuid === 'string' ? raw.xuid : null,
    addedAt: raw.addedAt || new Date().toISOString(),
    lastUsedAt: raw.lastUsedAt || raw.addedAt || new Date().toISOString(),
    expiresAt: type === 'offline' ? null : raw.expiresAt || null,
    sessionExpired: type === 'offline' ? false : Boolean(raw.sessionExpired),
    avatarDataUrl: typeof raw.avatarDataUrl === 'string' ? raw.avatarDataUrl : null,
  }
}

export class Store {
  constructor({ configFile, instancesRoot, totalMemMb, logger }) {
    this.configFile = configFile
    this.instancesRoot = instancesRoot
    this.totalMemMb = totalMemMb
    this.logger = logger
    this.defaults = createDefaultSettings({ totalMemMb, instancesRoot })
    this.data = null
    this.writeQueue = Promise.resolve()
  }

  async init() {
    await fsp.mkdir(path.dirname(this.configFile), { recursive: true })
    const raw = await readJsonFile(this.configFile, null)
    const defaults = this.defaults
    this.data = {
      schemaVersion: SCHEMA_VERSION,
      settings: normalizeSettings(raw?.settings, defaults),
      installations: Array.isArray(raw?.installations)
        ? raw.installations.map((item) => normalizeInstallation(item, defaults.defaultGameDir)).filter(Boolean)
        : [],
      activeInstallationId:
        typeof raw?.activeInstallationId === 'string' ? raw.activeInstallationId : null,
      accounts: Array.isArray(raw?.accounts) ? raw.accounts.map(normalizeAccount).filter(Boolean) : [],
      activeAccountId: typeof raw?.activeAccountId === 'string' ? raw.activeAccountId : null,
      servers: Array.isArray(raw?.servers)
        ? raw.servers.map(normalizeServer).filter(Boolean).slice(0, MAX_SERVERS)
        : [],
      activity: Array.isArray(raw?.activity)
        ? raw.activity
            .filter((item) => item && typeof item === 'object' && item.title)
            .slice(0, MAX_ACTIVITY)
        : [],
      sessions: Array.isArray(raw?.sessions)
        ? raw.sessions.filter((item) => item && typeof item === 'object').slice(0, MAX_SESSIONS)
        : [],
    }

    if (!this.data.installations.find((installation) => installation.id === this.data.activeInstallationId)) {
      this.data.activeInstallationId = this.data.installations[0]?.id || null
    }
    if (!this.data.accounts.find((account) => account.id === this.data.activeAccountId)) {
      this.data.activeAccountId = this.data.accounts[0]?.id || null
    }
    if (!raw) {
      await this.save()
      this.logger.info('Created initial launcher configuration', { path: this.configFile })
    }
    return this.data
  }

  get settings() {
    return this.data.settings
  }

  get installations() {
    return this.data.installations
  }

  get accounts() {
    return this.data.accounts
  }

  get activeAccountId() {
    return this.data.activeAccountId
  }

  get activeInstallationId() {
    return this.data.activeInstallationId
  }

  get activity() {
    return this.data.activity
  }

  get sessions() {
    return this.data.sessions
  }

  get servers() {
    return this.data.servers
  }

  get activeInstallation() {
    return this.data.installations.find((item) => item.id === this.data.activeInstallationId) || null
  }

  getInstallation(id) {
    return this.data.installations.find((item) => item.id === id) || null
  }

  getAccount(id) {
    return this.data.accounts.find((item) => item.id === id) || null
  }

  async save() {
    const snapshot = structuredClone(this.data)
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.configFile, snapshot))
    return this.writeQueue
  }

  async replaceSettings(settings) {
    this.data.settings = settings
    await this.save()
    return this.data.settings
  }

  async addInstallation(installation) {
    this.data.installations.push(installation)
    if (!this.data.activeInstallationId) this.data.activeInstallationId = installation.id
    await this.save()
    return installation
  }

  async updateInstallation(id, patch) {
    const installation = this.getInstallation(id)
    if (!installation) throw new Error('Installation not found.')
    Object.assign(installation, patch, { updatedAt: new Date().toISOString() })
    await this.save()
    return installation
  }

  async removeInstallation(id) {
    const index = this.data.installations.findIndex((item) => item.id === id)
    if (index === -1) throw new Error('Installation not found.')
    const [removed] = this.data.installations.splice(index, 1)
    if (this.data.activeInstallationId === id) {
      this.data.activeInstallationId = this.data.installations[0]?.id || null
    }
    await this.save()
    return removed
  }

  async setActiveInstallation(id) {
    if (!this.getInstallation(id)) throw new Error('Installation not found.')
    this.data.activeInstallationId = id
    await this.save()
  }

  getServer(id) {
    return this.data.servers.find((server) => server.id === id) || null
  }

  async addServer(server) {
    if (this.data.servers.length >= MAX_SERVERS) throw new Error('The server list is full. Remove a server first.')
    this.data.servers.push(server)
    await this.save()
    return server
  }

  async updateServer(id, patch) {
    const server = this.getServer(id)
    if (!server) throw new Error('Server not found.')
    Object.assign(server, patch)
    await this.save()
    return server
  }

  async removeServer(id) {
    const index = this.data.servers.findIndex((server) => server.id === id)
    if (index === -1) throw new Error('Server not found.')
    const [removed] = this.data.servers.splice(index, 1)
    await this.save()
    return removed
  }

  async markServerJoined(id) {
    const server = this.getServer(id)
    if (!server) return null
    server.lastJoinedAt = new Date().toISOString()
    await this.save()
    return server
  }

  async markInstallationPlayed(id, { startedAt, endedAt, playtimeMs = 0 }) {
    const installation = this.getInstallation(id)
    if (!installation) return
    installation.lastPlayedAt = endedAt || startedAt
    installation.totalPlaytimeMs = (installation.totalPlaytimeMs || 0) + Math.max(0, playtimeMs)
    installation.updatedAt = new Date().toISOString()
    this.data.sessions.unshift({
      id: runId(),
      installationId: id,
      startedAt,
      endedAt: endedAt || null,
      playtimeMs: Math.max(0, playtimeMs),
    })
    this.data.sessions = this.data.sessions.slice(0, MAX_SESSIONS)
    await this.save()
  }

  async markInstalled(id, installedAt) {
    const installation = this.getInstallation(id)
    if (!installation) return
    installation.lastInstalledAt = installedAt
    installation.updatedAt = new Date().toISOString()
    await this.save()
  }

  async upsertAccount(account) {
    const index = this.data.accounts.findIndex((item) => item.id === account.id)
    if (index >= 0) {
      this.data.accounts[index] = { ...this.data.accounts[index], ...account }
    } else {
      this.data.accounts.push(account)
    }
    await this.save()
    return this.getAccount(account.id)
  }

  async updateAccount(id, patch) {
    const account = this.getAccount(id)
    if (!account) return null
    Object.assign(account, patch)
    await this.save()
    return account
  }

  async removeAccount(id) {
    this.data.accounts = this.data.accounts.filter((item) => item.id !== id)
    if (this.data.activeAccountId === id) {
      this.data.activeAccountId = this.data.accounts[0]?.id || null
    }
    await this.save()
  }

  async setActiveAccount(id) {
    if (!this.getAccount(id)) throw new Error('Account not found.')
    this.data.activeAccountId = id
    const account = this.getAccount(id)
    account.lastUsedAt = new Date().toISOString()
    await this.save()
    return account
  }

  async addActivity(entry) {
    const activity = {
      id: randomId(),
      at: new Date().toISOString(),
      status: 'info',
      ...entry,
    }
    this.data.activity.unshift(activity)
    this.data.activity = this.data.activity.slice(0, MAX_ACTIVITY)
    await this.save()
    return activity
  }

  async clearActivity() {
    this.data.activity = []
    await this.save()
  }

  publicServer(server) {
    if (!server) return null
    return {
      id: server.id,
      name: server.name,
      address: server.address,
      connectAddress: server.connectAddress || server.address,
      edition: server.edition === 'bedrock' ? 'bedrock' : 'java',
      addedAt: server.addedAt,
      lastJoinedAt: server.lastJoinedAt,
    }
  }

  publicAccount(account) {
    if (!account) return null
    return {
      id: account.id,
      type: account.type || 'microsoft',
      name: account.name,
      uuid: account.uuid,
      addedAt: account.addedAt,
      lastUsedAt: account.lastUsedAt,
      expiresAt: account.expiresAt,
      sessionExpired: account.sessionExpired,
      avatarDataUrl: account.avatarDataUrl,
      isActive: account.id === this.data.activeAccountId,
    }
  }
}
