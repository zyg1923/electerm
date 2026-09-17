import { osResolve } from './resolve'
import sanitizeFilename from './sanitize-filename'

function yyyymmdd (d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('')
}

async function nextDailyIndex (dateDir) {
  try {
    const list = window.fs.readdirAsync || window.fs.readdir
    if (typeof list !== 'function') {
      return 1
    }
    const names = await list(dateDir)
    const nums = (Array.isArray(names) ? names : [])
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n) && n > 0)
    if (!nums.length) {
      return 1
    }
    return Math.max(...nums) + 1
  } catch {
    return 1
  }
}

/**
 * If the connection has sessionLogDir, save terminal I/O to:
 * {sessionLogDir}/{YYYYMMDD}/{index}/{title}.log
 */
export async function resolveBookmarkSessionLog (tab) {
  const root = String(tab?.sessionLogDir || '').trim()
  if (!root) {
    return null
  }
  const date = yyyymmdd()
  const dateDir = osResolve(root, date)
  const index = await nextDailyIndex(dateDir)
  const logName = sanitizeFilename(tab.sessionTitle || tab.title || tab.host || 'session')
  const sessionLogPath = osResolve(dateDir, String(index))
  return {
    saveTerminalLogToFile: true,
    sessionLogPath,
    logName,
    logFile: osResolve(sessionLogPath, `${logName}.log`)
  }
}
