import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'
import {
  createSnapshot,
  deleteSnapshot,
  isUnsafeEntryName,
  listSnapshots,
  matchesPattern,
  planPrune,
  pruneSnapshots,
  readSnapshotIndex,
  restoreSnapshot,
  snapshotId,
  writeSnapshotIndex,
} from '../electron/core/snapshots.js'

function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function write(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents)
}

async function listFiles(root) {
  const result = []
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else result.push(path.relative(root, absolute).split(path.sep).join('/'))
    }
  }
  await walk(root)
  return result.sort()
}

test('a snapshot round-trips a folder tree byte-for-byte', async () => {
  const root = await tempDir('aqua-snapshot-')
  const source = path.join(root, 'World ü with spaces')
  const destination = path.join(root, 'backups')
  const files = {
    'level.dat': Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]),
    'levelname.txt': Buffer.from('Ünïcode world\n', 'utf8'),
    'db/000001.log': Buffer.from('database contents'),
    'db/CURRENT': Buffer.from('MANIFEST-000001\n'),
  }
  for (const [name, data] of Object.entries(files)) await write(path.join(source, name), data)

  const snapshot = await createSnapshot({ sourceDir: source, destinationDir: destination, label: 'Ünïcode world' })
  assert.match(snapshot.id, /^[a-z0-9][a-z0-9-]{7,79}$/)
  assert.equal(snapshot.entry, 'World ü with spaces')
  assert.equal(snapshot.files, 4)
  assert.ok(snapshot.sizeBytes > 0)

  const listed = await listSnapshots(destination)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, snapshot.id)
  assert.equal(listed[0].files, 4)

  const target = path.join(root, 'restored')
  const restored = await restoreSnapshot({ archive: snapshot.archive, destinationDir: target })
  assert.equal(restored.folder, 'World ü with spaces')
  assert.equal(restored.files, 4)
  for (const [name, data] of Object.entries(files)) {
    const read = await fs.readFile(path.join(target, restored.folder, name))
    assert.deepEqual(read, data, `${name} should match byte for byte`)
  }
})

test('a snapshot that points outside its folder is rejected without writing', async () => {
  const root = await tempDir('aqua-snapshot-evil-')
  const zip = new AdmZip()
  zip.addFile('world/level.dat', Buffer.from('data'))
  zip.addFile('escape.txt', Buffer.from('nope'))
  const escape = zip.getEntries().find((item) => item.entryName === 'escape.txt')
  escape.entryName = '../escape.txt'
  const archive = path.join(root, 'evil.zip')
  await fs.writeFile(archive, zip.toBuffer())

  const destination = path.join(root, 'worlds')
  await assert.rejects(() => restoreSnapshot({ archive, destinationDir: destination }), /points outside its folder/)

  assert.deepEqual(await listFiles(root), ['evil.zip'])
  assert.deepEqual(await fs.readdir(root), ['evil.zip'])
})

test('unsafe archive entry names are recognised', () => {
  for (const name of ['../escape', 'a/../../b', '/etc/passwd', 'C:\\Windows\\x', 'a\0b', '']) {
    assert.equal(isUnsafeEntryName(name), true, `${name} should be unsafe`)
  }
  for (const name of ['world/level.dat', 'world/db/000001.log', 'levelname.txt', 'a/b/../c'.replace('..', 'db')]) {
    assert.equal(isUnsafeEntryName(name), false, `${name} should be safe`)
  }
})

test('retention keeps the newest unpinned snapshots and never deletes pinned ones', () => {
  const entries = [
    { id: 'snap-0000001', createdAt: '2026-10-01T00:00:00.000Z', sizeBytes: 100, pinned: true },
    { id: 'snap-0000002', createdAt: '2026-10-02T00:00:00.000Z', sizeBytes: 100 },
    { id: 'snap-0000003', createdAt: '2026-10-03T00:00:00.000Z', sizeBytes: 100 },
    { id: 'snap-0000004', createdAt: '2026-10-04T00:00:00.000Z', sizeBytes: 100 },
  ]

  const byCount = planPrune(entries, { keepCount: 2 })
  assert.deepEqual([...byCount.keptIds].sort(), ['snap-0000001', 'snap-0000003', 'snap-0000004'])
  assert.deepEqual(byCount.deleteIds, ['snap-0000002'])
  assert.equal(byCount.freedBytes, 100)

  const bySize = planPrune(entries, { keepCount: 10, maxTotalBytes: 150 })
  assert.deepEqual([...bySize.keptIds].sort(), ['snap-0000001', 'snap-0000004'])
  assert.deepEqual(bySize.deleteIds, ['snap-0000003', 'snap-0000002'])

  // Without the pinned exemption every snapshot competes for the budget.
  const noPinned = planPrune(entries, { keepCount: 2, pinnedFirst: false })
  assert.deepEqual([...noPinned.keptIds].sort(), ['snap-0000003', 'snap-0000004'])
})

