import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BedrockService,
  appUserModelId,
  bedrockDeepLink,
  dataRootCandidates,
  gameVersionFromPackageVersion,
  resolveDataRoot,
  usesUwpDataFolder,
} from '../electron/core/bedrock.js'

test('old package versions keep using the UWP data folder', () => {
  assert.equal(usesUwpDataFolder('1.9.15.0'), true)
  assert.equal(usesUwpDataFolder('1.16.201.0'), true)
  assert.equal(usesUwpDataFolder('1.21.1140.0'), true)
  assert.equal(usesUwpDataFolder('1.26.5203.0'), false)
  assert.equal(usesUwpDataFolder(''), false)
  assert.equal(usesUwpDataFolder('nonsense'), false)
})
import {
  ServerService,
  encodeUnconnectedPing,
  normalizeServerAddress,
  parseUnconnectedPong,
} from '../electron/core/servers.js'

const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex')

function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function pong(payload) {
  const body = Buffer.from(payload, 'utf8')
  const buffer = Buffer.alloc(35 + body.length)
  buffer.writeUInt8(0x1c, 0)
  buffer.writeBigUInt64BE(1234n, 1)
  buffer.writeBigUInt64BE(99n, 9)
  RAKNET_MAGIC.copy(buffer, 17)
  buffer.writeUInt16BE(body.length, 33)
  body.copy(buffer, 35)
  return buffer
}

test('store package versions map onto Bedrock game versions', () => {
  assert.equal(gameVersionFromPackageVersion('1.26.5203.0'), '1.26.52.03')
  assert.equal(gameVersionFromPackageVersion('1.21.2301.0'), '1.21.23.01')
  assert.equal(gameVersionFromPackageVersion('1.21.51.0'), '1.21.51')
  assert.equal(gameVersionFromPackageVersion('nonsense'), null)
  assert.equal(gameVersionFromPackageVersion(''), null)
  assert.equal(gameVersionFromPackageVersion(null), null)
})

