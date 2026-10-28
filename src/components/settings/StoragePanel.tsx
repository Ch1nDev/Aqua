import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Info, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes, relativeTime } from '../../lib/format'
import { useLauncher } from '../../state/LauncherProvider'
import type { StorageCleanResult, StorageScan } from '../../lib/types'
import { Badge, Button, Checkbox, IconButton } from '../ui/primitives'
import { Modal } from '../ui/overlays'

/** Categories that map onto a folder the shell can open. */
const FOLDER_KINDS: Record<string, 'data' | 'instances' | 'logs' | 'versions' | 'assets' | 'backups' | 'bedrock'> = {
  instances: 'instances',
  versions: 'versions',
  assets: 'assets',
  backups: 'backups',
  'game-logs': 'logs',
  'launcher-logs': 'logs',
  caches: 'data',
  bedrock: 'bedrock',
}

/**
 * One accent ramp for the stacked bar and the matching row dots, so the chart and
 * the list always agree. Kept as CSS colour-mix so every theme and accent flows
 * through instead of a hard-coded palette.
 */
function segmentColor(index: number): string {
  return `color-mix(in oklab, var(--accent) ${Math.max(16, 96 - index * 10)}%, var(--panel-3))`
}

function Explain({ label }: { label: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={label}>
      <Info />
      <span className="info-tip__bubble" role="tooltip">
        {label}
      </span>
    </span>
  )
}

