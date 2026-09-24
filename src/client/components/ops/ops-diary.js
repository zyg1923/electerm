/**
 * Ops diary CRUD + store helpers.
 */

import uid from '../../common/uid'
import { enrichDateMeta, toDateKey } from './ops-diary-calendar'

export function createDiaryEntry (partial = {}) {
  const now = Date.now()
  const date = partial.date || toDateKey(new Date())
  return {
    id: partial.id || uid(),
    date,
    title: String(partial.title || ''),
    content: String(partial.content || ''),
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now
  }
}

export function listDiaryEntries () {
  return Array.isArray(window.store?.opsDiaryEntries)
    ? window.store.opsDiaryEntries
    : []
}

export function saveDiaryEntry (entry) {
  const store = window.store
  if (!store) return entry
  const list = listDiaryEntries().slice()
  const next = {
    ...entry,
    updatedAt: Date.now()
  }
  const idx = list.findIndex(x => x.id === next.id)
  if (idx >= 0) list[idx] = next
  else list.unshift(next)
  store.opsDiaryEntries = list
  store.addOpsAuditLog?.({ action: 'diary-save', detail: { id: next.id, date: next.date } })
  return next
}

export function removeDiaryEntry (id) {
  const store = window.store
  if (!store) return
  store.opsDiaryEntries = listDiaryEntries().filter(x => x.id !== id)
  store.addOpsAuditLog?.({ action: 'diary-delete', detail: { id } })
}

export function removeDiaryEntries (ids) {
  const set = new Set(ids || [])
  const store = window.store
  if (!store) return
  store.opsDiaryEntries = listDiaryEntries().filter(x => !set.has(x.id))
}

/**
 * Filter by date range [fromKey, toKey] and keyword in title/content.
 */
export function filterDiaryEntries (entries, { from, to, keyword } = {}) {
  const kw = String(keyword || '').trim().toLowerCase()
  return (entries || []).filter(e => {
    if (from && e.date < from) return false
    if (to && e.date > to) return false
    if (kw) {
      const hay = `${e.title || ''}\n${e.content || ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  }).slice().sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

export function entriesForDate (dateKey) {
  return listDiaryEntries().filter(e => e.date === dateKey)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export function withMeta (entry) {
  return {
    ...entry,
    ...enrichDateMeta(entry.date)
  }
}

/**
 * Apply import decisions.
 * decisions: [{ incoming, action: 'replace'|'skip'|'add', existingId? }]
 */
export function applyDiaryImport (decisions = []) {
  const store = window.store
  if (!store) return { added: 0, replaced: 0, skipped: 0 }
  let list = listDiaryEntries().slice()
  let added = 0
  let replaced = 0
  let skipped = 0
  for (const d of decisions) {
    if (d.action === 'skip') {
      skipped++
      continue
    }
    if (d.action === 'replace' && d.existingId) {
      const idx = list.findIndex(x => x.id === d.existingId)
      if (idx >= 0) {
        const old = list[idx]
        list[idx] = {
          ...old,
          ...d.incoming,
          id: old.id,
          createdAt: old.createdAt,
          updatedAt: Date.now()
        }
        replaced++
      } else {
        list.unshift(createDiaryEntry(d.incoming))
        added++
      }
      continue
    }
    // add
    list.unshift(createDiaryEntry({
      ...d.incoming,
      id: undefined,
      createdAt: d.incoming.createdAt || Date.now(),
      updatedAt: Date.now()
    }))
    added++
  }
  store.opsDiaryEntries = list
  store.addOpsAuditLog?.({
    action: 'diary-import',
    detail: { added, replaced, skipped }
  })
  return { added, replaced, skipped }
}
