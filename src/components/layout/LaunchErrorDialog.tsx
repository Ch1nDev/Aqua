import { AlertTriangle, Coffee, FolderOpen, RefreshCw, UserRound, Wrench } from 'lucide-react'
import { api } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

export function LaunchErrorDialog() {
  const { launchError, clearLaunchError, retryLaunch, navigate, installGame, openInstallationFolder } = useLauncher()

  if (!launchError) return null
  const needsAccount = /sign in|session|account/i.test(launchError.message)
  const needsJava = /needs java|java \d+|install the java/i.test(launchError.message)
  const needsRepair = /missing|not installed|verify|corrupt/i.test(launchError.message)

  return (
    <Modal
      open
      onClose={clearLaunchError}
      title={launchError.title}
      subtitle="The launcher stopped before Minecraft could start."
      size="sm"
      footer={
        <>
          {launchError.installationId ? (
            <Button
              variant="ghost"
              icon={<FolderOpen />}
              className="modal__footer-left"
              onClick={() => {
                clearLaunchError()
                void openInstallationFolder(launchError.installationId!)
              }}
            >
              Game folder
            </Button>
          ) : null}
          <Button variant="ghost" onClick={clearLaunchError}>
            Close
          </Button>
          {needsAccount ? (
            <Button
              variant="primary"
              icon={<UserRound />}
              onClick={() => {
                clearLaunchError()
                navigate('account')
              }}
            >
              Open account
            </Button>
          ) : needsJava ? (
            <Button
              variant="primary"
              icon={<Coffee />}
              onClick={() => {
                clearLaunchError()
                navigate('settings')
              }}
            >
              Open Java settings
            </Button>
          ) : launchError.installationId ? (
            <Button
              variant="primary"
              icon={needsRepair ? <Wrench /> : <RefreshCw />}
              onClick={() => {
                if (needsRepair) {
                  const id = launchError.installationId!
                  clearLaunchError()
                  void installGame(id)
                } else {
                  void retryLaunch()
                }
              }}
            >
              {needsRepair ? 'Repair files' : 'Try again'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="launch-error">
        <div className="launch-error__icon">
          <AlertTriangle />
        </div>
        <p>{launchError.message}</p>
        {needsAccount ? (
          <p className="launch-error__hint">
            Microsoft sessions can expire after a while. Reconnect your account, then try launching again.
          </p>
        ) : needsJava ? (
          <p className="launch-error__hint">
            Settings → Java lists an official Java 8 runtime under “Official runtimes”. Install it and this profile will
            pick it up automatically.
          </p>
        ) : null}
        {launchError.installationId ? (
          <p className="launch-error__meta">
            Installation ID <span className="mono">{launchError.installationId}</span>
          </p>
        ) : null}
        {needsRepair ? (
          <p className="launch-error__hint">
            Repair verifies every downloaded file and fetches anything that is missing or damaged. Your worlds are
            never modified.
          </p>
        ) : null}
        <div className="launch-error__actions">
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderOpen />}
            onClick={() => void api.system.openFolder('logs').catch(() => {})}
          >
            Open logs folder
          </Button>
        </div>
      </div>
    </Modal>
  )
}
