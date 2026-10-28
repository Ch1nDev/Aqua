import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isAddonFileName } from './bedrock-addons.js'
import { sanitizeFileName } from './util.js'

/**
 * Bedrock add-on sites publish no catalogue API and refuse to be framed, so the
 * launcher shows them in a real Electron <webview> with its own session. Pack
 * downloads are caught here and installed into the game's add-on folders instead
 * of landing in Downloads.
 */
export const ADDON_BROWSER_PARTITION = 'persist:aqua-bedrock-browser'

export function isBrowserUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Only the launcher window may attach a webview, and only into the add-on
 * browser's own session: no preload script, no Node, no way to widen it.
 */
export function allowAddonBrowserWebviews(window, { openExternal } = {}) {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== ADDON_BROWSER_PARTITION || !isBrowserUrl(params.src)) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.spellcheck = false
    webPreferences.devTools = false
  })

  window.webContents.on('did-attach-webview', (_event, guest) => {
    // Pop-ups (ad networks mostly) never open a window; real links go to the OS
    // browser only when they are http(s).
    guest.setWindowOpenHandler(({ url }) => {
      try {
        if (isBrowserUrl(url)) openExternal?.(url)
      } catch {
        // Ignore a failed hand-off.
      }
      return { action: 'deny' }
    })
    const blockNonWeb = (event, url) => {
      if (!isBrowserUrl(url)) event.preventDefault()
    }
    guest.on('will-navigate', blockNonWeb)
    guest.on('will-redirect', blockNonWeb)
  })
}

async function existingDownloads(directory) {
  return fsp.readdir(directory).catch(() => [])
}

async function keepInDownloads(sourcePath, filename, downloadsDirectory) {
  const directory = downloadsDirectory || os.tmpdir()
  await fsp.mkdir(directory, { recursive: true }).catch(() => {})
  const taken = new Set((await existingDownloads(directory)).map((name) => name.toLowerCase()))
  const parsed = path.parse(sanitizeFileName(filename, 'addon.mcpack'))
  let candidate = sanitizeFileName(filename, 'addon.mcpack')
  let index = 2
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${parsed.name} (${index})${parsed.ext}`
    index += 1
  }
  const destination = path.join(directory, candidate)
  await fsp.copyFile(sourcePath, destination)
  return destination
}

/**
 * Watches the add-on browser's downloads. Bedrock packages are installed
 * straight away; anything else keeps Electron's normal download behaviour.
 */
export function attachAddonDownloads({
  browserSession,
  bedrockService,
  bedrockAddonsService,
  downloadsDirectory,
  logger,
  notify,
  onImported,
}) {
  browserSession.on('will-download', (_event, item) => {
    const filename = item.getFilename() || ''
    if (!isAddonFileName(filename)) return

    const target = path.join(
      os.tmpdir(),
      `aqua-bedrock-${Date.now()}-${sanitizeFileName(filename, 'addon.mcpack')}`,
    )
    const sourceUrl = item.getURL()
    item.setSavePath(target)

    item.once('done', async (_event, state) => {
      try {
        if (state !== 'completed') {
          notify?.({
            level: 'warning',
            title: 'Download did not finish',
            message: `${filename} was cancelled. Nothing was installed.`,
          })
          return
        }

        const { editions } = await bedrockService.status()
        if (!editions.length) {
          throw new Error('Install Minecraft for Windows first, then download it again.')
        }
        const edition = editions[0]
        const result = await bedrockAddonsService.import(edition.id, target)
        const names = result.installed.map((pack) => pack.name)
        logger?.info('Imported a Bedrock add-on from the in-app browser', {
          filename,
          sourceUrl,
          edition: edition.name,
          packs: names,
        })
        notify?.({
          level: 'success',
          title: names.length ? `Added ${names.join(', ')}` : 'Imported a Bedrock world',
          message: names.length
            ? `Installed for ${edition.name}. Enable it per world under Settings → Add-Ons in the game.`
            : `The world is in ${edition.name}'s worlds folder.`,
        })
        onImported?.({ editionId: edition.id, installed: names, filename })
      } catch (error) {
        logger?.warn('Could not install a downloaded Bedrock add-on', {
          filename,
          sourceUrl,
          message: error?.message,
        })
        const kept = await keepInDownloads(target, filename, downloadsDirectory).catch(() => null)
        notify?.({
          level: 'info',
          title: `Downloaded ${filename}`,
          message: kept
            ? `It could not be installed automatically (${error?.message || 'unknown error'}). Import it from Extra content: ${kept}`
            : 'It could not be installed automatically. Import it from Extra content.',
        })
      } finally {
        // Either imported or copied to Downloads; nothing is lost by clearing the
        // temporary download, including a cancelled one.
        await fsp.rm(target, { force: true }).catch(() => {})
      }
    })
  })
}
