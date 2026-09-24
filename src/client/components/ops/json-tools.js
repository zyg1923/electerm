/**
 * Minimal JSON toolkit: format / validate / compress / diff / JSONPath / to CSV·YAML·table.
 */

export function formatJson (text) {
  const obj = JSON.parse(text)
  return JSON.stringify(obj, null, 2)
}

export function compressJson (text) {
  const obj = JSON.parse(text)
  return JSON.stringify(obj)
}

export function validateJson (text) {
  try {
    JSON.parse(text)
    return { ok: true, error: '', line: 0 }
  } catch (e) {
    const msg = String(e.message || e)
    const m = msg.match(/position\s+(\d+)/i) || msg.match(/at position\s+(\d+)/i)
    let line = 1
    if (m) {
      const pos = Number(m[1])
      line = String(text).slice(0, pos).split(/\n/).length
    }
    return { ok: false, error: msg, line }
  }
}

/** Very small JSONPath: $.a.b[0].c */
export function jsonPathGet (obj, path) {
  const p = String(path || '').trim()
  if (!p || p === '$') return obj
  const parts = p.replace(/^\$\.?/, '').split(/\.|\[|\]/).filter(Boolean)
  let cur = obj
  for (const part of parts) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

export function jsonToCsv (obj) {
  const rows = Array.isArray(obj) ? obj : [obj]
  if (!rows.length) return ''
  const keys = [...new Set(rows.flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : [])))]
  const esc = v => {
    const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [keys.join(',')]
  for (const r of rows) {
    lines.push(keys.map(k => esc(r?.[k])).join(','))
  }
  return lines.join('\n')
}

/** Tiny YAML-ish dump (enough for ops preview, not full YAML) */
export function jsonToYaml (obj, indent = 0) {
  const pad = '  '.repeat(indent)
  if (obj === null) return 'null'
  if (typeof obj === 'boolean' || typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') {
    if (/[:#\n]/.test(obj) || obj === '') return JSON.stringify(obj)
    return obj
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]'
    return obj.map(v => {
      const body = jsonToYaml(v, indent + 1)
      if (typeof v === 'object' && v !== null) {
        return `${pad}- ${body.replace(/^\s+/, '')}`
      }
      return `${pad}- ${body}`
    }).join('\n')
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj)
    if (!keys.length) return '{}'
    return keys.map(k => {
      const v = obj[k]
      if (typeof v === 'object' && v !== null) {
        return `${pad}${k}:\n${jsonToYaml(v, indent + 1)}`
      }
      return `${pad}${k}: ${jsonToYaml(v, 0)}`
    }).join('\n')
  }
  return String(obj)
}

export function diffJson (aText, bText) {
  let a
  let b
  try { a = JSON.parse(aText) } catch (e) { return { ok: false, error: '左侧 JSON 无效: ' + e.message } }
  try { b = JSON.parse(bText) } catch (e) { return { ok: false, error: '右侧 JSON 无效: ' + e.message } }
  const changes = []
  walkDiff('', a, b, changes)
  return { ok: true, changes }
}

function walkDiff (path, a, b, out) {
  if (Object.is(a, b)) return
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b
  if (ta !== tb || (ta !== 'object' && ta !== 'array')) {
    out.push({ path: path || '$', left: a, right: b })
    return
  }
  if (ta === 'array') {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      walkDiff(`${path}[${i}]`, a[i], b[i], out)
    }
    return
  }
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const k of keys) {
    walkDiff(path ? `${path}.${k}` : k, a?.[k], b?.[k], out)
  }
}

/**
 * Extract business JSON from a code-node execution result.
 * Prefers output / raw_stdout JSON payload over the wrapper envelope.
 */
export function extractCodeExecJson (raw) {
  let obj = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) throw new Error('没有可解析的内容')
    try {
      obj = JSON.parse(text)
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}\s*$/)
      if (!m) throw new Error('不是合法 JSON: ' + e.message)
      obj = JSON.parse(m[0])
    }
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('无法解析')
  }

  if (obj.output != null && typeof obj.output === 'object' &&
    !Array.isArray(obj.output) && Object.keys(obj.output).length > 0) {
    if (typeof obj.output.text === 'string') {
      try {
        return JSON.parse(obj.output.text.trim())
      } catch (_) {
        return obj.output
      }
    }
    return obj.output
  }

  if (typeof obj.raw_stdout === 'string' && obj.raw_stdout.trim()) {
    const stdout = obj.raw_stdout.trim()
    try {
      return JSON.parse(stdout)
    } catch (_) {
      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if ((line.startsWith('{') && line.endsWith('}')) ||
          (line.startsWith('[') && line.endsWith(']'))) {
          try {
            return JSON.parse(line)
          } catch (_) {}
        }
      }
    }
  }

  if (Array.isArray(obj.results)) {
    return obj.results.map(r => ({
      host: r.host,
      success: r.success,
      ...(typeof r.output === 'object' && r.output ? r.output : { output: r.output })
    }))
  }

  if (!('raw_stdout' in obj) && !('exec_target' in obj) && !('exit_code' in obj)) {
    return obj
  }

  throw new Error('未找到可解析的业务 JSON（请先在「代码执行」跑一次，或把完整结果贴到左侧）')
}
