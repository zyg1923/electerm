/**
 * Human-readable byte sizes up to EB (1024-based).
 * Examples: 10KB, 1.53MB, 1.78GB, 2.1TB
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']
const BASE = 1024

export function formatBytes (n, { empty = '-' } = {}) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) {
    return empty
  }
  if (v === 0) {
    return '0B'
  }
  let x = v
  let i = 0
  while (x >= BASE && i < UNITS.length - 1) {
    x /= BASE
    i++
  }
  if (i === 0) {
    return Math.round(x) + UNITS[i]
  }
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2
  let s = x.toFixed(digits)
  s = s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
  return s + UNITS[i]
}

/** e.g. 1.5GB/30GB — each side picks its own unit */
export function formatBytesPair (done, total, { empty = '-' } = {}) {
  const a = Number(done)
  const b = Number(total)
  if (!Number.isFinite(b) || b <= 0) {
    if (!Number.isFinite(a) || a < 0) {
      return empty
    }
    return formatBytes(a) + '/-'
  }
  const left = !Number.isFinite(a) || a < 0 ? '0B' : formatBytes(a)
  return left + '/' + formatBytes(b)
}

export function formatSpeed (bytesPerSec) {
  const v = Number(bytesPerSec)
  if (!Number.isFinite(v) || v < 0) {
    return '-'
  }
  return formatBytes(v, { empty: '0B' }) + '/s'
}
