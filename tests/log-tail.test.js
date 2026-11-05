import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  LogTail,
  attributeLogLine,
  classifyTailChange,
  lineLevel,
  readIncremental,
  readTailFile,
  splitCompleteLines,
  takeTailBatch,
} from '../electron/core/log-tail.js'

const MODS = [
  { id: 'sodium', name: 'Sodium', filename: 'sodium-fabric-0.5.11.jar' },
  { id: 'create', name: 'Create', filename: 'create-1.20.1.jar' },
]

test('log levels separate errors, warnings, debug and ordinary lines', () => {
  assert.equal(lineLevel('[12:00:00] [Render thread/ERROR]: Failed'), 'error')
  assert.equal(lineLevel('java.lang.Exception: bad'), 'error')
  assert.equal(lineLevel('[12:00:00] [Render thread/WARN]: Low memory'), 'warn')
  assert.equal(lineLevel('[12:00:00] [Render thread/DEBUG]: tick'), 'debug')
  assert.equal(lineLevel('[12:00:00] [Render thread/INFO]: Started'), 'info')
})

test('a log logger or package segment is attributed to its mod', () => {
  assert.equal(
    attributeLogLine('[12:00:00] [Create/INFO] Loading ponder', MODS)?.id,
    'create',
  )
  assert.equal(
    attributeLogLine('[Render thread/INFO] [net.caffeinemc.mods.sodium/]: Renderer ready', MODS)?.id,
    'sodium',
  )
  assert.equal(
    attributeLogLine('at net.caffeinemc.mods.sodium.render.ChunkRenderer.render(ChunkRenderer.java:42)', MODS)?.id,
    'sodium',
  )
  assert.equal(attributeLogLine('[12:00:00] [Render thread/INFO]: Started', MODS), null)
  assert.equal(attributeLogLine('[12:00:00] [Create/INFO]: creative mode', [])?.id, undefined)
})

test('complete lines hold a trailing partial line for the next batch', () => {
  assert.deepEqual(splitCompleteLines('one\r\ntwo\nthr'), {
    lines: ['one', 'two'],
    pending: 'thr',
  })
  assert.deepEqual(splitCompleteLines('done\n'), { lines: ['done'], pending: '' })
  assert.deepEqual(splitCompleteLines(''), { lines: [], pending: '' })
})

test('incremental reads only return bytes appended after the offset', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-log-tail-'))
  const file = path.join(dir, 'latest.log')
  await fsp.writeFile(file, 'first\n', 'utf8')
  const firstStat = await fsp.stat(file)
  const first = await readIncremental(file, 0, firstStat.size)
  assert.equal(first, 'first\n')

  await fsp.appendFile(file, 'second\n', 'utf8')
  const secondStat = await fsp.stat(file)
  const second = await readIncremental(file, firstStat.size, secondStat.size)
  assert.equal(second, 'second\n')
  await fsp.rm(dir, { recursive: true, force: true })
})

test('tail reads the end of a large file and marks truncation', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-log-tail-'))
  const file = path.join(dir, 'latest.log')
  await fsp.writeFile(file, `${'x'.repeat(20)}\nend\n`, 'utf8')
  const result = await readTailFile(file, 10)
  assert.equal(result.truncated, true)
  assert.match(result.content, /end/)
  await fsp.rm(dir, { recursive: true, force: true })
})

test('a tail batch never carries more than 500 lines', () => {
  const lines = Array.from({ length: 600 }, (_, index) => `line-${index + 1}`)
  const batch = takeTailBatch(lines)
  assert.equal(batch.lines.length, 500)
  assert.equal(batch.lines[0], 'line-101')
  assert.equal(batch.dropped, 100)
})

test('tail change detection resets on truncation and replacement', () => {
  assert.equal(classifyTailChange({ offset: 10, size: 10 }, { size: 4 }), 'truncated')
  assert.equal(classifyTailChange({ offset: 10, size: 10, ino: 1 }, { size: 20, ino: 2 }), 'rotated')
  assert.equal(classifyTailChange({ offset: 10, size: 10, ino: 1 }, { size: 20, ino: 1 }), 'append')
  assert.equal(classifyTailChange({ offset: 10, size: 10, ino: 1 }, { size: 10, ino: 1 }), 'idle')
})

test('the tail service appends new bytes and resets after a truncation', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-log-tail-'))
  const file = path.join(dir, 'latest.log')
  await fsp.writeFile(file, 'first\n', 'utf8')
  const events = []
  const tail = new LogTail({
    logService: {
      resolve: async () => ({
        filePath: file,
        category: 'game',
        file: 'latest.log',
        installationId: 'installation-1',
        installation: { gameDir: dir },
      }),
    },
    contentIndexService: {
      list: async () => ({
        files: [{ enabled: true, filename: 'sodium.jar', metadata: { modId: 'sodium', name: 'Sodium' } }],
      }),
    },
    emit: (payload) => events.push(payload),
    pollMs: 10,
  })

  const start = await tail.start({ category: 'game', file: 'latest.log', installationId: 'installation-1' })
  assert.equal(start.stopped, false)
  assert.equal(start.lines.length, 1)

  await fsp.appendFile(file, 'second\n', 'utf8')
  await waitFor(() => events.some((event) => event.lines?.some((line) => line.text === 'second')))

  await fsp.writeFile(file, 'replacement\n', 'utf8')
  await waitFor(() => events.some((event) => event.reset === true))

  const reset = events.find((event) => event.reset === true)
  assert.equal(reset.lines[0].text, 'replacement')
  tail.stopAll()
  await fsp.rm(dir, { recursive: true, force: true })
})

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the log tail.')
}
