import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createDefaultSettings, normalizeSettings } from '../electron/core/settings.js'
import {
  DEFAULT_LAUNCHER_WINDOW,
  clampWindowPlacement,
  normalizeWindowPlacement,
} from '../electron/core/window-placement.js'
import {
  PAGE_SHORTCUTS,
  SHORTCUTS,
  isEditableTarget,
  matchShortcut,
  matchesShortcut,
  normalizeShortcut,
  pageForShortcut,
} from '../src/lib/shortcuts.ts'

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } })

test('shortcut combos normalize modifiers and aliases', () => {
  assert.equal(normalizeShortcut('Ctrl + K'), 'ctrl+k')
  assert.equal(normalizeShortcut('Cmd+Enter'), 'meta+enter')
  assert.equal(normalizeShortcut('Option+Space'), 'alt+space')
  assert.equal(normalizeShortcut('Esc'), 'escape')
  assert.equal(normalizeShortcut('Control+,'), 'ctrl+,')
})

test('mod matches Ctrl or Command and every table entry resolves', () => {
  assert.equal(matchesShortcut({ key: 'k', ctrlKey: true }, 'mod+k'), true)
  assert.equal(matchesShortcut({ key: 'k', metaKey: true }, 'mod+k'), true)
  assert.equal(matchesShortcut({ key: 'k', ctrlKey: true, shiftKey: true }, 'mod+k'), false)
  assert.equal(matchesShortcut({ key: 'k', ctrlKey: true, altKey: true }, 'mod+k'), false)
  assert.equal(matchesShortcut({ key: '?', shiftKey: true }, '?'), true)
  assert.equal(matchesShortcut({ key: 'Escape' }, 'escape'), true)
  assert.equal(matchShortcut({ key: ',', ctrlKey: true })?.id, 'settings')
  assert.equal(matchShortcut({ key: 'Enter', ctrlKey: true })?.id, 'play')
  assert.equal(matchShortcut({ key: '3', altKey: true })?.id, 'pages')
  assert.equal(matchShortcut({ key: 'k' }), null)

  for (const shortcut of SHORTCUTS) {
    assert.ok(shortcut.combos.length > 0, `${shortcut.id} has a combo`)
    for (const combo of shortcut.combos) assert.equal(normalizeShortcut(combo), combo)
  }
})

test('Alt+1 through Alt+9 follow sidebar order', () => {
  assert.deepEqual(
    PAGE_SHORTCUTS.map((shortcut) => shortcut.page),
    ['home', 'installations', 'stats', 'worlds', 'screenshots', 'servers', 'mods', 'account', 'logs'],
  )
  assert.equal(pageForShortcut({ key: '1', altKey: true }), 'home')
  assert.equal(pageForShortcut({ key: '9', altKey: true }), 'logs')
  assert.equal(pageForShortcut({ key: '0', altKey: true }), null)
})

test('editable targets never receive global shortcuts', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true)
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true)
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true)
  assert.equal(isEditableTarget({ isContentEditable: true, tagName: 'DIV' }), true)
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isEditableTarget(null), false)
})

test('placement normalization clamps malformed values and keeps first-run fallbacks', () => {
  assert.deepEqual(normalizeWindowPlacement(null), DEFAULT_LAUNCHER_WINDOW)
  assert.deepEqual(normalizeWindowPlacement({ width: 0, height: 99999, x: Infinity, maximized: 'yes' }), {
    x: null,
    y: null,
    width: 320,
    height: 4320,
    maximized: false,
  })

  const defaults = createDefaultSettings({ totalMemMb: 16_384, instancesRoot: path.join('C:', 'Aqua', 'instances') })
  assert.deepEqual(defaults.window.placement, DEFAULT_LAUNCHER_WINDOW)
  assert.deepEqual(
    normalizeSettings(
      { window: { placement: { x: 120, y: 80, width: 1320, height: 840, maximized: true } } },
      defaults,
    ).window.placement,
    { x: 120, y: 80, width: 1320, height: 840, maximized: true },
  )
})

test('an off-screen saved position is clamped inside the nearest display', () => {
  const result = clampWindowPlacement(
    { x: 5000, y: 5000, width: 1400, height: 880, maximized: true },
    [display(0, 0, 1920, 1040)],
  )
  assert.deepEqual(result, { x: 520, y: 160, width: 1400, height: 880, maximized: true })
})

test('a removed monitor falls back to the display nearest the saved rectangle', () => {
  const displays = [display(0, 0, 1920, 1040), display(1920, 0, 1920, 1040)]
  assert.deepEqual(
    clampWindowPlacement({ x: 2200, y: 120, width: 1400, height: 880 }, displays),
    { x: 2200, y: 120, width: 1400, height: 880, maximized: false },
  )

  const afterRemoval = clampWindowPlacement(
    { x: 2200, y: 120, width: 1400, height: 880 },
    [display(0, 0, 1920, 1040)],
  )
  assert.equal(afterRemoval.x, 520)
  assert.equal(afterRemoval.y, 120)
})

test('a large saved size shrinks to the work area and a first run is centered', () => {
  assert.deepEqual(
    clampWindowPlacement({ x: 100, y: 40, width: 3000, height: 2000 }, [display(0, 0, 1600, 900)]),
    { x: 0, y: 0, width: 1600, height: 900, maximized: false },
  )
  assert.deepEqual(clampWindowPlacement(null, [display(0, 40, 1920, 1000)]), {
    x: 260,
    y: 100,
    width: 1400,
    height: 880,
    maximized: false,
  })
})

test('placement without a usable display keeps the fallback size off-screen', () => {
  assert.deepEqual(clampWindowPlacement({ x: 20, y: 20, width: 1200, height: 800 }, []), {
    x: null,
    y: null,
    width: 1200,
    height: 800,
    maximized: false,
  })
})
