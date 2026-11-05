import assert from 'node:assert/strict'
import test from 'node:test'
import { LaunchQueue, MAX_LAUNCH_QUEUE_ENTRIES } from '../electron/core/launch-queue.js'

function queue() {
  return new LaunchQueue()
}

test('queueing the same installation twice keeps one entry', () => {
  const launches = queue()
  launches.enqueue({ installationId: 'one', installationName: 'One' })
  const snapshot = launches.enqueue({ installationId: 'one', installationName: 'One again' })

  assert.equal(snapshot.entries.length, 1)
  assert.equal(snapshot.entries[0].installationName, 'One')
  assert.equal(snapshot.entries[0].reason, 'manual')
  assert.equal(snapshot.paused, false)
})

test('queued launches start in the order they were requested', () => {
  const launches = queue()
  launches.enqueue({ installationId: 'one', reason: 'game-running' })
  launches.enqueue({ installationId: 'two', reason: 'preparing' })
  launches.enqueue({ installationId: 'three', reason: 'install' })

  assert.deepEqual(
    launches.snapshot().entries.map((entry) => entry.installationId),
    ['one', 'two', 'three'],
  )
  assert.equal(launches.peek().installationId, 'one')
  assert.equal(launches.shift().installationId, 'one')
  assert.deepEqual(
    launches.snapshot().entries.map((entry) => entry.installationId),
    ['two', 'three'],
  )
})

test('removing an entry leaves the rest of the queue alone', () => {
  const launches = queue()
  launches.enqueue({ installationId: 'one' })
  launches.enqueue({ installationId: 'two' })
  const removed = launches.snapshot().entries[0]

  const snapshot = launches.remove(removed.id)

  assert.deepEqual(
    snapshot.entries.map((entry) => entry.installationId),
    ['two'],
  )
  assert.equal(launches.peek().installationId, 'two')
})

test('a failed launch can be restored at the front and the queue pauses', () => {
  const launches = queue()
  launches.enqueue({ installationId: 'one' })
  launches.enqueue({ installationId: 'two' })
  const entry = launches.shift()
  launches.pause('Minecraft crashed before the queue could continue.')

  const paused = launches.restore(entry)

  assert.equal(paused.paused, true)
  assert.match(paused.reason, /crashed/)
  assert.deepEqual(
    paused.entries.map((item) => item.installationId),
    ['one', 'two'],
  )

  const resumed = launches.resume()
  assert.equal(resumed.paused, false)
  assert.equal(resumed.reason, null)
})

test('the queue is capped and manual is the fallback reason', () => {
  const launches = queue()
  for (let index = 0; index < MAX_LAUNCH_QUEUE_ENTRIES + 3; index += 1) {
    launches.enqueue({ installationId: `install-${index}`, reason: 'unexpected' })
  }

  const snapshot = launches.snapshot()
  assert.equal(snapshot.entries.length, MAX_LAUNCH_QUEUE_ENTRIES)
  assert.equal(snapshot.entries[0].installationId, 'install-3')
  assert.equal(snapshot.entries.at(-1).installationId, `install-${MAX_LAUNCH_QUEUE_ENTRIES + 2}`)
  assert.ok(snapshot.entries.every((entry) => entry.reason === 'manual'))
})
