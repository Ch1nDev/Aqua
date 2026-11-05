import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileArchive, Gamepad2, Server, TriangleAlert } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useLauncher } from '../../state/LauncherProvider'
import type { Installation, LinkIntent } from '../../lib/types'
import { Button, Spinner } from '../ui/primitives'
import { Modal } from '../ui/overlays'

function findInstallation(installations: Installation[], value: string | null) {
  if (!value) return null
  const key = value.trim().toLowerCase()
  return (
    installations.find((installation) => installation.id === value) ||
    installations.find((installation) => installation.name.trim().toLowerCase() === key) ||
    null
  )
}

function fileName(value: string) {
  return value.split(/[\\/]/).pop() || value
}

function fileTypeLabel(intent: Extract<LinkIntent, { kind: 'openFile' }>) {
  switch (intent.fileType) {
    case 'mrpack':
      return 'Modrinth modpack'
    case 'mcworld':
      return 'Bedrock world'
    default:
      return 'Bedrock add-on'
  }
}

function intentTitle(intent: LinkIntent) {
  switch (intent.kind) {
    case 'launch':
      return 'Launch a profile?'
    case 'join':
      return 'Join a server?'
    case 'install':
      return 'Install a modpack?'
    case 'openFile':
      return 'Open this file?'
    default:
      return 'Open Aqua?'
  }
}

