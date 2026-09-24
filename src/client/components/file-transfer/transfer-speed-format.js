/**
 * format transfer speed and ETA
 */

import { formatSpeed } from '../../common/byte-format'

const sec = 1000
const minute = sec * 60
const hour = minute * 60
const day = hour * 24
const month = day * 30
const year = day * 365

export default (bytes, startTime) => {
  let now = Date.now()
  if (now <= startTime) {
    now = startTime + 1
  }
  const speed = bytes / ((now - startTime) / 1000)
  return formatSpeed(speed)
}

/**
 * e.g. 1y 3mo 7d 14h 32m 08s — skip zero parts
 */
function formatTime (ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return '-'
  }
  if (ms < sec) {
    return '0s'
  }
  let left = Math.floor(ms)
  const y = Math.floor(left / year)
  left -= y * year
  const mo = Math.floor(left / month)
  left -= mo * month
  const d = Math.floor(left / day)
  left -= d * day
  const h = Math.floor(left / hour)
  left -= h * hour
  const m = Math.floor(left / minute)
  left -= m * minute
  const s = Math.floor(left / sec)
  const parts = []
  if (y) parts.push(y + 'y')
  if (mo) parts.push(mo + 'mo')
  if (d) parts.push(d + 'd')
  if (h) parts.push(h + 'h')
  if (m) parts.push(m + 'm')
  if (s || !parts.length) {
    parts.push(String(s).padStart(2, '0') + 's')
  }
  return parts.join(' ')
}

export const computePassedTime = (startTime) => {
  const allTimeNeed = (Date.now()) - startTime
  return formatTime(allTimeNeed)
}

export const computeLeftTime = (bytes, total, startTime) => {
  if (!total || total <= 0 || bytes >= total) {
    return {
      leftTime: '0s',
      leftTimeInt: 0,
      etaTime: Date.now()
    }
  }
  let now = Date.now()
  if (now <= startTime) {
    now = startTime + 1
  }
  const elapsed = now - startTime
  if (elapsed <= 0 || bytes <= 0) {
    return {
      leftTime: '-',
      leftTimeInt: 0,
      etaTime: 0
    }
  }
  const speed = bytes / elapsed
  const allTimeNeed = (total - bytes) / speed
  const leftMs = Number.isFinite(allTimeNeed) ? allTimeNeed : 0
  return {
    leftTime: formatTime(leftMs),
    leftTimeInt: leftMs,
    etaTime: now + leftMs
  }
}
