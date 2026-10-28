import os from 'node:os'

export function getSystemInfo(paths) {
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024))
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024))
  const cpus = os.cpus()
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    totalMemMb,
    freeMemMb,
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCount: cpus.length,
    recommendedMaxRamMb: recommendMaxRam(totalMemMb),
    electron: process.versions.electron || null,
    node: process.versions.node,
    chrome: process.versions.chrome || null,
    dataRoot: paths.dataRoot,
    minecraftRoot: paths.minecraftRoot,
    instancesRoot: paths.instancesRoot,
    logsRoot: paths.logsRoot,
  }
}

export function recommendMaxRam(totalMemMb) {
  const half = Math.floor((totalMemMb * 0.5) / 512) * 512
  return Math.max(2048, Math.min(8192, half))
}

export function getPlatformLabel() {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  return 'Linux'
}
