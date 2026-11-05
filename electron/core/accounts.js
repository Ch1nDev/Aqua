import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeStorage, shell } from 'electron'
import { atomicWriteFile, errorMessage, fetchWithRetry } from './util.js'
import { describeMissingCredentials, readMicrosoftCredentials } from './private-credentials.js'

// Minecraft Java Edition is tied to personal Microsoft accounts, and the
// XboxLive.signin scope only exists in the consumer tenant. /common resolves to
// a work tenant for organizational accounts, which rejects that scope outright,
// so the consumer endpoint is used for both authorize and token requests.
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const AUTHORIZE_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
const SCOPES = 'XboxLive.signin offline_access'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// The launcher icon is small enough to inline into the sign-in page, which is
// served from a loopback callback and cannot load app assets by URL.
const AUTH_ICON_FILES = [path.join(APP_ROOT, 'dist', 'icon.png'), path.join(APP_ROOT, 'public', 'icon.png')]

let authIconPromise = null

function authIconDataUrl() {
  if (!authIconPromise) {
    authIconPromise = (async () => {
      for (const file of AUTH_ICON_FILES) {
        const bytes = await fsp.readFile(file).catch(() => null)
        if (bytes?.length) return 'data:image/png;base64,' + bytes.toString('base64')
      }
      return null
    })()
  }
  return authIconPromise
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** Deterministic offline UUID in the same format used by Minecraft servers. */
function offlinePlayerUuid(name) {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function friendlyMicrosoftError(status, body, grantType = '') {
  let parsed = null
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    parsed = null
  }
  const code = parsed?.error || ''
  const description = parsed?.error_description || parsed?.error || `HTTP ${status}`
  const aad = description.match(/AADSTS\d+/)?.[0] || ''
  const suffix = aad ? ` (${aad})` : ''
  if (aad === 'AADSTS700016' || aad === 'AADSTS7000218') {
    return 'Microsoft rejected the application ID. Check the client ID and enable public client flows in your Azure app registration.'
  }
  if (aad === 'AADSTS50011') {
    return 'Microsoft rejected the redirect URI. Add this desktop app redirect in Azure: http://localhost'
  }
  if (aad === 'AADSTS65001' || /consent/i.test(description)) {
    return 'Microsoft requires consent that could not be granted. Try signing in again with the same account.'
  }
  if (aad === 'AADSTS9002326') {
    return 'The Azure redirect URI is not configured as a mobile and desktop application. Add http://localhost as a mobile/desktop redirect.'
  }
  if (aad === 'AADSTS90023') {
    return 'This Azure app is registered as a public client, so Microsoft refuses a client secret. Remove clientSecret from private/microsoft.json: PKCE sign-in needs none.'
  }
  if (code === 'invalid_grant' || /expired|revoked/i.test(description)) {
    if (grantType === 'authorization_code') {
      return 'Microsoft rejected the sign-in code before it could be exchanged. Close the leftover sign-in tab and try again from the launcher.'
    }
    return 'Your Microsoft session has expired. Sign in again to continue.'
  }
  if (code === 'invalid_client') {
    return 'Microsoft does not recognize this client ID. Verify the Azure application ID in Settings.'
  }
  return `Microsoft sign-in failed${suffix}: ${description.replace(/\s+/g, ' ').slice(0, 320)}`
}

async function tokenRequest(params) {
  let response
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(25_000),
    })
  } catch (error) {
    throw new Error(`Could not reach Microsoft sign-in: ${error.message}`)
  }
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('Microsoft returned an unreadable response.')
  }
  if (!response.ok || body?.error) {
    const error = new Error(friendlyMicrosoftError(response.status, text, params?.grant_type))
    error.status = response.status
    error.aadCode = String(body?.error_description || body?.error || '').match(/AADSTS\d+/)?.[0] || ''
    error.authError = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'consent_required'].includes(
      body?.error,
    )
    throw error
  }
  return body
}