test('the published app id comes from the package manifest', () => {
  assert.equal(appUserModelId('Microsoft.MinecraftUWP_8wekyb3d8bbwe', ['Game']), 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game')
  // A manifest that cannot be read still activates through the default app id.
  assert.equal(appUserModelId('Microsoft.MinecraftUWP_8wekyb3d8bbwe', []), 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!App')
  assert.equal(appUserModelId('', ['Game']), null)
})

test('deep links send the host and port Bedrock expects', () => {
  assert.equal(bedrockDeepLink('play.example.com:19132'), 'minecraft://connect?serverUrl=play.example.com&serverPort=19132')
  assert.equal(bedrockDeepLink('play.example.com'), 'minecraft://connect?serverUrl=play.example.com&serverPort=19132')
  assert.equal(bedrockDeepLink('minecraft://example.com:25565'), 'minecraft://connect?serverUrl=example.com&serverPort=25565')
  assert.throws(() => bedrockDeepLink(''), /Enter a server address/)
  assert.throws(() => bedrockDeepLink('bad host'), /invalid/)
})

test('bedrock addresses default to the Bedrock port and always carry it', () => {
  const bedrock = normalizeServerAddress('play.example.com', { edition: 'bedrock' })
  assert.equal(bedrock.edition, 'bedrock')
  assert.equal(bedrock.port, 19132)
  assert.equal(bedrock.address, 'play.example.com:19132')
  assert.equal(bedrock.connectAddress, 'play.example.com:19132')

  // Java keeps an omitted port omitted so the game can follow SRV records.
  const java = normalizeServerAddress('play.example.com')
  assert.equal(java.edition, 'java')
  assert.equal(java.address, 'play.example.com:25565')
  assert.equal(java.connectAddress, 'play.example.com')
})

test('RakNet ping carries the magic bytes and a client GUID', () => {
  const guid = Buffer.from('0102030405060708', 'hex')
  const ping = encodeUnconnectedPing(guid, 4242)
  assert.equal(ping.length, 33)
  assert.equal(ping.readUInt8(0), 0x01)
  assert.equal(ping.readBigUInt64BE(1), 4242n)
  assert.deepEqual(ping.subarray(9, 25), RAKNET_MAGIC)
  assert.deepEqual(ping.subarray(25), guid)
})

test('RakNet pong exposes the status the game shows', () => {
  const parsed = parseUnconnectedPong(
    pong('MCPE;Dedicated Server;671;1.21.50;3;10;13253860892328930865;Bedrock level;Survival;1;19132;19133;'),
  )
  assert.equal(parsed.version, '1.21.50')
  assert.equal(parsed.protocol, 671)
  assert.deepEqual(parsed.players, { online: 3, max: 10 })
  assert.equal(parsed.motd, 'Dedicated Server\nBedrock level')
  assert.equal(parsed.ports.ipv4, 19132)

  // Without a level name the second MOTD line stays empty.
  const single = parseUnconnectedPong(pong('MCPE;Hello;671;1.21.50;0;20;1234;;Creative;2;19132;19133;'))
  assert.equal(single.motd, 'Hello')
  assert.equal(single.gameMode, 'Creative')

  // Colour codes are stripped the same way the Java MOTD strips them.
  const coloured = parseUnconnectedPong(pong('MCPE;§aGreen §rserver;671;1.21.50;1;5;7;Level;Survival;1;19132;19133;'))
  assert.equal(coloured.motd.split('\n')[0], 'Green server')
})

test('RakNet pong rejects anything that is not a Bedrock status', () => {
  assert.equal(parseUnconnectedPong(Buffer.from([0x1c, 0x00])), null)
  const wrongId = pong('MCPE;Server;671;1.21.50;0;10;1;Level;Survival;1;19132;19133;')
  wrongId.writeUInt8(0x02, 0)
  assert.equal(parseUnconnectedPong(wrongId), null)
  const wrongMagic = pong('MCPE;Server;671;1.21.50;0;10;1;Level;Survival;1;19132;19133;')
  wrongMagic.writeUInt8(0x00, 18)
  assert.equal(parseUnconnectedPong(wrongMagic), null)
  // A Java status line arriving on the Bedrock port is ignored.
  assert.equal(parseUnconnectedPong(pong('Some other server')), null)
  // Truncated payloads are ignored rather than throwing.
  const truncated = pong('MCPE;Server;671;1.21.50;0;10;1;Level;Survival;1;19132;19133;')
  assert.equal(parseUnconnectedPong(truncated.subarray(0, 20)), null)
})

test('data roots prefer this player, then shared, then the package folder', async () => {
  const root = await tempDir('aqua-bedrock-')
  const appData = path.join(root, 'Roaming')
  const localAppData = path.join(root, 'Local')
  const edition = {
    id: 'bedrock',
    packageName: 'Microsoft.MinecraftUWP',
    roamingFolder: 'Minecraft Bedrock',
    packageFamilyName: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  }
  const gdkRoot = path.join(appData, 'Minecraft Bedrock')

  // The GDK root comes first, with the older UWP package folder last.
  const candidates = await dataRootCandidates(edition, { appData, localAppData })
  assert.deepEqual(candidates, [
    path.join(gdkRoot, 'games', 'com.mojang'),
    path.join(localAppData, 'Packages', edition.packageFamilyName, 'LocalState', 'games', 'com.mojang'),
  ])

  // Pre-1.21.120 builds only ever wrote to the UWP package folder, so that one
  // leads for them.
  const legacyFirst = await dataRootCandidates(edition, { appData, localAppData, preferUwp: true })
  assert.equal(
    legacyFirst[0],
    path.join(localAppData, 'Packages', edition.packageFamilyName, 'LocalState', 'games', 'com.mojang'),
  )

  // With nothing installed anywhere, the expected GDK folder is reported so the
  // UI can point at where the game would keep its data.
  const missing = await resolveDataRoot(edition, { appData, localAppData })
  assert.equal(missing.exists, false)
  assert.equal(missing.dataRoot, path.join(gdkRoot, 'games', 'com.mojang'))

  await fs.mkdir(path.join(gdkRoot, 'Users', 'Shared', 'games', 'com.mojang'), { recursive: true })
  const shared = await resolveDataRoot(edition, { appData, localAppData })
  assert.equal(shared.exists, true)
  assert.equal(shared.dataRoot, path.join(gdkRoot, 'Users', 'Shared', 'games', 'com.mojang'))

  await fs.mkdir(path.join(gdkRoot, 'Users', '685177682833241340', 'games', 'com.mojang'), { recursive: true })
  const player = await resolveDataRoot(edition, { appData, localAppData })
  assert.equal(player.dataRoot, path.join(gdkRoot, 'Users', '685177682833241340', 'games', 'com.mojang'))

  // Older Store builds only have the UWP package folder.
  const legacyLocal = path.join(root, 'legacy')
  await fs.mkdir(path.join(legacyLocal, 'Packages', edition.packageFamilyName, 'LocalState', 'games', 'com.mojang'), {
    recursive: true,
  })
  const legacy = await resolveDataRoot(edition, { appData: path.join(root, 'empty'), localAppData: legacyLocal })
  assert.equal(legacy.exists, true)
  assert.equal(
    legacy.dataRoot,
    path.join(legacyLocal, 'Packages', edition.packageFamilyName, 'LocalState', 'games', 'com.mojang'),
  )

  await fs.rm(root, { recursive: true, force: true })
})

test('the Bedrock service lists worlds from the data folder', async () => {
  const root = await tempDir('aqua-bedrock-worlds-')
  const worlds = path.join(root, 'minecraftWorlds')
  const world = path.join(worlds, 'abc123')
  await fs.mkdir(path.join(world, 'db'), { recursive: true })
  await fs.writeFile(path.join(world, 'levelname.txt'), 'My Bedrock world\n')
  await fs.writeFile(path.join(world, 'db', 'CURRENT'), 'x'.repeat(64))
  await fs.writeFile(path.join(world, 'world_icon.jpeg'), Buffer.from([0xff, 0xd8, 0xff]))
  await fs.mkdir(path.join(worlds, 'empty-world'), { recursive: true })

  const service = new BedrockService({ logger: null, openExternal: async () => {}, openPath: async () => '' })
  service.cache = {
    at: Date.now(),
    editions: [
      {
        id: 'bedrock',
        edition: 'bedrock',
        name: 'Minecraft for Windows',
        dataRoot: root,
        worldsDirectory: worlds,
      },
    ],
  }

  const result = await service.worlds('bedrock')
  assert.equal(result.directory, worlds)
  assert.equal(result.exists, true)
  assert.equal(result.worlds.length, 2)

  const first = result.worlds.find((entry) => entry.folder === 'abc123')
  assert.equal(first.name, 'My Bedrock world')
  // levelname.txt, the icon, and the database file all count towards the size.
  assert.equal(first.files, 3)
  assert.equal(first.sizeBytes, Buffer.byteLength('My Bedrock world\n') + 3 + 64)
  assert.ok(first.iconDataUrl.startsWith('data:image/jpeg;base64,'))
  assert.ok(Date.parse(first.lastPlayed) > 0)

  // A folder without a level name still shows up, using its folder name.
  const fallback = result.worlds.find((entry) => entry.folder === 'empty-world')
  assert.equal(fallback.name, 'empty-world')
  assert.equal(fallback.iconDataUrl, null)

  await assert.rejects(service.worlds('unknown'), /not installed on this device/)
  await assert.rejects(service.folderPath('bedrock', '../escape'), /invalid/)
  await fs.rm(root, { recursive: true, force: true })
})

test('servers remember their edition and stay unique per edition', async () => {
  const servers = []
  const store = {
    get servers() {
      return servers
    },
    getServer: (id) => servers.find((server) => server.id === id) || null,
    addServer: async (server) => {
      servers.push(server)
      return server
    },
    updateServer: async (id, patch) => {
      Object.assign(servers.find((server) => server.id === id), patch)
    },
    publicServer: (server) => ({ ...server }),
  }
  const service = new ServerService({ store, logger: null })

  const bedrock = await service.add({ name: 'Bedrock SMP', address: 'bedrock.example.com', edition: 'bedrock' })
  assert.equal(bedrock.edition, 'bedrock')
  assert.equal(bedrock.address, 'bedrock.example.com:19132')

  // The same host and port may exist once per edition.
  const java = await service.add({ name: 'Java SMP', address: 'bedrock.example.com:19132' })
  assert.equal(java.edition, 'java')
  await assert.rejects(
    service.add({ name: 'Duplicate', address: 'bedrock.example.com', edition: 'bedrock' }),
    /already in your list/,
  )

  const renamed = await service.update(bedrock.id, { name: 'Renamed', address: 'new.example.com:19133' })
  assert.equal(renamed.edition, 'bedrock')
  assert.equal(renamed.address, 'new.example.com:19133')
})
