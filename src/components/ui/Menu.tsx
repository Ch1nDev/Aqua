import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { IconButton, cx } from './primitives'

export interface MenuAction {
  label?: string
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export function ActionMenu({
  items,
  label = 'More options',
  trigger,
  className,
}: {
  items: MenuAction[]
  label?: string
  trigger?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const triggerElement = triggerRef.current
      if (!triggerElement) return
      const rect = triggerElement.getBoundingClientRect()
      const width = 200
      const estimatedHeight = Math.max(44, items.length * 38 + 10)
      let left = rect.right - width
      let top = rect.bottom + 6
      if (left < 10) left = 10
      if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10
      if (top + estimatedHeight > window.innerHeight - 10) top = rect.top - estimatedHeight - 6
      setPosition({ top, left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, items.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    const timer = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    }, 20)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
    }
  }, [open])

  return (
    <>
      {trigger ? (
        <button
          ref={triggerRef}
          type="button"
          className={cx('btn', 'btn--ghost', 'btn--sm', className)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((value) => !value)}
        >
          {trigger}
        </button>
      ) : (
        <IconButton
          ref={triggerRef}
          label={label}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={className}
        >
          <MoreHorizontal />
        </IconButton>
      )}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            aria-label={label}
            style={{ position: 'fixed', top: position.top, left: position.left, right: 'auto' }}
          >
            {items.map((item, index) =>
              item.separator ? (
                <div key={`separator-${index}`} className="menu__divider" role="separator" />
              ) : (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  className={cx('menu__item', item.danger && 'menu__item--danger')}
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect?.()
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
