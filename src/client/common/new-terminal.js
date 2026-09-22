/**
 * output default new terminal data obj
 */

import uid from './id-with-stamp'
import {
  paneMap,
  terminalLocalType
} from './constants'

const e = window.translate
window.et.tabCount = 0

export function updateCount (tab) {
  window.et.tabCount++
  return window.et.tabCount
}

export default (removeTitle) => {
  const titleRaw = e('newTerminal')
  const res = {
    id: uid(),
    status: 'processing',
    pane: paneMap.terminal
  }
  // Only a brand-new empty tab is local. Bookmark/history open passes
  // removeTitle and must keep the original type (ssh must not become local).
  if (!removeTitle) {
    res.type = terminalLocalType
    res.title = (titleRaw === 'newTerminal' || !titleRaw)
      ? '本地终端'
      : titleRaw
  }
  return res
}
