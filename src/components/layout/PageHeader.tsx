import type { ReactNode } from 'react'

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: string
  title: ReactNode
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {kicker ? <span className="page-header__kicker">{kicker}</span> : null}
        <h1 className="page-header__title">{title}</h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}
