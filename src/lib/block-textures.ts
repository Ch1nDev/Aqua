import { useSyncExternalStore } from 'react'
import { api, getErrorMessage } from './api'
import { setBlockTextures } from './custom-theme'
import type { BlockTextureSet } from './types'

/**
 * Renderer-side cache of the textures the main process extracted from an
 * installed Minecraft client jar. Nothing is fetched until the app asks for it,
 * and an empty set simply means the player has no installed version yet.
 */

export interface BlockTextureStore {
  status: BlockTextureSet | null
  loading: boolean
  error: string | null
}

let store: BlockTextureStore = { status: null, loading: false, error: null }
let epoch = 0
let inflight: Promise<BlockTextureSet | null> | null = null
const listeners = new Set<() => void>()

function emit() {
  epoch += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-scans installed versions. Concurrent callers share one request. */
export function loadBlockTextures(force = false): Promise<BlockTextureSet | null> {
  if (inflight) return inflight
  if (!api?.blockTextures) {
    store = {
      status: null,
      loading: false,
      error: 'Minecraft textures can only be read inside the desktop app.',
    }
    emit()
    return Promise.resolve(null)
  }
  store = { ...store, loading: true, error: null }
  emit()
  inflight = api.blockTextures
    .list({ force })
    .then((status) => {
      store = { status, loading: false, error: null }
      setBlockTextures(status.textures)
      return status
    })
    .catch((error) => {
      store = { ...store, loading: false, error: getErrorMessage(error) }
      emit()
      return null
    })
    .finally(() => {
      inflight = null
      emit()
    })
  return inflight
}

export function useBlockTextures(): BlockTextureStore {
  useSyncExternalStore(subscribe, () => epoch)
  return store
}
