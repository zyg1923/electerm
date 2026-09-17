/**
 * Windows-like unique names for open connection tabs.
 * Prefer the original name; then 01, 02, ... Reuse a name once that tab is closed.
 */
export function parseDupTitle (name) {
  const s = String(name || '').trim()
  const m = s.match(/^(.*?)(\d{2,})$/)
  if (m && m[1]) {
    return {
      base: m[1],
      n: parseInt(m[2], 10)
    }
  }
  return {
    base: s,
    n: 0
  }
}

export function formatDupTitle (base, n) {
  if (!n) {
    return base
  }
  if (n < 100) {
    return `${base}${String(n).padStart(2, '0')}`
  }
  return `${base}${n}`
}

export function resolveHistoryTitle (tab) {
  if (!tab) {
    return ''
  }
  const bms = window.store?.bookmarks || []
  if (tab.host) {
    const bm = bms.find(b =>
      b.host === tab.host &&
      Number(b.port || 22) === Number(tab.port || 22) &&
      (b.username || '') === (tab.username || '')
    )
    if (bm?.title) {
      return bm.title
    }
  }
  const { base } = parseDupTitle(tab.title)
  return base || tab.title || ''
}

export function historyIdentity (tab = {}) {
  return [
    tab.type || '',
    tab.host || '',
    tab.port || '',
    tab.username || '',
    tab.path || '',
    tab.url || ''
  ].join('\0')
}

export function uniqueOpenTabTitle (name, tabs = []) {
  const raw = String(name || '').trim()
  if (!raw) {
    return name
  }
  const { base } = parseDupTitle(raw)
  if (!base) {
    return raw
  }
  const used = new Set(
    (tabs || []).map(t => t.sessionTitle || t.title).filter(Boolean)
  )
  if (!used.has(base)) {
    return base
  }
  for (let i = 1; i < 10000; i++) {
    const next = formatDupTitle(base, i)
    if (!used.has(next)) {
      return next
    }
  }
  return `${base}${Date.now()}`
}
