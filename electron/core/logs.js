import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { ensureDir, isPathInside, safeSegment } from './util.js'

const MAX_READ_BYTES = 600_000

async function listFiles(dir, filter = () => true) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (!entry.isFile() || !filter(entry.name)) continue
      const filePath = path.join(dir, entry.name)
      try {
        const stat = await fsp.stat(filePath)
        files.push({ name: entry.name, size: stat.size, modified: stat.mtime.toISOString() })
      } catch {
        // Skip files that vanished.
      }
    }
    return files.sort((a, b) => new Date(b.modified) - new Date(a.modified))
  } catch {
    return []
  }
}

async function readTail(filePath, maxBytes = MAX_READ_BYTES) {
  const stat = await fsp.stat(filePath)
  const start = Math.max(0, stat.size - maxBytes)
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(stat.size - start)
    await handle.read(buffer, 0, buffer.length, start)
    return {
      content: buffer.toString('utf8'),
      truncated: start > 0,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      name: path.basename(filePath),
    }
  } finally {
    await handle.close()
  }
}

export class LogService {
  constructor({ paths, store, logger }) {
    this.paths = paths
    this.store = store
    this.logger = logger
  }

  installationInfo(installationId) {
    const installation = this.store.getInstallation(installationId)
    return {
      name: installation?.name || 'Removed installation',
      versionId: installation?.versionId || null,
      gameDir: installation?.gameDir || null,
    }
  }

  async list() {
    const launcher = (await listFiles(this.paths.logsRoot, (name) => name.endsWith('.log'))).map((file) => ({
      ...file,
      id: file.name,
    }))

    let gameDirs = []
    try {
      gameDirs = await fsp.readdir(this.paths.gameLogsRoot, { withFileTypes: true })
    } catch {
      gameDirs = []
    }
    const games = []
    for (const entry of gameDirs) {
      if (!entry.isDirectory()) continue
      const installationId = entry.name
      const info = this.installationInfo(installationId)
      const files = await listFiles(path.join(this.paths.gameLogsRoot, installationId), (name) => name.endsWith('.log'))
      if (!files.length) continue
      games.push({
        installationId,
        installationName: info.name,
        versionId: info.versionId,
        files,
      })
    }
    games.sort((a, b) => {
      const aDate = a.files[0]?.modified || ''
      const bDate = b.files[0]?.modified || ''
      return new Date(bDate) - new Date(aDate)
    })

    const crashes = []
    for (const installation of this.store.installations) {
      const crashDir = path.join(installation.gameDir, 'crash-reports')
      const files = await listFiles(crashDir, (name) => name.endsWith('.txt'))
      for (const file of files) {
        crashes.push({
          installationId: installation.id,
          installationName: installation.name,
          filename: file.name,
          size: file.size,
          modified: file.modified,
        })
      }
    }
    crashes.sort((a, b) => new Date(b.modified) - new Date(a.modified))

    return {
      launcher,
      games,
      crashes: crashes.slice(0, 100),
    }
  }

  async read({ category, file, installationId }) {
    if (!file || typeof file !== 'string') throw new Error('Choose a log file.')
    if (category === 'launcher') {
      const fileName = path.basename(file)
      const filePath = path.join(this.paths.logsRoot, fileName)
      if (!isPathInside(filePath, this.paths.logsRoot)) throw new Error('Invalid log file.')
      return readTail(filePath)
    }
    if (category === 'game') {
      const safeInstallationId = safeSegment(installationId, 'Installation ID')
      const fileName = path.basename(file)
      const filePath = path.join(this.paths.gameLogsRoot, safeInstallationId, fileName)
      if (!isPathInside(filePath, this.paths.gameLogsRoot)) throw new Error('Invalid game log file.')
      return readTail(filePath)
    }
    if (category === 'crash') {
      const installation = this.store.getInstallation(installationId)
      if (!installation) throw new Error('Installation not found.')
      const fileName = path.basename(file)
      const crashDir = path.join(installation.gameDir, 'crash-reports')
      const filePath = path.join(crashDir, fileName)
      if (!isPathInside(filePath, crashDir)) throw new Error('Invalid crash report.')
      return readTail(filePath)
    }
    throw new Error('Unknown log category.')
  }

  async openFolder({ category, installationId } = {}) {
    let target = this.paths.logsRoot
    if (category === 'game' && installationId) {
      target = path.join(this.paths.gameLogsRoot, safeSegment(installationId, 'Installation ID'))
    } else if (category === 'crash' && installationId) {
      const installation = this.store.getInstallation(installationId)
      if (!installation) throw new Error('Installation not found.')
      target = path.join(installation.gameDir, 'crash-reports')
    }
    await ensureDir(target)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  }

  async openFile({ category, file, installationId }) {
    let target
    if (category === 'launcher') {
      target = path.join(this.paths.logsRoot, path.basename(file))
    } else if (category === 'game') {
      target = path.join(
        this.paths.gameLogsRoot,
        safeSegment(installationId, 'Installation ID'),
        path.basename(file),
      )
    } else if (category === 'crash') {
      const installation = this.store.getInstallation(installationId)
      if (!installation) throw new Error('Installation not found.')
      target = path.join(installation.gameDir, 'crash-reports', path.basename(file))
    } else {
      throw new Error('Unknown log category.')
    }
    await fsp.access(target)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  }

  async exportDiagnostics(details) {
    const dir = path.join(this.paths.logsRoot, 'diagnostics')
    await ensureDir(dir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = path.join(dir, `diagnostics-${stamp}.txt`)
    const launcherLog = await readTail(this.paths.launcherLog, 250_000).catch(() => ({
      content: 'Launcher log not available.',
    }))
    const content = [
      'AQUA LAUNCHER DIAGNOSTICS',
      '========================',
      `Generated: ${new Date().toISOString()}`,
      '',
      'SYSTEM',
      '------',
      ...Object.entries(details.system || {}).map(([key, value]) => `${key}: ${value}`),
      '',
      'LAUNCHER',
      '--------',
      ...Object.entries(details.launcher || {}).map(([key, value]) => `${key}: ${value}`),
      '',
      'SETTINGS',
      '--------',
      JSON.stringify(details.settings || {}, null, 2),
      '',
      'INSTALLATIONS',
      '-------------',
      JSON.stringify(details.installations || [], null, 2),
      '',
      'JAVA RUNTIMES',
      '-------------',
      JSON.stringify(details.java || [], null, 2),
      '',
      'ACCOUNTS (no credentials)',
      '-------------------------',
      JSON.stringify(details.accounts || [], null, 2),
      '',
      'LAUNCHER LOG (tail)',
      '-------------------',
      launcherLog.content || '',
      '',
    ].join('\n')
    await fsp.writeFile(filePath, content, 'utf8')
    this.logger.info('Diagnostics exported', { filePath })
    return { path: filePath, filename: path.basename(filePath) }
  }
}
