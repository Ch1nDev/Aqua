import { useMemo, useState } from 'react'
import readmeSource from '../../README.md?raw'
import roadmapSource from '../../ROADMAP.md?raw'
import { Markdown } from '../components/docs/Markdown'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge, cx } from '../components/ui/primitives'
import { parseRoadmap, statusLabel } from '../lib/roadmap'

type Tab = 'roadmap' | 'readme'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'readme', label: 'README' },
]

export function DocsPage() {
  const [tab, setTab] = useState<Tab>('roadmap')
  const phases = useMemo(() => parseRoadmap(roadmapSource), [])
  const features = phases.flatMap((phase) => phase.features)
  const shipped = features.filter((feature) => feature.status === 'done').length

  return (
    <div className="page page--docs">
      <PageHeader
        title="Roadmap & docs"
        subtitle={
          tab === 'roadmap'
            ? 'What the launcher does today, and what is planned next.'
            : 'Everything Aqua supports, how it behaves, and where it keeps your files.'
        }
        actions={
          <div className="segmented" role="tablist" aria-label="Documentation">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={cx(tab === entry.id && 'is-active')}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'roadmap' ? (
        <div className="docs">
          <p className="docs-summary">
            {features.length} features across {phases.length} phases · {shipped} shipped
          </p>

          {phases.map((phase) => (
            <section className="docs-phase" key={phase.number}>
              <header className="docs-phase__head">
                <span className="docs-phase__kicker">Phase {phase.number}</span>
                <h2 className="docs-phase__title">{phase.title}</h2>
                {phase.summary ? <p className="docs-phase__summary">{phase.summary}</p> : null}
              </header>

              <ul className="docs-features">
                {phase.features.map((feature) => {
                  const status = statusLabel(feature.status)
                  return (
                    <li className="docs-feature" key={feature.id}>
                      <div className="docs-feature__head">
                        <h3 className="docs-feature__title">{feature.title}</h3>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="docs-feature__outcome">{feature.outcome}</p>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <article className="docs-article">
          <Markdown source={readmeSource} />
        </article>
      )}
    </div>
  )
}
