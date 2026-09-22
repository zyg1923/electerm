/**
 * Terminal clear mark helpers (colored separators + jump history)
 */

import { clearMarkColors } from '../../common/ops-constants'

export function nextClearColor (index) {
  return clearMarkColors[index % clearMarkColors.length]
}

export function hexToAnsiFg (hex) {
  const h = String(hex || '').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return `\x1b[38;2;${r};${g};${b}m`
}

export function hexToAnsiBg (hex) {
  const h = String(hex || '').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return `\x1b[48;2;${r};${g};${b}m`
}

function contrastFg (hex) {
  const h = String(hex || '').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  const luma = (r * 299 + g * 587 + b * 114) / 1000
  return luma > 160 ? '\x1b[30m' : '\x1b[97m'
}

export function buildClearMarkLine (index, color, ts = Date.now(), cols = 80) {
  const time = new Date(ts).toLocaleTimeString()
  const bg = hexToAnsiBg(color)
  const fg = contrastFg(color)
  let label = `  CLEAR #${index}   ${time}   以上是上一段内容`
  const width = Math.max(20, cols || 80)
  if (label.length < width) {
    label += ' '.repeat(width - label.length)
  }
  return `${bg}${fg}${label}\x1b[0m`
}

/**
 * Plain-text dump of the normal buffer, used to restore a screen after a real clear.
 */
export function dumpTerminalText (term) {
  try {
    const buf = term?.buffer?.active
    if (!buf || buf.type !== 'normal') {
      return ''
    }
    const lines = []
    for (let i = 0; i < buf.length; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) || '')
    }
    while (lines.length && lines[lines.length - 1] === '') {
      lines.pop()
    }
    return lines.join('\n')
  } catch (e) {
    return ''
  }
}

function charWidth (unicode, ch) {
  const cp = ch.codePointAt(0) || 0
  try {
    const width = unicode?.wcwidth?.(cp)
    if (width === 0 || width === 1 || width === 2) {
      return width
    }
  } catch (e) {
    // ignore
  }
  return cp > 0xffff ? 2 : 1
}

export function cloneBufferLines (term) {
  try {
    const buffers = term?._core?._bufferService?.buffers
    const buffer = buffers?.normal
    if (!buffer || buffers.active !== buffer) {
      return []
    }
    const lines = []
    for (let i = 0; i < buffer.lines.length; i++) {
      const line = buffer.lines.get(i)
      if (line?.clone) {
        lines.push(line.clone())
      }
    }
    while (lines.length && !lines[lines.length - 1].getTrimmedLength()) {
      lines.pop()
    }
    return lines
  } catch (e) {
    return []
  }
}

export function restoreClonedLines (term, lines) {
  const bufferService = term?._core?._bufferService
  const buffers = bufferService?.buffers
  const buffer = buffers?.normal
  if (!term || !buffer || buffers.active !== buffer || !lines?.length) {
    return false
  }
  let room = buffer.lines.maxLength - buffer.lines.length
  if (room < lines.length) {
    const need = lines.length - Math.max(0, room)
    const trim = Math.min(need, Math.max(0, buffer.ybase))
    if (trim > 0) {
      buffer.lines.trimStart(trim)
      buffer.ybase = Math.max(0, buffer.ybase - trim)
      buffer.ydisp = Math.max(0, buffer.ydisp - trim)
    }
  }
  room = buffer.lines.maxLength - buffer.lines.length
  if (room < 1) {
    return false
  }
  const use = lines.length > room ? lines.slice(lines.length - room) : lines
  let offset = 0
  let at = buffer.ybase
  const step = () => {
    if (!term._core || buffers.active !== buffer) {
      return
    }
    const chunk = use.slice(offset, offset + 400)
    if (!chunk.length) {
      try {
        term.scrollToBottom()
        term.refresh(0, Math.max(0, term.rows - 1))
      } catch (e) {
        // ignore
      }
      return
    }
    try {
      buffer.lines.splice(at, 0, ...chunk)
      at += chunk.length
      offset += chunk.length
      buffer.ybase += chunk.length
      buffer.ydisp = buffer.ybase
    } catch (e) {
      return
    }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  return true
}

/**
 * Insert saved lines just above the live viewport and scroll them into view.
 * The cursor row stays put, so the pty's screen does not shift.
 */
export function insertAboveViewport (term, text, reveal = true) {
  const core = term?._core
  const bufferService = core?._bufferService
  const buffers = bufferService?.buffers
  const buffer = buffers?.normal
  if (!term || !buffer || buffers.active !== buffer) {
    return false
  }
  const cols = bufferService.cols || term.cols || 80
  const unicode = core.unicodeService
  let attr
  try {
    attr = buffer.getNullCell()
  } catch (e) {
    return false
  }
  const pieces = []
  for (const row of String(text || '').split('\n')) {
    let line = ''
    let col = 0
    for (const ch of Array.from(row)) {
      const width = charWidth(unicode, ch)
      if (width === 0) {
        line += ch
        continue
      }
      if (col + width > cols && line) {
        pieces.push(line)
        line = ch
        col = width
      } else {
        line += ch
        col += width
      }
    }
    pieces.push(line)
  }
  while (pieces.length && pieces[pieces.length - 1] === '') {
    pieces.pop()
  }
  if (!pieces.length) {
    return false
  }
  const made = pieces.map(str => {
    const line = buffer.getBlankLine(attr)
    let col = 0
    for (const ch of Array.from(str)) {
      const cp = ch.codePointAt(0) || 0
      const width = charWidth(unicode, ch)
      if (width === 0) {
        if (col > 0) {
          line.addCodepointToCell(col - 1, cp, 0)
        }
        continue
      }
      if (col + width > cols) {
        break
      }
      line.setCellFromCodepoint(col, cp, width, attr)
      col += width
    }
    return line
  })
  const viewportKeep = Math.max(0, buffer.ybase)
  const roomLeft = buffer.lines.maxLength - buffer.lines.length
  if (roomLeft < made.length) {
    const trim = Math.min(made.length - roomLeft, viewportKeep)
    if (trim > 0) {
      buffer.lines.trimStart(trim)
      buffer.ybase = Math.max(0, buffer.ybase - trim)
      buffer.ydisp = Math.max(0, buffer.ydisp - trim)
    }
  }
  const fit = Math.min(made.length, buffer.lines.maxLength - buffer.lines.length)
  if (fit < 1) {
    return false
  }
  const useLines = made.slice(0, fit)
  const insertAt = buffer.ybase
  try {
    for (let i = 0; i < useLines.length; i += 200) {
      buffer.lines.splice(insertAt + i, 0, ...useLines.slice(i, i + 200))
    }
    buffer.ybase += useLines.length
    if (reveal) {
      term.scrollToLine(insertAt)
    }
  } catch (e) {
    return false
  }
  return true
}
