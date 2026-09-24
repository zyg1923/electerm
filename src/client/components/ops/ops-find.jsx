/**
 * Case-insensitive match positions shared by the editor and log views.
 */

export function findMatchIndexes (text, query) {
  const src = String(text || '')
  const needle = String(query || '')
  if (!needle) {
    return []
  }
  const lower = src.toLowerCase()
  const q = needle.toLowerCase()
  const out = []
  let from = 0
  while (from <= lower.length - q.length) {
    const at = lower.indexOf(q, from)
    if (at < 0) {
      break
    }
    out.push(at)
    from = at + Math.max(q.length, 1)
  }
  return out
}

export function clampHit (hit, count) {
  if (!count) {
    return 0
  }
  const n = Number(hit) || 0
  if (n < 0) {
    return 0
  }
  if (n >= count) {
    return count - 1
  }
  return n
}

export function renderHighlighted (text, query, hit) {
  const body = String(text || '')
  const indexes = findMatchIndexes(body, query)
  if (!indexes.length) {
    return body
  }
  const len = String(query).length
  const current = clampHit(hit, indexes.length)
  const nodes = []
  let cursor = 0
  indexes.forEach((at, i) => {
    if (at > cursor) {
      nodes.push(body.slice(cursor, at))
    }
    nodes.push(
      <mark key={at + '-' + i} className={i === current ? 'ops-hit-current' : ''}>
        {body.slice(at, at + len)}
      </mark>
    )
    cursor = at + len
  })
  if (cursor < body.length) {
    nodes.push(body.slice(cursor))
  }
  return nodes
}

export function matchLabel (hit, count) {
  if (!count) {
    return '没有匹配'
  }
  return `第 ${clampHit(hit, count) + 1} 个 / 共 ${count} 个`
}
