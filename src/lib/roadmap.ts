/**
 * Turns the agent roadmap into something a player can read.
 *
 * The roadmap is written for whoever builds the next package: it carries build
 * steps, contracts, verification commands and out-of-scope lists. None of that
 * belongs in the launcher. This module keeps only the user-facing part of each
 * package — its title and its `**Outcome:**` paragraph — plus the phase summary
 * and the shipped/planned state from the progress tracker.
 *
 * A package with no explicit `**Outcome:**` is dropped rather than guessed at,
 * because everything else in a package block describes how it is built.
 */

export type RoadmapStatus = 'done' | 'in-progress' | 'todo' | 'blocked'

export interface RoadmapFeature {
  id: string
  title: string
  outcome: string
  status: RoadmapStatus
}

export interface RoadmapPhase {
  number: number
  title: string
  summary: string | null
  features: RoadmapFeature[]
}

const PHASE_TABLE_ROW = /^\|\s*(\d)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/
const PHASE_HEADING = /^##\s+\d+\.\s+Phase\s+(\d+)\s*[—–-]\s*(.+?)\s*$/
const FEATURE_HEADING = /^###\s+(P\d\.\d)\s*[·•]\s*(.+?)\s*$/
const OUTCOME_LINE = /^\*\*Outcome:\*\*\s*(.*)$/
const TRACKER_ROW = /^\|\s*(P\d\.\d)\s+[^|]*\|\s*([^|]*?)\s*\|/

/** Lines that end an outcome paragraph. */
function endsBlock(line: string): boolean {
  return (
    !line.trim() ||
    line.startsWith('#') ||
    line.startsWith('**') ||
    line.startsWith('-') ||
    line.startsWith('|') ||
    line.startsWith('>') ||
    /^-{3,}$/.test(line.trim())
  )
}

function readStatus(value: string): RoadmapStatus {
  const text = value.toLowerCase()
  if (text.includes('done')) return 'done'
  if (text.includes('progress')) return 'in-progress'
  if (text.includes('block')) return 'blocked'
  return 'todo'
}

export function statusLabel(status: RoadmapStatus): { label: string; tone: 'success' | 'info' | 'warning' | 'default' } {
  switch (status) {
    case 'done':
      return { label: 'Shipped', tone: 'success' }
    case 'in-progress':
      return { label: 'In progress', tone: 'info' }
    case 'blocked':
      return { label: 'Not scheduled', tone: 'warning' }
    default:
      return { label: 'Planned', tone: 'default' }
  }
}

export function parseRoadmap(source: string): RoadmapPhase[] {
  const lines = source.split(/\r?\n/)

  // The progress tracker is the only place that knows which packages shipped.
  const statuses = new Map<string, RoadmapStatus>()
  for (const line of lines) {
    const tracker = TRACKER_ROW.exec(line)
    if (tracker) statuses.set(tracker[1], readStatus(tracker[2]))
  }

  // "Roadmap at a glance": phase number, theme, packages, exit outcome. The exit
  // outcome is already written in user language, unlike the prose in each phase.
  const glance = new Map<number, { title: string; summary: string | null }>()
  for (const line of lines) {
    const row = PHASE_TABLE_ROW.exec(line)
    if (!row) continue
    const number = Number(row[1])
    if (glance.has(number)) continue
    glance.set(number, { title: row[2], summary: row[4] })
  }

  const phaseTitles = new Map<number, string>()
  for (const line of lines) {
    const heading = PHASE_HEADING.exec(line)
    if (heading) phaseTitles.set(Number(heading[1]), heading[2])
  }

  const phases = new Map<number, RoadmapFeature[]>()
  let phaseNumber: number | null = null
  let current: { id: string; title: string; outcome: string[]; stopped: boolean } | null = null

  const commit = () => {
    if (!current || phaseNumber == null) {
      current = null
      return
    }
    // Outcomes are shown as plain sentences, so inline Markdown markers are taken
    // out rather than rendered: "a `.mrpack`" reads as "a .mrpack".
    const outcome = current.outcome
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/[`*]/g, '')
      .trim()
    if (outcome) {
      const list = phases.get(phaseNumber) || []
      list.push({
        id: current.id,
        title: current.title,
        outcome,
        status: statuses.get(current.id) || 'todo',
      })
      phases.set(phaseNumber, list)
    }
    current = null
  }

  for (const line of lines) {
    const phaseHeading = PHASE_HEADING.exec(line)
    if (phaseHeading) {
      commit()
      phaseNumber = Number(phaseHeading[1])
      continue
    }
    const featureHeading = FEATURE_HEADING.exec(line)
    if (featureHeading) {
      commit()
      current = { id: featureHeading[1], title: featureHeading[2], outcome: [], stopped: false }
      continue
    }
    if (!current || current.stopped) continue
    const outcome = OUTCOME_LINE.exec(line)
    if (outcome) {
      current.outcome.push(outcome[1])
      continue
    }
    if (!current.outcome.length) continue
    // The outcome paragraph ends at the first blank line or the next marker, so
    // the build steps that follow it are never collected.
    if (endsBlock(line)) {
      current.stopped = true
      continue
    }
    current.outcome.push(line.trim())
  }
  commit()

  const numbers = [...new Set([...glance.keys(), ...phaseTitles.keys()])].sort((a, b) => a - b)
  return numbers
    .map((number) => ({
      number,
      title: glance.get(number)?.title || phaseTitles.get(number) || `Phase ${number}`,
      summary: glance.get(number)?.summary || null,
      features: phases.get(number) || [],
    }))
    .filter((phase) => phase.features.length > 0)
}
