import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConfigDocument,
  CONFIG_VERSION,
  MAX_CONFIG_BYTES,
  mergePortablePreferences,
  parseConfigDocument,
  planInstallations,
  planServers,
} from '../electron/core/config-transfer.js'
import { createDefaultSettings } from '../electron/core/settings.js'

const CURRENT_SETTINGS = {
  ...createDefaultSettings({ totalMemMb: 16_384, instancesRoot: 'C:\\Users\\alex\\Aqua\\instances' }),
  theme: 'slate',
  dashboardBackground: 'C:\\Users\\alex\\Pictures\\dashboard.png',
  java: { mode: 'path', path: 'C:\\Program Files\\Java\\bin\\java.exe' },
  startup: {
    launchAtLogin: true,
    startMinimized: false,
    reopenOnGameExit: true,
    refreshJavaOnStart: false,
  },
  window: {
    width: 1600,
    height: 900,
    fullscreen: false,
    placement: { x: 40, y: 50, width: 1600, height: 900, maximized: false },
  },
}

const EXPORTED_PROFILE = {
  id: 'local-profile-id',
  name: 'Create Above and Beyond',
  versionId: '1.18.2',
  loader: { type: 'forge', version: '40.2.0', profileId: 'forge-40.2.0' },
  gameDir: 'C:\\Users\\alex\\Aqua\\instances\\create',
  javaPath: 'C:\\Program Files\\Java\\bin\\java.exe',
  coverPath: 'C:\\Users\\alex\\Aqua\\covers\\create.png',
  memoryOverride: { minMb: 2048, maxMb: 6144 },
  windowOverride: { width: 1920, height: 1080, fullscreen: true },
  jvmArgsOverride: '-XX:+UseG1GC',
  gameArgsOverride: '',
  backupPolicy: { enabled: true, onExit: true, daily: true, dailyHour: 4, retentionCount: 8, maxTotalMb: 4096 },
  pinned: true,
  tags: ['create', 'skyblock'],
  color: 'teal',
  sortIndex: 4,
  installed: true,
  installedAt: '2026-01-02T03:04:05.000Z',
  worlds: 3,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const EXPORTED_SERVER = {
  id: 'local-server-id',
  name: 'SMP',
  address: 'Play.Example.com',
  connectAddress: 'play.example.com',
  edition: 'java',
  installationId: 'local-profile-id',
  addedAt: '2026-01-01T00:00:00.000Z',
  lastJoinedAt: '2026-02-01T00:00:00.000Z',
}

test('export keeps portable settings and metadata but never local paths, ids or accounts', () => {
  const document = buildConfigDocument({
    settings: CURRENT_SETTINGS,
    installations: [EXPORTED_PROFILE],
    servers: [EXPORTED_SERVER],
    appVersion: '1.2.3',
    exportedAt: '2026-03-01T00:00:00.000Z',
  })
  const json = JSON.stringify(document)

  assert.equal(document.format, 'aqua-config')
  assert.equal(document.version, CONFIG_VERSION)
  assert.equal(document.app.version, '1.2.3')
  assert.equal(document.installations.length, 1)
  assert.equal(document.servers.length, 1)
  assert.equal(document.preferences.theme, 'slate')
  assert.equal(document.preferences.window.width, 1600)
  assert.deepEqual(document.preferences.window, { width: 1600, height: 900, fullscreen: false })
  assert.equal(document.preferences.startup.startMinimized, false)
  assert.equal(document.preferences.startup.launchAtLogin, undefined)

  assert.deepEqual(document.installations[0].memoryOverride, { minMb: 2048, maxMb: 6144 })
  assert.deepEqual(document.installations[0].tags, ['create', 'skyblock'])
  assert.equal(document.installations[0].pinned, true)
  assert.equal(document.installations[0].sourceId, 'local-profile-id')
  assert.equal(document.installations[0].gameDir, undefined)
  assert.equal(document.installations[0].javaPath, undefined)
  assert.equal(document.installations[0].coverPath, undefined)
  assert.equal(document.installations[0].loader.profileId, undefined)
  assert.equal(document.servers[0].connectAddress, undefined)
  assert.equal(document.servers[0].lastJoinedAt, undefined)

  assert.doesNotMatch(json, /dashboard\.png/)
  assert.doesNotMatch(json, /Program Files/)
  assert.doesNotMatch(json, /Accounts|accessToken|refreshToken|clientId/i)
  assert.ok(MAX_CONFIG_BYTES >= 1024)
})

test('parse rejects a foreign or future document and skips malformed entries', () => {
  assert.throws(() => parseConfigDocument({ format: 'something-else', version: 1 }), /not an Aqua configuration/)
  assert.throws(() => parseConfigDocument({ format: 'aqua-config', version: 99 }), /cannot import/)

  const parsed = parseConfigDocument({
    format: 'aqua-config',
    version: 1,
    preferences: { theme: 'slate', dashboardBackground: 'C:\\secret.png' },
    installations: [
      { name: 'Good', versionId: '1.20.1', loader: { type: 'fabric', version: '0.15.0' } },
      { name: '', versionId: '1.20.1' },
      null,
    ],
    servers: [
      { name: 'Good server', address: 'example.com', edition: 'java' },
      { name: 'Broken server', address: '' },
    ],
  })

  assert.equal(parsed.document.installations.length, 1)
  assert.equal(parsed.document.servers.length, 1)
  assert.equal(parsed.document.preferences.theme, 'slate')
  assert.equal(parsed.document.preferences.dashboardBackground, undefined)
  assert.equal(parsed.warnings.length, 2)
})

test('preferences merge preserves machine-specific values and clamps memory to this PC', () => {
  const merged = mergePortablePreferences(
    CURRENT_SETTINGS,
    {
      theme: 'midnight',
      accent: 'ocean',
      memory: { minMb: 2048, maxMb: 64_000 },
      window: { width: 1920, height: 1080, fullscreen: true, placement: { x: 999 } },
      downloads: { concurrency: 64, bandwidthKbps: 2500 },
      startup: { startMinimized: true, launchAtLogin: false },
      java: { mode: 'auto', path: null },
      defaultGameDir: 'D:\\Elsewhere',
      dashboardBackground: 'D:\\wallpaper.png',
    },
    { defaults: CURRENT_SETTINGS, totalMemMb: 8192 },
  )

  assert.equal(merged.theme, 'midnight')
  assert.equal(merged.accent, 'ocean')
  assert.equal(merged.memory.maxMb, 8192)
  assert.equal(merged.memory.minMb, 2048)
  assert.equal(merged.window.width, 1920)
  assert.equal(merged.window.height, 1080)
  assert.equal(merged.window.fullscreen, true)
  assert.deepEqual(merged.window.placement, CURRENT_SETTINGS.window.placement)
  assert.equal(merged.downloads.concurrency, 32)
  assert.equal(merged.startup.startMinimized, true)
  assert.equal(merged.startup.launchAtLogin, true)
  assert.deepEqual(merged.java, CURRENT_SETTINGS.java)
  assert.equal(merged.defaultGameDir, CURRENT_SETTINGS.defaultGameDir)
  assert.equal(merged.dashboardBackground, CURRENT_SETTINGS.dashboardBackground)
})

test('installation planning skips exact profiles and renames only real collisions', () => {
  const existing = [
    { id: 'profile-a', name: 'Vanilla', versionId: '1.20.1', loader: { type: 'vanilla', version: null } },
    { id: 'profile-b', name: 'Modded', versionId: '1.20.1', loader: { type: 'fabric', version: '0.15.0' } },
  ]
  const plan = planInstallations(
    [
      { sourceId: 'same', name: 'vanilla', versionId: '1.20.1', loader: { type: 'vanilla', version: null } },
      { sourceId: 'different', name: 'Modded', versionId: '1.19.2', loader: { type: 'fabric', version: '0.15.0' } },
      { sourceId: 'new', name: 'Fresh', versionId: '1.21', loader: { type: 'neoforge', version: '21.1.0' } },
    ],
    existing,
  )

  assert.deepEqual(
    plan.map((entry) => [entry.sourceId, entry.action]),
    [
      ['same', 'skip'],
      ['different', 'add'],
      ['new', 'add'],
    ],
  )
  assert.equal(plan[0].targetId, 'profile-a')
  assert.equal(plan[1].name, 'Modded (Imported)')
  assert.equal(plan[2].name, 'Fresh')

  const longName = 'A'.repeat(48)
  const longPlan = planInstallations(
    [{ sourceId: 'long', name: longName, versionId: '1.19.2', loader: { type: 'fabric', version: '0.15.0' } }],
    [{ id: 'profile-long', name: longName, versionId: '1.20.1', loader: { type: 'fabric', version: '0.15.0' } }],
  )
  assert.equal(longPlan[0].name.length, 48)
  assert.match(longPlan[0].name, /\(Imported\)$/)
})

test('server planning normalizes addresses and avoids duplicate or invalid entries', () => {
  const plan = planServers(
    [
      { sourceId: 'duplicate', name: 'Same', address: 'play.example.com:25565', edition: 'java' },
      { sourceId: 'fresh', name: 'Fresh', address: 'minecraft://New.Example.com', edition: 'java' },
      { sourceId: 'bedrock', name: 'Bedrock', address: 'bedrock.example.com', edition: 'bedrock' },
      { sourceId: 'bad', name: 'Bad', address: 'https://bad.example.com', edition: 'java' },
    ],
    [{ address: 'play.example.com', edition: 'java' }],
  )

  assert.equal(plan[0].action, 'skip')
  assert.equal(plan[1].action, 'add')
  assert.equal(plan[1].address, 'new.example.com:25565')
  assert.equal(plan[1].connectAddress, 'new.example.com')
  assert.equal(plan[2].action, 'add')
  assert.equal(plan[2].address, 'bedrock.example.com:19132')
  assert.equal(plan[3].action, 'skip')
  assert.match(plan[3].reason, /cannot contain|host name/i)
})

test('an exported document can be parsed and imported again', () => {
  const document = buildConfigDocument({
    settings: CURRENT_SETTINGS,
    installations: [EXPORTED_PROFILE],
    servers: [EXPORTED_SERVER],
  })
  const roundTripped = JSON.parse(JSON.stringify(document))
  const parsed = parseConfigDocument(roundTripped)

  assert.equal(parsed.warnings.length, 0)
  assert.equal(parsed.document.installations[0].name, EXPORTED_PROFILE.name)
  assert.equal(parsed.document.installations[0].loader.version, '40.2.0')
  assert.equal(parsed.document.servers[0].sourceInstallationId, 'local-profile-id')
})
