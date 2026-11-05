function dateValue(installation) {
  for (const value of [installation?.lastInstalledAt, installation?.installedAt, installation?.createdAt]) {
    const timestamp = Date.parse(value || '')
    if (Number.isFinite(timestamp)) return timestamp
  }
  return 0
}

/** Installed profiles only, newest installation first. */
export function planMaintenance(installations = []) {
  return (Array.isArray(installations) ? installations : [])
    .filter((installation) => installation?.installed === true)
    .slice()
    .sort((a, b) => dateValue(b) - dateValue(a))
    .map((installation) => ({
      id: installation.id,
      name: installation.name,
      versionId: installation.versionId,
      installedAt: installation.lastInstalledAt || installation.installedAt || null,
    }))
}

export function healthSnapshot(result) {
  const checks = Array.isArray(result?.checks) ? result.checks : []
  return {
    status: result?.status || 'unknown',
    errors: checks.filter((check) => check.status === 'error').length,
    warnings: checks.filter((check) => check.status === 'warn').length,
  }
}

export function classifyMaintenanceProfile(profile) {
  if (profile?.errors?.length) return 'failed'
  if ((profile?.repaired?.files || 0) > 0) return 'repaired'
  return profile?.after?.status === 'ok' ? 'healthy' : 'attention'
}

export function summarizeMaintenance(
  profiles,
  { total = profiles.length, cancelled = false, startedAt = null } = {},
) {
  const list = Array.isArray(profiles) ? profiles : []
  const count = (status) => list.filter((profile) => profile.status === status).length
  return {
    profiles: list,
    total,
    checked: list.length,
    healthy: count('healthy'),
    repaired: count('repaired'),
    failed: count('failed'),
    attention: count('attention'),
    cancelled,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}

/**
 * Runs the installer's verification path for one profile at a time. The
 * installer already knows how to verify hashes and fetch only missing or
 * damaged game files, so maintenance does not create a second downloader.
 */
export class MaintenanceService {
  constructor({ store, installer, healthService, logger = null }) {
    this.store = store
    this.installer = installer
    this.healthService = healthService
    this.logger = logger
  }

  async inspect(installation) {
    this.healthService.invalidate(installation.id)
    try {
      return healthSnapshot(await this.healthService.check(installation.id))
    } catch (error) {
      this.logger?.warn?.('Health check failed during maintenance', {
        installationId: installation.id,
        message: error.message,
      })
      return { status: 'error', errors: 1, warnings: 0 }
    }
  }

  async run({ onProgress = () => {}, shouldStop = () => false } = {}) {
    const plan = planMaintenance(this.store.installations)
    const profiles = []
    const startedAt = new Date().toISOString()
    let cancelled = false

    onProgress({
      stage: plan.length ? `Checking ${plan.length} installed profile${plan.length === 1 ? '' : 's'}` : 'No installed profiles to check',
      progress: 0,
      indeterminate: true,
      filesDone: 0,
      filesTotal: plan.length,
      currentFile: null,
    })

    for (let index = 0; index < plan.length; index += 1) {
      if (shouldStop()) {
        cancelled = true
        break
      }
      const entry = plan[index]
      const installation = this.store.getInstallation(entry.id)
      if (!installation) {
        const missing = {
          id: entry.id,
          name: entry.name,
          versionId: entry.versionId,
          before: { status: 'unknown', errors: 0, warnings: 0 },
          after: { status: 'unknown', errors: 0, warnings: 0 },
          repaired: { files: 0, bytes: 0 },
          errors: ['The installation was removed before it could be checked.'],
        }
        missing.status = classifyMaintenanceProfile(missing)
        profiles.push(missing)
        continue
      }

      const before = await this.inspect(installation)
      const report = (update = {}) => {
        const inner = Number.isFinite(Number(update.progress)) ? Number(update.progress) : 0
        const progress = plan.length
          ? Math.min(99, Math.round(((index + Math.min(100, Math.max(0, inner)) / 100) / plan.length) * 100))
          : 0
        onProgress({
          ...update,
          stage: `${entry.name} · ${update.stage || 'Checking files'}`,
          progress,
          indeterminate: update.indeterminate === true,
          filesDone: index,
          filesTotal: plan.length,
          currentFile: update.currentFile || entry.name,
        })
      }

      let repair = null
      let error = null
      try {
        onProgress({
          stage: `Checking ${entry.name}`,
          progress: plan.length ? Math.round((index / plan.length) * 100) : 0,
          indeterminate: true,
          filesDone: index,
          filesTotal: plan.length,
          currentFile: entry.name,
        })
        repair = await this.installer.install(installation, {
          settings: this.store.settings,
          onUpdate: report,
        })
      } catch (failure) {
        error = failure?.message || 'The game files could not be verified.'
        this.logger?.warn?.('Maintenance repair failed for a profile', {
          installationId: installation.id,
          message: error,
        })
      }

      const after = await this.inspect(installation)
      const profile = {
        id: installation.id,
        name: installation.name,
        versionId: installation.versionId,
        before,
        after,
        repaired: {
          files: Math.max(0, Number(repair?.downloadedFiles) || 0),
          bytes: Math.max(0, Number(repair?.downloadedBytes) || 0),
        },
        errors: error ? [error] : [],
      }
      profile.status = classifyMaintenanceProfile(profile)
      profiles.push(profile)
      onProgress({
        stage: `Checked ${entry.name}`,
        progress: Math.round(((index + 1) / plan.length) * 100),
        indeterminate: false,
        filesDone: index + 1,
        filesTotal: plan.length,
        currentFile: null,
      })
      if (shouldStop()) cancelled = true
    }

    const summary = summarizeMaintenance(profiles, {
      total: plan.length,
      cancelled,
      startedAt,
    })
    onProgress({
      stage: cancelled ? 'Maintenance cancelled after the current profile' : 'Verification complete',
      progress: 100,
      indeterminate: false,
      filesDone: profiles.length,
      filesTotal: plan.length,
      currentFile: null,
    })
    return summary
  }
}
