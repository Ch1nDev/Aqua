import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MaintenanceService,
  classifyMaintenanceProfile,
  planMaintenance,
  summarizeMaintenance,
} from '../electron/core/maintenance.js'

function installation(id, overrides = {}) {
  return {
    id,
    name: `Profile ${id}`,
    versionId: '1.20.1',
    installed: true,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastInstalledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function health(status = 'ok') {
  return {
    status,
    checks: [
      { status: 'ok' },
      ...(status === 'warn' || status === 'error' ? [{ status: 'warn' }] : []),
      ...(status === 'error' ? [{ status: 'error' }] : []),
    ],
  }
}

function serviceFor({ installations, installer, healths = {} }) {
  const checkCalls = []
  const invalidateCalls = []
  const store = {
    installations,
    settings: { downloads: { concurrency: 4, bandwidthKbps: 0 } },
    getInstallation: (id) => installations.find((item) => item.id === id) || null,
  }
  const healthService = {
    invalidate: (id) => invalidateCalls.push(id),
    check: async (id) => {
      checkCalls.push(id)
      return healths[id] || health('ok')
    },
  }
  return {
    service: new MaintenanceService({ store, installer, healthService }),
    checkCalls,
    invalidateCalls,
  }
}

test('maintenance planning keeps installed profiles and sorts newest first', () => {
  const plan = planMaintenance([
    installation('old', { lastInstalledAt: '2026-01-02T00:00:00.000Z' }),
    installation('new', { lastInstalledAt: '2026-03-04T00:00:00.000Z' }),
    installation('not-installed', { installed: false, lastInstalledAt: '2026-04-01T00:00:00.000Z' }),
    installation('fallback', { installedAt: '2026-02-01T00:00:00.000Z' }),
  ])

  assert.deepEqual(
    plan.map((entry) => entry.id),
    ['new', 'fallback', 'old'],
  )
})

test('profile status separates healthy, repaired, attention and failed', () => {
  assert.equal(
    classifyMaintenanceProfile({ errors: [], repaired: { files: 0 }, after: { status: 'ok' } }),
    'healthy',
  )
  assert.equal(
    classifyMaintenanceProfile({ errors: [], repaired: { files: 2 }, after: { status: 'ok' } }),
    'repaired',
  )
  assert.equal(
    classifyMaintenanceProfile({ errors: [], repaired: { files: 0 }, after: { status: 'error' } }),
    'attention',
  )
  assert.equal(
    classifyMaintenanceProfile({ errors: ['boom'], repaired: { files: 0 }, after: { status: 'ok' } }),
    'failed',
  )
})

test('the batch summary counts checked profiles and keeps the unchecked total', () => {
  const summary = summarizeMaintenance(
    [
      { status: 'healthy' },
      { status: 'repaired' },
      { status: 'attention' },
      { status: 'failed' },
    ],
    { total: 6, cancelled: true, startedAt: 'then' },
  )

  assert.equal(summary.checked, 4)
  assert.equal(summary.total, 6)
  assert.equal(summary.healthy, 1)
  assert.equal(summary.repaired, 1)
  assert.equal(summary.attention, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.cancelled, true)
})

test('every installed profile is visited once and one failure does not stop the batch', async () => {
  const installations = [
    installation('one', { lastInstalledAt: '2026-03-01T00:00:00.000Z' }),
    installation('two', { lastInstalledAt: '2026-02-01T00:00:00.000Z' }),
    installation('three', { lastInstalledAt: '2026-01-01T00:00:00.000Z' }),
  ]
  const calls = []
  const installer = {
    install: async (profile) => {
      calls.push(profile.id)
      if (profile.id === 'two') throw new Error('network exploded')
      if (profile.id === 'three') return { downloadedFiles: 3, downloadedBytes: 300 }
      return { downloadedFiles: 0, downloadedBytes: 0 }
    },
  }
  const { service, checkCalls, invalidateCalls } = serviceFor({
    installations,
    installer,
    healths: { one: health('ok'), two: health('warn'), three: health('error') },
  })

  const summary = await service.run()

  assert.deepEqual(calls, ['one', 'two', 'three'])
  assert.deepEqual(checkCalls, ['one', 'one', 'two', 'two', 'three', 'three'])
  assert.deepEqual(invalidateCalls, ['one', 'one', 'two', 'two', 'three', 'three'])
  assert.equal(summary.checked, 3)
  assert.equal(summary.healthy, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.repaired, 1)
  assert.equal(summary.cancelled, false)
  assert.deepEqual(summary.profiles.map((profile) => profile.status), ['healthy', 'failed', 'repaired'])
  assert.deepEqual(summary.profiles[1].errors, ['network exploded'])
  assert.deepEqual(summary.profiles[2].repaired, { files: 3, bytes: 300 })
})

test('cancellation finishes the current profile and stops before the next one', async () => {
  const installations = [
    installation('one', { lastInstalledAt: '2026-03-01T00:00:00.000Z' }),
    installation('two', { lastInstalledAt: '2026-02-01T00:00:00.000Z' }),
    installation('three', { lastInstalledAt: '2026-01-01T00:00:00.000Z' }),
  ]
  const calls = []
  let stopped = false
  const installer = {
    install: async (profile) => {
      calls.push(profile.id)
      stopped = true
      return { downloadedFiles: 0, downloadedBytes: 0 }
    },
  }
  const { service } = serviceFor({ installations, installer })
  const summary = await service.run({ shouldStop: () => stopped })

  assert.deepEqual(calls, ['one'])
  assert.equal(summary.checked, 1)
  assert.equal(summary.total, 3)
  assert.equal(summary.cancelled, true)
  assert.deepEqual(summary.profiles.map((profile) => profile.id), ['one'])
})

test('no installed profiles finishes cleanly without calling the installer', async () => {
  let called = false
  const { service } = serviceFor({
    installations: [installation('one', { installed: false })],
    installer: {
      install: async () => {
        called = true
        return {}
      },
    },
  })
  const summary = await service.run()
  assert.equal(called, false)
  assert.equal(summary.total, 0)
  assert.equal(summary.checked, 0)
  assert.equal(summary.cancelled, false)
})
