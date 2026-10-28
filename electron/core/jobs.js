import { randomId } from './util.js'

function publicJob(job) {
  const { abortController, ...rest } = job
  return rest
}

export class JobManager {
  constructor({
    store,
    installer,
    javaService,
    paths,
    logger,
    emitJobs,
    emitActivity,
    emitNotification,
    emitInstallations,
  }) {
    this.store = store
    this.installer = installer
    this.javaService = javaService
    this.paths = paths
    this.logger = logger
    this.emitJobsCallback = emitJobs
    this.emitActivity = emitActivity
    this.emitNotification = emitNotification
    this.emitInstallations = emitInstallations
    this.jobs = []
    this.running = false
    this.activeJob = null
  }

  list() {
    return this.jobs.map(publicJob)
  }

  emitJobs() {
    this.emitJobsCallback(this.jobs.map(publicJob))
  }

  enqueueInstall(installationId) {
    const installation = this.store.getInstallation(installationId)
    if (!installation) throw new Error('Installation not found.')
    const duplicate = this.jobs.find(
      (job) =>
        job.type === 'install' &&
        job.installationId === installationId &&
        (job.status === 'queued' || job.status === 'running'),
    )
    if (duplicate) return publicJob(duplicate)
    const job = {
      id: randomId(),
      type: 'install',
      installationId,
      installationName: installation.name,
      versionId: installation.versionId,
      title: `Installing ${installation.name}`,
      subtitle: `Minecraft ${installation.versionId}`,
      status: 'queued',
      stage: 'Queued',
      progress: null,
      indeterminate: true,
      bytesDone: 0,
      bytesTotal: 0,
      filesDone: 0,
      filesTotal: 0,
      speedBps: 0,
      etaSeconds: null,
      currentFile: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      abortController: null,
    }
    this.jobs.unshift(job)
    this.jobs = this.jobs.slice(0, 30)
    this.emitJobs()
    this.drain()
    return publicJob(job)
  }

  enqueueJavaRuntime(component, label) {
    const duplicate = this.jobs.find(
      (job) =>
        job.type === 'java' &&
        job.component === component &&
        (job.status === 'queued' || job.status === 'running'),
    )
    if (duplicate) return publicJob(duplicate)
    const job = {
      id: randomId(),
      type: 'java',
      component,
      installationId: null,
      installationName: null,
      versionId: null,
      title: label || `Installing Java runtime`,
      subtitle: component,
      status: 'queued',
      stage: 'Queued',
      progress: null,
      indeterminate: true,
      bytesDone: 0,
      bytesTotal: 0,
      filesDone: 0,
      filesTotal: 0,
      speedBps: 0,
      etaSeconds: null,
      currentFile: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      abortController: null,
    }
    this.jobs.unshift(job)
    this.jobs = this.jobs.slice(0, 30)
    this.emitJobs()
    this.drain()
    return publicJob(job)
  }

  cancel(jobId) {
    const job = this.jobs.find((item) => item.id === jobId)
    if (!job) throw new Error('Download not found.')
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return publicJob(job)
    if (job.status === 'queued') {
      job.status = 'cancelled'
      job.stage = 'Cancelled'
      job.finishedAt = new Date().toISOString()
      this.emitJobs()
      return publicJob(job)
    }
    job.cancelRequested = true
    job.stage = 'Cancelling…'
    this.emitJobs()
    job.abortController?.abort()
    return publicJob(job)
  }

  clearFinished() {
    this.jobs = this.jobs.filter((job) => job.status === 'queued' || job.status === 'running')
    this.emitJobs()
  }

  updateJob(job, update) {
    Object.assign(job, update)
    this.emitJobs()
  }

