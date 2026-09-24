/**
 * Multi-host download rename strategies.
 */

export const DOWNLOAD_RENAME_POLICIES = [
  { value: 'hostSuffix', label: '加主机后缀（推荐）', tip: 'app_192.168.1.10.log' },
  { value: 'index', label: '加序号', tip: 'app_1.log / app_2.log' },
  { value: 'timestamp', label: '加时间戳', tip: 'app_20240923_1430.log' },
  { value: 'keepDir', label: '保持目录结构', tip: '192.168.1.10/app.log' },
  { value: 'replace', label: '替换（只保留最后一个）', tip: '⚠ 会覆盖前面同名文件' }
]

const SESSION_KEY = 'ops-download-rename-policy'

export function getRenamePolicySession () {
  return window.store?.opsDownloadRenamePolicy ||
    sessionStorage.getItem(SESSION_KEY) ||
    'hostSuffix'
}

export function setRenamePolicySession (policy) {
  if (window.store) {
    window.store.opsDownloadRenamePolicy = policy
  }
  try {
    sessionStorage.setItem(SESSION_KEY, policy)
  } catch (_) {}
}

function basename (p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || 'file'
}

function dirnameJoin (dir, name) {
  const d = String(dir || '').replace(/[\\/]+$/, '')
  if (!d) return name
  return d.includes('\\') ? `${d}\\${name}` : `${d}/${name}`
}

function splitName (name) {
  const i = name.lastIndexOf('.')
  if (i <= 0) return { base: name, ext: '' }
  return { base: name.slice(0, i), ext: name.slice(i) }
}

function sanitizeHost (host) {
  return String(host || 'host').replace(/[^\w.-]+/g, '_').replace(/^\.+|\.+$/g, '') || 'host'
}

function stamp () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/**
 * Detect duplicate basenames across items: [{ host, fromPath, toDir }]
 */
export function findDuplicateNames (items = []) {
  const map = new Map()
  for (const it of items) {
    const name = basename(it.fromPath)
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(it)
  }
  const dups = []
  for (const [name, list] of map) {
    if (list.length > 1) dups.push({ name, items: list })
  }
  return dups
}

/**
 * Apply rename policy → local toPath for each item.
 * @param {Array<{ host, fromPath, toDir, tabId, ... }>} items
 * @param {string} policy
 */
export function applyDownloadRename (items = [], policy = 'hostSuffix') {
  const groups = new Map()
  items.forEach((it, idx) => {
    const name = basename(it.fromPath)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push({ it, idx })
  })

  const out = items.map(it => ({ ...it }))
  for (const [name, list] of groups) {
    if (list.length === 1 && policy !== 'keepDir') {
      const { it, idx } = list[0]
      out[idx].toPath = dirnameJoin(it.toDir, name)
      out[idx].toName = name
      continue
    }
    list.forEach(({ it, idx }, i) => {
      const { base, ext } = splitName(name)
      const host = sanitizeHost(it.host || it.title)
      let fileName = name
      if (policy === 'replace') {
        fileName = name
      } else if (policy === 'hostSuffix') {
        fileName = `${base}_${host}${ext}`
      } else if (policy === 'index') {
        fileName = `${base}_${i + 1}${ext}`
      } else if (policy === 'timestamp') {
        fileName = `${base}_${stamp()}_${i + 1}${ext}`
      } else if (policy === 'keepDir') {
        fileName = name
        out[idx].toPath = dirnameJoin(dirnameJoin(it.toDir, host), name)
        out[idx].toName = name
        return
      }
      out[idx].toPath = dirnameJoin(it.toDir, fileName)
      out[idx].toName = fileName
    })
  }
  return out
}
