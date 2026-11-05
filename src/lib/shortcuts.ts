import type { PageName } from './types'

/**
 * The one shortcut table used by both the global handler and the cheat sheet.
 * Combos use `mod` for the platform's primary modifier so the same definition
 * works on Windows/Linux (Ctrl) and macOS (Command).
 */
export type ShortcutId = 'search' | 'play' | 'settings' | 'pages' | 'help' | 'dismiss'

export interface ShortcutDefinition {
  id: ShortcutId
  keys: string
  combos: readonly string[]
  title: string
  description: string
}

export interface PageShortcut {
  combo: string
  page: PageName
  label: string
}

export interface ShortcutEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export const OPEN_SHORTCUTS_EVENT = 'aqua:open-shortcuts'

/** Sidebar order; the first nine pages get Alt+1 through Alt+9. */
export const PAGE_SHORTCUTS: readonly PageShortcut[] = [
  { combo: 'alt+1', page: 'home', label: 'Home' },
  { combo: 'alt+2', page: 'installations', label: 'Installations' },
  { combo: 'alt+3', page: 'stats', label: 'Stats' },
  { combo: 'alt+4', page: 'worlds', label: 'Worlds & backups' },
  { combo: 'alt+5', page: 'screenshots', label: 'Screenshots' },
  { combo: 'alt+6', page: 'servers', label: 'Servers' },
  { combo: 'alt+7', page: 'mods', label: 'Extra content' },
  { combo: 'alt+8', page: 'account', label: 'Account' },
  { combo: 'alt+9', page: 'logs', label: 'Logs & diagnostics' },
]

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'search',
    keys: 'Ctrl K',
    combos: ['mod+k'],
    title: 'Search',
    description: 'Open the command palette to find pages, profiles, worlds, servers and settings.',
  },
  {
    id: 'play',
    keys: 'Ctrl Enter',
    combos: ['mod+enter'],
    title: 'Play',
    description: 'Launch the current Play target, or queue it while another launch is busy.',
  },
  {
    id: 'pages',
    keys: 'Alt 1–9',
    combos: PAGE_SHORTCUTS.map((shortcut) => shortcut.combo),
    title: 'Go to a page',
    description: 'Home through Logs & diagnostics, in sidebar order.',
  },
  {
    id: 'settings',
    keys: 'Ctrl ,',
    combos: ['mod+,'],
    title: 'Settings',
    description: 'Open the Settings page.',
  },
  {
    id: 'help',
    keys: '?',
    combos: ['?'],
    title: 'Keyboard shortcuts',
    description: 'Open this sheet.',
  },
  {
    id: 'dismiss',
    keys: 'Esc',
    combos: ['escape'],
    title: 'Close the top layer',
    description: 'Dismiss the frontmost sheet, dialog or menu.',
  },
]

const KEY_ALIASES: Record<string, string> = {
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  option: 'alt',
  esc: 'escape',
  return: 'enter',
  spacebar: 'space',
}

function normalizeToken(token: string) {
  return KEY_ALIASES[token] || token
}

/** Canonical lowercase combo, e.g. `Ctrl + K` becomes `ctrl+k`. */
export function normalizeShortcut(shortcut: string): string {
  return shortcut
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .split('+')
    .filter(Boolean)
    .map(normalizeToken)
    .join('+')
}

function normalizeEventKey(key: string) {
  if (key === ' ') return 'space'
  return normalizeToken(key.toLowerCase())
}

/**
 * Match a keyboard event against a combo. Shift is ignored for punctuation
 * that already encodes it (notably `?`), but a shifted letter never matches an
 * unshifted letter shortcut.
 */
export function matchesShortcut(event: ShortcutEventLike, combo: string): boolean {
  const parts = normalizeShortcut(combo).split('+')
  const key = parts.pop()
  if (!key) return false

  const modifiers = new Set(parts)
  const ctrl = Boolean(event.ctrlKey)
  const meta = Boolean(event.metaKey)
  const alt = Boolean(event.altKey)
  const shift = Boolean(event.shiftKey)

  if (modifiers.has('mod')) {
    if (!ctrl && !meta) return false
  } else if (modifiers.has('ctrl') !== ctrl || modifiers.has('meta') !== meta) {
    return false
  }
  if (modifiers.has('alt') !== alt) return false
  if (modifiers.has('shift') && !shift) return false

  const eventKey = normalizeEventKey(event.key)
  if (eventKey !== key) return false

  const punctuation = key.length === 1 && !/[a-z0-9]/.test(key)
  if (!modifiers.has('shift') && shift && !punctuation) return false
  return true
}

export function matchShortcut(event: ShortcutEventLike): ShortcutDefinition | null {
  return SHORTCUTS.find((shortcut) => shortcut.combos.some((combo) => matchesShortcut(event, combo))) || null
}

export function pageForShortcut(event: ShortcutEventLike): PageName | null {
  return PAGE_SHORTCUTS.find((shortcut) => matchesShortcut(event, shortcut.combo))?.page ?? null
}

/** Text fields own their keystrokes; global shortcuts must not steal them. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  const tag = String(element.tagName || '').toUpperCase()
  return (
    element.isContentEditable === true ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  )
}

export function openShortcutSheet() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))
}
