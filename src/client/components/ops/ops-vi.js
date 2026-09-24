/**
 * Detect vi/vim typed at the shell prompt so the GUI editor can open instead.
 */

export function parseViCommand (cmd) {
  const s = String(cmd || '').trim()
  if (!s) {
    return null
  }
  if (/(?:^|\s)--raw\b/.test(s)) {
    return null
  }
  const m = s.match(/^(?:sudo\s+)?(?:\/usr\/bin\/)?(vi|vim|nvim|view|edit|cat)(?:\s+([\s\S]+))?$/)
  if (!m) {
    return null
  }
  const rest = (m[2] || '').trim()
  if (!rest) {
    return { editor: m[1], path: '' }
  }
  const quoted = rest.match(/^(?:"([^"]+)"|'([^']+)')/)
  if (quoted) {
    return { editor: m[1], path: quoted[1] || quoted[2] || '' }
  }
  const parts = rest.split(/\s+/).filter(part => part && !part.startsWith('-') && !part.startsWith('+'))
  return { editor: m[1], path: parts[parts.length - 1] || '' }
}
