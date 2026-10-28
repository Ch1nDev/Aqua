import {
  Coffee,
  Download,
  FolderOpen,
  Layers,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes, formatEta, formatSpeed } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import { useLauncher } from '../../state/LauncherProvider'
import type { DownloadJob } from '../../lib/types'
import { Badge, Button, EmptyState, IconButton, ProgressBar, cx } from '../ui/primitives'
import { Drawer } from '../ui/overlays'

function jobTone(job: DownloadJob) {
  if (job.status === 'completed') return 'success' as const
  if (job.status === 'failed') return 'danger' as const
  if (job.status === 'cancelled') return 'default' as const
  if (job.status === 'queued') return 'warning' as const
  return 'info' as const
}

function jobStatusLabel(job: DownloadJob) {
  if (job.status === 'queued') return 'Queued'
  if (job.status === 'running') return job.progress != null ? `${job.progress}%` : 'Working'
  if (job.status === 'completed') return 'Complete'
  if (job.status === 'failed') return 'Failed'
  return 'Cancelled'
}

export function DownloadsDrawer() {
  const {
    downloadsOpen,
    setDownloadsOpen,
    jobs,
    pushToast,
    installGame,
    openInstallationFolder,
    navigate,
    data,
  } = useLauncher()

  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued')
  const finished = jobs.filter((job) => !(job.status === 'running' || job.status === 'queued'))
  useNow(downloadsOpen && active.length > 0)

  const cancelJob = async (job: DownloadJob) => {
    try {
      await api.downloads.cancel(job.id)
      pushToast({ level: 'info', title: 'Download cancelled', message: job.title })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not cancel download', message: getErrorMessage(error) })
    }
  }

  const clearFinished = async () => {
    try {
      await api.downloads.clearFinished()
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not clear downloads', message: getErrorMessage(error) })
    }
  }

  const retryInstall = async (job: DownloadJob) => {
    if (!job.installationId) return
    const installation = data?.installations.find((item) => item.id === job.installationId)
    if (!installation) {
      pushToast({ level: 'error', title: 'Installation not found' })
      return
    }
    setDownloadsOpen(false)
    await installGame(installation.id)
  }

  return (
    <Drawer
      open={downloadsOpen}
      onClose={() => setDownloadsOpen(false)}
      title="Downloads"
      subtitle={active.length ? `${active.length} active · progress and speed update live` : 'Installs, updates and Java runtimes'}
      footer={
        <>
          <div className="drawer-footer-row">
            <span className="text-dim">
              {jobs.length} job{jobs.length === 1 ? '' : 's'} this session
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 />}
              onClick={() => void clearFinished()}
              disabled={finished.length === 0}
            >
              Clear finished
            </Button>
          </div>
        </>
      }
    >
      {jobs.length === 0 ? (
        <EmptyState
          icon={<Download />}
          title="No downloads yet"
          description="Installations, game files and official Java runtimes will appear here with live progress."
        >
          <Button size="sm" icon={<Layers />} onClick={() => navigate('versions')}>
            Browse versions
          </Button>
        </EmptyState>
      ) : (
        <>
          {active.length > 0 ? (
            <div className="download-section">
              <span className="download-section__title">In progress</span>
              {active.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onCancel={() => void cancelJob(job)}
                  onOpenFolder={job.installationId ? () => void openInstallationFolder(job.installationId!) : undefined}
                />
              ))}
            </div>
          ) : null}
          {finished.length > 0 ? (
            <div className="download-section">
              <span className="download-section__title">Recent</span>
              {finished.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onRetry={job.type === 'install' ? () => void retryInstall(job) : undefined}
                  onOpenFolder={job.installationId ? () => void openInstallationFolder(job.installationId!) : undefined}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </Drawer>
  )
}

function JobCard({
  job,
  onCancel,
  onRetry,
  onOpenFolder,
}: {
  job: DownloadJob
  onCancel?: () => void
  onRetry?: () => void
  onOpenFolder?: () => void
}) {
  const running = job.status === 'running'
  const indeterminate = job.progress == null
  return (
    <article className={cx('download-card', `download-card--${job.status}`)}>
      <div className="download-card__head">
        <span className={cx('download-card__icon', job.type === 'java' && 'is-java')}>
          {job.type === 'java' ? <Coffee /> : <Download />}
        </span>
        <div className="download-card__copy">
          <div className="download-card__title-row">
            <span className="download-card__title">{job.title}</span>
            <Badge tone={jobTone(job)}>{jobStatusLabel(job)}</Badge>
          </div>
          <span className="download-card__subtitle">{job.subtitle}</span>
        </div>
        {running || job.status === 'queued' ? (
          <IconButton label={`Cancel ${job.title}`} size="sm" onClick={onCancel}>
            <X />
          </IconButton>
        ) : job.status === 'failed' && onRetry ? (
          <IconButton label={`Retry ${job.title}`} size="sm" onClick={onRetry}>
            <RefreshCw />
          </IconButton>
        ) : onOpenFolder ? (
          <IconButton label="Open game folder" size="sm" onClick={onOpenFolder}>
            <FolderOpen />
          </IconButton>
        ) : null}
      </div>

      <div className="download-card__progress">
        <ProgressBar
          value={job.status === 'completed' ? 100 : job.status === 'cancelled' ? 0 : job.progress}
          danger={job.status === 'failed'}
          label={`${job.title} progress`}
        />
      </div>

      <div className="download-card__meta">
        <span className="download-card__stage">{job.error || job.stage}</span>
        {running ? (
          <span className="download-card__numbers">
            {job.bytesTotal > 0 ? (
              <span>
                {formatBytes(job.bytesDone)} / {formatBytes(job.bytesTotal)}
              </span>
            ) : job.filesTotal > 0 ? (
              <span>
                {job.filesDone.toLocaleString()} / {job.filesTotal.toLocaleString()} files
              </span>
            ) : null}
            {job.speedBps > 0 ? <span>{formatSpeed(job.speedBps)}</span> : null}
            {job.etaSeconds != null && job.etaSeconds > 0 ? <span>{formatEta(job.etaSeconds)} left</span> : null}
          </span>
        ) : indeterminate && job.status === 'failed' ? (
          <span />
        ) : job.filesTotal > 0 && job.status === 'completed' ? (
          <span className="download-card__numbers">
            {job.filesTotal.toLocaleString()} files
          </span>
        ) : null}
      </div>
      {job.currentFile && running ? (
        <div className="download-card__file mono" title={job.currentFile}>
          {job.currentFile}
        </div>
      ) : null}
      {job.status === 'failed' && onOpenFolder ? (
        <button type="button" className="download-card__link" onClick={onOpenFolder}>
          Open game folder
        </button>
      ) : null}
    </article>
  )
}
