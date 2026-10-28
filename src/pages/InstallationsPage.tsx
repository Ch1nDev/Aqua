import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Gem,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  FolderOpen,
  Gamepad2,
  Layers,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  X,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { formatBytes, formatEta, formatPlaytime, relativeTime, shortPath } from '../lib/format'
import { loaderLabel } from '../lib/loaders'
import { useLauncher } from '../state/LauncherProvider'
import type { DownloadJob, Installation } from '../lib/types'
import { PackIcon } from '../components/brand/Brand'
import { PageHeader } from '../components/layout/PageHeader'
import { ActionMenu } from '../components/ui/Menu'
import { Button, EmptyState, IconButton, ProgressBar, cx } from '../components/ui/primitives'
import { ConfirmDialog } from '../components/ui/overlays'
import { RegisterBedrockDialog } from '../components/bedrock/RegisterBedrockDialog'

type Filter = 'all' | 'installed' | 'missing' | 'release' | 'snapshot'

function activeInstallJob(jobs: DownloadJob[], installationId: string) {
  return (
    jobs.find(
      (job) =>
        job.type === 'install' &&
        job.installationId === installationId &&
        (job.status === 'running' || job.status === 'queued'),
    ) || null
  )
}

function latestInstallJob(jobs: DownloadJob[], installationId: string) {
  return jobs.find((job) => job.type === 'install' && job.installationId === installationId) || null
}

