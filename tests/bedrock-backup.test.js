import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { BedrockService } from '../electron/core/bedrock.js'

function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function write(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents)
}

const WORLD_FOLDER = 'abcdefghijklmnop'

async function fixture(prefix) {
  const root = await tempDir(prefix)
  const dataRoot = path.join(root, 'com.mojang')
  const worldsDirectory = path.join(dataRoot, 'minecraftWorlds')
  const worldDir = path.join(worldsDirectory, WORLD_FOLDER)
  const files = {
    'level.dat': Buffer.from([0x08, 0x00, 0x0a, 0x00, 0x04, 0x44, 0x61, 0x74, 0x61]),
    'level.dat_old': Buffer.from('previous level'),
    'levelname.txt': Buffer.from('Nordic Ø world\n', 'utf8'),
    'world_icon.jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    'db/MANIFEST-000001': Buffer.from('manifest'),
    'db/000001.log': Buffer.from('log data'),
  }
  for (const [name, data] of Object.entries(files)) await write(path.join(worldDir, name), data)

  const edition = {
    id: 'bedrock',
    edition: 'bedrock',
    name: 'Minecraft for Windows',
    packageVersion: '1.26.5203.0',
    version: '1.26.52.03',
    dataRoot,
    dataRootExists: true,
    worldsDirectory,
  }
  const paths = { backupsRoot: path.join(root, 'backups'), cacheRoot: path.join(root, 'cache') }
  const service = new BedrockService({
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    openExternal: async () => true,
    openPath: async () => null,
    paths,
  })
  // Detection spawns PowerShell, so the fixture pins the detected edition.
  service.status = async () => ({ supported: true, editions: [edition], developerMode: null })
  return { root, worldsDirectory, worldDir, files, edition, paths, service }
}

test('a Bedrock world backs up with its icon and restores as a copy', async () => {
  const { worldsDirectory, worldDir, files, service, paths } = await fixture('aqua-bedrock-backup-')

  const backup = await service.backupWorld('bedrock', WORLD_FOLDER)
  assert.equal(backup.editionId, 'bedrock')
  assert.equal(backup.editionName, 'Minecraft for Windows')
  assert.equal(backup.name, 'Nordic Ø world')
  assert.equal(backup.worldFolder, WORLD_FOLDER)
  assert.equal(backup.files, 6)
  assert.ok(backup.sizeBytes > 0)

  const archive = path.join(paths.backupsRoot, 'bedrock-bedrock', `${backup.id}.zip`)
  assert.ok((await fs.stat(archive)).isFile())

  const listed = await service.listBackups('bedrock')
  assert.equal(listed.backups.length, 1)
  assert.equal(listed.backups[0].id, backup.id)

  // The worlds payload carries the backups the page renders.
  const worlds = await service.worlds('bedrock')
  assert.equal(worlds.backups.length, 1)

  const restored = await service.restoreBackup('bedrock', backup.id)
  assert.notEqual(restored.folder, WORLD_FOLDER)
  assert.match(restored.folder, /^abcdefghijklmnop-restored-\d{14}/)
  assert.equal(restored.files, 6)

  const restoredDir = path.join(worldsDirectory, restored.folder)
  for (const [name, data] of Object.entries(files)) {
    assert.deepEqual(await fs.readFile(path.join(restoredDir, name)), data, `${name} should survive the round trip`)
  }
  // The live world is never written to.
  assert.deepEqual(await fs.readFile(path.join(worldDir, 'levelname.txt')), files['levelname.txt'])
})

test('restoring the same backup twice creates two separate worlds', async () => {
  const { worldsDirectory, service } = await fixture('aqua-bedrock-restore-twice-')
  const backup = await service.backupWorld('bedrock', WORLD_FOLDER)

  const first = await service.restoreBackup('bedrock', backup.id)
  const second = await service.restoreBackup('bedrock', backup.id)
  assert.notEqual(first.folder, second.folder)

  const folders = await fs.readdir(worldsDirectory)
  assert.equal(folders.length, 3)
  const worlds = await service.worlds('bedrock')
  assert.equal(worlds.worlds.length, 3)
  // Both copies keep the world's own name.
  assert.equal(worlds.worlds.filter((world) => world.name === 'Nordic Ø world').length, 3)
})

test('a world without level.dat is refused before a ZIP is written', async () => {
  const { worldDir, service, paths } = await fixture('aqua-bedrock-nolevel-')
  await fs.rm(path.join(worldDir, 'level.dat'))

  await assert.rejects(
    () => service.backupWorld('bedrock', WORLD_FOLDER),
    /no level\.dat/,
  )
  const backups = await fs.readdir(path.join(paths.backupsRoot, 'bedrock-bedrock')).catch(() => [])
  assert.deepEqual(backups, [])
})

test('deleting a backup removes its archive and index row', async () => {
  const { service, paths } = await fixture('aqua-bedrock-delete-')
  const backup = await service.backupWorld('bedrock', WORLD_FOLDER)

  await service.deleteBackup('bedrock', backup.id)
  assert.equal((await service.listBackups('bedrock')).backups.length, 0)
  assert.deepEqual(await fs.readdir(path.join(paths.backupsRoot, 'bedrock-bedrock')), ['index.json'])
  await assert.rejects(() => service.restoreBackup('bedrock', backup.id), /no longer available/)
})

test('a world folder outside the worlds directory is refused', async () => {
  const { service } = await fixture('aqua-bedrock-escape-')
  await assert.rejects(() => service.backupWorld('bedrock', '../com.mojang'), /invalid|outside/)
  await assert.rejects(() => service.listBackups('nonsense'), /not installed/)
})
