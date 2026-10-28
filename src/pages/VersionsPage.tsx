import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  CalendarDays,
  ChevronDown,
  Download,
  Gem,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { formatDate, relativeTime, versionTypeLabel } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { VersionEntry } from '../lib/types'
import { PageHeader } from '../components/layout/PageHeader'
import { BedrockVersionsPanel } from '../components/bedrock/BedrockVersionsPanel'
import { Badge, Button, EmptyState, Spinner, cx } from '../components/ui/primitives'

type VersionFilter = 'release' | 'snapshot' | 'all'
type EditionFilter = 'java' | 'bedrock'

function versionTone(type: string) {
  if (type === 'snapshot') return 'snapshot' as const
  if (type === 'old_beta') return 'beta' as const
  if (type === 'old_alpha') return 'alpha' as const
  return 'default' as const
}

export function VersionsPage() {
  const {
    versions,
    versionsLoading,
    versionsError,
    refreshVersions,
    installations,
    openInstallDialog,
    navigate,
  } = useLauncher()
  const [edition, setEdition] = useState<EditionFilter>('java')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<VersionFilter>('release')
  const [visibleCount, setVisibleCount] = useState(50)

  useEffect(() => {
    setVisibleCount(50)
  }, [query, filter])

  const latestRelease = versions?.versions.find((version) => version.id === versions.latest.release) || null
  const latestSnapshot = versions?.versions.find((version) => version.id === versions.latest.snapshot) || null
  const profileCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const installation of installations) {
      counts.set(installation.versionId, (counts.get(installation.versionId) || 0) + 1)
    }
    return counts
  }, [installations])

  const filtered = useMemo(() => {
    if (!versions) return []
    const normalized = query.trim().toLowerCase()
    return versions.versions.filter((version) => {
      if (filter !== 'all' && version.type !== filter) return false
      if (!normalized) return true
      return version.id.toLowerCase().includes(normalized) || version.type.includes(normalized)
    })
  }, [versions, filter, query])

  const visible = filtered.slice(0, visibleCount)

  const openInstall = (version: VersionEntry) => {
    openInstallDialog({ mode: 'create', versionId: version.id })
  }

  const usedBy = (versionId: string) => profileCounts.get(versionId) || 0

  return (
    <div className="page">
      <PageHeader
        title="Versions"
        subtitle="Java releases from Mojang's manifest, and the Bedrock builds published to the Microsoft Store."
        actions={
          edition === 'java' ? (
            <>
              <Button
                icon={<RefreshCw className={versionsLoading ? 'spin' : undefined} />}
                onClick={() => void refreshVersions(true)}
                loading={versionsLoading && !versions}
                disabled={versionsLoading}
              >
                Refresh
              </Button>
              <Button
                variant="primary"
                icon={<Plus />}
                onClick={() =>
                  openInstallDialog({
                    mode: 'create',
                    versionId: versions?.latest.release,
                  })
                }
              >
                New installation
              </Button>
            </>
          ) : null
        }
      />

      <div className="segmented edition-switch" role="tablist" aria-label="Edition">
        <button
          type="button"
          role="tab"
          aria-selected={edition === 'java'}
          className={edition === 'java' ? 'is-active' : undefined}
          onClick={() => setEdition('java')}
        >
          <Boxes /> Java Edition
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={edition === 'bedrock'}
          className={edition === 'bedrock' ? 'is-active' : undefined}
          onClick={() => setEdition('bedrock')}
        >
          <Gem /> Bedrock Edition
        </button>
      </div>

      {edition === 'bedrock' ? <BedrockVersionsPanel /> : <>
      {versionsError ? (
        <div className="callout callout--warning versions-cache-warning">
          <div className="grow">
            {versionsError}
            {versions?.fetchedAt ? (
              <span className="text-dim"> Last synced {relativeTime(versions.fetchedAt)}.</span>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void refreshVersions(true)} loading={versionsLoading}>
            Retry sync
          </Button>
        </div>
      ) : null}

      {versions?.fetchedAt ? (
        <div className="versions-status">
          <span>
            {versions.versions.length.toLocaleString()} versions · {installations.length} profile
            {installations.length === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}

      {!versions && versionsLoading ? (
        <div className="versions-loading">
          <div className="latest-grid">
            <div className="panel latest-card latest-card--skeleton">
              <div className="skeleton" style={{ width: '35%', height: 12 }} />
              <div className="skeleton" style={{ width: '60%', height: 30, marginTop: 18 }} />
              <div className="skeleton" style={{ width: '45%', height: 12, marginTop: 12 }} />
            </div>
            <div className="panel latest-card latest-card--skeleton">
              <div className="skeleton" style={{ width: '35%', height: 12 }} />
              <div className="skeleton" style={{ width: '60%', height: 30, marginTop: 18 }} />
              <div className="skeleton" style={{ width: '45%', height: 12, marginTop: 12 }} />
            </div>
          </div>
          <div className="panel version-list-panel">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="version-row version-row--skeleton">
                <div className="skeleton" style={{ width: 110, height: 14 }} />
                <div className="skeleton" style={{ width: 70, height: 20 }} />
                <div className="skeleton" style={{ width: 90, height: 12 }} />
              </div>
            ))}
          </div>
        </div>
      ) : !versions ? (
        <div className="panel">
          <EmptyState
            icon={<Boxes />}
            title="Could not load versions"
            description={versionsError || 'Mojang’s version service is not reachable right now.'}
          >
            <Button variant="primary" icon={<RefreshCw />} onClick={() => void refreshVersions(true)}>
              Try again
            </Button>
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="latest-grid">
            {[latestRelease, latestSnapshot].filter(Boolean).map((version, index) =>
              version ? (
                <article key={version.id} className={cx('latest-card', index === 1 && 'latest-card--snapshot')}>
                  <div className="latest-card__glow" />
                  <div className="latest-card__head">
                    <Badge tone={version.type === 'snapshot' ? 'snapshot' : 'success'}>
                      {version.type === 'snapshot' ? 'Latest snapshot' : 'Latest release'}
                    </Badge>
                    {usedBy(version.id) > 0 ? <span className="latest-card__used">{usedBy(version.id)} profile{usedBy(version.id) === 1 ? '' : 's'}</span> : null}
                  </div>
                  <h2 className="latest-card__version">Minecraft {version.id}</h2>
                  <p className="latest-card__copy">
                    {version.type === 'snapshot'
                      ? 'The newest experimental build. Worlds may not be compatible with other versions.'
                      : 'The current stable release, recommended for everyday play and new worlds.'}
                  </p>
                  <div className="latest-card__meta">
                    <span>
                      <CalendarDays /> {formatDate(version.releaseTime)}
                    </span>
                    <span>{versionTypeLabel(version.type)}</span>
                  </div>
                  <div className="latest-card__actions">
                    <Button
                      size="sm"
                      variant={index === 0 ? 'primary' : 'default'}
                      icon={<Download />}
                      onClick={() => openInstall(version)}
                    >
                      Create profile
                    </Button>
                    {usedBy(version.id) > 0 ? (
                      <button type="button" className="link-button" onClick={() => navigate('installations')}>
                        Manage profiles <ArrowRight />
                      </button>
                    ) : null}
                  </div>
                </article>
              ) : null,
            )}
          </div>

          <div className="version-browser panel">
            <div className="version-browser__toolbar">
              <div className="search-input">
                <Search />
                <input
                  className="input"
                  placeholder="Search by version, e.g. 1.21.5 or 26.3"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search versions"
                />
              </div>
              <div className="segmented" role="tablist" aria-label="Version filter">
                {(
                  [
                    ['release', 'Releases'],
                    ['snapshot', 'Snapshots'],
                    ['all', 'All versions'],
                  ] as Array<[VersionFilter, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    className={filter === value ? 'is-active' : undefined}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="version-browser__count">{filtered.length.toLocaleString()} results</span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<Search />}
                title="No versions found"
                description="Try a different search term or switch the version filter."
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
            ) : (
              <>
                <div className="version-rows" role="list">
                  <div className="version-row version-row--header" role="presentation">
                    <span>Version</span>
                    <span>Type</span>
                    <span>Released</span>
                    <span>Profiles</span>
                    <span />
                  </div>
                  {visible.map((version) => (
                    <div key={version.id} className="version-row" role="listitem">
                      <div className="version-row__name">
                        <span className="version-row__icon">
                          <Boxes />
                        </span>
                        <div>
                          <span className="version-row__id">{version.id}</span>
                          {version.id === versions.latest.release ? (
                            <span className="version-row__latest">
                              <Sparkles /> Latest
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <Badge tone={versionTone(version.type)}>{versionTypeLabel(version.type)}</Badge>
                      </div>
                      <div className="version-row__date">{formatDate(version.releaseTime)}</div>
                      <div className="version-row__profiles">
                        {usedBy(version.id) > 0 ? (
                          `${usedBy(version.id)} profile${usedBy(version.id) === 1 ? '' : 's'}`
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </div>
                      <div className="version-row__actions">
                        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => openInstall(version)}>
                          Create profile
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {visible.length < filtered.length ? (
                  <div className="version-browser__more">
                    <Button
                      variant="ghost"
                      icon={versionsLoading ? <Spinner /> : <ChevronDown />}
                      onClick={() => setVisibleCount((count) => count + 80)}
                      loading={versionsLoading}
                    >
                      Show more versions ({filtered.length - visible.length} remaining)
                    </Button>
                  </div>
                ) : null}
              </>
            )}
            <div className="version-browser__footer">
              <span>Downloads are checked against Mojang’s SHA-1 hashes.</span>
            </div>
          </div>
        </>
      )}
      </>}
    </div>
  )
}