/**
 * Exchanges token parameters, adding the app secret only when one is configured.
 * A registration with public client flows enabled rejects a secret outright
 * (AADSTS90023), so that specific refusal is retried without it: PKCE desktop
 * clients never need a secret, and confidential apps still get theirs.
 */
async function requestToken(params, clientSecret) {
  if (!clientSecret) return tokenRequest(params)
  try {
    // The PKCE (public client) exchange is attempted first. A desktop app with
    // public client flows rejects a secret outright, and that rejected attempt
    // still invalidates the single-use authorization code, so the secret must
    // not be sent speculatively. A confidential registration answers
    // AADSTS7000218 instead, and only then is the code retried with the secret.
    return await tokenRequest(params)
  } catch (error) {
    if (error.aadCode !== 'AADSTS7000218' && error.aadCode !== 'AADSTS7000219') throw error
    return tokenRequest({ ...params, client_secret: clientSecret })
  }
}

async function postJson(url, body, { signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'AquaLauncher/1.0.0',
    },
    body: JSON.stringify(body),
    signal,
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const message = data?.XErr ? `Xbox error ${data.XErr}` : `${response.status} ${response.statusText}`
    const error = new Error(message)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

async function fetchMinecraftProfile(accessToken) {
  const profileResponse = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'AquaLauncher/1.0.0',
    },
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    throw new Error(`Could not read your Minecraft profile: ${error.message}`)
  })
  if (profileResponse.status === 404) {
    throw new Error('This account does not own Minecraft: Java Edition.')
  }
  if (!profileResponse.ok) {
    const error = new Error(
      profileResponse.status === 401
        ? 'Microsoft sign-in succeeded, but Minecraft rejected the session. If this keeps happening, check that your Azure app is approved for Minecraft services.'
        : `Minecraft profile request failed (HTTP ${profileResponse.status}).`,
    )
    error.authError = profileResponse.status === 401 || profileResponse.status === 403
    throw error
  }
  const profile = await profileResponse.json()
  if (!profile?.id || !profile?.name) throw new Error('Minecraft did not return a valid player profile.')
  return profile
}

function xstsMessage(xerr) {
  switch (Number(xerr)) {
    case 2148916233:
      return 'This Microsoft account does not have an Xbox profile. Sign in at xbox.com once, then try again.'
    case 2148916235:
      return 'Xbox Live is not available for this account’s country or region.'
    case 2148916236:
      return 'This account needs adult verification to use Xbox Live.'
    case 2148916237:
      return 'This Xbox account has been suspended.'
    case 2148916238:
      return 'This is a child account. An adult in a Microsoft family must add it before it can play online.'
    default:
      return 'Xbox Live rejected this account. Check your Xbox account at xbox.com and try again.'
  }
}