export function StoragePanel() {
  const { pushToast, storageProgress } = useLauncher()
  const [scan, setScan] = useState<StorageScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cleaning, setCleaning] = useState(false)
  const [lastResult, setLastResult] = useState<StorageCleanResult | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const requested = useRef(false)

  const runScan = async (force: boolean) => {
    setScanning(true)
    setError(null)
    try {
      setScan(await api.storage.scan({ force }))
    } catch (scanError) {
      setError(getErrorMessage(scanError))
    } finally {
      setScanning(false)
    }
  }

  // Scan the first time the section scrolls into view. Opening Settings should not
  // walk tens of thousands of files for a panel nobody looked at.
  useEffect(() => {
    const element = rootRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      if (!requested.current) {
        requested.current = true
        void runScan(false)
      }
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || requested.current) return
        requested.current = true
        observer.disconnect()
        void runScan(false)
      },
      { threshold: 0.15 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const candidates = scan?.candidates || []
  const reclaimable = useMemo(
    () => candidates.reduce((sum, candidate) => sum + candidate.bytes, 0),
    [candidates],
  )
  const largest = useMemo(
    () => (scan?.categories || []).reduce((max, category) => Math.max(max, category.bytes), 1),
    [scan],
  )

  const openCleanup = () => {
    setSelected(new Set(candidates.filter((candidate) => candidate.safeByDefault).map((candidate) => candidate.id)))
    setDialogOpen(true)
  }

  const selectedBytes = useMemo(
    () =>
      candidates
        .filter((candidate) => selected.has(candidate.id))
        .reduce((sum, candidate) => sum + candidate.bytes, 0),
    [candidates, selected],
  )

  const runCleanup = async () => {
    if (!selected.size) return
    setCleaning(true)
    try {
      const result = await api.storage.clean([...selected])
      setLastResult(result)
      setDialogOpen(false)
      if (result.failed.length) {
        pushToast({
          level: 'warning',
          title: 'Some items were left alone',
          message: `${formatBytes(result.freedBytes)} reclaimed · ${result.failed.length} skipped. ${result.failed[0].error}`,
        })
      } else if (!result.removed.length) {
        pushToast({
          level: 'info',
          title: 'Nothing left to remove',
          message: 'Those items were already gone. The numbers below are up to date.',
        })
      } else {
        pushToast({
          level: 'success',
          title: 'Storage cleaned up',
          message: `${formatBytes(result.freedBytes)} moved to the Recycle Bin.`,
        })
      }
      await runScan(true)
    } catch (cleanError) {
      pushToast({ level: 'error', title: 'Could not clean up storage', message: getErrorMessage(cleanError) })
    } finally {
      setCleaning(false)
    }
  }

  const barLabel = scan
    ? scan.categories
        .filter((category) => category.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .map((category) => `${category.label} ${formatBytes(category.bytes)}`)
        .join(', ')
    : ''

  return (
    <div className="storage-panel" ref={rootRef}>
      <div className="storage-head">
        <div className="storage-total">
          <span className="storage-total__value">{scan ? formatBytes(scan.totalBytes) : '—'}</span>
          <span className="storage-total__meta">
            {scan
              ? `${scan.files.toLocaleString()} files · scanned ${relativeTime(scan.scannedAt).toLowerCase()}`
              : scanning
                ? 'Measuring folders…'
                : 'Not measured yet'}
          </span>
        </div>
        <div className="storage-actions">
          {scanning ? (
            <Button size="sm" onClick={() => void api.storage.cancel()}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" icon={<RefreshCw />} onClick={() => void runScan(true)}>
              {scan ? 'Scan again' : 'Scan storage'}
            </Button>
          )}
        </div>
      </div>

      {scanning ? (
        <p className="storage-progress" role="status">
          Reading {storageProgress?.phase === 'scan' && storageProgress.label ? storageProgress.label : 'folders'}…
        </p>
      ) : null}

      {error ? (
        <div className="callout callout--danger" role="alert">
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}

      {scan?.cancelled ? (
        <div className="callout callout--warning">
          <TriangleAlert />
          <span>The scan was cancelled, so these numbers are partial. Scan again to get the full picture.</span>
        </div>
      ) : null}

      {scan && !scan.cancelled && scan.totalBytes === 0 ? (
        <p className="storage-empty">Nothing has been downloaded yet, so there is nothing to measure.</p>
      ) : null}

      {scan && scan.totalBytes > 0 ? (
        <>
          <div className="storage-bar" role="img" aria-label={`Disk usage by category: ${barLabel}`}>
            {scan.categories.map((category, index) =>
              category.bytes > 0 ? (
                <span
                  key={category.id}
                  className="storage-bar__seg"
                  style={{ flexGrow: category.bytes / scan.totalBytes, background: segmentColor(index) }}
                />
              ) : null,
            )}
          </div>

          <ul className="storage-list">
            {scan.categories.map((category, index) => (
              <li className="storage-row" key={category.id}>
                <span className="storage-row__dot" style={{ background: segmentColor(index) }} aria-hidden="true" />
                <span className="storage-row__label">
                  {category.label}
                  <Explain label={category.explanation} />
                </span>
                <span
                  className="storage-row__meter"
                  aria-hidden="true"
                  style={{ width: `${Math.max(2, (category.bytes / largest) * 100)}%` }}
                />
                <span className="storage-row__size">
                  {formatBytes(category.bytes)}
                  <small>{category.files.toLocaleString()} files</small>
                </span>
                {FOLDER_KINDS[category.id] ? (
                  <IconButton
                    size="sm"
                    label={`Open the ${category.label.toLowerCase()} folder`}
                    onClick={() =>
                      void api.system
                        .openFolder(FOLDER_KINDS[category.id])
                        .catch((folderError) => setError(getErrorMessage(folderError)))
                    }
                  >
                    <FolderOpen />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>

          {scan.truncated ? (
            <p className="settings-hint">
              This scan stopped after {scan.categories.length ? 'its file limit' : 'a limit'} — the folders are unusually
              large. The numbers shown are a lower bound.
            </p>
          ) : null}
          {scan.unreadable > 0 ? (
            <p className="settings-hint">
              {scan.unreadable} folder{scan.unreadable === 1 ? '' : 's'} could not be read — probably in use by another
              program.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="settings-divider" />

      <div className="storage-cleanup">
        <div className="storage-cleanup__copy">
          <span className="storage-cleanup__title">
            Reclaim space
            <Explain label="Caches, old logs and unused versions. Worlds, mods, resource packs and configs are never touched." />
          </span>
          <span className="storage-cleanup__meta">
            {scan
              ? candidates.length
                ? `${formatBytes(reclaimable)} could be freed from ${candidates.length} item${candidates.length === 1 ? '' : 's'}.`
                : 'Caches and logs are already tidy.'
              : 'Scan storage to see what can be freed.'}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!candidates.length || scanning}
          onClick={openCleanup}
        >
          Review cleanup
        </Button>
      </div>

      {lastResult?.failed.length ? (
        <div className="callout callout--warning">
          <TriangleAlert />
          <span>
            {lastResult.failed.length} item{lastResult.failed.length === 1 ? '' : 's'} stayed in place: {lastResult.failed[0].error}
          </span>
        </div>
      ) : null}

      <p className="settings-hint storage-note">
        <ShieldCheck />
        Cleanup only moves files to the Recycle Bin, so a mistake can be undone from there.
      </p>

      <Modal
        open={dialogOpen}
        onClose={() => (cleaning ? undefined : setDialogOpen(false))}
        title="Reclaim space"
        subtitle="Pick what to clear. Every item below is rebuilt on demand or is old enough to be safe."
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)} disabled={cleaning}>
              Cancel
            </Button>
            <Button variant="primary" loading={cleaning} disabled={!selected.size} onClick={() => void runCleanup()}>
              Move {formatBytes(selectedBytes)} to Recycle Bin
            </Button>
          </>
        }
      >
        <div className="storage-clean-list">
          {candidates.map((candidate) => (
            <div className="storage-clean-item" key={candidate.id}>
              <Checkbox
                checked={selected.has(candidate.id)}
                onChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (checked) next.add(candidate.id)
                    else next.delete(candidate.id)
                    return next
                  })
                }
              >
                <span className="storage-clean-item__title">{candidate.label}</span>
              </Checkbox>
              <div className="storage-clean-item__meta">
                {formatBytes(candidate.bytes)} · {candidate.files} {candidate.files === 1 ? 'item' : 'items'}
                {candidate.safeByDefault ? null : <Badge tone="warning">Kept by default</Badge>}
              </div>
              <p className="storage-clean-item__reason">{candidate.reason}</p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
