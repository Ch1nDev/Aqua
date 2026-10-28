import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { Check, Copy, UserRound } from 'lucide-react'
import { api } from '../../lib/api'

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'subtle' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'default',
  size = 'md',
  block = false,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'btn',
        variant !== 'default' && `btn--${variant}`,
        size !== 'md' && `btn--${size}`,
        block && 'btn--block',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
  tone?: 'default' | 'danger'
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  label,
  size = 'md',
  tone = 'default',
  className,
  children,
  ref,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'icon-btn',
        size === 'sm' && 'icon-btn--sm',
        tone === 'danger' && 'icon-btn--danger',
        className,
      )}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Spinner({ size = 'md', label }: { size?: 'md' | 'lg'; label?: string }) {
  return (
    <span
      className={cx('spinner', size === 'lg' && 'spinner--lg')}
      role={label ? 'status' : undefined}
      aria-label={label}
    />
  )
}

export function ProgressBar({
  value,
  thin = false,
  danger = false,
  label,
}: {
  value: number | null
  thin?: boolean
  danger?: boolean
  label?: string
}) {
  const indeterminate = value == null || !Number.isFinite(value)
  const safeValue = indeterminate ? 38 : Math.max(0, Math.min(100, value))
  return (
    <div
      className={cx('progress', thin && 'progress--thin', indeterminate && 'is-indeterminate')}
      role="progressbar"
      aria-label={label || 'Progress'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(safeValue)}
    >
      <div
        className={cx('progress__bar', danger && 'progress__bar--danger')}
        style={{ width: `${safeValue}%` }}
      />
    </div>
  )
}

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'snapshot' | 'beta' | 'alpha'

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return <span className={cx('badge', tone !== 'default' && `badge--${tone}`, className)}>{children}</span>
}

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name?: string | null
  src?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizeClass = size === 'md' ? '' : `avatar--${size}`
  const initials = name
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('')
    : ''
  return (
    <span className={cx('avatar', sizeClass, !src && 'avatar--empty', className)} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : initials || <UserRound strokeWidth={1.6} />}
    </span>
  )
}

export function Field({
  label,
  note,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string
  note?: string
  hint?: string
  error?: string | null
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('field', className)}>
      <label className="field__label" htmlFor={htmlFor}>
        <span>{label}</span>
        {note ? <span className="field__label-note">{note}</span> : null}
      </label>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label className="checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="checkbox__box">
        <Check strokeWidth={3} />
      </span>
      <span>{children}</span>
    </label>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    try {
      if (api?.copyText) {
        api.copyText(value)
      } else {
        await navigator.clipboard.writeText(value)
      }
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <IconButton label={copied ? 'Copied' : label} size="sm" onClick={() => void copy()}>
      {copied ? <Check strokeWidth={2.4} /> : <Copy />}
    </IconButton>
  )
}

export function FieldRow({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="choice-row">
      <div className="choice-row__copy">
        <span className="choice-row__title">{title}</span>
        {description ? <span className="choice-row__description">{description}</span> : null}
      </div>
      <div className="row gap-3">{children}</div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3 className="empty__title">{title}</h3>
      {description ? <p className="empty__description">{description}</p> : null}
      {children ? <div className="empty__actions">{children}</div> : null}
    </div>
  )
}