test('pruning removes archives and index rows together', async () => {
  const root = await tempDir('aqua-snapshot-prune-')
  const destination = path.join(root, 'backups')
  const created = []
  for (let index = 0; index < 4; index += 1) {
    const source = path.join(root, `source-${index}`)
    await write(path.join(source, 'data.bin'), Buffer.alloc(64, index))
    created.push(
      await createSnapshot({
        sourceDir: source,
        destinationDir: destination,
        label: `day-${index}`,
        at: new Date(Date.UTC(2026, 9, 1 + index)),
      }),
    )
  }

  const plan = await pruneSnapshots(destination, { keepCount: 2 })
  assert.equal(plan.deleteIds.length, 2)
  const remaining = await listSnapshots(destination)
  assert.deepEqual(
    remaining.map((item) => item.id).sort(),
    [created[3].id, created[2].id].sort(),
  )
  const index = await readSnapshotIndex(destination)
  assert.equal(index.length, 2)
  const leftovers = (await fs.readdir(destination)).filter((name) => name.endsWith('.zip'))
  assert.equal(leftovers.length, 2)

  await deleteSnapshot(destination, created[3].id)
  assert.deepEqual((await readSnapshotIndex(destination)).map((item) => item.id), [created[2].id])
  assert.deepEqual((await listSnapshots(destination)).map((item) => item.id), [created[2].id])
})

test('an index row without its archive is never listed', async () => {
  const directory = await tempDir('aqua-snapshot-partial-')
  await writeSnapshotIndex(directory, [
    {
      id: 'snap-0000001',
      label: 'half written',
      entry: 'world',
      createdAt: '2026-10-01T00:00:00.000Z',
      sizeBytes: 10,
      bytes: 10,
      files: 1,
    },
  ])
  assert.deepEqual(await listSnapshots(directory), [])
})

test('a finished snapshot leaves no temporary file behind', async () => {
  const root = await tempDir('aqua-snapshot-temp-')
  const source = path.join(root, 'world')
  await write(path.join(source, 'level.dat'), Buffer.from('data'))
  const destination = path.join(root, 'backups')
  await createSnapshot({ sourceDir: source, destinationDir: destination })
  const names = await fs.readdir(destination)
  assert.deepEqual(names.filter((name) => name.endsWith('.tmp')), [])
  assert.equal(names.filter((name) => name.endsWith('.zip')).length, 1)
  assert.ok(names.includes('index.json'))
})

test('include and exclude patterns pick the archived files', async () => {
  const root = await tempDir('aqua-snapshot-patterns-')
  const source = path.join(root, 'world')
  await write(path.join(source, 'level.dat'), Buffer.from('level'))
  await write(path.join(source, 'db', '000001.log'), Buffer.from('log'))
  await write(path.join(source, 'notes.txt'), Buffer.from('notes'))
  await write(path.join(source, 'screenshots', 'a.png'), Buffer.from('png'))

  const snapshot = await createSnapshot({
    sourceDir: source,
    destinationDir: path.join(root, 'backups'),
    include: ['*.dat', 'db/**'],
    exclude: ['db/*.log'],
  })
  assert.equal(snapshot.files, 1)

  const zip = new AdmZip(snapshot.archive)
  assert.deepEqual(
    zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName),
    ['world/level.dat'],
  )
})

test('an empty folder is refused instead of writing an empty archive', async () => {
  const root = await tempDir('aqua-snapshot-empty-')
  const source = path.join(root, 'empty')
  await fs.mkdir(source, { recursive: true })
  const destination = path.join(root, 'backups')
  await assert.rejects(
    () => createSnapshot({ sourceDir: source, destinationDir: destination }),
    /nothing to back up/,
  )
  assert.deepEqual(await readSnapshotIndex(destination), [])
})

test('patterns match basenames and multi-segment paths', () => {
  assert.equal(matchesPattern('db/000001.log', 'db/*.log'), true)
  assert.equal(matchesPattern('db/000001.log', '*.log'), true)
  assert.equal(matchesPattern('a/b/c.txt', 'a/**'), true)
  assert.equal(matchesPattern('a/b/c.txt', 'a/*'), false)
  assert.equal(matchesPattern('level.dat', '*.dat'), true)
  assert.equal(matchesPattern('level.dat', '*.txt'), false)
  assert.match(snapshotId('My World', new Date('2026-10-28T14:30:00.000Z')), /^my-world-20261028143000-[a-z0-9]+$/)
})
