import { Fragment, useState } from 'react'
import {
  Boxes,
  ChevronRight,
  Download,
  Gamepad2,
  Globe2,
  Home,
  Layers,
  Map,
  ScrollText,
  Server,
  Settings,
  UserRound,
} from 'lucide-react'
import { CONTENT_TYPES } from '../../lib/contentTypes'
import { MICROSOFT_AUTH_ENABLED } from '../../lib/features'
import { useLauncher } from '../../state/LauncherProvider'
import { useNow } from '../../lib/hooks'
import { elapsedSince } from '../../lib/format'
import { Avatar, ProgressBar, cx } from '../ui/primitives'
import { AquaWordmark } from '../brand/Brand'
import type { PageName } from '../../lib/types'

const NAV_ITEMS: Array<{ page: PageName; label: string; icon: typeof Home }> = [
  { page: 'home', label: 'Home', icon: Home },
  { page: 'installations', label: 'Installations', icon: Layers },
  { page: 'worlds', label: 'Worlds & backups', icon: Globe2 },
  { page: 'servers', label: 'Servers', icon: Server },
  { page: 'versions', label: 'Versions', icon: Boxes },
  { page: 'mods', label: 'Extra content', icon: Download },
  { page: 'account', label: 'Account', icon: UserRound },
  { page: 'logs', label: 'Logs & diagnostics', icon: ScrollText },
  { page: 'docs', label: 'Roadmap & docs', icon: Map },
  { page: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const {
    route,
    navigate,
    activeAccount,
    activeJobs,
    jobs,
    game,
    downloadsOpen,
    setDownloadsOpen,
    openAuth,
    data,
  } = useLauncher()
  const [modsMenuOpen, setModsMenuOpen] = useState(false)
  const activeContentType = route.params?.contentType ?? 'mod'
  const gameActive = game.status === 'running' || game.status === 'preparing'
  useNow(gameActive)

  const primaryJob = activeJobs[0] || null
  const finishedJobs = jobs.filter((job) => job.status === 'completed' || job.status === 'failed').length
  const totalJobs = activeJobs.length + finishedJobs

  const handleAccount = () => {
    if (activeAccount) navigate('account')
    else openAuth()
  }

  // The Extra content entry doubles as the Modrinth content-type picker.
  const handleModsNav = () => {
    if (route.page !== 'mods') {
      navigate('mods', { contentType: activeContentType })
      setModsMenuOpen(true)
      return
    }
    setModsMenuOpen((open) => !open)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <AquaWordmark />
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = route.page === item.page
          const isMods = item.page === 'mods'
          return (
            <Fragment key={item.page}>
              <button
                type="button"
                className={cx('sidebar__nav-item', isActive && 'is-active')}
                onClick={
                  isMods
                    ? handleModsNav
                    : () => {
                        setModsMenuOpen(false)
                        navigate(item.page)
                      }
                }
                aria-current={isActive ? 'page' : undefined}
                aria-expanded={isMods ? modsMenuOpen : undefined}
                aria-haspopup={isMods ? 'menu' : undefined}
                title={item.label}
              >
                <Icon strokeWidth={isActive ? 2.1 : 1.8} />
                <span className="sidebar__nav-text">{item.label}</span>
              </button>
              {isMods && modsMenuOpen ? (
                <div className="sidebar__subnav" role="menu" aria-label="Modrinth content">
                  {CONTENT_TYPES.map((option) => {
                    const OptionIcon = option.icon
                    const optionActive = option.id === activeContentType
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={optionActive}
                        className={cx('sidebar__subnav-item', optionActive && 'is-active')}
                        onClick={() => navigate('mods', { contentType: option.id })}
                      >
                        <OptionIcon strokeWidth={optionActive ? 2.1 : 1.8} />
                        <span className="sidebar__nav-text">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </nav>

      <div className="sidebar__spacer" />

      <div className="sidebar__footer">
        {gameActive ? (
          <button
            type="button"
            className={cx('sidebar__status', game.status === 'running' && 'is-live')}
            onClick={() => navigate(game.status === 'running' ? 'logs' : 'home', game.status === 'running' ? { category: 'game', installationId: game.installationId } : undefined)}
          >
            <span className="sidebar__status-icon">
              <Gamepad2 />
            </span>
            <span className="sidebar__status-copy">
              <span className="sidebar__status-title">
                {game.status === 'running' ? 'Minecraft is running' : game.phase || 'Preparing launch'}
              </span>
              <span className="sidebar__status-meta">
                {game.status === 'running' ? elapsedSince(game.startedAt) : 'Please wait…'}
              </span>
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className={cx('sidebar__downloads', downloadsOpen && 'is-open')}
          onClick={() => setDownloadsOpen(!downloadsOpen)}
          aria-expanded={downloadsOpen}
        >
          <span className="sidebar__downloads-icon">
            <Download />
          </span>
          <span className="sidebar__downloads-copy">
            <span className="sidebar__downloads-title">
              Downloads
              {activeJobs.length > 0 ? <span className="sidebar__count">{activeJobs.length}</span> : null}
            </span>
            <span className="sidebar__downloads-meta">
              {primaryJob
                ? primaryJob.progress != null
                  ? `${primaryJob.progress}% · ${primaryJob.stage}`
                  : primaryJob.stage
                : totalJobs > 0
                  ? `${finishedJobs} recent`
                  : 'Nothing queued'}
            </span>
          </span>
          <ChevronRight size={14} className="sidebar__chevron" />
        </button>
        {primaryJob ? (
          <div className="sidebar__download-progress">
            <ProgressBar value={primaryJob.progress} thin label="Current download" />
          </div>
        ) : null}

        <button type="button" className="sidebar__account" onClick={handleAccount} aria-label={activeAccount ? 'Open account' : 'Add a player profile'}>
          <Avatar name={activeAccount?.name} src={activeAccount?.avatarDataUrl} size="md" />
          <span className="sidebar__account-copy">
            <span className="sidebar__account-name">{activeAccount?.name || 'Add profile'}</span>
            <span className="sidebar__account-meta">
              {activeAccount
                ? activeAccount.type === 'offline'
                  ? 'Offline profile'
                  : activeAccount.sessionExpired
                    ? 'Session expired'
                    : 'Microsoft account'
                : MICROSOFT_AUTH_ENABLED
                  ? 'Offline or Microsoft'
                  : 'Offline profile'}
            </span>
          </span>
          <ChevronRight size={14} className="sidebar__chevron" />
        </button>
        <div className="sidebar__build">Aqua {data?.app.version ? `v${data.app.version}` : ''}</div>
      </div>
    </aside>
  )
}