export function InstallationsPage() {
  const {
    installations,
    jobs,
    game,
    launchingId,
    versions,
    openInstallDialog,
    play,
    installGame,
    setActiveInstallation,
    openInstallationFolder,
    duplicateInstallation,
    deleteInstallation,
    setDownloadsOpen,
    pushToast,
    bedrock,
    bedrockLoading,
    bedrockError,
    refreshBedrock,
    launchBedrock,
    bedrockTarget,
    selectBedrockTarget,
    bedrockLibrary,
    registerBedrockVersion,
    removeBedrockVersion,
    openBedrockVersionFolder,
    navigate,
  } = useLauncher()

  const [editionTab, setEditionTab] = useState<'java' | 'bedrock'>('java')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [deleteTarget, setDeleteTarget] = useState<Installation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [launchingEditionId, setLaunchingEditionId] = useState<string | null>(null)
  const [registerTarget, setRegisterTarget] = useState<string | null>(null)

  const launchEdition = async (editionId: string) => {
    setLaunchingEditionId(editionId)
    try {
      // Launching also points the dashboard's Play button at this edition.
      await launchBedrock(editionId)
    } finally {
      setLaunchingEditionId(null)
    }
  }

  const useEditionForPlay = (editionId: string) => {
    selectBedrockTarget(editionId)
    pushToast({
      level: 'info',
      title: 'Bedrock is now the Play target',
      message: 'Press Play on the dashboard to launch this edition.',
    })
  }

  const openEditionFolder = async (editionId: string) => {
    try {
      await api.bedrock.openFolder(editionId)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not open the data folder', message: getErrorMessage(error) })
    }
  }

  // A registered build also sits in the download folder: it is one thing, not two.
  const registeredFolders = useMemo(
    () => new Set((bedrock?.editions || []).map((edition) => (edition.installLocation || '').toLowerCase())),
    [bedrock],
  )
  const extraBuilds = useMemo(
    () => bedrockLibrary.filter((entry) => !registeredFolders.has(entry.directory.toLowerCase())),
    [bedrockLibrary, registeredFolders],
  )

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return installations
      .filter((installation) => {
        if (filter === 'installed' && !installation.installed) return false
        if (filter === 'missing' && installation.installed) return false
        if (filter === 'release' && installation.versionType !== 'release') return false
        if (filter === 'snapshot' && installation.versionType !== 'snapshot') return false
        if (!normalized) return true
        return (
          installation.name.toLowerCase().includes(normalized) ||
          installation.versionId.toLowerCase().includes(normalized) ||
          installation.gameDir.toLowerCase().includes(normalized)
        )
      })
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return new Date(b.lastPlayedAt || b.createdAt).getTime() - new Date(a.lastPlayedAt || a.createdAt).getTime()
      })
  }, [installations, query, filter])

  const requestDelete = (installation: Installation) => {
    setDeleteError(null)
    setDeleteTarget(installation)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteInstallation(deleteTarget.id)
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const cancelJob = async (job: DownloadJob) => {
    try {
      await api.downloads.cancel(job.id)
      pushToast({ level: 'info', title: 'Download cancelled', message: job.title })
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not cancel download', message: getErrorMessage(error) })
    }
  }

  const selectInstallation = async (id: string) => {
    try {
      await setActiveInstallation(id)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not select installation', message: getErrorMessage(error) })
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Installations"
        subtitle={
          editionTab === 'java'
            ? 'Each profile keeps its own version, game folder, and launch settings.'
            : 'Bedrock editions installed for this Windows account, plus builds downloaded here.'
        }
        actions={
          editionTab === 'java' ? (
            <Button
              variant="primary"
              icon={<Plus />}
              onClick={() => openInstallDialog({ mode: 'create', versionId: versions?.latest.release })}
            >
              New installation
            </Button>
          ) : (
            <Button icon={<Download />} onClick={() => navigate('versions')}>
              Browse versions
            </Button>
          )
        }
      />

      <div className="segmented edition-switch" role="tablist" aria-label="Edition">
        <button
          type="button"
          role="tab"
          aria-selected={editionTab === 'java'}
          className={editionTab === 'java' ? 'is-active' : undefined}
          onClick={() => setEditionTab('java')}
        >
          <Boxes /> Java Edition
          <span className="edition-switch__count">{installations.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={editionTab === 'bedrock'}
          className={editionTab === 'bedrock' ? 'is-active' : undefined}
          onClick={() => setEditionTab('bedrock')}
        >
          <Gem /> Bedrock Edition
          <span className="edition-switch__count">{(bedrock?.editions.length ?? 0) + extraBuilds.length}</span>
        </button>
      </div>

      {editionTab === 'java' ? (
      <div className="page-toolbar">
        <div className="search-input">
          <Search />
          <input
            className="input"
            placeholder="Search installations, versions or folders…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search installations"
          />
          {query ? (
            <button type="button" className="search-input__clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X />
            </button>
          ) : null}
        </div>
        <div className="filter-chips" role="group" aria-label="Filter installations">
          {(
            [
              ['all', 'All'],
              ['installed', 'Installed'],
              ['missing', 'Not installed'],
              ['release', 'Releases'],
              ['snapshot', 'Snapshots'],
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cx('chip', filter === value && 'is-active')}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="page-toolbar__count">
          {filtered.length} of {installations.length}
        </span>
      </div>
      ) : (
        <div className="page-toolbar">
          <span className="page-toolbar__count">
            {bedrock?.editions.length ?? 0} installed · {extraBuilds.length} downloaded
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={bedrockLoading ? 'spin' : undefined} />}
            onClick={() => void refreshBedrock(true)}
            disabled={bedrockLoading}
          >
            Refresh
          </Button>
        </div>
      )}

      {editionTab === 'bedrock' ? (
        <>
      {bedrock?.editions.length ? (
        <section className="bedrock-panel">
          <div className="bedrock-panel__head">
            <div>
              <h2>Bedrock Edition</h2>
              <p>
                Installed from the Microsoft Store. Bedrock signs in with your Xbox profile and keeps its own worlds,
                separate from Java.
              </p>
            </div>
            <button type="button" className="link-button" onClick={() => void refreshBedrock(true)} disabled={bedrockLoading}>
              <RefreshCw /> Refresh
            </button>
          </div>
          <div className="bedrock-grid">
            {bedrock.editions.map((edition) => (
              <article className="bedrock-card" key={edition.id}>
                <div className="bedrock-card__identity">
                  <span className="bedrock-card__icon" aria-hidden="true">
                    <Boxes />
                  </span>
                  <div className="bedrock-card__titles">
                    <h3>
                      {edition.name}
                      {bedrockTarget?.id === edition.id ? (
                        <span className="bedrock-card__target">
                          <CheckCircle2 /> Play target
                        </span>
                      ) : null}
                    </h3>
                    <p>
                      {edition.version ? `Bedrock ${edition.version}` : 'Version unknown'}
                      <span className="bedrock-card__dot">·</span>
                      package {edition.packageVersion}
                    </p>
                  </div>
                </div>
                <dl className="bedrock-card__facts">
                  <div>
                    <dt>Data folder</dt>
                    <dd title={edition.dataRoot}>{shortPath(edition.dataRoot)}</dd>
                  </div>
                  <div>
                    <dt>Worlds folder</dt>
                    <dd title={edition.worldsDirectory}>{shortPath(edition.worldsDirectory)}</dd>
                  </div>
                </dl>
                <div className="bedrock-card__actions">
                  <Button
                    variant="primary"
                    icon={<Play />}
                    loading={launchingEditionId === edition.id}
                    onClick={() => void launchEdition(edition.id)}
                  >
                    Play
                  </Button>
                  <Button icon={<FolderOpen />} onClick={() => void openEditionFolder(edition.id)}>
                    Open data folder
                  </Button>
                  <Button icon={<Layers />} onClick={() => navigate('worlds')}>
                    Worlds
                  </Button>
                  {bedrockTarget?.id === edition.id ? (
                    <Button icon={<Check />} disabled>
                      Used by Play
                    </Button>
                  ) : (
                    <Button icon={<Play />} onClick={() => useEditionForPlay(edition.id)}>
                      Use for Play
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : bedrock?.supported && !bedrockLoading ? (
        <div className="callout bedrock-callout">
          <Store />
          <div>
            <strong>Minecraft for Windows was not found</strong>
            <span>
              Install Bedrock Edition from the Microsoft Store to play it, and to use Bedrock servers and worlds here.{' '}
              <button type="button" className="link-button" onClick={() => void api.openExternal(bedrock.storeUrl)}>
                Open the Store page
              </button>
            </span>
            {bedrockLibrary.length ? (
              <span className="text-dim">
                Registering a downloaded build below hands the Minecraft package over to that copy, and the Store version
                stays missing until you install it again.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {bedrockLibrary.length ? (
        <section className="panel bedrock-downloads">
          <div className="panel-head">
            <div>
              <h2 className="panel-head__title">Bedrock builds downloaded here</h2>
              <p className="panel-head__subtitle">
                Unpacked in the launcher's own folder. Registering one makes Windows run that build instead of the Store
                copy.
              </p>
            </div>
            <button type="button" className="link-button" onClick={() => navigate('versions')}>
              More versions
            </button>
          </div>
          {bedrockLibrary.map((entry) => {
            const linked = registeredFolders.has(entry.directory.toLowerCase())
            return (
              <div className="bedrock-download-row" key={entry.version}>
                <div className="grow">
                  <span className="bedrock-download-row__version">
                    Bedrock {entry.version}
                    {linked ? <span className="bedrock-download-row__flag">Registered</span> : null}
                  </span>
                  <span className="bedrock-download-row__meta">
                    {formatBytes(entry.sizeBytes)}
                    {linked
                      ? ' · this folder is the installed Minecraft'
                      : entry.layout === 'appx'
                        ? ' · ready to register'
                        : ' · MSIXVC, installs only from the Store'}
                  </span>
                </div>
                {entry.layout === 'appx' && !linked ? (
                  <Button size="sm" variant="primary" icon={<CheckCircle2 />} onClick={() => setRegisterTarget(entry.version)}>
                    Register build
                  </Button>
                ) : null}
                <Button size="sm" icon={<FolderOpen />} onClick={() => void openBedrockVersionFolder(entry.version)}>
                  Open folder
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 />}
                  disabled={linked}
                  title={linked ? 'Windows is running this build. Uninstall it in Windows Settings first.' : undefined}
                  onClick={() => void removeBedrockVersion(entry.version)}
                >
                  Remove
                </Button>
              </div>
            )
          })}
        </section>
      ) : null}

      <RegisterBedrockDialog
        version={registerTarget}
        onCancel={() => setRegisterTarget(null)}
        onConfirm={(options) => {
          const version = registerTarget
          setRegisterTarget(null)
          if (version) void registerBedrockVersion(version, options)
        }}
      />

      {bedrockError ? (
        <div className="callout callout--danger" role="alert">
          <AlertTriangle />
          <span>{bedrockError}</span>
        </div>
      ) : null}
        </>
      ) : null}

      {editionTab === 'java' ? (
        <>
      {installations.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Layers />}
            title="No installations yet"
            description="Create a profile to pick a Minecraft version, choose a game folder, and download only the files you need."
          >
            <Button
              variant="primary"
              icon={<Plus />}
              onClick={() => openInstallDialog({ mode: 'create', versionId: versions?.latest.release })}
            >
              Create installation
            </Button>
            <Button icon={<Download />} onClick={() => setDownloadsOpen(true)}>
              View downloads
            </Button>
          </EmptyState>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Search />}
            title="No matching installations"
            description="Try a different search term or clear the active filter."
          >
            <Button
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        </div>
      ) : (
        <div className="installation-grid">
          {filtered.map((installation) => {
            const job = activeInstallJob(jobs, installation.id)
            const lastJob = latestInstallJob(jobs, installation.id)
            const isPlaying = game.status === 'running' && game.installationId === installation.id
            const isPreparing =
              (game.status === 'preparing' && game.installationId === installation.id) ||
              launchingId === installation.id
            const isOtherGameRunning =
              (game.status === 'running' || game.status === 'preparing') && game.installationId !== installation.id
            return (
              <article
                key={installation.id}
                className={cx('installation-card', installation.isActive && 'is-selected', isPlaying && 'is-playing')}
              >
                <div className="installation-card__top">
                  <div className="installation-card__identity">
                    <button
                      type="button"
                      className={cx('installation-card__select', installation.isActive && 'is-on')}
                      aria-label={installation.isActive ? 'Selected for launch' : 'Select for launch'}
                      aria-pressed={installation.isActive}
                      title={installation.isActive ? 'Selected for launch' : 'Select for launch'}
                      onClick={() => void selectInstallation(installation.id)}
                    >
                      {installation.isActive ? <CheckCircle2 /> : <Circle />}
                    </button>
                    <div className="installation-card__cube" data-version-type={installation.versionType}>
                      <PackIcon
                        modpack={installation.modpack}
                        loader={installation.loader?.type ?? 'vanilla'}
                        size={26}
                      />
                    </div>
                    <div className="installation-card__titles">
                      <div className="installation-card__name-row">
                        <h2 className="installation-card__name">{installation.name}</h2>
                      </div>
                      <div className="installation-card__version-row">
                        <span className="installation-card__version">
                          {installation.versionId}
                          {installation.loader?.type && installation.loader.type !== 'vanilla'
                            ? ` · ${loaderLabel(installation.loader.type)}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ActionMenu
                    label={`Actions for ${installation.name}`}
                    items={[
                      {
                        label: 'Edit installation',
                        icon: <Pencil />,
                        onSelect: () => openInstallDialog({ mode: 'edit', installation }),
                      },
                      {
                        label: installation.installed ? 'Verify game files' : 'Download game files',
                        icon: <RefreshCw />,
                        onSelect: () => void installGame(installation.id),
                      },
                      {
                        label: 'Open game folder',
                        icon: <FolderOpen />,
                        onSelect: () => void openInstallationFolder(installation.id),
                      },
                      {
                        label: 'Set as selected',
                        icon: <Check />,
                        disabled: installation.isActive,
                        onSelect: () => void selectInstallation(installation.id),
                      },
                      {
                        label: 'Duplicate profile',
                        icon: <Copy />,
                        onSelect: () => void duplicateInstallation(installation.id),
                      },
                      { separator: true },
                      {
                        label: 'Delete installation',
                        icon: <Trash2 />,
                        danger: true,
                        onSelect: () => requestDelete(installation),
                      },
                    ]}
                  />
                </div>

                <div className="installation-card__statusline">
                  <span className="installation-card__played">
                    {installation.lastPlayedAt ? `Played ${relativeTime(installation.lastPlayedAt)}` : 'Never played'}
                  </span>
                </div>

                <div className="installation-card__meta">
                  <div>
                    <span>Worlds</span>
                    <strong>{installation.worlds}</strong>
                  </div>
                  <div>
                    <span>Playtime</span>
                    <strong>{formatPlaytime(installation.totalPlaytimeMs)}</strong>
                  </div>
                  <div>
                    <span>Folder</span>
                    <strong title={installation.gameDir}>{shortPath(installation.gameDir, 30)}</strong>
                  </div>
                </div>

                {job ? (
                  <div className="installation-card__download">
                    <div className="installation-card__download-head">
                      <span>
                        {job.status === 'queued' ? 'Queued' : job.stage}
                        {job.progress != null ? ` · ${job.progress}%` : ''}
                      </span>
                      <div className="row gap-2">
                        <button type="button" className="link-button" onClick={() => setDownloadsOpen(true)}>
                          Details
                        </button>
                        <IconButton label="Cancel installation" size="sm" onClick={() => void cancelJob(job)}>
                          <X />
                        </IconButton>
                      </div>
                    </div>
                    <ProgressBar value={job.progress} label="Installation progress" thin />
                    <div className="installation-card__download-meta">
                      <span>
                        {job.bytesTotal > 0
                          ? `${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}`
                          : job.stage}
                      </span>
                      <span>
                        {job.speedBps > 0 ? `${formatBytes(job.speedBps)}/s` : ''}
                        {job.etaSeconds != null && job.etaSeconds > 0 ? ` · ${formatEta(job.etaSeconds)} left` : ''}
                      </span>
                    </div>
                  </div>
                ) : lastJob?.status === 'failed' ? (
                  <div className="installation-card__download is-error">
                    <span className="installation-card__download-error">
                      {lastJob.error || 'The last installation attempt failed.'}
                    </span>
                    <button type="button" className="link-button" onClick={() => void installGame(installation.id)}>
                      Try again
                    </button>
                  </div>
                ) : null}

                <div className="installation-card__actions">
                  {isPlaying ? (
                    <Button
                      size="sm"
                      variant="subtle"
                      icon={<Gamepad2 />}
                      onClick={() =>
                        play(installation.id)
                      }
                    >
                      In game
                    </Button>
                  ) : job ? (
                    <Button size="sm" variant="subtle" icon={<Download />} onClick={() => setDownloadsOpen(true)}>
                      {job.progress != null ? `Installing ${job.progress}%` : 'Installing'}
                    </Button>
                  ) : isPreparing ? (
                    <Button size="sm" variant="subtle" icon={<RefreshCw />} disabled>
                      Launching…
                    </Button>
                  ) : installation.installed ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Play />}
                      onClick={() => void play(installation.id)}
                      disabled={isOtherGameRunning}
                    >
                      Play
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Download />}
                      onClick={() => void installGame(installation.id)}
                    >
                      Install
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil />}
                    onClick={() => openInstallDialog({ mode: 'edit', installation })}
                  >
                    Edit
                  </Button>
                  <IconButton
                    label={`Open ${installation.name} game folder`}
                    size="sm"
                    onClick={() => void openInstallationFolder(installation.id)}
                  >
                    <FolderOpen />
                  </IconButton>
                </div>
              </article>
            )
          })}
        </div>
      )}
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete installation?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong> will be removed from Aqua. Its
            worlds, screenshots, and downloaded files are kept on disk — nothing inside the game folder is deleted.
          </>
        }
        confirmLabel="Delete installation"
        loading={deleting}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
        onConfirm={() => void confirmDelete()}
      >
        {deleteTarget ? (
          <div className="delete-dialog">
            <div className="callout callout--warning">
              <AlertTriangle />
              <div>
                {deleteTarget.worlds > 0
                  ? `${deleteTarget.worlds} world${deleteTarget.worlds === 1 ? '' : 's'} will remain safe in this folder.`
                  : 'No worlds were found in this installation yet.'}
                <div className="delete-dialog__path mono" title={deleteTarget.gameDir}>
                  {deleteTarget.gameDir}
                </div>
              </div>
            </div>
            {deleteError ? <div className="callout callout--danger">{deleteError}</div> : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
