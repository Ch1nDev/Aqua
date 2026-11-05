import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { OPEN_FILE_TYPES, parseCommandLine, parseOpenFileIntent } from '../electron/core/deep-links.js'
import { buildJumpListCategories } from '../electron/core/jump-list.js'

test('openFile intents accept only absolute, existing, known files', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-open-file-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const pack = path.join(root, 'My Pack.mrpack')
  await fsp.writeFile(pack, 'pack')

  assert.deepEqual(parseOpenFileIntent(pack), {
    kind: 'openFile',
    path: pack,
    fileType: 'mrpack',
    confirmed: false,
    source: 'file',
  })
  for (const [extension, fileType] of Object.entries(OPEN_FILE_TYPES)) {
    const file = path.join(root, `sample${extension}`)
    await fsp.writeFile(file, 'x')
    assert.equal(parseOpenFileIntent(file).fileType, fileType)
  }

  assert.throws(() => parseOpenFileIntent('relative.mrpack'), /absolute/)
  assert.throws(() => parseOpenFileIntent(path.join(root, 'missing.mrpack')), /no longer available/)
  const folder = path.join(root, 'folder.mrpack')
  await fsp.mkdir(folder)
  assert.throws(() => parseOpenFileIntent(folder), /folder, not a file/)
  assert.throws(() => parseOpenFileIntent(path.join(root, 'thing.exe')), /Aqua can open/)
  const empty = path.join(root, 'empty.mcworld')
  await fsp.writeFile(empty, '')
  assert.throws(() => parseOpenFileIntent(empty), /empty/)
  assert.throws(
    () => parseOpenFileIntent(pack, { stat: () => ({ isFile: () => true, size: 5 * 1024 * 1024 * 1024 }) }),
    /too large/,
  )
})

test('an associated file travels through the same CLI parser as other intents', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-open-cli-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const world = path.join(root, 'Holiday.mcworld')
  await fsp.writeFile(world, 'world')

  const intent = parseCommandLine([process.execPath, '.', world])
  assert.equal(intent.kind, 'openFile')
  assert.equal(intent.fileType, 'mcworld')
  assert.equal(intent.source, 'file')
  assert.equal(intent.confirmed, false)
  assert.throws(() => parseCommandLine([process.execPath, '.', world, '--yes']), /one associated file/)
  assert.throws(() => parseCommandLine([process.execPath, '.', path.join(root, 'thing.exe')]), /Aqua can open/)
})

test('the packaged build advertises the four Windows associations', async () => {
  const pkg = JSON.parse(await fsp.readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
  assert.deepEqual(
    pkg.build.fileAssociations.map((entry) => entry.ext).sort(),
    ['mcaddon', 'mcpack', 'mcworld', 'mrpack'],
  )
  for (const association of pkg.build.fileAssociations) {
    assert.ok(association.name, `${association.ext} has a display name`)
    assert.ok(association.description, `${association.ext} has a description`)
  }
})

test('jump lists keep five recent installed profiles and the last server', () => {
  const installations = [
    ['oldest', '2026-10-01T10:00:00.000Z', true],
    ['newest', '2026-11-03T10:00:00.000Z', true],
    ['second', '2026-11-02T10:00:00.000Z', true],
    ['third', '2026-11-01T10:00:00.000Z', true],
    ['fourth', '2026-10-31T10:00:00.000Z', true],
    ['fifth', '2026-10-30T10:00:00.000Z', true],
    ['uninstalled', '2026-11-04T10:00:00.000Z', false],
  ].map(([name, lastPlayedAt, installed]) => ({
    id: `id-${name}`,
    name,
    versionId: '1.21.4',
    loader: { type: 'fabric' },
    installed,
    lastPlayedAt,
  }))
  const categories = buildJumpListCategories({
    installations,
    servers: [
      { id: 'old-server', name: 'Old server', address: 'old.example.net', edition: 'java', lastJoinedAt: '2026-10-01T10:00:00.000Z' },
      {
        id: 'last-server',
        name: 'Friends',
        address: 'play.example.net:25565',
        connectAddress: 'play.example.net:25565',
        edition: 'bedrock',
        lastJoinedAt: '2026-11-03T11:00:00.000Z',
      },
    ],
    execPath: 'C:\\Aqua\\Aqua Launcher.exe',
  })

  assert.equal(categories.length, 2)
  assert.equal(categories[0].name, 'Recent profiles')
  assert.deepEqual(
    categories[0].items.map((item) => item.title),
    ['newest', 'second', 'third', 'fourth', 'fifth'],
  )
  assert.ok(categories[0].items.every((item) => item.type === 'task'))
  assert.equal(categories[0].items[0].program, 'C:\\Aqua\\Aqua Launcher.exe')
  assert.equal(categories[0].items[0].args, '"aqua://launch?instance=id-newest"')
  assert.equal(categories[1].name, 'Last server')
  assert.equal(categories[1].items[0].title, 'Join Friends')
  assert.equal(
    categories[1].items[0].args,
    '"aqua://join?server=play.example.net%3A25565&edition=bedrock"',
  )
})

test('empty or development jump lists do not add invalid tasks', () => {
  assert.deepEqual(buildJumpListCategories({ execPath: 'C:\\Aqua\\Aqua.exe' }), [])
  assert.deepEqual(buildJumpListCategories({ installations: [{ id: 'one', name: 'One', installed: true }] }), [])
})