function authPage(ok, title, message, { artwork = null, icon = null } = {}) {
  const tone = ok ? '#7fe0b0' : '#ff9aa8'
  const label = ok ? 'Account connected' : 'Sign-in issue'
  const art = artwork
    ? `<div class="art" style="background-image:url('${artwork}')" aria-hidden="true"></div><div class="shade" aria-hidden="true"></div>`
    : ''
  const mark = icon
    ? `<img class="brand__icon" src="${icon}" alt="" width="30" height="30">`
    : '<span class="brand__icon brand__icon--fallback" aria-hidden="true">A</span>'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<title>${title} · Aqua Launcher</title>
<style>
  :root {
    --text: #ffffff;
    --body: #a3a3a3;
    --dim: #666666;
    --tone: ${tone};
    --display: 'Minecraftia', 'Cascadia Mono', ui-monospace, Consolas, monospace;
    --mono: 'Geist Mono', 'Cascadia Mono', ui-monospace, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 40px 20px;
    color: var(--body);
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(900px 600px at 50% 0%, rgba(41, 100, 164, 0.22), transparent 65%),
      #000000;
  }
  .art {
    position: fixed;
    inset: 0;
    background-color: #000000;
    background-size: cover;
    background-position: center;
  }
  .shade {
    position: fixed;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.58) 0%, rgba(0, 0, 0, 0.72) 48%, rgba(0, 0, 0, 0.88) 100%);
  }
  .card {
    position: relative;
    width: min(440px, 100%);
    padding: 30px 32px 28px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    background: rgba(12, 12, 12, 0.82);
    -webkit-backdrop-filter: blur(18px) saturate(1.1);
    backdrop-filter: blur(18px) saturate(1.1);
    box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.85);
  }
  .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 24px; }
  .brand__icon {
    display: block;
    width: 30px;
    height: 30px;
    flex: none;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 7px;
  }
  .brand__icon--fallback {
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
    font-family: var(--display);
    font-size: 14px;
  }
  .brand__name {
    display: block;
    font-family: var(--display);
    font-size: 14px;
    letter-spacing: 0.04em;
    line-height: 1.3;
    color: var(--text);
  }
  .brand__sub {
    display: block;
    font-size: 9px;
    letter-spacing: 0.2em;
    line-height: 1.4;
    text-transform: uppercase;
    color: var(--dim);
  }
  .eyebrow {
    margin: 0 0 8px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .title {
    margin: 0 0 10px;
    font-family: var(--display);
    font-size: 21px;
    font-weight: 400;
    line-height: 1.45;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .message { margin: 0; color: var(--body); }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 24px 0 0;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 11.5px;
    color: var(--dim);
  }
  .meta__dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--tone);
  }
</style>
</head>
<body>
  ${art}
  <main class="card" role="status">
    <div class="brand">
      ${mark}
      <span>
        <span class="brand__name">AQUA</span>
        <span class="brand__sub">Launcher</span>
      </span>
    </div>
    <h1 class="title">${title}</h1>
    <p class="message">${message}</p>
  </main>
