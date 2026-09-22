/**
 * Simple in-memory cache layer for ops collectors
 */

const store = new Map()
const locks = new Map()

const defaultTtl = {
  machineStatus: 30 * 1000,
  dockerPs: 15 * 1000,
  dockerImages: 60 * 1000,
  serviceList: 30 * 1000,
  disk: 5 * 60 * 1000
}

export function getTtl (type) {
  const cfg = window.store?.opsCacheTtl || {}
  return cfg[type] ?? defaultTtl[type] ?? 30000
}

export function cacheKey (hostOrTabId, type) {
  return `${hostOrTabId}::${type}`
}

export function getCache (hostOrTabId, type) {
  if (window.store?.opsCacheEnabled === false) return null
  const key = cacheKey(hostOrTabId, type)
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() > hit.expireAt) {
    store.delete(key)
    return null
  }
  return hit.value
}

export function setCache (hostOrTabId, type, value) {
  const key = cacheKey(hostOrTabId, type)
  store.set(key, {
    value,
    expireAt: Date.now() + getTtl(type),
    at: Date.now()
  })
  return value
}

export function invalidate (hostOrTabId, type) {
  if (type) store.delete(cacheKey(hostOrTabId, type))
  else {
    for (const k of [...store.keys()]) {
      if (k.startsWith(hostOrTabId + '::')) store.delete(k)
    }
  }
}

export function invalidateAll () {
  store.clear()
}

export async function withCache (hostOrTabId, type, loader, { force } = {}) {
  if (!force) {
    const hit = getCache(hostOrTabId, type)
    if (hit) return { data: hit, fromCache: true }
  }
  const lockKey = cacheKey(hostOrTabId, type)
  if (locks.has(lockKey)) {
    const stale = getCache(hostOrTabId, type)
    if (stale) return { data: stale, fromCache: true, waiting: true }
    await locks.get(lockKey)
    const again = getCache(hostOrTabId, type)
    if (again) return { data: again, fromCache: true }
  }
  let resolve
  const p = new Promise(r => { resolve = r })
  locks.set(lockKey, p)
  try {
    const data = await loader()
    setCache(hostOrTabId, type, data)
    return { data, fromCache: false }
  } finally {
    locks.delete(lockKey)
    resolve?.()
  }
}

export function cacheStats () {
  return {
    size: store.size,
    keys: [...store.keys()]
  }
}