export function LinkIntentDialog() {
  const {
    linkIntent,
    dismissLinkIntent,
    installations,
    selectedInstallation,
    navigate,
    play,
    joinServer,
    refreshInstallations,
    pushToast,
    bedrock,
  } = useLauncher()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handled = useRef<LinkIntent | null>(null)

  const run = useCallback(
    async (intent: LinkIntent) => {
      setBusy(true)
      setError(null)
      try {
        if (intent.kind === 'launch') {
          const target = findInstallation(installations, intent.instance) || (intent.instance ? null : selectedInstallation)
          if (!target) {
            throw new Error(
              intent.instance
                ? `No installation named “${intent.instance}” was found.`
                : 'Select an installation before using a launch link.',
            )
          }
          await play(target.id)
          navigate('home')
        } else if (intent.kind === 'join') {
          const explicit = findInstallation(installations, intent.instance)
          if (intent.instance && !explicit) throw new Error(`No installation named “${intent.instance}” was found.`)
          let saved = null
          try {
            const servers = await api.servers.list()
            const address = intent.server.toLowerCase()
            const editionPort = intent.edition === 'bedrock' ? ':19132' : ':25565'
            const matches = (value: string) => {
              const candidate = value.toLowerCase()
              return candidate === address || candidate === `${address}${editionPort}` || `${candidate}${editionPort}` === address
            }
            saved =
              servers.find((server) => matches(server.connectAddress || server.address)) ||
              servers.find((server) => matches(server.address)) ||
              null
          } catch {
            // A missing server list does not block a direct join.
          }
          await joinServer(saved?.id ?? null, intent.server, intent.edition, {
            installationId: explicit?.id ?? saved?.installationId ?? null,
            serverName: saved?.name ?? 'Aqua link',
          })
        } else if (intent.kind === 'install') {
          const result = await api.mods.installModpack(intent.project)
          await refreshInstallations()
          pushToast({
            level: 'success',
            title: 'Modpack installed',
            message: `${result.installation.name} was created from the link.`,
          })
          navigate('installations')
        } else if (intent.kind === 'openFile') {
          if (intent.fileType === 'mrpack') {
            const info = await api.mods.inspectPack(intent.path)
            await api.mods.importPack(info.path, 'copy')
            await refreshInstallations()
            pushToast({
              level: 'info',
              title: `Importing ${info.name}`,
              message: 'Track progress in Tasks. The source .mrpack is left untouched.',
            })
            navigate('installations')
          } else {
            const editionId = bedrock?.editions?.[0]?.id
            if (!editionId) {
              throw new Error('No Minecraft for Windows installation was found. Install Bedrock Edition first.')
            }
            const result = await api.bedrock.importAddon(editionId, intent.path)
            if (result.installed.length) {
              pushToast({
                level: 'success',
                title: `Imported ${result.installed.map((pack) => pack.name).join(', ')}`,
                message: 'Enable it per world under Settings → Add-Ons in Minecraft.',
              })
            } else if (result.worlds.length) {
              pushToast({
                level: 'success',
                title: 'Imported a Bedrock world',
                message: `The world is in ${result.worlds.join(', ')}.`,
              })
              navigate('worlds')
            } else {
              throw new Error(result.skipped[0] || 'That file did not contain a Bedrock pack or world.')
            }
          }
        }
        dismissLinkIntent()
      } catch (cause) {
        setError(getErrorMessage(cause))
      } finally {
        setBusy(false)
      }
    },
    [
      bedrock,
      dismissLinkIntent,
      installations,
      joinServer,
      navigate,
      play,
      pushToast,
      refreshInstallations,
      selectedInstallation,
    ],
  )

  useEffect(() => {
    if (!linkIntent) {
      setBusy(false)
      setError(null)
      handled.current = null
      return
    }
    if (linkIntent.kind === 'open') {
      if (handled.current === linkIntent) return
      handled.current = linkIntent
      navigate(linkIntent.page, {
        ...(linkIntent.contentType ? { contentType: linkIntent.contentType } : {}),
        ...(linkIntent.section ? { section: linkIntent.section } : {}),
      })
      dismissLinkIntent()
      return
    }
    if (!linkIntent.confirmed || handled.current === linkIntent) return
    handled.current = linkIntent
    void run(linkIntent)
  }, [dismissLinkIntent, linkIntent, navigate, run])

  if (!linkIntent || linkIntent.kind === 'open') return null

  const external = linkIntent.source === 'link'
  const source =
    linkIntent.kind === 'openFile' ? 'Windows' : external ? 'an external link' : 'the command line'
  const actionLabel =
    linkIntent.kind === 'install'
      ? 'Install'
      : linkIntent.kind === 'join'
        ? 'Join'
        : linkIntent.kind === 'openFile'
          ? linkIntent.fileType === 'mrpack'
            ? 'Import pack'
            : linkIntent.fileType === 'mcworld'
              ? 'Import world'
              : 'Import add-on'
          : 'Launch'

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) dismissLinkIntent()
      }}
      title={intentTitle(linkIntent)}
      subtitle={`Requested by ${source}.`}
      size="sm"
      footer={
        <>
          <Button onClick={dismissLinkIntent} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run(linkIntent)}>
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className="link-intent">
        <div className="link-intent__action">
          <span className="link-intent__icon">
            {linkIntent.kind === 'launch' ? (
              <Gamepad2 />
            ) : linkIntent.kind === 'join' ? (
              <Server />
            ) : linkIntent.kind === 'openFile' ? (
              <FileArchive />
            ) : (
              <Download />
            )}
          </span>
          <div className="link-intent__copy">
            {linkIntent.kind === 'launch' ? (
              <>
                <strong>{findInstallation(installations, linkIntent.instance)?.name || linkIntent.instance || 'Selected profile'}</strong>
                <span>Launches the same profile the Play button uses.</span>
              </>
            ) : linkIntent.kind === 'join' ? (
              <>
                <strong>{linkIntent.server}</strong>
                <span>
                  {linkIntent.edition === 'bedrock' ? 'Bedrock Edition' : 'Java Edition'}
                  {linkIntent.instance ? ` · ${linkIntent.instance}` : ' · saved profile binding when available'}
                </span>
              </>
            ) : linkIntent.kind === 'openFile' ? (
              <>
                <strong>{fileName(linkIntent.path)}</strong>
                <span>{fileTypeLabel(linkIntent)} · Double-clicked in Windows.</span>
                <code className="link-intent__path">{linkIntent.path}</code>
              </>
            ) : (
              <>
                <strong>{linkIntent.project}</strong>
                <span>A new installation is created and its files are downloaded.</span>
              </>
            )}
          </div>
        </div>

        <div className="callout callout--warning">
          <TriangleAlert />
          <span>
            {linkIntent.kind === 'openFile'
              ? 'Aqua only reads the file after you confirm. The original file is left in place.'
              : `Deep links and commands are untrusted input. Only continue if you expected this action.${
                  linkIntent.confirmed ? ' The CLI passed --yes, so it was already accepted.' : ''
                }`}
          </span>
        </div>

        {busy ? (
          <div className="link-intent__working">
            <Spinner /> Working…
          </div>
        ) : null}

        {error ? (
          <div className="callout callout--danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