</body>
</html>`
}

export class AccountManager {
  constructor({
    paths,
    store,
    logger,
    artworkService = null,
    emitAccounts,
    emitAuth,
    emitActivity,
    emitNotification,
  }) {
    this.paths = paths
    this.store = store
    this.logger = logger
    this.emitAccounts = emitAccounts
    this.emitAuth = emitAuth
    this.emitActivity = emitActivity
    this.emitNotification = emitNotification
    this.tokens = new Map()
    this.tokensLoaded = false
    this.persistenceAvailable = false
    this.storageLabel = 'Not available'
    this.activeLogin = null
    this.authState = { status: 'idle' }
    this.refreshInFlight = new Map()
    this.artworkService = artworkService
    this.authArtwork = null
    this.authArtworkPromise = null
    this.authIcon = null
  }

  get secureStorageAvailable() {
    return this.persistenceAvailable
  }

  async init() {
    this.authIcon = await authIconDataUrl()
    try {
      this.persistenceAvailable = safeStorage.isEncryptionAvailable()
    } catch {
      this.persistenceAvailable = false
    }
    if (this.persistenceAvailable) {
      this.storageLabel =
        process.platform === 'win32' ? 'Windows DPAPI' : process.platform === 'darwin' ? 'macOS Keychain' : 'System keyring'
    }
    await this.loadTokens()
    const validIds = new Set(this.tokens.keys())
    let changed = false
    for (const account of this.store.accounts) {
      if (account.type !== 'offline' && !validIds.has(account.id) && !account.sessionExpired) {
        await this.store.updateAccount(account.id, { sessionExpired: true })
        changed = true
      }
    }
    if (changed) this.logger.warn('Some accounts no longer have stored credentials')
    return {
      secureStorageAvailable: this.persistenceAvailable,
      storageLabel: this.storageLabel,
    }
  }

  async loadTokens() {
    if (this.tokensLoaded) return
    this.tokensLoaded = true
    if (!this.persistenceAvailable) {
      this.logger.warn('OS credential encryption is unavailable; sessions will only be kept in memory')
      return
    }
    try {
      const encrypted = await fsp.readFile(this.paths.accountsFile)
      const decrypted = safeStorage.decryptString(encrypted)
      const parsed = JSON.parse(decrypted)
      if (parsed?.tokens && typeof parsed.tokens === 'object') {
        for (const [id, token] of Object.entries(parsed.tokens)) {
          if (token?.refreshToken) this.tokens.set(id, token)
        }
      }
      this.logger.info('Loaded encrypted account credentials', { accounts: this.tokens.size })
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn('Could not read saved credentials', { message: error.message })
      }
    }
  }

  async saveTokens() {
    if (!this.persistenceAvailable) return
    const payload = JSON.stringify({ version: 1, tokens: Object.fromEntries(this.tokens) })
    const encrypted = safeStorage.encryptString(payload)
    await fsp.mkdir(path.dirname(this.paths.accountsFile), { recursive: true })
    await atomicWriteFile(this.paths.accountsFile, encrypted, { mode: 0o600 })
    await fsp.chmod(this.paths.accountsFile, 0o600).catch(() => {})
  }

  listPublic() {
    return this.store.accounts.map((account) => this.store.publicAccount(account))
  }

  accountsPayload() {
    return {
      accounts: this.listPublic(),
      activeAccountId: this.store.activeAccountId,
      secureStorageAvailable: this.persistenceAvailable,
      storageLabel: this.storageLabel,
    }
  }

  broadcastAccounts() {
    this.emitAccounts(this.accountsPayload())
  }

  setAuthState(state) {
    this.authState = state
    this.emitAuth({ ...state, secureStorageAvailable: this.persistenceAvailable })
  }

  getAuthState() {
    return this.authState
  }

  async signInOffline(rawName) {
    if (typeof rawName !== 'string') throw new Error('Enter a username for the offline profile.')
    const name = rawName.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      throw new Error('Offline usernames must be 3–16 characters and use only letters, numbers, and underscores.')
    }
    const existing = this.store.accounts.find(
      (account) => account.type === 'offline' && account.name.toLowerCase() === name.toLowerCase(),
    )
    const uuid = existing?.uuid || offlinePlayerUuid(name)
    const id = existing?.id || `offline-${uuid}`
    this.tokens.delete(id)
    await this.store.upsertAccount({
      id,
      type: 'offline',
      name,
      uuid,
      xuid: null,
      addedAt: existing?.addedAt || new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      expiresAt: null,
      sessionExpired: false,
      avatarDataUrl: null,
    })
    await this.store.setActiveAccount(id)
    this.broadcastAccounts()
    await this.store.addActivity({
      type: 'account',
      title: `Added offline profile ${name}`,
      detail: 'Singleplayer and LAN only',
      status: 'info',
    })
    this.emitActivity()
    this.emitNotification({
      level: 'success',
      title: 'Offline profile ready',
      message: `${name} can now launch singleplayer and LAN games.`,
    })
    this.logger.info('Offline profile selected', { name })
    return this.accountsPayload()
  }

  async beginLogin() {
    const credentials = readMicrosoftCredentials()
    const clientId = credentials.clientId
    if (!clientId) throw new Error(describeMissingCredentials(credentials))
    void this.prepareAuthArtwork()
    if (this.activeLogin && !this.activeLogin.settled) {
      this.cancelLogin()
    }
    const state = base64Url(crypto.randomBytes(24))
    const verifier = base64Url(crypto.randomBytes(48))
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest())

    const login = {
      id: crypto.randomUUID(),
      clientId,
      clientSecret: credentials.clientSecret,
      state,
      verifier,
      settled: false,
      server: null,
      timer: null,
      redirectUri: null,
    }

    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
      if (requestUrl.pathname !== '/callback') {
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end('Not found')
        return
      }
      const artwork = await this.authPageArtwork()
      if (login.settled) {
        response.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage(false, 'Sign-in already handled', 'This sign-in request was already completed.', {
            artwork,
            icon: this.authIcon,
          }),
        )
        return
      }
      if (requestUrl.searchParams.get('state') !== login.state) {
        login.settled = true
        clearTimeout(login.timer)
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage(false, 'Sign-in could not be verified', 'The security state did not match. Please try again.', {
            artwork,
            icon: this.authIcon,
          }),
        )
        server.close()
        this.failLogin(login, 'Microsoft sign-in could not be verified. Please try again.')
        return
      }
      const oauthError = requestUrl.searchParams.get('error')
      if (oauthError) {
        login.settled = true
        clearTimeout(login.timer)
        const description = requestUrl.searchParams.get('error_description') || oauthError
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage(false, 'Sign-in was not completed', 'You can return to Aqua and try again.', {
            artwork,
            icon: this.authIcon,
          }),
        )
        server.close()
        this.failLogin(login, description.replace(/\+/g, ' ').slice(0, 400))
        return
      }
      const code = requestUrl.searchParams.get('code')
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage(false, 'Missing authorization code', 'Please try signing in again.', {
            artwork,
            icon: this.authIcon,
          }),
        )
        return
      }
      login.settled = true
      clearTimeout(login.timer)
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        authPage(true, 'You’re signed in', 'You can close this window.', {
          artwork,
          icon: this.authIcon,
        }),
      )
      server.close()
      this.completeLogin(login, code).catch(() => {})
    })

    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    login.server = server
    login.redirectUri = `http://localhost:${address.port}/callback`
    this.activeLogin = login

    const authUrl = new URL(AUTHORIZE_ENDPOINT)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', login.redirectUri)
    authUrl.searchParams.set('response_mode', 'query')
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('prompt', 'select_account')

    login.timer = setTimeout(() => {
      if (login.settled) return
      login.settled = true
      this.activeLogin = null
      try {
        server.close()
      } catch {
        // Ignore close errors.
      }
      this.failLogin(login, 'Microsoft sign-in timed out. Please try again.')
    }, LOGIN_TIMEOUT_MS)

    this.setAuthState({
      status: 'waiting',
      url: authUrl.toString(),
      startedAt: new Date().toISOString(),
      message: 'Finish signing in with Microsoft in your browser.',
    })
    try {
      await shell.openExternal(authUrl.toString())
    } catch (error) {
      this.logger.warn('Could not open the system browser automatically', { message: errorMessage(error) })
    }
    return { url: authUrl.toString() }
  }

  /**
   * Kicks off the random version backdrop for the browser pages. The player
   * needs a few seconds to sign in, so it is normally ready by the callback.
   */
  prepareAuthArtwork() {
    this.authArtwork = null
    this.authArtworkPromise = (async () => {
      try {
        // Each sign-in picks a new release, while every page of that attempt
        // keeps showing the same backdrop.
        const art = await this.artworkService?.getRandomVersionArt?.({ fresh: true })
        this.authArtwork = art?.dataUrl || null
      } catch {
        this.authArtwork = null
      }
      return this.authArtwork
    })()
    return this.authArtworkPromise
  }

  /** The prepared backdrop, waiting briefly on the first page only. */
  async authPageArtwork() {
    if (!this.authArtworkPromise) this.prepareAuthArtwork()
    if (!this.authArtwork) {
      await Promise.race([
        this.authArtworkPromise,
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ])
    }
    return this.authArtwork
  }

  failLogin(login, message) {
    if (this.activeLogin?.id === login.id) this.activeLogin = null
    this.logger.warn('Microsoft sign-in failed', { message })
    this.setAuthState({ status: 'error', message, finishedAt: new Date().toISOString() })
  }

  async completeLogin(login, code) {
    try {
      this.setAuthState({
        status: 'finalizing',
        message: 'Verifying your Microsoft account…',
        startedAt: new Date().toISOString(),
      })
      const tokenBody = await requestToken(
        {
          client_id: login.clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: login.redirectUri,
          code_verifier: login.verifier,
          scope: SCOPES,
        },
        login.clientSecret,
      )
      const account = await this.authenticateMinecraft(tokenBody, login.clientId)
      await this.persistAccount(account)
      this.setAuthState({
        status: 'success',
        message: `Signed in as ${account.name}`,
        finishedAt: new Date().toISOString(),
      })
      this.logger.info('Microsoft account authenticated', { name: account.name, uuid: account.uuid })
      this.emitNotification({
        level: 'success',
        title: 'Signed in',
        message: `Welcome back, ${account.name}.`,
      })
      await this.store.addActivity({
        type: 'account',
        title: `Signed in as ${account.name}`,
        detail: 'Microsoft account',
        status: 'success',
      })
      this.emitActivity()
      this.broadcastAccounts()
      this.fetchAvatar(account.uuid, account.id).catch(() => {})
    } catch (error) {
      this.logger.warn('Microsoft authentication failed', { message: error.message })
      this.setAuthState({
        status: 'error',
        message: error.message,
        finishedAt: new Date().toISOString(),
      })
    } finally {
      if (this.activeLogin?.id === login.id) this.activeLogin = null
    }
  }

  async signInXbox(microsoftAccessToken) {
    let xbl
    try {
      xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${microsoftAccessToken}`,
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      })
    } catch (error) {
      const authError = error.status === 401 || error.status === 400
      const wrapped = new Error(`Xbox Live authentication failed: ${error.message}`)
      wrapped.authError = authError
      throw wrapped
    }
    let xsts
    try {
      xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xbl.Token],
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      })
    } catch (error) {
      const xerr = error.data?.XErr
      const wrapped = new Error(xerr ? xstsMessage(xerr) : `Xbox security token request failed: ${error.message}`)
      wrapped.authError = true
      throw wrapped
    }
    const claims = xsts?.DisplayClaims?.xui?.[0]
    if (!claims?.uhs) throw new Error('Xbox did not return a usable user hash.')

    let minecraftToken
    try {
      minecraftToken = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
        identityToken: `XBL3.0 x=${claims.uhs};${xsts.Token}`,
      })
    } catch (error) {
      if (error.status === 403 || /invalid app registration/i.test(JSON.stringify(error.data || ''))) {
        throw new Error(
          'Minecraft rejected this Azure application. Your app registration must be approved for Minecraft: Java Edition services. See README → Microsoft sign-in setup.',
        )
      }
      const wrapped = new Error(`Minecraft authentication failed: ${error.message}`)
      wrapped.authError = error.status === 401 || error.status === 403
      throw wrapped
    }
    if (!minecraftToken?.access_token) throw new Error('Minecraft did not return an access token.')
    return {
      accessToken: minecraftToken.access_token,
      expiresAt: new Date(Date.now() + (Number(minecraftToken.expires_in) || 86_400) * 1000).toISOString(),
      xuid: claims.xid || null,
      uhs: claims.uhs,
    }
  }

  async authenticateMinecraft(tokenBody, clientId) {
    const session = await this.signInXbox(tokenBody.access_token)
    const profile = await fetchMinecraftProfile(session.accessToken)
    return {
      id: profile.id,
      uuid: profile.id,
      name: profile.name,
      xuid: session.xuid,
      uhs: session.uhs,
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      refreshToken: tokenBody.refresh_token,
      microsoftAccessToken: tokenBody.access_token,
      microsoftExpiresAt: new Date(
        Date.now() + (Number(tokenBody.expires_in) || 3600) * 1000,
      ).toISOString(),
      clientId,
    }
  }

  async persistAccount(account) {
    const tokens = {
      refreshToken: account.refreshToken,
      microsoftAccessToken: account.microsoftAccessToken,
      microsoftExpiresAt: account.microsoftExpiresAt,
      accessToken: account.accessToken,
      expiresAt: account.expiresAt,
      xuid: account.xuid,
      uhs: account.uhs,
      clientId: account.clientId,
    }
    this.tokens.set(account.id, tokens)
    await this.saveTokens()
    const existing = this.store.getAccount(account.id)
    await this.store.upsertAccount({
      id: account.id,
      type: 'microsoft',
      name: account.name,
      uuid: account.uuid,
      xuid: account.xuid,
      addedAt: existing?.addedAt || new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      expiresAt: account.expiresAt,
      sessionExpired: false,
      avatarDataUrl: existing?.avatarDataUrl || null,
    })
    await this.store.setActiveAccount(account.id)
  }

  async fetchAvatar(uuid, accountId) {
    const cleanUuid = String(uuid).replace(/-/g, '')
    const urls = [
      `https://crafatar.com/avatars/${cleanUuid}?overlay&size=128`,
      `https://mc-heads.net/avatar/${cleanUuid}/128`,
    ]
    for (const url of urls) {
      try {
        const response = await fetchWithRetry(
          url,
          { headers: { 'User-Agent': 'AquaLauncher/1.0.0' } },
          { attempts: 1, timeoutMs: 12_000, retryStatuses: [] },
        )
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) continue
        await fsp.mkdir(this.paths.avatarCacheRoot, { recursive: true })
        const filePath = path.join(this.paths.avatarCacheRoot, `${cleanUuid}.png`)
        await fsp.writeFile(filePath, buffer)
        const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
        await this.store.updateAccount(accountId, { avatarDataUrl: dataUrl })
        this.broadcastAccounts()
        return dataUrl
      } catch {
        // Try the next avatar provider.
      }
    }
    return null
  }

  cancelLogin() {
    const login = this.activeLogin
    if (!login) {
      this.setAuthState({ status: 'idle' })
      return
    }
    login.settled = true
    clearTimeout(login.timer)
    try {
      login.server?.close()
    } catch {
      // Already closed.
    }
    this.activeLogin = null
    this.setAuthState({ status: 'idle' })
    this.logger.info('Microsoft sign-in cancelled')
  }

  async refreshTokenFor(accountId, { force = false } = {}) {
    if (this.refreshInFlight.has(accountId)) return this.refreshInFlight.get(accountId)
    const promise = (async () => {
      const account = this.store.getAccount(accountId)
      if (account?.type === 'offline') {
        throw new Error('Offline profiles do not have a Microsoft session to refresh.')
      }
      const token = this.tokens.get(accountId)
      if (!token?.refreshToken) {
        await this.store.updateAccount(accountId, { sessionExpired: true })
        this.broadcastAccounts()
        throw new Error('No saved Microsoft session was found. Sign in again.')
      }
      const minecraftValid =
        token.accessToken &&
        token.expiresAt &&
        new Date(token.expiresAt).getTime() - Date.now() > 2 * 60 * 1000
      if (minecraftValid && !force) {
        if (this.store.getAccount(accountId)?.sessionExpired) {
          await this.store.updateAccount(accountId, { sessionExpired: false })
        }
        return token
      }

      const credentials = readMicrosoftCredentials()
      const clientId = token.clientId || credentials.clientId
      if (!clientId) throw new Error(describeMissingCredentials(credentials))
      let microsoftAccessToken = token.microsoftAccessToken
      let microsoftExpiresAt = token.microsoftExpiresAt
      let refreshToken = token.refreshToken
      const microsoftValid =
        microsoftAccessToken &&
        microsoftExpiresAt &&
        new Date(microsoftExpiresAt).getTime() - Date.now() > 2 * 60 * 1000

      try {
        if (force || !microsoftValid) {
          const refreshed = await requestToken(
            {
              client_id: clientId,
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              scope: SCOPES,
            },
            credentials.clientSecret,
          )
          microsoftAccessToken = refreshed.access_token
          microsoftExpiresAt = new Date(
            Date.now() + (Number(refreshed.expires_in) || 3600) * 1000,
          ).toISOString()
          refreshToken = refreshed.refresh_token || refreshToken
        }
        const session = await this.signInXbox(microsoftAccessToken)
        const next = {
          ...token,
          refreshToken,
          microsoftAccessToken,
          microsoftExpiresAt,
          accessToken: session.accessToken,
          expiresAt: session.expiresAt,
          xuid: session.xuid || token.xuid,
          uhs: session.uhs || token.uhs,
          clientId,
        }
        this.tokens.set(accountId, next)
        await this.saveTokens()
        await this.store.updateAccount(accountId, { expiresAt: next.expiresAt, sessionExpired: false })
        this.broadcastAccounts()
        return next
      } catch (error) {
        if (error.authError) {
          await this.store.updateAccount(accountId, { sessionExpired: true })
          this.broadcastAccounts()
        }
        throw new Error(
          error.authError
            ? /expired|revoked|invalid_grant/i.test(error.message)
              ? 'Your Microsoft session expired. Sign in again to continue.'
              : error.message
            : error.message,
        )
      }
    })()
    this.refreshInFlight.set(accountId, promise)
    try {
      return await promise
    } finally {
      this.refreshInFlight.delete(accountId)
    }
  }

  async getLaunchCredentials(accountId) {
    const account = this.store.getAccount(accountId)
    if (!account) throw new Error('Add a player profile before launching Minecraft.')
    if (account.type === 'offline') {
      return {
        accessToken: '0',
        uuid: account.uuid,
        name: account.name,
        xuid: '0',
        clientId: '0',
        userType: 'legacy',
        offline: true,
      }
    }
    const token = await this.refreshTokenFor(accountId)
    if (!token?.accessToken) throw new Error('Your Microsoft session is not available. Sign in again.')
    return {
      accessToken: token.accessToken,
      uuid: account.uuid,
      name: account.name,
      xuid: token.xuid || account.xuid || '',
      clientId: token.clientId || readMicrosoftCredentials().clientId,
      userType: 'msa',
    }
  }

  async switchAccount(accountId) {
    const account = await this.store.setActiveAccount(accountId)
    if (account.type !== 'offline') {
      try {
        await this.refreshTokenFor(accountId)
      } catch (error) {
        this.logger.warn('Could not refresh the selected account', { message: error.message })
        throw error
      }
    }
    this.broadcastAccounts()
    return this.store.publicAccount(account)
  }

  async refreshAccount(accountId) {
    const account = this.store.getAccount(accountId)
    if (!account) throw new Error('Account not found.')
    if (account.type === 'offline') {
      this.broadcastAccounts()
      return this.store.publicAccount(account)
    }
    await this.refreshTokenFor(accountId, { force: true })
    this.broadcastAccounts()
    return this.store.publicAccount(this.store.getAccount(accountId))
  }

  async signOut(accountId) {
    const account = this.store.getAccount(accountId)
    if (!account) throw new Error('Account not found.')
    this.tokens.delete(accountId)
    await this.saveTokens()
    await this.store.removeAccount(accountId)
    this.broadcastAccounts()
    await this.store.addActivity({
      type: 'account',
      title: `Signed out of ${account.name}`,
      detail: 'Microsoft session removed from this device',
      status: 'info',
    })
    this.emitActivity()
    this.emitNotification({
      level: 'success',
      title: 'Signed out',
      message: `${account.name} was removed from this launcher.`,
    })
    this.logger.info('Account signed out', { name: account.name })
    return this.accountsPayload()
  }

  async restoreActiveSession() {
    const activeId = this.store.activeAccountId
    if (!activeId) return
    if (this.store.getAccount(activeId)?.type === 'offline') return
    if (!this.tokens.has(activeId)) {
      await this.store.updateAccount(activeId, { sessionExpired: true })
      this.broadcastAccounts()
      return
    }
    try {
      await this.refreshTokenFor(activeId)
      this.broadcastAccounts()
    } catch (error) {
      this.logger.warn('Stored Microsoft session could not be refreshed', { message: error.message })
    }
  }

  dispose() {
    this.cancelLogin()
  }
}

export { TOKEN_ENDPOINT, AUTHORIZE_ENDPOINT }
