import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, fileExists, isPathInside } from './util.js'

/**
 * The files Minecraft itself writes for client settings: video, audio, controls,
 * language, shader selection and the multiplayer server list. Mod config files,
 * resource packs, worlds and saves are deliberately excluded.
 */
export const MINECRAFT_SETTING_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']

/**
 * Keeps one global copy of those files so every installation can share the same
 * in-game settings: the launcher applies them before a launch and captures them
 * again when the game closes.
 */
export class MinecraftSettingsService {
  constructor({ paths, store, logger }) {
    this.paths = paths
    this.store = store
    this.logger = logger
  }

  get directory() {
    return path.join(this.paths.dataRoot, 'minecraft-settings')
  }

  filePath(name) {
    if (!MINECRAFT_SETTING_FILES.includes(name)) throw new Error('That file is not a Minecraft settings file.')
    const target = path.join(this.directory, name)
    if (!isPathInside(target, this.directory)) throw new Error('That file is outside the settings folder.')
    return target
  }

  get enabled() {
    return this.store?.settings?.minecraftSettings?.sync !== false
  }

  async status() {
    let entries = []
    try {
      entries = await fsp.readdir(this.directory, { withFileTypes: true })
    } catch {
      entries = []
    }
    const files = []
    let updatedAt = null
    for (const entry of entries) {
      if (!entry.isFile() || !MINECRAFT_SETTING_FILES.includes(entry.name)) continue
      const stat = await fsp.stat(path.join(this.directory, entry.name)).catch(() => null)
      if (!stat) continue
      const modified = stat.mtime.toISOString()
      files.push({ name: entry.name, size: stat.size, modified })
      if (!updatedAt || modified > updatedAt) updatedAt = modified
    }
    files.sort((a, b) => a.name.localeCompare(b.name))
    return {
      directory: this.directory,
      files,
      updatedAt,
      enabled: this.enabled,
      installations: this.store?.installations?.length || 0,
    }
  }

  /** Copies the settings from one installation into the global folder. */
  async capture(installation) {
    if (!installation?.gameDir) throw new Error('Installation not found.')
    await ensureDir(this.directory)
    const files = []
    const skipped = []
    for (const name of MINECRAFT_SETTING_FILES) {
      const source = path.join(installation.gameDir, name)
      if (!(await fileExists(source))) {
        skipped.push(name)
        continue
      }
      try {
        await fsp.copyFile(source, this.filePath(name))
        files.push(name)
      } catch (error) {
        skipped.push(name)
        this.logger?.warn('Could not save a Minecraft setting', { name, message: error.message })
      }
    }
    if (files.length) {
      this.logger?.info('Saved global Minecraft settings', {
        installation: installation.name,
        files,
      })
    }
    return { files, skipped, directory: this.directory, source: installation.name }
  }

  /** Copies the global settings into one installation's game folder. */
  async apply(installation) {
    if (!installation?.gameDir) throw new Error('Installation not found.')
    const state = await this.status()
    if (!state.files.length) {
      return { files: [], skipped: [...MINECRAFT_SETTING_FILES], directory: this.directory, installation: installation.name }
    }
    await ensureDir(installation.gameDir)
    const files = []
    for (const entry of state.files) {
      try {
        await fsp.copyFile(this.filePath(entry.name), path.join(installation.gameDir, entry.name))
        files.push(entry.name)
      } catch (error) {
        this.logger?.warn('Could not apply a Minecraft setting', { name: entry.name, message: error.message })
      }
    }
    if (files.length) {
      this.logger?.info('Applied global Minecraft settings', {
        installation: installation.name,
        files,
      })
    }
    return {
      files,
      skipped: MINECRAFT_SETTING_FILES.filter((name) => !files.includes(name)),
      directory: this.directory,
      installation: installation.name,
    }
  }

  /** Copies the global settings into every installation. */
  async applyToAll() {
    const installations = this.store?.installations || []
    const results = []
    for (const installation of installations) {
      const result = await this.apply(installation)
      results.push({ id: installation.id, name: installation.name, files: result.files })
    }
    return { installations: results, directory: this.directory }
  }
}
