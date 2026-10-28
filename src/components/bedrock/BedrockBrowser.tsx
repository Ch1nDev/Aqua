import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Loader2, RotateCw, Upload, X } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { Button, IconButton, cx } from '../ui/primitives'

/**
 * Where the browser opens and the shortcuts above it. MCPEDL sits behind a bot check
 * that never clears inside an embedded browser, so it hands off to the real one.
 */
const HOME_URL = 'https://mcpeaddons.com/addons/'
const SITES = [
  { label: 'MCPE Addons', url: 'https://mcpeaddons.com/addons/' },
  { label: 'ModBay', url: 'https://modbay.org/mods/' },
]
const EXTERNAL_SITES = [{ label: 'MCPEDL', url: 'https://mcpedl.com/' }]
const SEARCH_URL = 'https://www.google.com/search?q='
const PARTITION = 'persist:aqua-bedrock-browser'

type NavigationEvent = Event & {
  url?: string
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}

/**
 * Electron's <webview> element. It is created imperatively rather than through
 * JSX because React would treat its custom events as attributes.
 */
interface BedrockWebview extends HTMLElement {
  loadURL?: (url: string) => Promise<void>
  reload?: () => void
  goBack?: () => void
  goForward?: () => void
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  getURL?: () => string
}

function looksLikeAddress(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\s/.test(trimmed)) return false
  return /^[a-z]+:\/\//i.test(trimmed) || /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(trimmed)
}

function toUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return HOME_URL
  if (looksLikeAddress(trimmed)) return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return `${SEARCH_URL}${encodeURIComponent(trimmed)}`
}

function readableUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.hostname.replace(/^www\./i, '')}${url.pathname === '/' ? '' : url.pathname}${url.search}`
  } catch {
    return value
  }
}

/**
 * Bedrock add-on sites have no catalogue API and cannot be framed, so the
 * launcher gives them a real browser view of their own. Packs downloaded here are
 * installed into Bedrock by the main process instead of being saved.
 */
export function BedrockBrowser() {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<BedrockWebview | null>(null)
  const [address, setAddress] = useState(readableUrl(HOME_URL))
  const [currentUrl, setCurrentUrl] = useState(HOME_URL)
  const [loading, setLoading] = useState(true)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const syncHistory = useCallback(() => {
    const frame = frameRef.current
    if (!frame) return
    try {
      setCanGoBack(Boolean(frame.canGoBack?.()))
      setCanGoForward(Boolean(frame.canGoForward?.()))
    } catch {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [])

  const navigate = useCallback(
    (value: string) => {
      const target = toUrl(value)
      const frame = frameRef.current
      setFailed(null)
      setLoading(true)
      setCurrentUrl(target)
      setAddress(readableUrl(target))
      if (!frame) return
      try {
        const pending = frame.loadURL?.(target)
        if (pending && typeof pending.catch === 'function') {
          pending.catch(() => {
            // A navigation cancelled by another one is not an error worth showing.
          })
        }
      } catch {
        // Ignore; the did-fail-load handler reports real problems.
      }
    },
    [],
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const frame = document.createElement('webview') as BedrockWebview
    frame.className = 'bedrock-browser__frame'
    // src has to be in place before attaching: the main process checks the
    // partition and the URL when the webview attaches, and denies anything else.
    frame.setAttribute('partition', PARTITION)
    frame.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')
    frame.setAttribute('src', HOME_URL)
    stage.appendChild(frame)
    frameRef.current = frame

    if (typeof frame.loadURL !== 'function') {
      setUnsupported(true)
      setLoading(false)
    }

    const onStart = () => setLoading(true)
    const onStop = () => {
      setLoading(false)
      syncHistory()
    }
    const onNavigate = (event: Event) => {
      const url = (event as NavigationEvent).url
      if (!url) return
      setCurrentUrl(url)
      setAddress(readableUrl(url))
      setFailed(null)
      syncHistory()
    }
    const onFail = (event: Event) => {
      const detail = event as NavigationEvent
      if (detail.errorCode === -3) return // Aborted navigations are normal.
      setLoading(false)
      setFailed(detail.errorDescription || 'That page could not be loaded.')
    }

    frame.addEventListener('did-start-loading', onStart)
    frame.addEventListener('did-stop-loading', onStop)
    frame.addEventListener('did-navigate', onNavigate)
    frame.addEventListener('did-navigate-in-page', onNavigate)
    frame.addEventListener('did-fail-load', onFail)

    return () => {
      frame.removeEventListener('did-start-loading', onStart)
      frame.removeEventListener('did-stop-loading', onStop)
      frame.removeEventListener('did-navigate', onNavigate)
      frame.removeEventListener('did-navigate-in-page', onNavigate)
      frame.removeEventListener('did-fail-load', onFail)
      frame.remove()
      frameRef.current = null
    }
  }, [syncHistory])

  const openExternally = async (url: string) => {
    try {
      await api.openExternal(url)
    } catch (error) {
      setFailed(getErrorMessage(error))
    }
  }

  return (
    <div className="bedrock-browser">
      <div className="bedrock-browser__bar">
        <IconButton
          label="Back"
          size="sm"
          disabled={!canGoBack}
          onClick={() => {
            try {
              frameRef.current?.goBack?.()
            } catch {
              // Ignore.
            }
          }}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Forward"
          size="sm"
          disabled={!canGoForward}
          onClick={() => {
            try {
              frameRef.current?.goForward?.()
            } catch {
              // Ignore.
            }
          }}
        >
          <ArrowRight />
        </IconButton>
        <IconButton
          label="Reload"
          size="sm"
          onClick={() => {
            try {
              frameRef.current?.reload?.()
            } catch {
              // Ignore.
            }
          }}
        >
          <RotateCw className={cx(loading && 'spin')} />
        </IconButton>

        <form
          className="bedrock-browser__address"
          onSubmit={(event) => {
            event.preventDefault()
            navigate(address)
          }}
        >
          <Globe />
          <input
            className="input"
            value={address}
            spellCheck={false}
            aria-label="Address or search"
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="Address or search"
          />
          {loading ? <Loader2 className="spin bedrock-browser__spinner" /> : null}
          {address ? (
            <button
              type="button"
              className="search-input__clear"
              aria-label="Reset the address"
              onClick={() => {
                setAddress('')
                navigate(HOME_URL)
              }}
            >
              <X />
            </button>
          ) : null}
        </form>

        <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void openExternally(currentUrl)}>
          Open in browser
        </Button>
      </div>

      <div className="bedrock-browser__sites">
        {SITES.map((site) => (
          <button
            key={site.url}
            type="button"
            className={cx('chip', currentUrl.startsWith(site.url) && 'is-active')}
            onClick={() => navigate(site.url)}
          >
            {site.label}
          </button>
        ))}
        {EXTERNAL_SITES.map((site) => (
          <button key={site.url} type="button" className="chip" onClick={() => void openExternally(site.url)}>
            {site.label} <ExternalLink />
          </button>
        ))}
        <span className="bedrock-browser__hint">
          <Upload /> .mcpack, .mcaddon and .mcworld downloads install themselves.
        </span>
      </div>

      {unsupported ? (
        <div className="panel bedrock-browser__fallback">
          <p>
            The in-app browser is unavailable in this build. Bedrock add-ons can still be imported from a file you
            download in your own browser.
          </p>
          <Button variant="primary" icon={<ExternalLink />} onClick={() => void openExternally(HOME_URL)}>
            Open the add-on sites in your browser
          </Button>
        </div>
      ) : (
        <>
          {failed ? (
            <div className="callout callout--warning bedrock-browser__error">
              <span>{failed}</span>
              <Button size="sm" variant="ghost" onClick={() => navigate(currentUrl)}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void openExternally(currentUrl)}>
                Open in browser
              </Button>
            </div>
          ) : null}
          <div
            ref={stageRef}
            className={cx('bedrock-browser__stage', loading && 'is-loading')}
            role="region"
            aria-label="Bedrock add-on browser"
          />
        </>
      )}
    </div>
  )
}
