import { useEffect, useState } from 'react'
import { useLauncher } from '../../state/LauncherProvider'
import {
  OPEN_SHORTCUTS_EVENT,
  SHORTCUTS,
  isEditableTarget,
  matchShortcut,
  pageForShortcut,
} from '../../lib/shortcuts'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'
import { openCommandPalette } from '../command/CommandPalette'

function topLayerOpen() {
  return Boolean(document.querySelector('.modal-overlay'))
}

function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      subtitle="These work anywhere in Aqua unless a text field has focus."
      size="sm"
      className="shortcut-sheet-modal"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="shortcut-sheet">
        {SHORTCUTS.map((shortcut) => (
          <div className="shortcut-sheet__row" key={shortcut.id}>
            <div className="shortcut-sheet__copy">
              <strong>{shortcut.title}</strong>
              <span>{shortcut.description}</span>
            </div>
            <span className="shortcut-sheet__keys">
              <kbd>{shortcut.keys}</kbd>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/**
 * The single global shortcut handler. It reads the same table as the cheat
 * sheet and leaves all keystrokes alone while the user is typing.
 */
export function ShortcutController() {
  const {
    selectedInstallation,
    bedrockTarget,
    horizonTarget,
    launchBedrock,
    launchHorizon,
    play,
    navigate,
    pushToast,
  } = useLauncher()
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setSheetOpen(true)
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      if (isEditableTarget(event.target) || topLayerOpen()) return

      const shortcut = matchShortcut(event)
      if (!shortcut) return
      // Modals own Escape for focus return and nested-layer ordering.
      if (shortcut.id === 'dismiss') return

      event.preventDefault()
      switch (shortcut.id) {
        case 'search':
          openCommandPalette()
          break
        case 'play':
          if (bedrockTarget) {
            void launchBedrock(bedrockTarget.id)
          } else if (horizonTarget) {
            void launchHorizon(horizonTarget)
          } else if (selectedInstallation) {
            void play(selectedInstallation.id)
          } else {
            pushToast({
              level: 'info',
              title: 'Choose an installation',
              message: 'Select a profile before launching with Ctrl+Enter.',
            })
          }
          break
        case 'pages': {
          const page = pageForShortcut(event)
          if (page) navigate(page)
          break
        }
        case 'settings':
          navigate('settings')
          break
        case 'help':
          setSheetOpen(true)
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    bedrockTarget,
    horizonTarget,
    launchBedrock,
    launchHorizon,
    navigate,
    play,
    pushToast,
    selectedInstallation,
  ])

  return <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
}
