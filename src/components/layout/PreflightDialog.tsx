import { useState } from 'react'
import { AlertTriangle, FolderOpen, RefreshCw, Settings, Wrench, XCircle } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import type { PreflightRow } from '../../lib/types'
import { useLauncher } from '../../state/LauncherProvider'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

export function PreflightDialog() {
  const { preflight, confirmPreflight, cancelPreflight, installations, installGame, navigate, pushToast } = useLauncher()
  const [fixing, setFixing] = useState<string | null>(null)

  if (!preflight) return null

  const installation = installations.find((item) => item.id === preflight.result.installationId)
  const blocked = preflight.result.rows.some((row) => row.level === 'error')

  const applyAction = async (row: PreflightRow) => {
    if (!row.action) return
    const installationId = preflight.result.installationId
    if (row.action.kind === 'reinstall') {
      cancelPreflight()
      await installGame(installationId)
      return
    }
    if (row.action.kind === 'open-settings') {
      cancelPreflight()
      navigate('settings')
      return
    }
    setFixing(row.id)
    try {
      await api.health.fix(installationId, row.action.kind)
      pushToast({ level: 'info', title: 'Opened the fix' })
      cancelPreflight()
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not apply that fix', message: getErrorMessage(error) })
    } finally {
      setFixing(null)
    }
  }

  return (
    <Modal
      open
      onClose={cancelPreflight}
      title="Before you launch"
      subtitle={
        installation
          ? `${installation.name} · Minecraft ${installation.versionId}`
          : 'Aqua found a few things to check first.'
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={cancelPreflight}>
            {blocked ? 'Close' : 'Not now'}
          </Button>
          <Button variant="primary" disabled={blocked} onClick={() => void confirmPreflight()}>
            {blocked ? 'Fix a problem to launch' : 'Launch anyway'}
          </Button>
        </>
      }
    >
      <div className="join-warning">
        <p className="join-warning__hint">
          {blocked
            ? 'These problems will stop Minecraft from starting. Fix them here, then try Play again.'
            : 'Aqua can still launch, but these warnings are worth a look. They will not be shown again for this profile this session.'}
        </p>
        <div className="health-list">
          {preflight.result.rows.map((row) => (
            <div key={`${row.id}-${row.title}`} className={`health-row is-${row.level}`}>
              <span className="health-row__icon">
                {row.level === 'error' ? <XCircle /> : <AlertTriangle />}
              </span>
              <div className="health-row__copy">
                <strong>{row.title}</strong>
                <span>{row.detail}</span>
              </div>
              {row.action ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={fixing === row.id}
                  icon={
                    row.action.kind === 'reinstall' ? (
                      <RefreshCw />
                    ) : row.action.kind === 'open-settings' ? (
                      <Settings />
                    ) : row.action.kind === 'open-content' ? (
                      <Wrench />
                    ) : (
                      <FolderOpen />
                    )
                  }
                  onClick={() => void applyAction(row)}
                >
                  {row.action.label}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
