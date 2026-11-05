import { useEffect, useState } from 'react'
import { Keyboard, Minus, X } from 'lucide-react'
import {
  BarChart3,
  Download,
  Gamepad2,
  Globe2,
  Home,
  Image as ImageIcon,
  Layers,
  Map,
  Package,
  ScrollText,
  Search,
  Server,
  Settings,
} from 'lucide-react'
import { api } from '../../lib/api'
import { CONTENT_TYPES } from '../../lib/contentTypes'
import { MICROSOFT_AUTH_ENABLED } from '../../lib/features'
import { elapsedSince } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import { SHORTCUTS, openShortcutSheet } from '../../lib/shortcuts'
import { useLauncher } from '../../state/LauncherProvider'
import { AppIcon } from '../brand/Brand'
import { Avatar, cx } from '../ui/primitives'
import { SkinAvatar } from '../account/SkinAvatar'
import { openCommandPalette } from '../command/CommandPalette'
import { NotificationCenter } from './NotificationCenter'
import type { PageName } from '../../lib/types'

const NAV_ITEMS: Array<{ page: PageName; label: string; icon: typeof Home }> = [
  { page: 'home', label: 'Home', icon: Home },
  { page: 'installations', label: 'Installations', icon: Layers },
  { page: 'stats', label: 'Stats', icon: BarChart3 },
  { page: 'worlds', label: 'Worlds & backups', icon: Globe2 },
  { page: 'screenshots', label: 'Screenshots', icon: ImageIcon },
  { page: 'servers', label: 'Servers', icon: Server },
  { page: 'mods', label: 'Extra content', icon: Package },
  { page: 'logs', label: 'Logs & diagnostics', icon: ScrollText },
  { page: 'docs', label: 'Roadmap & docs', icon: Map },
  { page: 'settings', label: 'Settings', icon: Settings },
]

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="2.2" y="0.8" width="7" height="7" rx="0.7" stroke="currentColor" strokeWidth="1" />
      <path d="M0.8 3.2V8.5C0.8 8.9 1.1 9.2 1.5 9.2H6.8" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export function NavigatorDock() {
  const { route, navigate, activeAccount, activeJobs, game, openAuth, windowMaximized } = useLauncher()
  const [typesOpen, setTypesOpen] = useState(false)
  const activeContentType = route.params?.contentType ?? 'mod'
  const gameActive = game.status === 'running' || game.status === 'preparing'
  const searchKeys = SHORTCUTS.find((shortcut) => shortcut.id === 'search')?.keys || 'Ctrl K'
  const helpKeys = SHORTCUTS.find((shortcut) => shortcut.id === 'help')?.keys || '?'
  useNow(gameActive)

  const handleAccount = () => {
    if (activeAccount) navigate('account')
    else openAuth()
  }

  // The Extra content entry doubles as the Modrinth content-type picker, whose
  // types now sit in the bar itself: the strip opens left of the button.
  const handleModsNav = () => {
    if (route.page !== 'mods') {
      navigate('mods', { contentType: activeContentType })
      setTypesOpen(true)
      return
    }
    setTypesOpen((open) => !open)
  }

  // The strip belongs to the page, so it is open on Extra content and collapsed
  // everywhere else; clicking the Extra content button toggles it on that page.
  useEffect(() => {
    setTypesOpen(route.page === 'mods')
  }, [route.page])

  const accountLabel = activeAccount
    ? `${activeAccount.name}${
        activeAccount.type === 'offline'
          ? ' · offline profile'
          : activeAccount.sessionExpired
            ? ' · session expired'
            : ' · Microsoft account'
      }`
    : MICROSOFT_AUTH_ENABLED
      ? 'Add a player profile (offline or Microsoft)'
      : 'Add an offline profile'

  const gameLabel =
    game.status === 'running'
      ? `${game.safeMode?.active ? 'Minecraft is running · Safe Mode' : 'Minecraft is running'} · ${elapsedSince(
          game.startedAt,
        )}`
      : game.phase || 'Preparing launch'

  return (
    <div className="nav-dock no-drag">
      <button
        type="button"
        className="nav-dock__brand"
        onClick={() => navigate('home')}
        aria-label="Go to home"
        title="Aqua Launcher"
      >
        <AppIcon size={16} />
        <span className="nav-dock__brand-name">Aqua</span>
      </button>

      <span className="nav-dock__divider" aria-hidden="true" />

      <nav className="nav-dock__nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = route.page === item.page
          const isMods = item.page === 'mods'
          return (
            <div key={item.page} className="nav-dock__group">
              {/* Part of the bar, not a dropdown: the strip grows out of the
                  Extra content button to its left. */}
              {isMods ? (
                <div
                  className={cx('nav-dock__types', typesOpen && 'is-open')}
                  role="group"
                  aria-label="Extra content types"
                  aria-hidden={!typesOpen}
                >
                  {CONTENT_TYPES.map((option) => {
                    const OptionIcon = option.icon
                    const optionActive = option.id === activeContentType
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={cx('nav-dock__type', optionActive && 'is-active')}
                        aria-pressed={optionActive}
                        tabIndex={typesOpen ? 0 : -1}
                        title={option.label}
                        onClick={() => navigate('mods', { contentType: option.id })}
                      >
                        <OptionIcon strokeWidth={optionActive ? 2.1 : 1.8} />
                        <span>{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
              <button
                type="button"
                className={cx('nav-dock__item', isActive && 'is-active')}
                onClick={isMods ? handleModsNav : () => navigate(item.page)}
                aria-current={isActive ? 'page' : undefined}
                aria-expanded={isMods ? typesOpen : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <Icon strokeWidth={isActive ? 2.1 : 1.8} />
              </button>
            </div>
          )
        })}
      </nav>

      <span className="nav-dock__divider" aria-hidden="true" />

      {gameActive ? (
        <button
          type="button"
          className={cx('nav-dock__item', game.status === 'running' && 'is-live')}
          onClick={() =>
            navigate(
              game.status === 'running' ? 'logs' : 'home',
              game.status === 'running' ? { category: 'game', installationId: game.installationId } : undefined,
            )
          }
          aria-label={gameLabel}
          title={gameLabel}
        >
          <Gamepad2 strokeWidth={1.9} />
        </button>
      ) : null}

      <button
        type="button"
        className={cx('nav-dock__item', route.page === 'tasks' && 'is-active')}
        onClick={() => navigate('tasks')}
        aria-current={route.page === 'tasks' ? 'page' : undefined}
        aria-label={activeJobs.length > 0 ? `Tasks, ${activeJobs.length} running` : 'Tasks'}
        title={activeJobs.length > 0 ? `Tasks · ${activeJobs.length} running` : 'Tasks'}
      >
        <Download strokeWidth={1.9} />
        {activeJobs.length > 0 ? (
          <span className="nav-dock__count">{activeJobs.length > 9 ? '9+' : activeJobs.length}</span>
        ) : null}
      </button>

      <button
        type="button"
        className="nav-dock__item"
        onClick={handleAccount}
        aria-label={accountLabel}
        title={accountLabel}
      >
        {activeAccount?.skin?.textureDataUrl ? (
          <SkinAvatar name={activeAccount.name} texture={activeAccount.skin.textureDataUrl} size="sm" />
        ) : (
          <Avatar name={activeAccount?.name} src={activeAccount?.avatarDataUrl} size="sm" />
        )}
      </button>

      <span className="nav-dock__divider" aria-hidden="true" />

      <button
        type="button"
        className="titlebar__search"
        onClick={openCommandPalette}
        aria-label={`Search Aqua (${searchKeys})`}
        title={`Search Aqua (${searchKeys})`}
      >
        <Search size={12} strokeWidth={1.9} />
        <span>Search</span>
      </button>
      <button
        type="button"
        className="titlebar__help"
        onClick={openShortcutSheet}
        aria-label={`Keyboard shortcuts (${helpKeys})`}
        title={`Keyboard shortcuts (${helpKeys})`}
      >
        <Keyboard size={14} strokeWidth={1.8} />
      </button>
      <NotificationCenter />

      <span className="nav-dock__divider" aria-hidden="true" />

      <div className="nav-dock__window">
        <button
          type="button"
          className="titlebar__control"
          onClick={() => void api.windowControls.minimize()}
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="titlebar__control"
          onClick={() => void api.windowControls.toggleMaximize()}
          aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
          title={windowMaximized ? 'Restore' : 'Maximize'}
        >
          {windowMaximized ? <RestoreIcon /> : <span className="titlebar__square" />}
        </button>
        <button
          type="button"
          className="titlebar__control titlebar__control--close"
          onClick={() => void api.windowControls.close()}
          aria-label="Close launcher"
          title="Close"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
