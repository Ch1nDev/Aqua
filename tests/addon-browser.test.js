import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attachAddonDownloads } from '../electron/core/addon-browser.js'

function fakeDownload(filename) {
  const listeners = new Map()
  return {
    path: null,
    getFilename: () => filename,
    getURL: () => 'https://example.invalid/download',
    setSavePath(target) {
      this.path = target
    },
    once(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
    },
    async finish(state) {
      const handlers = listeners.get('done') ?? []
      await Promise.all(handlers.map((handler) => handler({}, state)))
    },
  }
}

function temporaryDownloads() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-addon-test-'))
}

test('a downloaded pack is installed and the temporary file is cleaned up', async () => {
  const session = new EventEmitter()
  const downloads = temporaryDownloads()
  const imported = []
  const notifications = []
  const importedEvents = []
  attachAddonDownloads({
    browserSession: session,
    bedrockService: { status: async () => ({ editions: [{ id: 'bedrock', name: 'Minecraft for Windows' }] }) },
    bedrockAddonsService: {
      import: async (editionId, filePath) => {
        imported.push({ editionId, filePath, existed: fs.existsSync(filePath) })
        return { installed: [{ kind: 'resource_pack', name: 'Aqua Pack', folder: 'aqua-pack', version: '1.0.0' }] }
      },
    },
    downloadsDirectory: downloads,
    logger: { info() {}, warn() {} },
    notify: (notification) => notifications.push(notification),
    onImported: (payload) => importedEvents.push(payload),
  })

  const item = fakeDownload('Aqua Pack.mcpack')
  session.emit('will-download', {}, item)
  assert.ok(item.path, 'the download is redirected to a temporary file')
  fs.writeFileSync(item.path, 'pack bytes')
  await item.finish('completed')

  assert.deepEqual(imported.map((entry) => entry.editionId), ['bedrock'])
  assert.equal(imported[0].existed, true)
  assert.equal(fs.existsSync(item.path), false, 'the temporary download is removed')
  assert.equal(notifications.at(-1).level, 'success')
  assert.match(notifications.at(-1).title, /Aqua Pack/)
  assert.equal(importedEvents.at(-1).editionId, 'bedrock')
  fs.rmSync(downloads, { recursive: true, force: true })
})

test('a pack that cannot be installed is kept in Downloads', async () => {
  const session = new EventEmitter()
  const downloads = temporaryDownloads()
  const notifications = []
  attachAddonDownloads({
    browserSession: session,
    bedrockService: { status: async () => ({ editions: [{ id: 'bedrock', name: 'Minecraft for Windows' }] }) },
    bedrockAddonsService: {
      import: async () => {
        throw new Error('That file does not contain a Bedrock pack.')
      },
    },
    downloadsDirectory: downloads,
    logger: { info() {}, warn() {} },
    notify: (notification) => notifications.push(notification),
  })

  const item = fakeDownload('Broken.mcaddon')
  session.emit('will-download', {}, item)
  fs.writeFileSync(item.path, 'not a pack')
  await item.finish('completed')

  assert.equal(fs.existsSync(item.path), false, 'the temporary download is removed')
  const kept = path.join(downloads, 'Broken.mcaddon')
  assert.equal(fs.existsSync(kept), true, 'the file is kept for a manual import')
  assert.match(notifications.at(-1).message, /Broken\.mcaddon|Import it from Extra content/)
  fs.rmSync(downloads, { recursive: true, force: true })
})

test('other downloads keep Electron default behaviour', async () => {
  const session = new EventEmitter()
  let imported = false
  attachAddonDownloads({
    browserSession: session,
    bedrockService: { status: async () => ({ editions: [] }) },
    bedrockAddonsService: {
      import: async () => {
        imported = true
        return { installed: [] }
      },
    },
    logger: { info() {}, warn() {} },
    notify: () => {},
  })

  const item = fakeDownload('screenshot.png')
  session.emit('will-download', {}, item)
  assert.equal(item.path, null)
  assert.equal(imported, false)
})
