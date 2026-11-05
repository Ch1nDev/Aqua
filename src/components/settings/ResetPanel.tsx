import { useState } from 'react'
import { Download, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import type { ResetCategory, ResetPreview } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { ConfirmDialog } from '../ui/overlays'
import { Button, Spinner } from '../ui/primitives'

function categoryValue(category: ResetCategory) {
  if (category.id === 'settings') return 'Defaults'
  if (category.id === 'caches' || category.id === 'logs') {
    return `${formatBytes(category.bytes)} · ${category.files} file${category.files === 1 ? '' : 's'}`
  }
  const count = category.count ?? 0
  if (category.id === 'history') return `${count} record${count === 1 ? '' : 's'}`
  return `${count} ${category.id === 'profiles' ? 'profile' : 'server'}${count === 1 ? '' : 's'}`
}

export function ResetPanel() {
  const { pushToast } = useLauncher()
  const [preview, setPreview] = useState<ResetPreview | null>(null)
  const [confirmWord, setConfirmWord] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'export' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const review = async () => {
    setBusy('preview')
    setError(null)
    setConfirmWord('')
    try {
      setPreview(await api.reset.preview())
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const exportFirst = async () => {
    setBusy('export')
    setError(null)
    try {
      const result = await api.config.exportConfig()
      if (result) {
        pushToast({
          level: 'success',
          title: 'Configuration exported',
          message: `${result.installations} profile${result.installations === 1 ? '' : 's'} and ${result.servers} server${result.servers === 1 ? '' : 's'} saved outside the reset scope.`,
        })
      }
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    setPreview(null)
    setConfirmWord('')
    setError(null)
    try {
      await api.reset.cancel()
    } catch {
      // The preview is already gone locally; a stale token cannot be applied.
    }
  }

  const apply = async () => {
    if (!preview) return
    setDialogOpen(false)
    setBusy('apply')
    setError(null)
    try {
      const result = await api.reset.apply(preview.token, preview.confirmationWord)
      const warnings = result.warnings.length
      pushToast({
        level: warnings ? 'warning' : 'success',
        title: 'Launcher reset to defaults',
        message: `${formatBytes(result.removed.bytes)} of caches and logs cleared. Accounts and game files were kept.${
          warnings ? ` ${warnings} cleanup warning${warnings === 1 ? '' : 's'} saved to the launcher log.` : ''
        } Reloading to first-run setup.`,
      })
      setPreview(null)
      setConfirmWord('')
      // A clean renderer reload is deliberate: it drops every cached page and
      // form value, then bootstrap opens first-run setup from the new defaults.
      window.setTimeout(() => window.location.reload(), 700)
    } catch (cause) {
      setError(getErrorMessage(cause))
      setBusy(null)
    }
  }

  const blocked = Boolean(preview?.blockedReason)

  return (
    <div className="reset-panel">
      <div className="reset-panel__action">
        <span className="reset-panel__icon">
          <RotateCcw />
        </span>
        <div>
          <strong>Reset launcher data</strong>
          <span>
            Return Aqua to first-run settings while keeping accounts, worlds, mods, backups and exports.
          </span>
        </div>
        <Button
          size="sm"
          variant="subtle"
          icon={busy === 'preview' ? <Spinner /> : <RotateCcw />}
          loading={busy === 'preview'}
          disabled={busy !== null || Boolean(preview)}
          onClick={() => void review()}
        >
          Review reset
        </Button>
      </div>

      {error ? (
        <div className="callout callout--danger" role="alert">
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}

      {preview ? (
        <div className="reset-panel__review">
          <div className="reset-panel__review-head">
            <strong>This reset will clear</strong>
            <span>
              {formatBytes(preview.totalBytes)} in {preview.totalFiles} cache/log file
              {preview.totalFiles === 1 ? '' : 's'}
            </span>
          </div>

          <ul className="reset-panel__list">
            {preview.categories.map((category) => (
              <li key={category.id}>
                <div>
                  <strong>{category.label}</strong>
                  <span>{category.description}</span>
                </div>
                <span>{categoryValue(category)}</span>
              </li>
            ))}
          </ul>

          <div className="reset-panel__preserved">
            <ShieldCheck />
            <div>
              <strong>Kept on this PC</strong>
              <span>
                {preview.preserved.join(' · ')}. {preview.accountsPreserved} account
                {preview.accountsPreserved === 1 ? '' : 's'} stay signed in.
              </span>
            </div>
          </div>

          {preview.skippedLinks ? (
            <p className="settings-hint reset-panel__hint">
              {preview.skippedLinks} linked entr{preview.skippedLinks === 1 ? 'y was' : 'ies were'} skipped while
              counting. Reset removes links without following them outside the launcher folder.
            </p>
          ) : null}
          {preview.truncated ? (
            <p className="settings-hint reset-panel__hint">
              The cache is very large; the size shown is a lower bound. Reset still clears every safe entry.
            </p>
          ) : null}

          {preview.blockedReason ? (
            <div className="callout callout--danger" role="alert">
              <TriangleAlert />
              <span>{preview.blockedReason}</span>
            </div>
          ) : null}

          <div className="reset-panel__export">
            <div>
              <strong>Export first</strong>
              <span>Save portable settings, profiles and servers outside the folders being cleared.</span>
            </div>
            <Button
              size="sm"
              variant="subtle"
              icon={busy === 'export' ? <Spinner /> : <Download />}
              loading={busy === 'export'}
              disabled={busy !== null}
              onClick={() => void exportFirst()}
            >
              Export
            </Button>
          </div>

          <label className="reset-panel__confirm">
            <span>
              Type <strong>{preview.confirmationWord}</strong> to confirm
            </span>
            <input
              className="input"
              value={confirmWord}
              onChange={(event) => setConfirmWord(event.target.value)}
              placeholder={preview.confirmationWord}
              autoComplete="off"
              spellCheck={false}
              disabled={busy !== null || blocked}
            />
          </label>

          <div className="reset-panel__actions">
            <Button variant="ghost" disabled={busy !== null} onClick={() => void cancel()}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy !== null || blocked || confirmWord !== preview.confirmationWord}
              onClick={() => setDialogOpen(true)}
            >
              Reset launcher data
            </Button>
          </div>

          <p className="settings-hint reset-panel__hint">
            A copy of the current launcher config will be saved to {preview.backupPath} before anything changes.
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={dialogOpen}
        title="Reset launcher data?"
        description="Aqua will return to first-run settings and clear owned caches and logs. This cannot be undone, but the pre-reset config backup remains on this PC."
        confirmLabel="Reset launcher data"
        loading={busy === 'apply'}
        onConfirm={() => void apply()}
        onCancel={() => setDialogOpen(false)}
      >
        <p className="settings-hint">
          Accounts and encrypted tokens stay signed in. Worlds, mods, backups, exported files and game folders are
          never touched.
        </p>
      </ConfirmDialog>
    </div>
  )
}
