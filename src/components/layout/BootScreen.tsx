import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { AppIcon } from '../brand/Brand'
import { Button, Spinner } from '../ui/primitives'

export function BootScreen({
  error,
  onRetry,
}: {
  error?: string | null
  onRetry?: () => void
}) {
  if (!error) {
    return (
      <div className="boot-screen">
        <Spinner size="lg" label="Starting Aqua Launcher" />
      </div>
    )
  }

  return (
    <div className="boot-screen">
      <div className="boot-screen__glow" />
      <div className="boot-screen__content">
        <AppIcon size={60} />
        <div className="boot-screen__text">
          <span className="boot-screen__eyebrow">AQUA LAUNCHER</span>
          <h1>Something went wrong</h1>
          <p>{error}</p>
        </div>
        <div className="boot-screen__error-icon">
          <AlertTriangle />
        </div>
        <div className="boot-screen__actions">
          <Button variant="primary" icon={<RefreshCw />} onClick={onRetry}>
            Try again
          </Button>
          <Button icon={<FolderOpen />} onClick={() => void api.system.openFolder('logs').catch(() => {})}>
            Open logs
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DesktopRequired() {
  return (
    <div className="boot-screen">
      <div className="boot-screen__glow" />
      <div className="boot-screen__content">
        <AppIcon size={60} />
        <div className="boot-screen__text">
          <span className="boot-screen__eyebrow">DESKTOP APP</span>
          <h1>Open Aqua in its desktop window</h1>
          <p>
            The launcher runs as an Electron application so it can download game files, manage Java, and start
            Minecraft. Run <code>npm run electron:dev</code> from the project folder.
          </p>
        </div>
      </div>
    </div>
  )
}
