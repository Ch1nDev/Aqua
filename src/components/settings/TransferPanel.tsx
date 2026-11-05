import { useState } from 'react'
import { ArrowLeftRight, Download, ShieldCheck, TriangleAlert, Upload } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import type { ConfigImportResult } from '../../lib/types'
import { Button, Spinner } from '../ui/primitives'

export function TransferPanel() {
  const { pushToast } = useLauncher()
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastImport, setLastImport] = useState<ConfigImportResult | null>(null)

  const exportConfig = async () => {
    setBusy('export')
    setError(null)
    try {
      const result = await api.config.exportConfig()
      if (result) {
        pushToast({
          level: 'success',
          title: 'Configuration exported',
          message: `${result.installations} profile${result.installations === 1 ? '' : 's'} and ${result.servers} server${result.servers === 1 ? '' : 's'} saved.`,
        })
      }
    } catch (cause) {
      setError(getErrorMessage(cause))
      pushToast({ level: 'error', title: 'Could not export configuration', message: getErrorMessage(cause) })
    } finally {
      setBusy(null)
    }
  }

  const importConfig = async () => {
    setBusy('import')
    setError(null)
    setLastImport(null)
    try {
      const result = await api.config.importConfig()
      if (result) {
        setLastImport(result)
        const failed = result.installations.failed + result.servers.failed
        pushToast({
          level: failed > 0 ? 'warning' : 'success',
          title: failed > 0 ? 'Configuration imported with warnings' : 'Configuration imported',
          message: `${result.installations.added} profile${result.installations.added === 1 ? '' : 's'} and ${result.servers.added} server${result.servers.added === 1 ? '' : 's'} added.`,
        })
      }
    } catch (cause) {
      setError(getErrorMessage(cause))
      pushToast({ level: 'error', title: 'Could not import configuration', message: getErrorMessage(cause) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="config-transfer">
      <div className="config-transfer__actions">
        <div className="config-transfer__action">
          <span className="config-transfer__icon">
            <Download />
          </span>
          <div>
            <strong>Export configuration</strong>
            <span>Preferences, themes, profiles and saved servers in one JSON file.</span>
          </div>
          <Button
            size="sm"
            icon={busy === 'export' ? <Spinner /> : <Download />}
            loading={busy === 'export'}
            disabled={busy !== null}
            onClick={() => void exportConfig()}
          >
            Export
          </Button>
        </div>

        <div className="config-transfer__action">
          <span className="config-transfer__icon">
            <Upload />
          </span>
          <div>
            <strong>Import configuration</strong>
            <span>Add profiles and servers from another PC, then review the summary before anything changes.</span>
          </div>
          <Button
            size="sm"
            variant="subtle"
            icon={busy === 'import' ? <Spinner /> : <Upload />}
            loading={busy === 'import'}
            disabled={busy !== null}
            onClick={() => void importConfig()}
          >
            Import
          </Button>
        </div>
      </div>

      <p className="settings-hint config-transfer__note">
        <ShieldCheck />
        <span>
          Accounts, sessions, tokens, worlds, mods, screenshots and game files are never included. Imports only add
          profiles and servers; nothing already on this PC is deleted or overwritten. Java paths, game folders,
          dashboard images, the Microsoft client ID and window position stay local. A backup of the current launcher
          configuration is written before an import is applied.
        </span>
      </p>

      {lastImport ? (
        <div className="config-transfer__summary">
          <ArrowLeftRight />
          <span>
            <strong>Last import</strong>
            {lastImport.installations.added} profiles added, {lastImport.installations.skipped} already present
            {lastImport.installations.failed ? `, ${lastImport.installations.failed} failed` : ''}.{' '}
            {lastImport.servers.added} servers added, {lastImport.servers.skipped} already present
            {lastImport.servers.failed ? `, ${lastImport.servers.failed} failed` : ''}.
          </span>
        </div>
      ) : null}

      {lastImport?.warnings.length ? (
        <div className="callout callout--warning" role="status">
          <TriangleAlert />
          <span>{lastImport.warnings.join(' ')}</span>
        </div>
      ) : null}

      {error ? (
        <div className="callout callout--danger" role="alert">
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}
