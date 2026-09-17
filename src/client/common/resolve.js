/**
 * smart resolve function
 * @param {String} basePath
 * @param {String} nameOrDot
 * @return {String}
 */

export const isWslPath = (path) => /^\\\\(?:wsl\$|wsl\.localhost)\\/.test(path)

export const isWslDistroRoot = (path) => {
  const trimmed = path.replace(/\\$/, '')
  return /^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+$/.test(trimmed)
}

export default function resolve (basePath, nameOrDot) {
  const hasWinDrive = (path) => /^[a-zA-Z]:/.test(path)
  const isWin = basePath.includes('\\') || nameOrDot.includes('\\') || hasWinDrive(basePath) || hasWinDrive(nameOrDot)
  const sep = isWin ? '\\' : '/'
  if (/^[a-zA-Z]:/.test(nameOrDot)) {
    return nameOrDot.replace(/^\//, '').replace(/\//g, sep)
  }
  if (nameOrDot.startsWith('/')) {
    return nameOrDot.replace(/\\/g, sep)
  }
  if (nameOrDot.startsWith('\\\\')) {
    return nameOrDot
  }
  if (nameOrDot === '..') {
    if (isWslDistroRoot(basePath)) {
      return '/'
    }
    const baseEndsWithSep = basePath.endsWith(sep)
    const parts = basePath.split(sep)
    if (parts.length > 1) {
      parts.pop()
      if (isWin && parts.length === 1 && /^[a-zA-Z]:$/.test(parts[0])) {
        return baseEndsWithSep ? '/' : parts[0] + sep
      }
      if (isWin && parts.length === 1) {
        return baseEndsWithSep ? '/' : parts.join(sep)
      }
      return parts.join(sep) || '/'
    }
    return '/'
  }
  if (isWslDistroRoot(basePath) && !basePath.endsWith(sep)) {
    return basePath + sep + nameOrDot
  }
  const trimmed = String(basePath || '').replace(/[\\/]+$/, '')
  if (!trimmed) {
    return (isWin ? sep : '/') + String(nameOrDot).replace(/^[/\\]+/, '')
  }
  const result = trimmed + sep + nameOrDot
  return isWin && result.length === 3 && result.endsWith(':\\') ? '/' : result
}

export const normalizeWinLocalPath = (p) => {
  if (p == null || p === '') {
    return p
  }
  const s = String(p)
  if (/^[a-zA-Z]:$/.test(s)) {
    return s + '\\'
  }
  return s
}

export const osResolve = (...args) => {
  const mapped = args.map(a => (
    typeof a === 'string' && /^[a-zA-Z]:$/.test(a)
      ? a + '\\'
      : a
  ))
  return window.pre.resolve(...mapped)
}
