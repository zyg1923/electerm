/**
 * Multi-host config / directory diff helpers
 * Strategy: backend hash grouping + frontend fine diff
 */

import { execCmd } from '../terminal/terminal-apis'
import uid from '../../common/uid'

function shellQuote (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

async function hashRemoteFile (tabId, remotePath) {
  const cmd = `sha256sum ${shellQuote(remotePath)} 2>/dev/null || shasum -a 256 ${shellQuote(remotePath)} 2>/dev/null || md5sum ${shellQuote(remotePath)}`
  try {
    const r = await execCmd(tabId, cmd, 30000)
    const out = (r?.stdout || r?.out || '').trim()
    const hash = out.split(/\s+/)[0] || ''
    const code = typeof r?.code === 'number' ? r.code : 0
    return { ok: code === 0 && !!hash, hash, raw: out, error: r?.stderr || '' }
  } catch (err) {
    return { ok: false, hash: '', error: err.message || String(err) }
  }
}

async function catRemoteFile (tabId, remotePath, maxBytes = 2 * 1024 * 1024) {
  // limit via head -c when possible
  const cmd = `wc -c < ${shellQuote(remotePath)} 2>/dev/null; head -c ${maxBytes} ${shellQuote(remotePath)}`
  try {
    const r = await execCmd(tabId, cmd, 60000)
    const out = r?.stdout || r?.out || ''
    const lines = out.split('\n')
    const sizeLine = lines[0]
    const size = parseInt(sizeLine, 10)
    const content = Number.isFinite(size)
      ? lines.slice(1).join('\n')
      : out
    const truncated = Number.isFinite(size) && size > maxBytes
    return {
      ok: true,
      content,
      size: Number.isFinite(size) ? size : content.length,
      truncated,
      error: ''
    }
  } catch (err) {
    return { ok: false, content: '', size: 0, truncated: false, error: err.message || String(err) }
  }
}

/**
 * Compare same path across hosts.
 * @returns {{ hosts: array, groups: array, baselineId, matrix: object }}
 */
export async function compareConfigAcrossHosts ({
  tabs = [],
  remotePath,
  baselineTabId,
  fetchContent = true,
  maxBytes = 2 * 1024 * 1024
}) {
  const hosts = []
  for (const tab of tabs) {
    const tabId = tab.id || tab.tabId
    const meta = {
      id: uid(),
      tabId,
      title: tab.title || tabId,
      host: tab.host || '',
      path: remotePath,
      hash: '',
      content: '',
      size: 0,
      truncated: false,
      error: '',
      ok: false
    }
    const h = await hashRemoteFile(tabId, remotePath)
    meta.hash = h.hash
    meta.ok = h.ok
    meta.error = h.error
    if (fetchContent && h.ok) {
      const c = await catRemoteFile(tabId, remotePath, maxBytes)
      meta.content = c.content
      meta.size = c.size
      meta.truncated = c.truncated
      if (!c.ok) {
        meta.error = c.error
        meta.ok = false
      }
    }
    hosts.push(meta)
  }

  const groupMap = new Map()
  for (const h of hosts) {
    const key = h.ok ? h.hash : '__error__:' + h.tabId
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(h.tabId)
  }

  const groups = [...groupMap.entries()].map(([hash, tabIds]) => ({
    hash,
    tabIds,
    identical: tabIds.length > 1 && !hash.startsWith('__error__')
  }))

  const baselineId = baselineTabId || hosts.find(h => h.ok)?.tabId || ''
  const baseline = hosts.find(h => h.tabId === baselineId)
  const matrix = {}
  for (const h of hosts) {
    matrix[h.tabId] = {
      sameAsBaseline: !!(baseline && h.ok && baseline.ok && h.hash === baseline.hash),
      hash: h.hash,
      ok: h.ok,
      error: h.error
    }
  }

  return {
    remotePath,
    hosts,
    groups,
    baselineId,
    matrix,
    allIdentical: groups.filter(g => !g.hash.startsWith('__error__')).length <= 1 &&
      hosts.every(h => h.ok)
  }
}

/**
 * Directory listing diff between two hosts
 */
export async function compareDirectories ({
  leftTabId,
  rightTabId,
  leftPath,
  rightPath
}) {
  const listCmd = (p) =>
    `find ${shellQuote(p)} -maxdepth 2 -printf '%P\\t%s\\t%T@\\n' 2>/dev/null || find ${shellQuote(p)} -maxdepth 2 | while read f; do rel=\${f#${shellQuote(p)}/}; [ \"$rel\" = \"$f\" ] && rel=.; sz=$(wc -c < \"$f\" 2>/dev/null || echo 0); echo -e \"$rel\\t$sz\\t0\"; done`

  const parse = (text) => {
    const map = new Map()
    for (const line of (text || '').split('\n')) {
      if (!line.trim()) continue
      const [rel, size, mtime] = line.split('\t')
      if (!rel || rel === '.') continue
      map.set(rel.replace(/^\.\//, ''), {
        size: parseInt(size, 10) || 0,
        mtime: parseFloat(mtime) || 0
      })
    }
    return map
  }

  let leftRaw = ''
  let rightRaw = ''
  let leftErr = ''
  let rightErr = ''
  try {
    const r = await execCmd(leftTabId, listCmd(leftPath), 60000)
    leftRaw = r?.stdout || r?.out || ''
    if (r?.code && r.code !== 0) leftErr = r.stderr || 'list failed'
  } catch (e) {
    leftErr = e.message
  }
  try {
    const r = await execCmd(rightTabId, listCmd(rightPath), 60000)
    rightRaw = r?.stdout || r?.out || ''
    if (r?.code && r.code !== 0) rightErr = r.stderr || 'list failed'
  } catch (e) {
    rightErr = e.message
  }

  const left = parse(leftRaw)
  const right = parse(rightRaw)
  const onlyLeft = []
  const onlyRight = []
  const sizeDiff = []
  const same = []

  for (const [k, v] of left) {
    if (!right.has(k)) onlyLeft.push({ path: k, ...v })
    else if (right.get(k).size !== v.size) sizeDiff.push({ path: k, left: v, right: right.get(k) })
    else same.push({ path: k, ...v })
  }
  for (const [k, v] of right) {
    if (!left.has(k)) onlyRight.push({ path: k, ...v })
  }

  return {
    leftPath,
    rightPath,
    onlyLeft,
    onlyRight,
    sizeDiff,
    same,
    leftErr,
    rightErr
  }
}
