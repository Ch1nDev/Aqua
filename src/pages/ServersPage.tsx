import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Boxes,
  Clock,
  Info,
  Layers,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { api, getErrorMessage } from '../lib/api'
import { relativeTime } from '../lib/format'
import { useLauncher } from '../state/LauncherProvider'
import type { ServerEdition, ServerEntry, ServerStatus } from '../lib/types'
import { useHeroArtwork } from '../components/brand/Artwork'
import { PageHeader } from '../components/layout/PageHeader'
import { ActionMenu } from '../components/ui/Menu'
import {
  Button,
  CopyButton,
  EmptyState,
  Field,
  Spinner,
  cx,
} from '../components/ui/primitives'
import { ConfirmDialog, Modal } from '../components/ui/overlays'

type ServerDialog = { mode: 'add' } | { mode: 'edit'; server: ServerEntry }

const EDITION_LABELS: Record<ServerEdition, string> = {
  java: 'Java Edition',
  bedrock: 'Bedrock',
}

export function ServersPage() {
  const { selectedInstallation, installations, game, launchingId, joinServer, navigate, pushToast, bedrock } =
    useLauncher()
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({})
  const [pinging, setPinging] = useState<Record<string, boolean>>({})
  const [pingNonce, setPingNonce] = useState(0)
  const [recentJoins, setRecentJoins] = useState<Record<string, string>>({})
  const [notFound, setNotFound] = useState(false)
  const [dialog, setDialog] = useState<ServerDialog | null>(null)
  const [form, setForm] = useState<{ name: string; address: string; edition: ServerEdition }>({
    name: '',
    address: '',
    edition: 'java',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ServerEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadServers = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.servers.list()
      setServers([...list])
      setNotFound(false)
    } catch (error) {
      setNotFound(true)
      pushToast({ level: 'error', title: 'Could not load servers', message: getErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const pingOne = useCallback(
    async (server: ServerEntry) => {
      setPinging((current) => ({ ...current, [server.id]: true }))
      try {
        const status = await api.servers.ping(
          server.connectAddress || server.address,
          server.edition === 'bedrock' ? 'bedrock' : 'java',
        )
        setStatuses((current) => ({ ...current, [server.id]: status }))
      } catch (error) {
        setStatuses((current) => ({
          ...current,
          [server.id]: {
            address: server.connectAddress || server.address,
            online: false,
            latencyMs: 0,
            motd: null,
            version: null,
            protocol: null,
            players: { online: 0, max: 0, sample: [] },
            favicon: null,
            error: getErrorMessage(error),
          },
        }))
      } finally {
        setPinging((current) => ({ ...current, [server.id]: false }))
      }
    },
    [],
  )

  useEffect(() => {
    for (const server of servers) void pingOne(server)
  }, [servers, pingNonce, pingOne])

  const openAdd = () => {
    setForm({ name: '', address: '', edition: 'java' })
    setFormError(null)
    setDialog({ mode: 'add' })
  }

  const openEdit = (server: ServerEntry) => {
    setForm({
      name: server.name,
      address: server.connectAddress || server.address,
      edition: server.edition === 'bedrock' ? 'bedrock' : 'java',
    })
    setFormError(null)
    setDialog({ mode: 'edit', server })
  }

  const saveServer = async () => {
    if (saving) return
    if (!form.address.trim()) {
      setFormError('Enter a server address.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      if (dialog?.mode === 'edit') {
        const updated = await api.servers.update(dialog.server.id, {
          name: form.name.trim() || form.address.trim(),
          address: form.address.trim(),
        })
        setServers((current) => current.map((server) => (server.id === updated.id ? updated : server)))
        pushToast({ level: 'success', title: 'Server updated', message: updated.name })
      } else {
        const created = await api.servers.add({
          name: form.name.trim(),
          address: form.address.trim(),
          edition: form.edition,
        })
        setServers((current) => [...current, created])
        pushToast({ level: 'success', title: 'Server added', message: created.name })
      }
      setDialog(null)
    } catch (error) {
      setFormError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const removeServer = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.servers.remove(deleteTarget.id)
      setServers((current) => current.filter((server) => server.id !== deleteTarget.id))
      pushToast({ level: 'info', title: 'Server removed', message: deleteTarget.name })
      setDeleteTarget(null)
    } catch (error) {
      pushToast({ level: 'error', title: 'Could not remove server', message: getErrorMessage(error) })
    } finally {
      setDeleting(false)
    }
  }

  const handleJoin = async (server: ServerEntry) => {
    const joined = await joinServer(
      server.id,
      server.connectAddress || server.address,
      server.edition === 'bedrock' ? 'bedrock' : 'java',
    )
    if (!joined) return
    setRecentJoins((current) => ({ ...current, [server.id]: new Date().toISOString() }))
  }

  const installation = selectedInstallation
  const artwork = useHeroArtwork(installation?.versionId)
  const artworkStyle = artwork ? ({ '--server-art': `url("${artwork}")` } as CSSProperties) : undefined
  const gameBusy = game.status === 'preparing' || game.status === 'running'
  const installationBusy = Boolean(installation && launchingId === installation.id)
  const bedrockEdition = bedrock?.editions[0] ?? null
  const hasJavaServers = servers.some((server) => server.edition !== 'bedrock')
  const hasBedrockServers = servers.some((server) => server.edition === 'bedrock')
  const canJoinServer = (server: ServerEntry) =>
    server.edition === 'bedrock' ? Boolean(bedrockEdition) : Boolean(installation?.installed)
  const joinBlockedReason = (server: ServerEntry) => {
    if (server.edition === 'bedrock') {
      if (!bedrockEdition) return 'Install Minecraft for Windows from the Microsoft Store first'
      return `Join with ${bedrockEdition.name}`
    }
    if (!installation) return 'Create an installation first'
    if (!installation.installed) return 'Install the game files first'
    return `Join with ${installation.name}`
  }

  return (
    <div className="page">
      <PageHeader
        title="Servers"
        subtitle="Save the servers you play on, watch their live status, and join in one click."
        actions={
          <div className="row gap-2">
            <Button
              icon={<RefreshCw />}
              onClick={() => setPingNonce((value) => value + 1)}
              disabled={loading || !servers.length}
            >
              Refresh status
            </Button>
            <Button variant="primary" icon={<Plus />} onClick={openAdd}>
              Add server
            </Button>
          </div>
        }
      />

      {hasBedrockServers ? (
        <div className="callout callout--info">
          <Boxes />
          <span>
            Bedrock servers open {bedrockEdition?.name || 'Minecraft for Windows'} and connect through its own deep link, so
            they do not use a Java profile.
          </span>
        </div>
      ) : null}

      {!hasJavaServers ? null : !installation ? (
        <div className="callout callout--warning">
          <AlertTriangle />
          <span>Create a Minecraft installation before joining a Java server.</span>
          <Button size="sm" icon={<Layers />} onClick={() => navigate('installations')}>
            Installations
          </Button>
        </div>
      ) : !installation.installed ? (
        <div className="callout callout--warning">
          <AlertTriangle />
          <span>
            <strong style={{ color: 'var(--text)' }}>{installation.name}</strong> has not downloaded its game files yet.
            Install it before joining.
          </span>
          <Button size="sm" icon={<Layers />} onClick={() => navigate('installations')}>
            Install files
          </Button>
        </div>
      ) : (
        <div className="servers-context">
          <span className="servers-context__icon">
            <Server />
          </span>
          <span className="servers-context__copy">
            <span className="servers-context__title">Joining with {installation.name}</span>
            <span className="servers-context__meta">
              Minecraft {installation.versionId}
              {installation.loader?.type && installation.loader.type !== 'vanilla' ? ` · ${installation.loader.type}` : ''} ·{' '}
              {installations.length} profile{installations.length === 1 ? '' : 's'} configured
            </span>
          </span>
          <Button size="sm" variant="ghost" icon={<Layers />} onClick={() => navigate('installations')}>
            Change
          </Button>
        </div>
      )}

      {loading && !servers.length ? (
        <div className="panel">
          <div className="mods-loading">
            <Spinner /> Loading saved servers…
          </div>
        </div>
      ) : !servers.length ? (
        <div className="panel">
          <EmptyState
            icon={<Server />}
            title={notFound ? 'Server list unavailable' : 'No servers saved yet'}
            description={
              notFound
                ? 'The launcher could not read its saved server list. Try again, or add a server manually.'
                : 'Add your favourite survival server, a creative plot, or a modded community. Aqua pings each one and joins it with the selected installation.'
            }
          >
            {notFound ? (
              <Button icon={<RefreshCw />} onClick={() => void loadServers()}>
                Try again
              </Button>
            ) : (
              <Button variant="primary" icon={<Plus />} onClick={openAdd}>
                Add your first server
              </Button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="server-grid" style={artworkStyle}>
          {servers.map((server) => {
            const status = statuses[server.id]
            const checking = pinging[server.id] || !status
            const online = Boolean(status?.online)
            const direct = status || null
            const lastJoinedAt = recentJoins[server.id] || server.lastJoinedAt
            return (
              <article key={server.id} className="server-card">
                <div className="server-card__top">
                  <span className="server-card__icon">
                    {direct?.favicon ? <img src={direct.favicon} alt="" /> : <Server strokeWidth={1.6} />}
                  </span>
                  <div className="server-card__identity">
                    <h2 className="server-card__name">
                      {server.name}
                      {server.edition === 'bedrock' ? (
                        <span className="server-card__edition" title="Runs Minecraft for Windows (Bedrock)">
                          Bedrock
                        </span>
                      ) : null}
                    </h2>
                    <span className="server-card__address mono" title={server.address}>
                      {server.connectAddress || server.address}
                    </span>
                  </div>
                  <div className="server-card__top-actions">
                    <span
                      className={cx(
                        'server-status',
                        checking && 'is-checking',
                        online && 'is-online',
                        !checking && !online && 'is-offline',
                      )}
                      title={status?.error || (online ? `${status?.latencyMs ?? 0} ms` : undefined)}
                    >
                      {checking ? <Loader2 className="spin" /> : online ? <Wifi /> : <WifiOff />}
                      {checking ? 'Checking' : online ? `${status?.latencyMs ?? 0} ms` : 'Offline'}
                    </span>
                    <CopyButton value={server.connectAddress || server.address} label="Copy server address" />
                    <ActionMenu
                      label={`Actions for ${server.name}`}
                      items={[
                        {
                          label: 'Edit server',
                          icon: <Pencil />,
                          onSelect: () => openEdit(server),
                        },
                        {
                          label: 'Ping again',
                          icon: <RefreshCw />,
                          disabled: pinging[server.id],
                          onSelect: () => void pingOne(server),
                        },
                        { separator: true },
                        {
                          label: 'Remove server',
                          icon: <Trash2 />,
                          danger: true,
                          onSelect: () => setDeleteTarget(server),
                        },
                      ]}
                    />
                  </div>
                </div>

                <p className={cx('server-card__motd', !online && 'is-offline')}>
                  {checking
                    ? 'Pinging the server…'
                    : online
                      ? status?.motd || 'A Minecraft server'
                      : status?.error || 'The server could not be reached.'}
                </p>

                {online && status?.players.sample.length ? (
                  <div className="server-card__players">
                    {status.players.sample.slice(0, 6).map((player) => (
                      <span key={`${player.name}-${player.id || ''}`}>{player.name}</span>
                    ))}
                    {status.players.sample.length > 6 ? (
                      <span>+{status.players.sample.length - 6} more</span>
                    ) : null}
                  </div>
                ) : null}

                <div className="server-card__meta">
                  <span title="Players online">
                    <Users />
                    {online ? `${status?.players.online.toLocaleString()} / ${status?.players.max.toLocaleString()}` : '—'}
                  </span>
                  <span title="Server version">
                    <Boxes />
                    {online ? status?.version || 'Unknown' : '—'}
                  </span>
                  <span title="Last joined from Aqua">
                    <Clock />
                    {lastJoinedAt ? relativeTime(lastJoinedAt) : 'Never joined'}
                  </span>
                </div>

                <div className="server-card__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={installationBusy ? <Loader2 className="spin" /> : <Play />}
                    disabled={!canJoinServer(server) || gameBusy || installationBusy}
                    onClick={() => void handleJoin(server)}
                    title={gameBusy ? 'Minecraft is already running' : joinBlockedReason(server)}
                  >
                    {installationBusy ? 'Launching…' : gameBusy ? 'In game' : 'Join server'}
                  </Button>
                  <span className="server-card__join-note">
                    {server.edition === 'bedrock'
                      ? bedrockEdition
                        ? `Opens ${bedrockEdition.name}`
                        : 'Bedrock not installed'
                      : installation
                        ? installation.name
                        : 'No installation selected'}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="callout callout--info servers-footnote">
        <Info />
        <span>
          Java servers: offline profiles can only join servers with <span className="mono">online-mode=false</span>.
          Online-mode servers require Microsoft sign-in, which is currently unavailable in Aqua. Bedrock servers always
          sign in with the Xbox profile the Store edition is already using.
        </span>
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => {
          if (saving) return
          setDialog(null)
        }}
        title={dialog?.mode === 'edit' ? 'Edit server' : 'Add a server'}
        subtitle={
          dialog?.mode === 'edit'
            ? 'Update how this server appears in Aqua.'
            : form.edition === 'bedrock'
              ? 'Bedrock servers open Minecraft for Windows and sign in with your Xbox profile.'
              : 'Save a Java server address for one-click joins. No account is needed to save it.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="server-form"
              variant="primary"
              loading={saving}
              icon={<Server />}
            >
              {dialog?.mode === 'edit' ? 'Save changes' : 'Add server'}
            </Button>
          </>
        }
      >
        <form
          id="server-form"
          className="server-form"
          onSubmit={(event) => {
            event.preventDefault()
            void saveServer()
          }}
        >
          {dialog?.mode === 'edit' ? (
            <div className="server-form__edition">
              <span className="field__label">Edition</span>
              <span className={cx('chip', form.edition === 'bedrock' && 'is-active')}>
                {EDITION_LABELS[form.edition]}
              </span>
              <span className="field__hint">A saved server keeps its edition. Remove it and add it again to switch.</span>
            </div>
          ) : (
            <Field label="Edition" hint="Bedrock servers open Minecraft for Windows; Java servers launch a launcher profile.">
              <div className="segmented" role="radiogroup" aria-label="Server edition">
                {(['java', 'bedrock'] as const).map((edition) => (
                  <button
                    key={edition}
                    type="button"
                    role="radio"
                    aria-checked={form.edition === edition}
                    className={cx(form.edition === edition && 'is-active')}
                    onClick={() => setForm((current) => ({ ...current, edition }))}
                  >
                    {EDITION_LABELS[edition]}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Display name" hint="Optional. The address is used when this is blank." htmlFor="server-name">
            <input
              id="server-name"
              className="input"
              data-autofocus
              value={form.name}
              maxLength={60}
              placeholder="Survival with friends"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field
            label="Server address"
            hint={
              form.edition === 'bedrock'
                ? 'Host name or IP of a Bedrock server. The port defaults to 19132.'
                : 'Host name or IP, optionally with a port. Example: play.example.com:25565'
            }
            error={formError}
            htmlFor="server-address"
          >
            <input
              id="server-address"
              className="input"
              value={form.address}
              maxLength={300}
              placeholder={form.edition === 'bedrock' ? 'bedrock.example.com:19132' : 'play.example.com'}
              onChange={(event) => {
                setForm((current) => ({ ...current, address: event.target.value }))
                if (formError) setFormError(null)
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this server?"
        description={
          <>
            <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong> will be removed from your saved server
            list. The server itself and any worlds stored on it are untouched.
          </>
        }
        confirmLabel="Remove server"
        loading={deleting}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
        onConfirm={() => void removeServer()}
      />
    </div>
  )
}
