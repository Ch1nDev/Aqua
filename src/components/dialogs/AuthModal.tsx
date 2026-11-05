import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  WifiOff,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import { Button, Field, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

type AuthMode = 'microsoft' | 'offline'

/**
 * Account sign-in. Microsoft is the default path: the approved Azure
 * credentials live in the main process (private/microsoft.json), so there is
 * nothing to configure here. Holding Shift turns the primary action into
 * "Make an offline account" for local-only profiles.
 */
export function AuthModal() {
  const {
    authOpen,
    authInitialMode,
    closeAuth,
    auth,
    beginAuth,
    signInOffline,
    cancelAuth,
    accounts,
    authPhase,
  } = useLauncher()
  const [mode, setMode] = useState<AuthMode>('microsoft')
  const [shiftHeld, setShiftHeld] = useState(false)
  const [offlineName, setOfflineName] = useState('')
  const [starting, setStarting] = useState(false)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offlineError, setOfflineError] = useState<string | null>(null)

  const waiting = authPhase === 'waiting'
  const finalizing = authPhase === 'finalizing'
  const success = authPhase === 'success'
  const busy = waiting || finalizing

  useEffect(() => {
    if (!authOpen) {
      setShiftHeld(false)
      return
    }
    setMode(authInitialMode === 'offline' ? 'offline' : 'microsoft')
    setShiftHeld(false)
    setError(null)
    setOfflineError(null)
    setStarting(false)
    setOfflineBusy(false)
    setOfflineName(accounts?.accounts.find((account) => account.type === 'offline')?.name || '')
  }, [authOpen, authInitialMode, accounts])

  useEffect(() => {
    if (!authOpen || busy || success) {
      setShiftHeld(false)
      return
    }
    const trackShift = (event: KeyboardEvent) => setShiftHeld(event.shiftKey)
    const clearShift = () => setShiftHeld(false)
    window.addEventListener('keydown', trackShift, true)
    window.addEventListener('keyup', trackShift, true)
    window.addEventListener('blur', clearShift)
    return () => {
      window.removeEventListener('keydown', trackShift, true)
      window.removeEventListener('keyup', trackShift, true)
      window.removeEventListener('blur', clearShift)
    }
  }, [authOpen, busy, success])

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    try {
      await beginAuth()
    } catch (startError) {
      setError(getErrorMessage(startError))
    } finally {
      setStarting(false)
    }
  }

  const handleOffline = async () => {
    const name = offlineName.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setOfflineError('Use 3–16 letters, numbers, or underscores for your username.')
      return
    }
    setOfflineBusy(true)
    setOfflineError(null)
    try {
      await signInOffline(name)
      closeAuth()
    } catch (offlineSignInError) {
      setOfflineError(getErrorMessage(offlineSignInError))
    } finally {
      setOfflineBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) {
      void cancelAuth()
    } else {
      closeAuth()
    }
  }

  const goOffline = () => {
    setError(null)
    setMode('offline')
  }

  const title = success
    ? 'You’re signed in'
    : mode === 'offline'
      ? 'Make an offline account'
      : 'Connect your Microsoft account'
  const subtitle = success
    ? 'Your Minecraft profile is ready.'
    : mode === 'offline'
      ? 'For singleplayer, LAN, and mod testing. The username and UUID stay on this device.'
      : 'Aqua uses Microsoft’s official OAuth flow. Your password is never seen by the launcher.'

  const footer = success ? (
    <Button variant="primary" onClick={closeAuth}>
      Continue
    </Button>
  ) : busy ? (
    <>
      <Button variant="ghost" onClick={() => void cancelAuth()}>
        Cancel sign-in
      </Button>
      {auth.url ? (
        <Button
          icon={<ExternalLink />}
          onClick={() => void api.openExternal(auth.url as string).catch((openError) => setError(getErrorMessage(openError)))}
        >
          Open browser
        </Button>
      ) : null}
    </>
  ) : mode === 'offline' ? (
    <>
      <Button variant="ghost" onClick={() => setMode('microsoft')}>
        Back
      </Button>
      <Button
        variant="primary"
        onClick={() => void handleOffline()}
        loading={offlineBusy}
        icon={<UserRound />}
      >
        Create offline profile
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={handleClose}>
        Cancel
      </Button>
      {shiftHeld ? (
        <Button variant="primary" onClick={goOffline} icon={<UserRound />}>
          Make an offline account
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => void handleStart()}
          loading={starting}
          icon={<KeyRound />}
        >
          {authPhase === 'error' ? 'Try again' : 'Continue with Microsoft'}
        </Button>
      )}
    </>
  )

  return (
    <Modal
      open={authOpen}
      onClose={handleClose}
      title={title}
      subtitle={subtitle}
      size="sm"
      footer={footer}
    >
      {success ? (
        <div className="auth-success">
          <span className="auth-success__icon">
            <CheckCircle2 />
          </span>
          <div>
            <h3>{auth.message || 'Microsoft account connected'}</h3>
            <p>You can now launch Minecraft and keep your session securely on this device.</p>
          </div>
        </div>
      ) : mode === 'offline' ? (
        <div className="auth-intro auth-intro--offline">
          <div className="auth-intro__mark">
            <WifiOff />
          </div>
          <h3>Play with a local username</h3>
          <p>
            Offline profiles launch Minecraft with a local username. Use one for singleplayer, LAN worlds, or mod
            testing. The username and a generated player UUID stay on this device.
          </p>
          <div className="callout callout--warning auth-offline-note">
            <TriangleAlert />
            <span>
              Offline mode does not prove account ownership. Online-mode servers will reject this profile. Use a
              username you own, never someone else’s.
            </span>
          </div>
          <Field
            label="Username"
            htmlFor="offline-username"
            hint="3–16 characters. Letters, numbers, and underscores only."
            error={offlineError}
          >
            <input
              id="offline-username"
              className="input input--mono"
              value={offlineName}
              maxLength={16}
              onChange={(event) => {
                setOfflineName(event.target.value)
                setOfflineError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleOffline()
              }}
              placeholder="Steve"
              spellCheck={false}
              autoComplete="off"
              data-autofocus
            />
          </Field>
          <div className="auth-offline-meta">
            <span>
              <LockKeyhole /> No credentials stored
            </span>
            <span>UUID generated offline</span>
          </div>
        </div>
      ) : busy ? (
        <div className="auth-waiting">
          <div className="auth-waiting__visual">
            <span className="auth-waiting__ring" />
            <span className="auth-waiting__ring auth-waiting__ring--delay" />
            <Spinner size="lg" />
          </div>
          <h3>{finalizing ? 'Finishing your session' : 'Waiting for Microsoft'}</h3>
          <p>
            {finalizing
              ? 'We’re linking your Xbox and Minecraft profiles. This only takes a moment.'
              : 'Finish signing in in the browser window. It may be behind other windows.'}
          </p>
          {auth.url ? (
            <Button
              size="sm"
              icon={<ExternalLink />}
              onClick={() => void api.openExternal(auth.url as string).catch((openError) => setError(getErrorMessage(openError)))}
            >
              Reopen sign-in page
            </Button>
          ) : null}
          <span className="auth-note">
            <LockKeyhole /> Never enter your password into this launcher.
          </span>
          {error ? (
            <div className="callout callout--danger">
              <TriangleAlert /> {error}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="auth-intro">
          <div className="auth-intro__mark">
            <ShieldCheck />
          </div>
          <h3>What happens after sign-in</h3>
          <p>
            Use the account that owns Minecraft: Java Edition. Aqua opens Microsoft’s official sign-in window, loads
            your player name and skin, refreshes the session before each launch, and stores only an encrypted refresh
            token{accounts?.secureStorageAvailable ? ` using ${accounts.storageLabel}` : ''}. You can add more accounts
            later and switch between them.
          </p>
          {error || authPhase === 'error' ? (
            <div className="callout callout--danger" role="alert">
              <TriangleAlert />
              <span>{error || auth.message || 'Microsoft sign-in did not complete.'}</span>
            </div>
          ) : null}
          {!accounts?.secureStorageAvailable ? (
            <div className="callout callout--warning">
              <TriangleAlert />
              <span>
                Secure credential storage is unavailable on this system. You can sign in, but the session will only
                last until the launcher closes.
              </span>
            </div>
          ) : null}
          {starting && !shiftHeld ? (
            <span className="auth-note">
              <Spinner /> Opening Microsoft sign-in…
            </span>
          ) : (
            <span className="auth-note">
              <UserRound /> Hold Shift to make an offline account instead.
            </span>
          )}
        </div>
      )}
    </Modal>
  )
}
