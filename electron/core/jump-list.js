const PROFILE_LIMIT = 5
const MAX_TITLE = 80
const MAX_DESCRIPTION = 260

const LOADER_LABELS = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function timestamp(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function argsFor(url) {
  return `"${url}"`
}

function item({ title, description, url, program }) {
  return {
    type: 'task',
    title: text(title, MAX_TITLE),
    description: text(description, MAX_DESCRIPTION),
    program,
    args: argsFor(url),
  }
}

/**
 * Builds the Windows jump-list categories from already-serialized profiles
 * (the same rows the renderer sees) and saved servers. The caller owns
 * `app.setJumpList`; this module stays Electron-free.
 */
export function buildJumpListCategories({
  installations = [],
  servers = [],
  execPath = '',
  limit = PROFILE_LIMIT,
} = {}) {
  if (typeof execPath !== 'string' || !execPath) return []
  const maxProfiles = Math.max(0, Math.min(PROFILE_LIMIT, Number(limit) || PROFILE_LIMIT))

  const profiles = (Array.isArray(installations) ? installations : [])
    .filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        entry.id &&
        typeof entry.name === 'string' &&
        entry.name.trim() &&
        entry.installed !== false,
    )
    .sort(
      (left, right) =>
        timestamp(right.lastPlayedAt) - timestamp(left.lastPlayedAt) ||
        timestamp(right.updatedAt) - timestamp(left.updatedAt),
    )
    .slice(0, maxProfiles)
    .map((entry) => {
      const loader = LOADER_LABELS[entry.loader?.type] || text(entry.loader?.type, 24) || 'Vanilla'
      const version = text(entry.versionId, 32)
      return item({
        title: entry.name,
        description: `${version ? `Minecraft ${version} · ` : ''}${loader}`,
        url: `aqua://launch?instance=${encodeURIComponent(entry.id)}`,
        program: execPath,
      })
    })

  const server = (Array.isArray(servers) ? servers : [])
    .filter(
      (entry) =>
        entry &&
        typeof entry.name === 'string' &&
        entry.name.trim() &&
        (typeof entry.connectAddress === 'string' || typeof entry.address === 'string'),
    )
    .sort(
      (left, right) =>
        timestamp(right.lastJoinedAt) - timestamp(left.lastJoinedAt) ||
        timestamp(right.addedAt) - timestamp(left.addedAt),
    )[0]

  const categories = []
  if (profiles.length) {
    categories.push({ type: 'custom', name: 'Recent profiles', items: profiles })
  }
  if (server) {
    const edition = server.edition === 'bedrock' ? 'bedrock' : 'java'
    const address = text(server.connectAddress || server.address, 300)
    if (address) {
      categories.push({
        type: 'custom',
        name: 'Last server',
        items: [
          item({
            title: `Join ${server.name}`,
            description: `${edition === 'bedrock' ? 'Bedrock Edition' : 'Java Edition'} · ${address}`,
            url: `aqua://join?server=${encodeURIComponent(address)}&edition=${edition}`,
            program: execPath,
          }),
        ],
      })
    }
  }
  return categories
}
