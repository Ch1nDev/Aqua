import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title?: ReactNode
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      {title || subtitle ? (
        <div className="page-header__copy">
          {title ? <h1 className="page-header__title">{title}</h1> : null}
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
        </div>
      ) : null}
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}
