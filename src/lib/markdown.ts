/**
 * A small Markdown reader for the two documents the launcher ships.
 *
 * The project does not carry a Markdown dependency, and the README/ROADMAP use a
 * narrow slice of the syntax: headings, paragraphs, lists, fenced code, tables,
 * quotes, rules, links, bold, inline code and badge images. This parses exactly
 * that slice into blocks; the React component turns blocks into elements.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^```(\w*)\s*$/
const RULE = /^(-{3,}|\*{3,}|_{3,})$/
const UL_ITEM = /^[-*]\s+(.*)$/
const OL_ITEM = /^\d+\.\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const TABLE_ROW = /^\|(.+)\|$/
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((cell) => cell.trim())
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = FENCE.exec(line.trim())
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index].trim())) {
        body.push(lines[index])
        index += 1
      }
      index += 1 // closing fence
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }

    if (RULE.test(line.trim())) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    // A table starts with a row and is confirmed by the separator underneath.
    if (TABLE_ROW.test(line.trim()) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1].trim())) {
      const head = splitRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && TABLE_ROW.test(lines[index].trim())) {
        rows.push(splitRow(lines[index]))
        index += 1
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      const body = [quote[1]]
      index += 1
      while (index < lines.length) {
        const next = QUOTE.exec(lines[index])
        if (!next) break
        body.push(next[1])
        index += 1
      }
      blocks.push({ kind: 'quote', text: body.join(' ').trim() })
      continue
    }

    const bullet = UL_ITEM.exec(line)
    const numbered = OL_ITEM.exec(line)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      const items: string[] = []
      while (index < lines.length) {
        const match = ordered ? OL_ITEM.exec(lines[index]) : UL_ITEM.exec(lines[index])
        if (match) {
          items.push(match[1].trim())
          index += 1
          continue
        }
        // An indented line continues the item above it.
        const continuation = /^\s{2,}(\S.*)$/.exec(lines[index])
        if (continuation && items.length) {
          items[items.length - 1] = `${items[items.length - 1]} ${continuation[1].trim()}`
          index += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      if (
        !next.trim() ||
        HEADING.test(next) ||
        RULE.test(next.trim()) ||
        UL_ITEM.test(next) ||
        OL_ITEM.test(next) ||
        QUOTE.test(next) ||
        FENCE.test(next.trim()) ||
        TABLE_ROW.test(next.trim())
      ) {
        break
      }
      paragraph.push(next.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

/**
 * Shields-style badge URLs carry their own label: `badge/Electron-45-2b2e3a`
 * is "Electron 45". The renderer cannot load remote images (the CSP allows only
 * launcher and Modrinth hosts), so badges are shown as text using this.
 */
export function badgeLabel(url: string, alt = ''): string | null {
  const match = /^https?:\/\/img\.shields\.io\/badge\/([^/?#]+)/.exec(url)
  if (!match) return null
  const parts = decodeURIComponent(match[1]).split('-').filter(Boolean)
  if (!parts.length) return alt || null
  const hex = /^[0-9a-f]{3,8}$/i
  if (parts.length > 2 && hex.test(parts[parts.length - 1])) parts.pop()
  return parts.join(' ')
}
