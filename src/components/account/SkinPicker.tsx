import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Palette, Search, Shirt, X } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import type { Account, SkinSummary } from '../../lib/types'
import { Button, EmptyState, Spinner, cx } from '../ui/primitives'
import { SkinFace, SkinFigure } from './SkinAvatar'

type ModelFilter = 'all' | 'classic' | 'slim'

/**
 * Browses the MCStat skin library and stores the chosen texture on this player
 * profile, so the launcher draws the same face everywhere the profile appears.
 */
export function SkinPicker({ account }: { account: Account }) {
  const { pushToast } = useLauncher()
  const [skins, setSkins] = useState<SkinSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [model, setModel] = useState<ModelFilter>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [browsing, setBrowsing] = useState(!account.skin)
  const [applying, setApplying] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const ticket = useRef(0)

  const load = useCallback(
    async (nextPage: number) => {
      const current = ++ticket.current
      setLoading(true)
      setError(null)
      try {
        const catalog = await api.skins.list({
          page: nextPage,
          limit: 24,
          search: query,
          model: model === 'all' ? null : model,
        })
        if (current !== ticket.current) return
        setSkins(catalog.skins)
        setPage(catalog.page)
        setTotalPages(catalog.totalPages)
      } catch (err) {
        if (current === ticket.current) setError(getErrorMessage(err))
      } finally {
        if (current === ticket.current) setLoading(false)
      }
    },
    [model, query],
  )

  useEffect(() => {
    if (!browsing) return
    const timer = window.setTimeout(() => void load(1), query.trim() ? 320 : 0)
    return () => window.clearTimeout(timer)
  }, [browsing, load, query])

  const choose = async (skin: SkinSummary) => {
    setApplying(skin.slug)
    try {
      await api.skins.apply(account.id, skin)
      setBrowsing(false)
      pushToast({ level: 'success', title: 'Skin updated', message: skin.name })
    } catch (err) {
      pushToast({ level: 'error', title: 'Could not set that skin', message: getErrorMessage(err) })
    } finally {
      setApplying(null)
    }
  }

  const remove = async () => {
    setClearing(true)
    try {
      await api.skins.clear(account.id)
      setBrowsing(true)
      pushToast({ level: 'success', title: 'Skin removed', message: 'The profile uses its account avatar again.' })
    } catch (err) {
      pushToast({ level: 'error', title: 'Could not remove the skin', message: getErrorMessage(err) })
    } finally {
      setClearing(false)
    }
  }

  const texture = account.skin?.textureDataUrl || null

  return (
    <section className="panel account-skins">
      <div className="panel-head">
        <div>
          <h2 className="panel-head__title">Skin</h2>
          <p className="panel-head__subtitle">
            {account.skin
              ? `${account.skin.name} · ${account.skin.model === 'slim' ? 'slim' : 'classic'} arms`
              : 'Pick a skin from the community library.'}
          </p>
        </div>
        {account.skin ? (
          <div className="account-skins__actions">
            <Button size="sm" icon={<Shirt />} onClick={() => setBrowsing((open) => !open)}>
              {browsing ? 'Close library' : 'Change skin'}
            </Button>
            <Button size="sm" variant="ghost" icon={<X />} loading={clearing} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      <div className="panel-body">
        <div className={cx('account-skins__layout', browsing && 'is-browsing')}>
          <div className="account-skins__current">
            {texture ? (
              <SkinFigure texture={texture} model={account.skin?.model || 'classic'} scale={4} />
            ) : (
              <span className="account-skins__placeholder">
                <Shirt />
              </span>
            )}
            <div className="account-skins__meta">
              <strong>{account.skin ? account.skin.name : 'No skin selected'}</strong>
              <span>
                {account.skin
                  ? 'Drawn from the skin texture on this device for this profile.'
                  : 'Skins come from the MCStat community library and are stored with this profile.'}
              </span>
            </div>
          </div>

          {browsing ? (
            <div className="account-skins__library">
              <div className="account-skins__filters">
                <label className="account-skins__search">
                  <Search />
                  <input
                    className="input"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search skins"
                    aria-label="Search skins"
                  />
                </label>
                <select
                  className="select account-skins__model"
                  value={model}
                  onChange={(event) => setModel(event.target.value as ModelFilter)}
                  aria-label="Skin model"
                >
                  <option value="all">All models</option>
                  <option value="classic">Classic</option>
                  <option value="slim">Slim</option>
                </select>
              </div>

              {error ? <div className="callout callout--warning">{error}</div> : null}

              {loading && skins.length === 0 ? (
                <div className="account-skins__status">
                  <Spinner /> Loading skins…
                </div>
              ) : null}

              {!loading && !error && skins.length === 0 ? (
                <EmptyState icon={<Palette />} title="No skins found" description="Try another search or model." />
              ) : null}

              {skins.length > 0 ? (
                <div className="account-skins__grid">
                  {skins.map((skin) => (
                    <button
                      key={skin.slug}
                      type="button"
                      className={cx('skin-card', account.skin?.slug === skin.slug && 'is-active')}
                      disabled={applying !== null}
                      onClick={() => void choose(skin)}
                      title={skin.name}
                    >
                      <span className="skin-card__face">
                        {skin.textureDataUrl ? (
                          <SkinFace texture={skin.textureDataUrl} size={48} />
                        ) : (
                          <Shirt />
                        )}
                      </span>
                      <span className="skin-card__name">{skin.name}</span>
                      <span className="skin-card__model">{skin.model === 'slim' ? 'Slim' : 'Classic'}</span>
                      {applying === skin.slug ? (
                        <span className="skin-card__busy">
                          <Spinner />
                        </span>
                      ) : account.skin?.slug === skin.slug ? (
                        <span className="skin-card__check">
                          <Check />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {totalPages > 1 ? (
                <div className="account-skins__pager">
                  <Button size="sm" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>
                    Previous
                  </Button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <Button size="sm" disabled={loading || page >= totalPages} onClick={() => void load(page + 1)}>
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
