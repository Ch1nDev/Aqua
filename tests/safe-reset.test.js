import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  applySafeReset,
  buildResetPreview,
  clearResetDirectory,
  FactoryResetService,
  RESET_CONFIRMATION,
} from '../electron/core/factory-reset.js'
import { Store } from '../electron/core/store.js'

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-reset-'))
  const dataRoot = path.join(root, 'data')
  const paths = {
    dataRoot,
    configFile: path.join(dataRoot, 'launcher.json'),
    accountsFile: path.join(dataRoot, 'accounts.bin'),
    minecraftRoot: path.join(dataRoot, 'minecraft'),
    instancesRoot: path.join(dataRoot, 'instances'),
    cacheRoot: path.join(dataRoot, 'cache'),
    logsRoot: path.join(dataRoot, 'logs'),
    runtimeRoot: path.join(dataRoot, 'runtime'),
    backupsRoot: path.join(dataRoot, 'backups'),
    bedrockRoot: path.join(dataRoot, 'bedrock'),
    horizonRoot: path.join(dataRoot, 'horizon'),
  }
  await Promise.all(
    [
      paths.instancesRoot,
      paths.cacheRoot,
      paths.logsRoot,
      paths.runtimeRoot,
      paths.backupsRoot,
      paths.bedrockRoot,
      paths.horizonRoot,
      path.join(dataRoot, 'exports'),
    ].map((folder) => fs.mkdir(folder, { recursive: true })),
  )

  const store = new Store({
    configFile: paths.configFile,
    instancesRoot: paths.instancesRoot,
    totalMemMb: 16_384,
    logger: silentLogger,
  })
  await store.init()
  await store.replaceSettings({
    ...store.defaults,
    theme: 'slate',
    dashboardBackground: 'C:\\Users\\alex\\Pictures\\dashboard.png',
  })
  store.data.installations = [{ id: 'profile-1', name: 'Create', versionId: '1.20.1' }]
  store.data.activeInstallationId = 'profile-1'
  store.data.servers = [{ id: 'server-1', name: 'SMP', address: 'play.example.com' }]
  store.data.activity = [{ id: 'activity-1', title: 'Played Create' }]
  store.data.sessions = [{ id: 'session-1', installationId: 'profile-1', playtimeMs: 42 }]
  store.data.notifications = [{ id: 'notification-1', title: 'Installed' }]
  store.data.crashes = [{ id: 'crash-1', title: 'A crash' }]
  store.data.accounts = [
    {
      id: 'account-1',
      type: 'microsoft',
      name: 'Alex',
      uuid: '11111111-2222-3333-4444-555555555555',
      addedAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    },
  ]
  store.data.activeAccountId = 'account-1'
  await store.save()

  await fs.writeFile(paths.accountsFile, 'encrypted-token-bytes', 'utf8')
  await fs.writeFile(path.join(paths.cacheRoot, 'cache.bin'), '1234567', 'utf8')
  await fs.writeFile(path.join(paths.logsRoot, 'launcher.log'), 'hello', 'utf8')
  await fs.writeFile(path.join(paths.instancesRoot, 'world.dat'), 'world', 'utf8')
  await fs.writeFile(path.join(paths.backupsRoot, 'world.zip'), 'backup', 'utf8')
  await fs.writeFile(path.join(dataRoot, 'exports', 'aqua-config.json'), '{"format":"aqua-config"}', 'utf8')

  return {
    root,
    paths,
    store,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

test('reset preview names every category and only measures launcher-owned folders', async (t) => {
  const fixture = await makeFixture()
  t.after(fixture.cleanup)

  const preview = await buildResetPreview({ paths: fixture.paths, store: fixture.store })
  const category = (id) => preview.categories.find((item) => item.id === id)

  assert.equal(preview.categories.length, 6)
  assert.equal(category('settings').count, null)
  assert.equal(category('profiles').count, 1)
  assert.equal(category('servers').count, 1)
  assert.equal(category('history').count, 4)
  assert.equal(category('caches').bytes, 7)
  assert.equal(category('caches').files, 1)
  assert.equal(category('logs').bytes, 5)
  assert.equal(category('logs').files, 1)
  assert.equal(preview.totalBytes, 12)
  assert.equal(preview.totalFiles, 2)
  assert.equal(preview.accountsPreserved, 1)
  assert.equal(preview.confirmationWord, RESET_CONFIRMATION)
  assert.match(preview.backupPath, /config\.before-reset\.json$/)
  assert.ok(preview.preserved.some((item) => /Worlds, mods/.test(item)))
})

test('reset requires the current preview and exact confirmation, then preserves accounts and game data', async (t) => {
  const fixture = await makeFixture()
  t.after(fixture.cleanup)
  const service = new FactoryResetService({ paths: fixture.paths, store: fixture.store })

  const canceled = await service.preview()
  assert.equal(service.cancel(), true)
  await assert.rejects(
    service.apply({ token: canceled.token, confirmation: RESET_CONFIRMATION }),
    /Review the reset/,
  )

  const preview = await service.preview()
  await assert.rejects(service.apply({ token: preview.token, confirmation: 'reset' }), /Type RESET/)
  const result = await service.apply({ token: preview.token, confirmation: RESET_CONFIRMATION })

  assert.equal(result.settings.theme, 'midnight')
  assert.equal(result.settings.onboardingComplete, false)
  assert.equal(result.removed.files, 2)
  assert.equal(result.removed.bytes, 12)
  assert.ok(result.markerPath)

  assert.deepEqual(fixture.store.installations, [])
  assert.deepEqual(fixture.store.servers, [])
  assert.deepEqual(fixture.store.activity, [])
  assert.deepEqual(fixture.store.sessions, [])
  assert.deepEqual(fixture.store.notifications, [])
  assert.deepEqual(fixture.store.crashes, [])
  assert.equal(fixture.store.accounts.length, 1)
  assert.equal(fixture.store.activeAccountId, 'account-1')

  const backup = JSON.parse(await fs.readFile(result.backupPath, 'utf8'))
  assert.equal(backup.settings.theme, 'slate')
  assert.equal(backup.accounts[0].id, 'account-1')
  const marker = JSON.parse(await fs.readFile(result.markerPath, 'utf8'))
  assert.equal(marker.format, 'aqua-reset')
  assert.equal(marker.removed.bytes, 12)

  assert.deepEqual(await fs.readdir(fixture.paths.cacheRoot), [])
  assert.deepEqual(await fs.readdir(fixture.paths.logsRoot), [])
  assert.equal(await fs.readFile(fixture.paths.accountsFile, 'utf8'), 'encrypted-token-bytes')
  assert.equal(await fs.readFile(path.join(fixture.paths.instancesRoot, 'world.dat'), 'utf8'), 'world')
  assert.equal(await fs.readFile(path.join(fixture.paths.backupsRoot, 'world.zip'), 'utf8'), 'backup')
  assert.equal(
    await fs.readFile(path.join(fixture.paths.dataRoot, 'exports', 'aqua-config.json'), 'utf8'),
    '{"format":"aqua-config"}',
  )
  await assert.rejects(service.apply({ token: preview.token, confirmation: RESET_CONFIRMATION }), /Review the reset/)
})

test('a running game or job blocks apply and leaves the configuration and caches intact', async (t) => {
  const fixture = await makeFixture()
  t.after(fixture.cleanup)
  const service = new FactoryResetService({
    paths: fixture.paths,
    store: fixture.store,
    getBlockingActivity: () => 'Close Minecraft before resetting Aqua.',
  })

  const preview = await service.preview()
  assert.equal(preview.blockedReason, 'Close Minecraft before resetting Aqua.')
  await assert.rejects(
    service.apply({ token: preview.token, confirmation: RESET_CONFIRMATION }),
    /Close Minecraft/,
  )
  assert.equal(fixture.store.settings.theme, 'slate')
  assert.equal(await fs.readFile(path.join(fixture.paths.cacheRoot, 'cache.bin'), 'utf8'), '1234567')
})

test('a failed store write keeps the pre-reset config and leaves caches alone', async (t) => {
  const fixture = await makeFixture()
  t.after(fixture.cleanup)
  const service = new FactoryResetService({ paths: fixture.paths, store: fixture.store })
  const preview = await service.preview()
  service.store = {
    defaults: fixture.store.defaults,
    resetLauncherData: async () => {
      throw new Error('disk full')
    },
  }

  await assert.rejects(service.apply({ token: preview.token, confirmation: RESET_CONFIRMATION }), /disk full/)
  assert.equal(fixture.store.settings.theme, 'slate')
  assert.equal(await fs.readFile(path.join(fixture.paths.cacheRoot, 'cache.bin'), 'utf8'), '1234567')
  assert.equal(await fs.readFile(path.join(fixture.paths.logsRoot, 'launcher.log'), 'utf8'), 'hello')
})

test('reset never follows a linked folder outside the cache root', async (t) => {
  const fixture = await makeFixture()
  t.after(fixture.cleanup)
  const outside = path.join(fixture.root, 'outside')
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(path.join(outside, 'keep.txt'), 'keep', 'utf8')
  const link = path.join(fixture.paths.cacheRoot, 'outside-link')
  try {
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`this host cannot create a folder link: ${error.code || error.message}`)
    return
  }

  const preview = await buildResetPreview({ paths: fixture.paths, store: fixture.store })
  assert.ok(preview.skippedLinks >= 1)
  assert.equal(preview.totalBytes, 12)

  await applySafeReset({ paths: fixture.paths, store: fixture.store })
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep')
  await assert.rejects(fs.access(link))
})

test('cleanup refuses an unowned folder even when it is inside the data root', async (t) => {
  const fixture = await makeFixture()
  t.after(fixture.cleanup)

  await assert.rejects(clearResetDirectory(fixture.paths.dataRoot, fixture.paths, 'caches'), /Refusing/)
  await assert.rejects(clearResetDirectory(fixture.paths.instancesRoot, fixture.paths, 'logs'), /Refusing/)
  await assert.rejects(clearResetDirectory(fixture.paths.logsRoot, fixture.paths, 'caches'), /Refusing/)
})
