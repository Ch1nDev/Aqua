import { api } from '../../lib/api'

/**
 * A thin transparent band along the top edge. The content now covers the whole
 * window, so this is the only draggable region left: drag it to move the
 * window, double click it to maximize.
 */
export function Titlebar() {
  return (
    <div
      className="window-drag"
      aria-hidden="true"
      onDoubleClick={() => void api.windowControls.toggleMaximize()}
    />
  )
}
