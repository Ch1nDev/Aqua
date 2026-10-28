import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Download, FolderOpen, Layers, Package, RotateCw, Search, Server } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatDate, versionTypeLabel } from '../../lib/format'
import { useLauncher } from '../../state/LauncherProvider'
import type { LoaderType, LoaderVersion, VersionEntry } from '../../lib/types'
import { LOADER_OPTIONS } from '../../lib/loaders'
import { Badge, Button, Checkbox, Field, Spinner, Switch, cx } from '../ui/primitives'
import { Modal } from '../ui/overlays'

type VersionFilter = 'release' | 'snapshot' | 'all'

export function InstallationDialog() {
  const {
    installDialog,
    closeInstallDialog,
    versions,
    versionsError,
    versionsLoading,
    refreshVersions,
    settings,
    javas,
    data,
    createInstallation,
    updateInstallation,
    installGame,
  } = useLauncher()

  const isOpen = Boolean(installDialog)
  const isEdit = installDialog?.mode === 'edit'
  const existing = installDialog?.installation
  const [name, setName] = useState('')
  const [versionId, setVersionId] = useState('')
  const [gameDir, setGameDir] = useState('')
  const [versionSearch, setVersionSearch] = useState('')
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('release')
  const [loaderType, setLoaderType] = useState<LoaderType>('vanilla')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false)
  const [loaderVersionsError, setLoaderVersionsError] = useState<string | null>(null)
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [javaPath, setJavaPath] = useState('')
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [minMemory, setMinMemory] = useState(settings?.memory.minMb || 1024)
  const [maxMemory, setMaxMemory] = useState(settings?.memory.maxMb || 4096)
  const [windowEnabled, setWindowEnabled] = useState(false)
  const [width, setWidth] = useState(settings?.window.width || 1280)
  const [height, setHeight] = useState(settings?.window.height || 720)
  const [fullscreen, setFullscreen] = useState(false)
  const [jvmArgs, setJvmArgs] = useState('')
  const [gameArgs, setGameArgs] = useState('')
  const [installNow, setInstallNow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const nameSeeded = useRef(false)

  useEffect(() => {
    if (!installDialog) return
    setName(existing?.name || '')
    setVersionId(existing?.versionId || installDialog.versionId || '')
    setGameDir(existing?.gameDir || '')
    setVersionSearch('')
    setLoaderType(existing?.loader?.type || 'vanilla')
    setLoaderVersion(existing?.loader?.version || '')
    setLoaderVersions([])
    setLoaderVersionsError(null)
    setVersionFilter(existing?.versionType === 'snapshot' ? 'snapshot' : 'release')
    setShowAllVersions(false)
    setAdvancedOpen(
      Boolean(existing?.javaPath || existing?.memoryOverride || existing?.windowOverride || existing?.jvmArgsOverride || existing?.gameArgsOverride),
    )
    setJavaPath(existing?.javaPath || '')
    setMemoryEnabled(Boolean(existing?.memoryOverride))
    setMinMemory(existing?.memoryOverride?.minMb ?? settings?.memory.minMb ?? 1024)
    setMaxMemory(existing?.memoryOverride?.maxMb ?? settings?.memory.maxMb ?? 4096)
    setWindowEnabled(Boolean(existing?.windowOverride))
    setWidth(existing?.windowOverride?.width ?? settings?.window.width ?? 1280)
    setHeight(existing?.windowOverride?.height ?? settings?.window.height ?? 720)
    setFullscreen(existing?.windowOverride?.fullscreen ?? false)
    setJvmArgs(existing?.jvmArgsOverride || '')
    setGameArgs(existing?.gameArgsOverride || '')
    setInstallNow(!existing)
    setError(null)
    setNameTouched(false)
    nameSeeded.current = Boolean(existing)
  }, [installDialog])

  useEffect(() => {
    if (!isOpen || loaderType === 'vanilla' || !versionId) {
      setLoaderVersions([])
      return
    }
    let cancelled = false
    setLoaderVersionsLoading(true)
    setLoaderVersionsError(null)
    api.loaders
      .versions(loaderType, versionId)
      .then((versions) => {
        if (cancelled) return
        setLoaderVersions(versions)
        setLoaderVersion((current) =>
          versions.some((entry) => entry.version === current) ? current : versions[0]?.version || '',
        )
      })
      .catch((loadError) => {
        if (!cancelled) setLoaderVersionsError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoaderVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, loaderType, versionId])

  useEffect(() => {
    if (!isOpen || isEdit || nameSeeded.current) return
    const fallback = versionId || versions?.latest.release
    if (!fallback) return
    setVersionId((current) => current || fallback)
    setName(`Minecraft ${fallback}`)
    nameSeeded.current = true
  }, [isOpen, isEdit, versionId, versions])

  const filteredVersions = useMemo(() => {
    if (!versions) return []
    const query = versionSearch.trim().toLowerCase()
    return versions.versions.filter((version) => {
      if (versionFilter !== 'all' && version.type !== versionFilter) return false
      if (!query) return true
      return version.id.toLowerCase().includes(query) || version.type.includes(query)
    })
  }, [versions, versionFilter, versionSearch])

  const visibleVersions = showAllVersions ? filteredVersions.slice(0, 260) : filteredVersions.slice(0, 24)
  const selectedVersion: VersionEntry | null =
    versions?.versions.find((version) => version.id === versionId) || null
  const totalMemory = data?.system.totalMemMb || 8192

  const chooseDirectory = async () => {
    try {
      const chosen = await api.dialogs.chooseDirectory({
        title: 'Choose a Minecraft game directory',
        defaultPath: gameDir || settings?.defaultGameDir,
      })
      if (chosen) setGameDir(chosen)
    } catch (chooseError) {
      setError(getErrorMessage(chooseError))
    }
  }

  const chooseJava = async () => {
    try {
      const chosen = await api.dialogs.chooseJava()
      if (!chosen) return
      const info = await api.java.validate(chosen)
      setJavaPath(info.path)
      setError(null)
    } catch (javaError) {
      setError(getErrorMessage(javaError))
    }
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Give this installation a name.'
    if (name.trim().length > 48) return 'The installation name must be 48 characters or fewer.'
    if (!versionId) return 'Choose a Minecraft version.'
    if (!versions?.versions.some((version) => version.id === versionId)) return 'Choose a version from the list.'
    if (loaderType !== 'vanilla' && !loaderVersion) return 'Choose a mod loader version.'
    if (gameDir.trim() && !/^[A-Za-z]:[\\/]|^\\\\|^\//.test(gameDir.trim())) return 'Choose a valid absolute folder path.'
    if (memoryEnabled) {
      if (!Number.isFinite(minMemory) || minMemory < 512) return 'Minimum memory must be at least 512 MB.'
      if (!Number.isFinite(maxMemory) || maxMemory < 1024) return 'Maximum memory must be at least 1024 MB.'
      if (minMemory > maxMemory) return 'Minimum memory cannot be greater than maximum memory.'
      if (maxMemory > totalMemory) return `Maximum memory cannot exceed the ${Math.round(totalMemory / 1024)} GB installed.`
    }
    if (windowEnabled) {
      if (!Number.isInteger(width) || width < 320 || width > 7680) return 'Window width must be between 320 and 7680.'
      if (!Number.isInteger(height) || height < 240 || height > 4320) return 'Window height must be between 240 and 4320.'
    }
    return null
  }

  const handleSubmit = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const loader = { type: loaderType, version: loaderType === 'vanilla' ? null : loaderVersion }
      const overrides = {
        javaPath: javaPath.trim() || null,
        memory: memoryEnabled ? { minMb: Math.round(minMemory), maxMb: Math.round(maxMemory) } : null,
        window: windowEnabled
          ? { width: Math.round(width), height: Math.round(height), fullscreen }
          : null,
        jvmArgs: jvmArgs.trim() || null,
        gameArgs: gameArgs.trim() || null,
      }
      let installation
      if (isEdit && existing) {
        const patch: Record<string, unknown> = {
          name: name.trim(),
          versionId,
          loader,
          ...overrides,
        }
        if (gameDir.trim() && gameDir.trim() !== existing.gameDir) patch.gameDir = gameDir.trim()
        installation = await updateInstallation(existing.id, patch)
      } else {
        installation = await createInstallation({
          name: name.trim(),
          versionId,
          loader,
          ...(gameDir.trim() ? { gameDir: gameDir.trim() } : {}),
          ...overrides,
        })
      }
      closeInstallDialog()
      if (installNow) void installGame(installation.id)
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <Modal
      open={isOpen}
      onClose={() => (saving ? undefined : closeInstallDialog())}
      title={isEdit ? 'Edit installation' : 'New installation'}
      subtitle={
        isEdit
          ? 'Settings apply to this profile. Your worlds and game folder are never deleted.'
          : 'Choose a version, then download only the files you need.'
      }
      size="xl"
      footer={
        <>
          <Checkbox checked={installNow} onChange={setInstallNow} disabled={saving}>
            Download game files after {isEdit ? 'saving' : 'creating'}
          </Checkbox>
          <Button variant="ghost" onClick={closeInstallDialog} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            loading={saving}
            icon={isEdit ? <Check /> : <Layers />}
          >
            {isEdit ? 'Save changes' : 'Create installation'}
          </Button>
        </>
      }
    >
      <div className="install-dialog">
        {error ? (
          <div className="callout callout--danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="install-dialog__top">
          <Field label="Installation name" htmlFor="installation-name">
            <input
              id="installation-name"
              className="input"
              value={name}
              maxLength={48}
              placeholder="My Minecraft installation"
              onChange={(event) => {
                setName(event.target.value)
                setNameTouched(true)
              }}
              data-autofocus
            />
          </Field>
          <Field
            label="Game directory"
            htmlFor="installation-directory"
            hint="Leave blank to use a separate, managed folder."
          >
            <div className="input-row">
              <input
                id="installation-directory"
                className="input input--mono"
                value={gameDir}
                placeholder="Automatic — recommended"
                onChange={(event) => setGameDir(event.target.value)}
                spellCheck={false}
              />
              <Button icon={<FolderOpen />} onClick={() => void chooseDirectory()}>
                Browse
              </Button>
            </div>
          </Field>
        </div>

        <div className="install-dialog__versions">
          <div className="install-dialog__section-title">
            <div>
              <h3>Minecraft version</h3>
              <p>Choose the exact release or snapshot for this profile.</p>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void refreshVersions(true)}
              aria-label="Refresh available versions"
              title="Refresh version list"
            >
              <RotateCw className={versionsLoading ? 'spin' : undefined} />
            </button>
          </div>

          <div className="version-picker">
            <div className="version-picker__toolbar">
              <div className="search-input">
                <Search />
                <input
                  className="input"
                  placeholder="Search versions…"
                  value={versionSearch}
                  onChange={(event) => {
                    setVersionSearch(event.target.value)
                    setShowAllVersions(false)
                  }}
                  aria-label="Search Minecraft versions"
                />
              </div>
              <div className="segmented" role="tablist" aria-label="Version type">
                {(['release', 'snapshot', 'all'] as VersionFilter[]).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    role="tab"
                    aria-selected={versionFilter === filter}
                    className={versionFilter === filter ? 'is-active' : undefined}
                    onClick={() => {
                      setVersionFilter(filter)
                      setShowAllVersions(false)
                    }}
                  >
                    {filter === 'all' ? 'All' : filter === 'release' ? 'Releases' : 'Snapshots'}
                  </button>
                ))}
              </div>
            </div>

            {!versions && versionsLoading ? (
              <div className="version-picker__loading">
                <Spinner /> Loading versions from Mojang…
              </div>
            ) : versionsError && !versions ? (
              <div className="callout callout--danger">
                {versionsError}
                <button type="button" className="link-button" onClick={() => void refreshVersions(true)}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="version-list" role="listbox" aria-label="Minecraft versions">
                  {visibleVersions.length === 0 ? (
                    <div className="version-list__empty">No versions match this filter.</div>
                  ) : (
                    visibleVersions.map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        role="option"
                        aria-selected={version.id === versionId}
                        className={cx('version-option', version.id === versionId && 'is-selected')}
                        onClick={() => {
                          setVersionId(version.id)
                          if (!nameTouched && !isEdit) setName(`Minecraft ${version.id}`)
                        }}
                      >
                        <span className={cx('version-option__indicator', version.id === versionId && 'is-on')}>
                          {version.id === versionId ? <Check /> : null}
                        </span>
                        <span className="version-option__id">{version.id}</span>
                        <Badge
                          tone={
                            version.type === 'snapshot'
                              ? 'snapshot'
                              : version.type === 'old_beta'
                                ? 'beta'
                                : version.type === 'old_alpha'
                                  ? 'alpha'
                                  : 'default'
                          }
                        >
                          {versionTypeLabel(version.type)}
                        </Badge>
                        <span className="version-option__date">{formatDate(version.releaseTime)}</span>
                      </button>
                    ))
                  )}
                </div>
                {filteredVersions.length > visibleVersions.length ? (
                  <button type="button" className="load-more-button" onClick={() => setShowAllVersions(true)}>
                    Show more versions <ChevronDown />
                  </button>
                ) : null}
              </>
            )}
            {selectedVersion ? (
              <div className="version-picker__selection">
                <Server />
                <span>
                  Selected <strong>{selectedVersion.id}</strong> · {versionTypeLabel(selectedVersion.type)} ·{' '}
                  {formatDate(selectedVersion.releaseTime)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="install-dialog__loader">
          <div className="install-dialog__section-title">
            <div>
              <h3>Mod loader</h3>
              <p>Fabric, Quilt, Forge, and NeoForge profiles can run Modrinth mods.</p>
            </div>
            {loaderType !== 'vanilla' ? <Package className="install-dialog__loader-icon" /> : null}
          </div>
          <div className="loader-row">
            <div className="loader-choices" role="radiogroup" aria-label="Mod loader">
              {LOADER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={loaderType === option.id}
                  className={cx('loader-choice', loaderType === option.id && 'is-selected')}
                  onClick={() => setLoaderType(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {loaderType !== 'vanilla' ? (
              <div className="select-wrap loader-version">
                <select
                  className="select"
                  value={loaderVersion}
                  onChange={(event) => setLoaderVersion(event.target.value)}
                  disabled={loaderVersionsLoading || loaderVersions.length === 0}
                  aria-label="Mod loader version"
                >
                  {loaderVersionsLoading ? <option value="">Loading versions…</option> : null}
                  {!loaderVersionsLoading && loaderVersions.length === 0 ? (
                    <option value="">No builds for {versionId || 'this version'}</option>
                  ) : null}
                  {loaderVersions.map((entry) => (
                    <option key={entry.version} value={entry.version}>
                      {entry.version}
                      {entry.stable ? ' · stable' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown />
              </div>
            ) : null}
          </div>
          {loaderVersionsError ? (
            <div className="callout callout--danger">{loaderVersionsError}</div>
          ) : null}
          {isEdit &&
          existing &&
          ((existing.loader?.type || 'vanilla') !== loaderType || (existing.loader?.version || '') !== loaderVersion) ? (
            <p className="install-dialog__loader-note">
              Changing the loader needs a fresh download of the profile. Worlds and saves stay untouched.
            </p>
          ) : null}
        </div>

        <div className="install-advanced">
          <button
            type="button"
            className="install-advanced__toggle"
            onClick={() => setAdvancedOpen((value) => !value)}
            aria-expanded={advancedOpen}
          >
            <span>
              <strong>Advanced overrides</strong>
              <span>Memory, Java, window size and custom arguments</span>
            </span>
            <ChevronDown className={advancedOpen ? 'rotate-180' : undefined} />
          </button>
          {advancedOpen ? (
            <div className="install-advanced__body">
              <div className="override-row">
                <div className="override-row__copy">
                  <div className="override-row__title">
                    <span>Custom memory</span>
                    <Switch
                      checked={memoryEnabled}
                      onChange={setMemoryEnabled}
                      label="Use custom memory for this installation"
                    />
                  </div>
                  <p>Override the launcher-wide RAM allocation for this profile.</p>
                </div>
                <div className={cx('override-row__fields', !memoryEnabled && 'is-disabled')}>
                  <label>
                    Min MB
                    <input
                      className="input"
                      type="number"
                      min={512}
                      max={totalMemory}
                      step={512}
                      value={minMemory}
                      onChange={(event) => setMinMemory(Number(event.target.value))}
                      disabled={!memoryEnabled}
                    />
                  </label>
                  <label>
                    Max MB
                    <input
                      className="input"
                      type="number"
                      min={1024}
                      max={totalMemory}
                      step={512}
                      value={maxMemory}
                      onChange={(event) => setMaxMemory(Number(event.target.value))}
                      disabled={!memoryEnabled}
                    />
                  </label>
                </div>
              </div>

              <div className="override-row">
                <div className="override-row__copy">
                  <div className="override-row__title">
                    <span>Custom window</span>
                    <Switch
                      checked={windowEnabled}
                      onChange={setWindowEnabled}
                      label="Use a custom game window for this installation"
                    />
                  </div>
                  <p>Choose a custom starting resolution or launch in fullscreen.</p>
                </div>
                <div className={cx('override-row__fields', !windowEnabled && 'is-disabled')}>
                  <label>
                    Width
                    <input
                      className="input"
                      type="number"
                      min={320}
                      max={7680}
                      step={1}
                      value={width}
                      onChange={(event) => setWidth(Number(event.target.value))}
                      disabled={!windowEnabled}
                    />
                  </label>
                  <label>
                    Height
                    <input
                      className="input"
                      type="number"
                      min={240}
                      max={4320}
                      step={1}
                      value={height}
                      onChange={(event) => setHeight(Number(event.target.value))}
                      disabled={!windowEnabled}
                    />
                  </label>
                  <label className="override-row__check">
                    <Switch checked={fullscreen} onChange={setFullscreen} label="Start in fullscreen" disabled={!windowEnabled} />
                    Fullscreen
                  </label>
                </div>
              </div>

              <Field
                label="Java executable"
                hint="Leave blank to detect a compatible runtime automatically."
              >
                <div className="input-row">
                  <input
                    className="input input--mono"
                    value={javaPath}
                    onChange={(event) => setJavaPath(event.target.value)}
                    placeholder={javas[0] ? `Automatic — e.g. Java ${javas[0].major}` : 'Automatic detection'}
                    spellCheck={false}
                  />
                  <Button icon={<FolderOpen />} onClick={() => void chooseJava()}>
                    Choose
                  </Button>
                </div>
              </Field>

              <div className="install-dialog__args">
                <Field label="JVM arguments" hint="Appended after the launcher’s JVM arguments. Leave blank for defaults.">
                  <textarea
                    className="textarea textarea--mono"
                    value={jvmArgs}
                    onChange={(event) => setJvmArgs(event.target.value)}
                    placeholder="-XX:+UseG1GC"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Game arguments" hint="Additional arguments passed to Minecraft.">
                  <textarea
                    className="textarea textarea--mono"
                    value={gameArgs}
                    onChange={(event) => setGameArgs(event.target.value)}
                    placeholder="Additional game arguments"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </div>
          ) : null}
        </div>

        <div className="install-dialog__note">
          <Download />
          <span>
            Downloads are verified with SHA-1 checks and can resume after an interruption. Worlds are stored in the
            game directory and are never deleted by this launcher.
          </span>
        </div>
      </div>
    </Modal>
  )
}
