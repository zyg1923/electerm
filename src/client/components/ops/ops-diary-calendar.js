/**
 * Solar/lunar display helpers + Chinese rest-day detection for ops diary.
 */

/** Official rest / work adjustment (YYYY-MM-DD). rest=true 休, rest=false 班 */
const CN_DAY_OVERRIDES = {
  // 2024
  '2024-01-01': true,
  '2024-02-04': false,
  '2024-02-10': true, '2024-02-11': true, '2024-02-12': true,
  '2024-02-13': true, '2024-02-14': true, '2024-02-15': true, '2024-02-16': true, '2024-02-17': true,
  '2024-02-18': false,
  '2024-04-04': true, '2024-04-05': true, '2024-04-06': true, '2024-04-07': false,
  '2024-04-28': false,
  '2024-05-01': true, '2024-05-02': true, '2024-05-03': true, '2024-05-04': true, '2024-05-05': true,
  '2024-05-11': false,
  '2024-06-10': true,
  '2024-09-14': false,
  '2024-09-15': true, '2024-09-16': true, '2024-09-17': true,
  '2024-09-29': false,
  '2024-10-01': true, '2024-10-02': true, '2024-10-03': true, '2024-10-04': true,
  '2024-10-05': true, '2024-10-06': true, '2024-10-07': true,
  '2024-10-12': false,
  // 2025
  '2025-01-01': true,
  '2025-01-26': false,
  '2025-01-28': true, '2025-01-29': true, '2025-01-30': true, '2025-01-31': true,
  '2025-02-01': true, '2025-02-02': true, '2025-02-03': true, '2025-02-04': true,
  '2025-02-08': false,
  '2025-04-04': true, '2025-04-05': true, '2025-04-06': true,
  '2025-04-27': false,
  '2025-05-01': true, '2025-05-02': true, '2025-05-03': true, '2025-05-04': true, '2025-05-05': true,
  '2025-05-31': true,
  '2025-09-28': false,
  '2025-10-01': true, '2025-10-02': true, '2025-10-03': true, '2025-10-04': true,
  '2025-10-05': true, '2025-10-06': true, '2025-10-07': true, '2025-10-08': true,
  '2025-10-11': false,
  // 2026
  '2026-01-01': true, '2026-01-02': true, '2026-01-03': true,
  '2026-01-04': false,
  '2026-02-14': false,
  '2026-02-15': true, '2026-02-16': true, '2026-02-17': true, '2026-02-18': true,
  '2026-02-19': true, '2026-02-20': true, '2026-02-21': true, '2026-02-22': true, '2026-02-23': true,
  '2026-02-28': false,
  '2026-04-04': true, '2026-04-05': true, '2026-04-06': true,
  '2026-05-01': true, '2026-05-02': true, '2026-05-03': true, '2026-05-04': true, '2026-05-05': true,
  '2026-05-09': false,
  '2026-06-19': true, '2026-06-20': true, '2026-06-21': true,
  '2026-09-20': false,
  '2026-09-25': true, '2026-09-26': true, '2026-09-27': true,
  '2026-10-01': true, '2026-10-02': true, '2026-10-03': true, '2026-10-04': true,
  '2026-10-05': true, '2026-10-06': true, '2026-10-07': true,
  '2026-10-10': false,
  // 2027
  '2027-01-01': true, '2027-01-02': true, '2027-01-03': true,
  '2027-02-06': false,
  '2027-02-07': true, '2027-02-08': true, '2027-02-09': true, '2027-02-10': true,
  '2027-02-11': true, '2027-02-12': true, '2027-02-13': true,
  '2027-02-17': false,
  '2027-04-03': true, '2027-04-04': true, '2027-04-05': true,
  '2027-05-01': true, '2027-05-02': true, '2027-05-03': true, '2027-05-04': true, '2027-05-05': true,
  '2027-05-08': false,
  '2027-06-09': true, '2027-06-10': true, '2027-06-11': true,
  '2027-09-15': true, '2027-09-16': true, '2027-09-17': true,
  '2027-09-18': false,
  '2027-10-01': true, '2027-10-02': true, '2027-10-03': true, '2027-10-04': true,
  '2027-10-05': true, '2027-10-06': true, '2027-10-07': true,
  '2027-10-09': false
}

export function pad2 (n) {
  return String(n).padStart(2, '0')
}

export function toDateKey (d) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`
}

export function parseDateKey (key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function formatDateTime (ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return '-'
  const d = new Date(n)
  return `${toDateKey(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** 阴历文案：优先 Intl Chinese calendar */
export function getLunarLabel (dateOrKey) {
  const d = dateOrKey instanceof Date ? dateOrKey : parseDateKey(dateOrKey)
  if (!d || Number.isNaN(d.getTime())) return '-'
  try {
    const fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long',
      day: 'numeric'
    })
    const parts = fmt.formatToParts(d)
    const month = parts.find(p => p.type === 'month')?.value || ''
    const day = parts.find(p => p.type === 'day')?.value || ''
    // Intl may return numeric month; map common
    const full = fmt.format(d)
    if (month && day) {
      return `${month}${/月/.test(month) ? '' : '月'}${day}`.replace(/月月/, '月')
    }
    return full.replace(/\s/g, '')
  } catch (_) {
    return '-'
  }
}

export function getSolarLabel (dateOrKey) {
  const d = dateOrKey instanceof Date ? dateOrKey : parseDateKey(dateOrKey)
  if (!d || Number.isNaN(d.getTime())) return '-'
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${toDateKey(d)} 周${week}`
}

/**
 * @returns {{ isRest: boolean, label: string, kind: 'holiday'|'weekend'|'workday'|'makeup' }}
 */
export function getRestInfo (dateOrKey) {
  const key = typeof dateOrKey === 'string' ? dateOrKey : toDateKey(dateOrKey)
  const d = parseDateKey(key)
  if (!d) {
    return { isRest: false, label: '-', kind: 'workday' }
  }
  if (Object.prototype.hasOwnProperty.call(CN_DAY_OVERRIDES, key)) {
    const rest = CN_DAY_OVERRIDES[key]
    return rest
      ? { isRest: true, label: '休', kind: 'holiday' }
      : { isRest: false, label: '班', kind: 'makeup' }
  }
  const day = d.getDay()
  if (day === 0 || day === 6) {
    return { isRest: true, label: '休', kind: 'weekend' }
  }
  return { isRest: false, label: '班', kind: 'workday' }
}

export function enrichDateMeta (dateKey) {
  const rest = getRestInfo(dateKey)
  return {
    date: dateKey,
    solar: getSolarLabel(dateKey),
    lunar: getLunarLabel(dateKey),
    isRest: rest.isRest,
    restLabel: rest.label,
    restKind: rest.kind
  }
}