  async drain() {
    if (this.running) return
    const job = this.jobs
      .slice()
      .reverse()
      .find((item) => item.status === 'queued')
    if (!job) return
    this.running = true
    this.activeJob = job
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    job.stage = 'Starting'
    job.abortController = new AbortController()
    this.emitJobs()

    try {
      if (job.type === 'install') {
        const installation = this.store.getInstallation(job.installationId)
        if (!installation) throw new Error('The installation was removed before it could start.')
        const settings = this.store.settings
        const installResult = await this.installer.install(installation, {
          settings,
          signal: job.abortController.signal,
          onUpdate: (update) => {
            const progress = update.progress
            this.updateJob(job, {
              ...update,
              indeterminate: progress == null,
              ...(update.bytesDone != null ? { bytesDone: update.bytesDone } : {}),
              ...(update.bytesTotal != null ? { bytesTotal: update.bytesTotal } : {}),
              ...(update.filesDone != null ? { filesDone: update.filesDone } : {}),
              ...(update.filesTotal != null ? { filesTotal: update.filesTotal } : {}),
              ...(update.speedBps != null ? { speedBps: update.speedBps } : {}),
              ...(update.etaSeconds !== undefined ? { etaSeconds: update.etaSeconds } : {}),
            })
          },
        })
        if (job.cancelRequested) throw Object.assign(new Error('Installation cancelled.'), { name: 'AbortError' })
        const installedAt = new Date().toISOString()
        if (installResult?.loaderProfileId && installation.loader?.profileId !== installResult.loaderProfileId) {
          await this.store.updateInstallation(installation.id, {
            loader: { ...installation.loader, profileId: installResult.loaderProfileId },
          })
        }
        await this.store.markInstalled(installation.id, installedAt)
        job.status = 'completed'
        job.stage = 'Installed'
        job.progress = 100
        job.indeterminate = false
        job.finishedAt = installedAt
        job.speedBps = 0
        job.etaSeconds = 0
        await this.store.addActivity({
          type: 'install',
          title: `${installation.name} is ready to play`,
          detail: `Minecraft ${installation.versionId}`,
          installationId: installation.id,
          status: 'success',
        })
        this.emitActivity()
        await this.emitInstallations()
        this.emitNotification({
          level: 'success',
          title: 'Installation complete',
          message: `${installation.name} (${installation.versionId}) is installed and ready.`,
        })
        this.logger.info('Installation job completed', {
          installationId: installation.id,
          version: installation.versionId,
        })
      } else if (job.type === 'java') {
        const settings = this.store.settings
        const result = await this.javaService.installRuntime(job.component, {
          settings,
          logger: this.logger,
          signal: job.abortController.signal,
          onProgress: (update) => {
            this.updateJob(job, {
              stage: update.stage,
              progress: update.progress ?? null,
              indeterminate: update.progress == null,
              ...(update.filesDone != null ? { filesDone: update.filesDone } : {}),
              ...(update.filesTotal != null ? { filesTotal: update.filesTotal } : {}),
              ...(update.bytesDone != null ? { bytesDone: update.bytesDone } : {}),
              ...(update.bytesTotal != null ? { bytesTotal: update.bytesTotal } : {}),
              ...(update.speedBps != null ? { speedBps: update.speedBps } : {}),
              ...(update.etaSeconds !== undefined ? { etaSeconds: update.etaSeconds } : {}),
            })
          },
        })
        if (job.cancelRequested) throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' })
        job.status = 'completed'
        job.stage = 'Installed'
        job.progress = 100
        job.indeterminate = false
        job.finishedAt = new Date().toISOString()
        job.speedBps = 0
        job.etaSeconds = 0
        job.title = `Java ${result.major} installed`
        await this.store.addActivity({
          type: 'java',
          title: `Java ${result.major} runtime installed`,
          detail: result.home,
          status: 'success',
        })
        this.emitActivity()
        this.emitNotification({
          level: 'success',
          title: 'Java runtime installed',
          message: `Java ${result.major} (${result.version}) is ready to use.`,
        })
        this.logger.info('Java runtime job completed', { component: job.component, version: result.version })
      }
    } catch (error) {
      if (error?.name === 'AbortError' || job.cancelRequested) {
        job.status = 'cancelled'
        job.stage = 'Cancelled'
        job.error = null
        job.finishedAt = new Date().toISOString()
        job.speedBps = 0
        job.etaSeconds = null
        this.logger.info('Download job cancelled', { id: job.id, type: job.type })
      } else {
        job.status = 'failed'
        job.stage = 'Failed'
        job.error = error.message || 'Unknown error'
        job.finishedAt = new Date().toISOString()
        job.speedBps = 0
        job.etaSeconds = null
        this.logger.error('Download job failed', {
          id: job.id,
          type: job.type,
          message: job.error,
        })
        await this.store.addActivity({
          type: job.type === 'install' ? 'install' : 'java',
          title: job.type === 'install' ? `${job.installationName} installation failed` : 'Java runtime installation failed',
          detail: job.error,
          installationId: job.installationId,
          status: 'error',
        })
        this.emitActivity()
        this.emitNotification({
          level: 'error',
          title: job.type === 'install' ? 'Installation failed' : 'Java installation failed',
          message: job.error,
        })
        if (job.type === 'install') await this.emitInstallations()
      }
    } finally {
      this.running = false
      this.activeJob = null
      this.emitJobs()
      setTimeout(() => this.drain(), 25)
    }
  }
}
