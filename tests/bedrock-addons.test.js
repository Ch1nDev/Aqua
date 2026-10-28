import test from 'node:test'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import {
  addonKindForModules,
  isAddonFileName,
  manifestRoots,
  parseLangFile,
  parsePackManifest,
  resolveText,
} from '../electron/core/bedrock-addons.js'
import { isBrowserUrl } from '../electron/core/addon-browser.js'

const header = {
  name: 'pack.name',
  description: 'pack.description',
  uuid: 'd6f1cd0b-6a5b-4a0f-9f11-26b8fb0b6a51',
  version: [1, 2, 3],
}

test('resolveText prefers en_US and falls back to the first language', () => {
  assert.equal(resolveText({ en_GB: 'Colour', en_US: 'Color' }, {}), 'Color')
  assert.equal(resolveText({ de_DE: 'Farbe' }, {}), 'Farbe')
  assert.equal(resolveText('plain name', {}), 'plain name')
  assert.equal(resolveText(undefined, {}), '')
})

test('parseLangFile reads key=value pairs and skips comments', () => {
  const lang = parseLangFile('# a comment\npack.name=Aqua Pack\npack.description=Test pack\n')
  assert.deepEqual(lang, { 'pack.name': 'Aqua Pack', 'pack.description': 'Test pack' })
})

test('a data or script module makes a behavior pack', () => {
  assert.equal(addonKindForModules([{ type: 'data' }]), 'behavior_pack')
  assert.equal(addonKindForModules([{ type: 'script' }]), 'behavior_pack')
  assert.equal(addonKindForModules([{ type: 'resources' }]), 'resource_pack')
  assert.equal(addonKindForModules([{ type: 'skin' }]), 'skin_pack')
  assert.equal(addonKindForModules([{ type: 'unknown' }]), null)
})

test('parsePackManifest resolves translated names and versions', () => {
  const manifest = JSON.stringify({ format_version: 2, header, modules: [{ type: 'resources' }] })
  const parsed = parsePackManifest(manifest, { 'pack.name': 'Aqua Pack', 'pack.description': 'Nice.' })
  assert.deepEqual(parsed, {
    name: 'Aqua Pack',
    description: 'Nice.',
    uuid: header.uuid,
    version: '1.2.3',
    kind: 'resource_pack',
  })
})

test('pack manifests without a readable name are rejected', () => {
  assert.equal(parsePackManifest('not json', {}), null)
  assert.equal(parsePackManifest(JSON.stringify({ header: {} }), {}), null)
})

test('manifestRoots finds packs at the archive root and in subfolders', () => {
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from('{}'))
  zip.addFile('packs/one/manifest.json', Buffer.from('{}'))
  zip.addFile('packs/two/manifest.json', Buffer.from('{}'))
  zip.addFile('packs/one/texts/en_US.lang', Buffer.from('pack.name=One'))
  const roots = manifestRoots(zip.getEntries()).sort()
  assert.deepEqual(roots, ['', 'packs/one/', 'packs/two/'])
})

test('only Bedrock package downloads are intercepted', () => {
  assert.equal(isAddonFileName('Cool Addon.mcpack'), true)
  assert.equal(isAddonFileName('MEGA PACK.MCADDON'), true)
  assert.equal(isAddonFileName('world.mcworld'), true)
  assert.equal(isAddonFileName('archive.zip'), false)
  assert.equal(isAddonFileName('installer.exe'), false)
  assert.equal(isAddonFileName(''), false)
})

test('the add-on browser only navigates to http(s)', () => {
  assert.equal(isBrowserUrl('https://mcpeaddons.com/addons/'), true)
  assert.equal(isBrowserUrl('http://localhost:3000/'), true)
  assert.equal(isBrowserUrl('file:///C:/Windows/System32/cmd.exe'), false)
  assert.equal(isBrowserUrl('javascript:alert(1)'), false)
  assert.equal(isBrowserUrl('not a url'), false)
})
