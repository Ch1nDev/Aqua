import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPreflight, canLaunchPreflight } from '../electron/core/preflight.js'

const GB = 1024 * 1024 * 1024
const installation = { id: 'instance-1', name: 'Test instance', versionId: '1.21.1', memoryOverride: null }
const settings = { memory: { minMb: 1024, maxMb: 4096 } }
const system = { totalMemMb: 16_384, freeBytes: 10 * GB }

function health(checks) {
  return { status: checks.some((entry) => entry.status === 'error') ? 'error' : 'ok', checks }
}

test('a healthy profile produces no preflight rows', () => {
  const result = buildPreflight({ installation, health: health([]), system, settings })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.rows, [])
  assert.equal(canLaunchPreflight(result), true)
})

test('a missing client jar blocks with the repair action', () => {
  const result = buildPreflight({
    installation,
    health: health([
      {
        id: 'client-jar',
        status: 'error',
        title: 'Client jar is missing',
        detail: 'Repair the installation.',
        fix: { kind: 'reinstall', label: 'Repair install' },
      },
    ]),
    system,
    settings,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.rows[0].level, 'error')
  assert.equal(result.rows[0].action.kind, 'reinstall')
  assert.equal(canLaunchPreflight(result), false)
})

test('a 32-bit Java runtime blocks the launch', () => {
  const result = buildPreflight({
    installation,
    health: health([
      {
        id: 'java-arch',
        status: 'error',
        title: 'Java is 32-bit',
        detail: 'Install a 64-bit runtime.',
        fix: { kind: 'open-settings', label: 'Open Java settings' },
      },
    ]),
    system,
    settings,
  })
  assert.equal(result.rows[0].id, 'java-arch')
  assert.equal(canLaunchPreflight(result), false)
})

test('less than 2 GB free blocks and names the measured space', () => {
  const result = buildPreflight({
    installation,
    health: health([]),
    system: { totalMemMb: 16_384, freeBytes: 1.5 * GB },
    settings,
  })
  const row = result.rows.find((entry) => entry.id === 'disk-free')
  assert.equal(row.level, 'error')
  assert.match(row.detail, /1\.5 GB/)
  assert.match(row.detail, /2 GB/)
  assert.equal(canLaunchPreflight(result), false)
})

test('disk space between 2 and 5 GB warns but can still launch', () => {
  const result = buildPreflight({
    installation,
    health: health([]),
    system: { totalMemMb: 16_384, freeBytes: 3 * GB },
    settings,
  })
  assert.equal(result.status, 'warn')
  assert.equal(result.rows[0].level, 'warn')
  assert.equal(canLaunchPreflight(result), true)
})

test('memory above 70 percent warns without blocking', () => {
  const result = buildPreflight({
    installation,
    health: health([]),
    system: { totalMemMb: 8192, freeBytes: 10 * GB },
    settings: { memory: { minMb: 1024, maxMb: 6144 } },
  })
  const row = result.rows.find((entry) => entry.id === 'memory')
  assert.equal(row.level, 'warn')
  assert.match(row.detail, /70%/)
  assert.equal(canLaunchPreflight(result), true)
})

test('errors sort ahead of warnings', () => {
  const result = buildPreflight({
    installation,
    health: health([
      {
        id: 'client-jar',
        status: 'error',
        title: 'Client jar is missing',
        detail: 'Repair the installation.',
        fix: { kind: 'reinstall', label: 'Repair install' },
      },
    ]),
    system: { totalMemMb: 16_384, freeBytes: 3 * GB },
    settings: { memory: { minMb: 1024, maxMb: 12_000 } },
  })
  assert.equal(result.rows[0].level, 'error')
  assert.ok(result.rows.slice(1).every((row) => row.level === 'warn'))
})
