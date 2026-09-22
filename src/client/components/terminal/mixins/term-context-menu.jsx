import Modal from '../../common/modal'
import { readClipboardAsync, readClipboard, copy } from '../../../common/clipboard.js'
import { isWin, isMac, isMacJs, connectionMap } from '../../../common/constants.js'
import iconsMap from '../../sys-menu/icons-map.jsx'
import { refsStatic } from '../../common/ref.js'
import AIIcon from '../../icons/ai-icon.jsx'
import { isAIDisabled } from '../../../common/ai-feature.js'
import message from '../../common/message'
import {
  nextClearColor,
  dumpTerminalText,
  insertAboveViewport,
  cloneBufferLines,
  restoreClonedLines
} from '../clear-marks.js'

const e = window.translate

function countNonEmptyLines (text) {
  return String(text || '')
    .split(/\r\n|\n|\r/)
    .filter(l => l.length > 0)
    .length
}

function isMultilinePaste (text) {
  return /[\r\n]/.test(text || '') && countNonEmptyLines(text) >= 2
}

/**
 * The right-click (and long-press) menu plus the clipboard actions behind it.
 * Menu item `key`s are method names, so `onContextMenu` just dispatches.
 */
export const contextMenuMixin = {
  renderContextMenu () {
    const { hasSelection, recording } = this.state
    const copyed = true
    const copyShortcut = this.getShortcut('terminal_copy')
    const pasteShortcut = this.getShortcut('terminal_paste')
    const clearShortcut = this.getShortcut('terminal_clear')
    const searchShortcut = this.getShortcut('terminal_search')
    const selectAllShortcut = isMacJs ? 'meta+a' : 'ctrl+shift+a'
    const isSerial = this.props.tab?.type === connectionMap.serial
    const items = [
      {
        key: 'onCopy',
        icon: <iconsMap.CopyOutlined />,
        label: e('copy'),
        disabled: !hasSelection,
        extra: copyShortcut
      },
      {
        key: 'onPaste',
        icon: <iconsMap.SwitcherOutlined />,
        label: e('paste'),
        disabled: !copyed,
        extra: pasteShortcut
      },
      {
        key: 'onPasteSelected',
        icon: <iconsMap.SwitcherOutlined />,
        label: e('pasteSelected') === 'pasteSelected' ? '粘贴选中' : e('pasteSelected'),
        disabled: !hasSelection
      },
      {
        key: 'onSelectAll',
        icon: <iconsMap.CheckSquareOutlined />,
        label: e('selectall'),
        extra: selectAllShortcut
      },
      ...(
        this.isTouchMode()
          ? [{
              key: 'onSelectTextMode',
              icon: <iconsMap.SelectOutlined />,
              label: e('selectText')
            }]
          : []
      ),
      ...(
        isAIDisabled()
          ? []
          : [{
              key: 'explainWithAi',
              icon: <AIIcon />,
              label: e('explainWithAi'),
              disabled: !hasSelection
            }]
      ),
      {
        key: 'onClear',
        icon: <iconsMap.ReloadOutlined />,
        label: e('clear'),
        extra: clearShortcut
      },
      {
        key: 'scrollToPrevClearMark',
        icon: <iconsMap.ReloadOutlined />,
        label: '跳到上一个 Clear',
        disabled: !(this.clearMarks && this.clearMarks.length)
      },
      this.renderClearHistoryMenu(),
      {
        key: 'toggleSearch',
        icon: <iconsMap.SearchOutlined />,
        label: e('search'),
        extra: searchShortcut
      },
      {
        key: 'onSaveTerminalLog',
        icon: <iconsMap.SaveOutlined />,
        label: e('saveTerminalLogToFile')
      },
      {
        key: recording ? 'onStopRecord' : 'onRecord',
        icon: recording ? <iconsMap.StopOutlined /> : <iconsMap.PlayCircleFilled />,
        label: e(recording ? 'stopRecord' : 'record')
      },
      {
        type: 'divider'
      },
      {
        key: 'onRestartApp',
        icon: <iconsMap.RedoOutlined />,
        label: '重启'
      }
    ]
    if (isSerial) {
      items.push(
        {
          type: 'divider'
        },
        {
          key: 'onXmodemSend',
          icon: <iconsMap.CloudUploadOutlined />,
          label: 'XMODEM Send'
        },
        {
          key: 'onXmodemReceive',
          icon: <iconsMap.CloudDownloadOutlined />,
          label: 'XMODEM Receive'
        }
      )
    }
    return items
  },

  renderClearHistoryMenu () {
    const marks = this.clearMarks || []
    return {
      key: 'clearHistoryMenu',
      label: marks.length ? `Clear 历史 (${marks.length})` : 'Clear 历史',
      disabled: !marks.length,
      children: marks.length
        ? [...marks].reverse().map(mark => ({
          key: `jumpClearMark-${mark.index}`,
          label: (
            <span>
              <i
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  marginRight: 8,
                  background: mark.color,
                  verticalAlign: 'middle'
                }}
              />
              {`#${mark.index}  ${new Date(mark.ts).toLocaleTimeString()}`}
            </span>
          )
        }))
        : undefined
    }
  },

  onContextMenu ({ key }) {
    const name = String(key || '')
    if (name.startsWith('jumpClearMark-')) {
      this.jumpToClearMark(Number(name.slice('jumpClearMark-'.length)))
      return
    }
    if (typeof this[name] === 'function') {
      this[name]()
    }
  },

  onContextMenuInner (e) {
    e.preventDefault()
    if (this.state.loading) {
      return
    }
    if (this.props.config.pasteWhenContextMenu) {
      return this.onPaste()
    }
  },

  onSelection () {
    if (this._suppressCopyOnce) {
      this._suppressCopyOnce = false
      return false
    }
    if (
      !this.props.config.copyWhenSelect ||
      window.store.onOperation
    ) {
      return false
    }
    if (this.dragSelect) {
      return false
    }
    this.copySelectionToClipboard()
  },

  copySelectionToClipboard () {
    this.copyToClipboard(this.term.getSelection())
  },

  /**
   * Shared clipboard write. Lives here rather than in term-touch.js so that
   * the touch module stays free of imports (it is loaded directly by a
   * node:test unit spec), and so every copy raises the same `copied` toast.
   */
  copyToClipboard (txt) {
    if (txt) {
      copy(txt)
    }
  },

  tryInsertSelected () {
    const txt = this.term.getSelection()
    if (txt) {
      this.attachAddon._sendData(txt)
    }
  },

  onCopy () {
    const selected = this.term.getSelection()
    copy(selected)
    this.term.focus()
  },

  onSelectAll () {
    this.term.selectAll()
  },

  pasteNeedsConfirm (text) {
    if (!this.props.config.disableConfirmForLargeClipboardContent) {
      if ((text || '').length > 500) {
        return { need: true, reason: 'large' }
      }
    }
    if (this.props.config.confirmOnMultilinePaste !== false && isMultilinePaste(text)) {
      return { need: true, reason: 'multiline', lines: countNonEmptyLines(text) }
    }
    return { need: false }
  },

  pasteTextTooLong () {
    if (this.props.config.disableConfirmForLargeClipboardContent) {
      return false
    }
    if (window.et.isWebApp) {
      return false
    }
    const text = readClipboard()
    return text.length > 500
  },

  askUserConfirm (opts = {}) {
    const text = opts.text != null ? opts.text : readClipboard()
    const lines = countNonEmptyLines(text)
    const multiline = opts.reason === 'multiline' || isMultilinePaste(text)
    const title = multiline
      ? '检测到多行粘贴'
      : e('paste')
    const hint = multiline
      ? (
        <p>
          剪贴板包含 <b>{lines}</b> 行，粘贴后可能连续执行多条命令。
          可在「设置 → 终端」关闭「多行粘贴确认」(confirmOnMultilinePaste)。
        </p>
        )
      : <p>{e('paste')}:</p>
    Modal.confirm({
      title,
      content: (
        <div>
          {hint}
          <div className='paste-text'>
            <pre>
              <code>{text}</code>
            </pre>
          </div>
        </div>
      ),
      okText: e('ok'),
      cancelText: e('cancel'),
      onOk: () => this.onPaste(true)
    })
  },

  async onPaste (skipTextLengthCheck) {
    let selected = await readClipboardAsync()
    if (!skipTextLengthCheck) {
      const check = this.pasteNeedsConfirm(selected)
      if (check.need && !window.et.isWebApp) {
        return this.askUserConfirm({ text: selected, reason: check.reason })
      }
    }
    if (isWin && this.isRemote()) {
      selected = selected.replace(/\r\n/g, '\n')
    }
    this.term.paste(selected || '')
    this.term.focus()
  },

  onRestartApp () {
    window.store.restart()
  },

  onPasteSelected () {
    const selected = this.term.getSelection()
    if (!selected) {
      message.warning('没有选中文本')
      this.term.focus()
      return
    }
    this.term.paste(selected)
    this.term.focus()
  },

  csiEraseParam (params) {
    const raw = params && params.length ? params[0] : 0
    const n = Array.isArray(raw) ? raw[0] : raw
    return n || 0
  },

  recentBufferText (maxLines = 40) {
    try {
      const buf = this.term?.buffer?.active
      if (!buf) {
        return ''
      }
      const start = Math.max(0, buf.length - maxLines)
      const lines = []
      for (let i = start; i < buf.length; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) || '')
      }
      return lines.join('\n')
    } catch (e) {
      return ''
    }
  },

  // Local PowerShell/cmd use cls. Linux, macOS, and remote bash/zsh use clear.
  // A Windows desktop SSH'd into Linux must still send clear.
  shellUsesCls () {
    if (!this.isLocal()) {
      const shell = String(this.startupQueue?.shellType || '').toLowerCase()
      if (shell === 'bash' || shell === 'zsh' || shell === 'fish') {
        return false
      }
      const sample = this.recentBufferText(40)
      if (/[A-Za-z]:[\\/]/.test(sample) || /Windows PowerShell|Microsoft Windows|pwsh|cmd\.exe/i.test(sample)) {
        return true
      }
      return false
    }
    if (!isWin) {
      return false
    }
    const exec = String(this.props?.config?.execWindows || '')
    if (/\\bash(\.exe)?$|\\zsh(\.exe)?$|\\fish(\.exe)?$|git-bash/i.test(exec)) {
      return false
    }
    return true
  },

  // Remote and non-Windows shells: ignore CSI 3J (the part of `clear` that
  // deletes scrollback) and let CSI 2J push the viewport into scrollback.
  // Local Windows ConPTY desyncs if 3J is swallowed, so that path restores
  // a clone only after the shell really wiped the buffer.
  bindKeepScrollbackOnClear (term) {
    if (!term?.parser?.registerCsiHandler || this._clearKeepDisp) {
      return
    }
    const localWindows = this.isLocal() && isWin
    if (localWindows) {
      this._clearKeepsScrollback = false
      this._clearKeepDisp = term.parser.registerCsiHandler({ final: 'J' }, params => {
        if (this.csiEraseParam(params) === 3 && this._menuClearLines) {
          clearTimeout(this._restoreTimer)
          this._restoreTimer = setTimeout(() => this.finishMenuClearRestore(), 150)
        }
        return false
      })
      return
    }
    term.options.scrollOnEraseInDisplay = true
    this._clearKeepsScrollback = true
    this._clearKeepDisp = term.parser.registerCsiHandler({ final: 'J' }, params => {
      return this.csiEraseParam(params) === 3
    })
  },

  bufferLineCount () {
    return this.term?._core?._bufferService?.buffers?.normal?.lines?.length || 0
  },

  finishMenuClearRestore () {
    const lines = this._menuClearLines
    this._menuClearLines = null
    if (!lines?.length || !this.term) {
      return
    }
    restoreClonedLines(this.term, lines)
    try {
      this.term.scrollToBottom()
      this.term.focus()
    } catch (e) {
      // ignore
    }
  },

  scheduleMenuClearRestore () {
    clearTimeout(this._restoreTimer)
    const started = Date.now()
    const before = this._menuClearLen || 0
    const attempt = () => {
      if (!this._menuClearLines || !this.term) {
        return
      }
      const len = this.bufferLineCount()
      const wiped = before > 0 && len < before - 1
      if (wiped) {
        this.finishMenuClearRestore()
        return
      }
      if (Date.now() - started > 1500) {
        // 3J never arrived, so the existing scrollback is still there.
        this._menuClearLines = null
        this.term.focus()
        return
      }
      this._restoreTimer = setTimeout(attempt, 100)
    }
    this._restoreTimer = setTimeout(attempt, 200)
  },

  onClear () {
    const shouldClear = this.searchAddon &&
      window.store.termSearchOpen &&
      window.store.termSearch
    if (shouldClear) {
      this.searchAddon.clearDecorations()
    }

    const enabled = this.props.config.clearMarkEnabled !== false
    if (!this.clearMarks) {
      this.clearMarks = []
      this.clearMarkIndex = 0
    }
    if (enabled) {
      const cmd = this.shellUsesCls() ? 'cls' : 'clear'
      if (this.attachAddon?._sendData) {
        if (!this._clearKeepsScrollback) {
          this._menuClearLines = cloneBufferLines(this.term)
          this._menuClearLen = this.bufferLineCount()
          this.scheduleMenuClearRestore()
        }
        this.attachAddon._sendData(cmd + '\r')
      } else {
        const prev = this.term.options.scrollOnEraseInDisplay
        this.term.options.scrollOnEraseInDisplay = true
        this.term.write('\x1b[2J\x1b[H', () => {
          if (!this._clearKeepsScrollback) {
            this.term.options.scrollOnEraseInDisplay = !!prev
          }
          this.term.scrollToBottom()
          this.term.focus()
        })
      }
    } else {
      this.term.clear()
      this.term.scrollToBottom()
      this.term.focus()
    }
    if (shouldClear) {
      this.searchAddon._lineCache.clear()
      this.timers.clearSearchTimer = setTimeout(() => {
        refsStatic.get('term-search')?.next()
      }, 100)
    }
  },

  bindClearHistoryWheel (term) {
    const el = term?.element
    if (!el) {
      return
    }
    if (this._clearWheelEl && this._clearWheel) {
      this._clearWheelEl.removeEventListener('wheel', this._clearWheel, true)
    }
    this._clearWheel = (ev) => this.onClearHistoryWheel(ev)
    this._clearWheelEl = el
    el.addEventListener('wheel', this._clearWheel, { capture: true, passive: false })
  },

  noteIncomingClear () {
    const now = Date.now()
    const recent = this._lastClearSnap && now - this._lastClearSnap < 500
    if (recent) {
      clearTimeout(this._restoreTimer)
      this._restoreTimer = setTimeout(() => this.restoreClearedScrollback(), 160)
      return
    }
    let text = dumpTerminalText(this.term)
    if (!text.trim()) {
      return
    }
    this._lastClearSnap = now
    clearTimeout(this._restoreTimer)
    this._restoreTimer = setTimeout(() => this.restoreClearedScrollback(), 160)
    if (!this.clearMarks) {
      this.clearMarks = []
      this.clearMarkIndex = 0
    }
    if (!this._menuClearPending) {
      this.clearMarkIndex = (this.clearMarkIndex || 0) + 1
    }
    const index = this.clearMarkIndex || this.clearMarks.length + 1
    if (!text.includes('CLEAR #')) {
      text += `\n======== CLEAR #${index}  ${new Date(now).toLocaleTimeString()}  以上是上一段 ========`
    }
    this._pendingRestore = text
    this.clearMarks.push({
      index,
      ts: now,
      color: nextClearColor(index - 1),
      text
    })
    if (this.clearMarks.length > 20) {
      this.clearMarks.splice(0, this.clearMarks.length - 20)
    }
    this.clearLoadNext = this.clearMarks.length
    setTimeout(() => {
      if (this.term) {
        this.setState({ clearMarkCount: this.clearMarks.length })
      }
    }, 0)
  },

  restoreClearedScrollback () {
    const text = this._pendingRestore
    this._pendingRestore = ''
    if (!text || !this.term) {
      return
    }
    const buffer = this.term._core?._bufferService?.buffers?.normal
    const rows = this.term.rows || 24
    const len = buffer?.lines?.length || 0
    // 3J wipes scrollback, so put the whole snapshot back.
    // A plain ED2 only erases the viewport; keep existing scrollback and
    // put just the cleared screen above the prompt.
    let payload = text
    if (len > rows + 2) {
      payload = text.split('\n').slice(-rows).join('\n')
    }
    const ok = insertAboveViewport(this.term, payload, false)
    if (!ok) {
      return
    }
    this.clearLoadNext = 0
    try {
      this.term.scrollToBottom()
      this.term.refresh(0, Math.max(0, this.term.rows - 1))
    } catch (e) {
      // ignore
    }
  },

  bindLineSelect (term) {
    const el = term?.element
    if (!el) {
      return
    }
    this._lineDown = (ev) => {
      if (ev.button !== 0) {
        return
      }
      this._lineDownX = ev.clientX
      this._lineDownY = ev.clientY
    }
    this._lineUp = (ev) => {
      if (ev.button !== 0 || ev.detail >= 2) {
        return
      }
      const dx = Math.abs(ev.clientX - (this._lineDownX || 0))
      const dy = Math.abs(ev.clientY - (this._lineDownY || 0))
      if (dx > 5 || dy > 5) {
        return
      }
      const screen = this.term?.element?.querySelector('.xterm-screen')
      if (screen && !screen.contains(ev.target)) {
        return
      }
      const line = this.eventToBufferLine(ev)
      const shift = ev.shiftKey
      setTimeout(() => this.finishLineClick(line, shift), 0)
    }
    el.addEventListener('mousedown', this._lineDown, true)
    el.addEventListener('mouseup', this._lineUp, true)
    this._lineSelectEl = el
  },

  eventToBufferLine (ev) {
    const screen = this.term?.element?.querySelector('.xterm-screen')
    if (!screen || !this.term) {
      return -1
    }
    const rect = screen.getBoundingClientRect()
    const y = ev.clientY - rect.top
    if (y < 0 || y > rect.height || !this.term.rows) {
      return -1
    }
    const row = Math.min(this.term.rows - 1, Math.max(0, Math.floor(y / (rect.height / this.term.rows))))
    return (this.term.buffer.active.viewportY || 0) + row
  },

  finishLineClick (line, shift) {
    if (line < 0 || !this.term) {
      return
    }
    if (shift && this._lineAnchor != null) {
      const start = Math.min(this._lineAnchor, line)
      const end = Math.max(this._lineAnchor, line)
      this.term.selectLines(start, end)
      const text = this.term.getSelection()
      if (text && text.trim()) {
        this.copyToClipboard(text)
        message.success(`已复制 ${end - start + 1} 行`)
      }
      return
    }
    this._lineAnchor = line
    this._suppressCopyOnce = true
    this.term.selectLines(line, line)
  },

  onClearHistoryWheel (ev) {
    if (!ev || ev.deltaY >= 0) {
      return
    }
    const top = this.term?.buffer?.active?.viewportY ?? 0
    if (top > 0) {
      return
    }
    const next = this.clearLoadNext == null
      ? (this.clearMarks || []).length
      : this.clearLoadNext
    if (next <= 0) {
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    if (this._clearWheelLock) {
      return
    }
    this._clearWheelLock = true
    setTimeout(() => {
      this._clearWheelLock = false
    }, 280)
    this.loadPreviousClear()
  },

  loadPreviousClear () {
    const marks = this.clearMarks || []
    if (this.clearLoadNext == null) {
      this.clearLoadNext = marks.length
    }
    if (this.clearLoadNext <= 0) {
      message.info('已经是最早的 Clear')
      return
    }
    const mark = marks[this.clearLoadNext - 1]
    if (!mark?.text || !insertAboveViewport(this.term, mark.text)) {
      message.info('回滚区已满，放不下这段历史')
      return
    }
    mark.loaded = true
    this.clearLoadNext -= 1
    this.term.focus()
  },

  jumpToClearMark (index) {
    const marks = this.clearMarks || []
    const pos = marks.findIndex(item => item.index === index)
    if (pos < 0 || !marks[pos].text) {
      message.info('这条 Clear 已经不在缓存里')
      return
    }
    if (marks[pos].loaded) {
      message.info('这段内容已经在上面，继续往上翻')
      return
    }
    if (!insertAboveViewport(this.term, marks[pos].text)) {
      message.info('回滚区已满，放不下这段历史')
      return
    }
    marks[pos].loaded = true
    if (this.clearLoadNext == null || this.clearLoadNext > pos) {
      this.clearLoadNext = pos
    }
    this.term.focus()
  },

  scrollToPrevClearMark () {
    if (!(this.clearMarks || []).length) {
      message.info('暂无 Clear 历史')
      return
    }
    this.loadPreviousClear()
  },

  onXmodemSend () {
    if (this.xmodemClient) {
      this.xmodemClient.initiateSend()
    }
    this.term.focus()
  },

  onXmodemReceive () {
    if (this.xmodemClient) {
      this.xmodemClient.initiateReceive()
    }
    this.term.focus()
  },

  explainWithAi () {
    window.store.explainWithAi(
      this.term.getSelection()
    )
  },

  clearShortcut (e) {
    e.stopPropagation()
    this.onClear()
  },

  copyShortcut (e) {
    const sel = this.term.getSelection()
    if (sel) {
      e.stopPropagation()
      this.copySelectionToClipboard()
      return false
    }
  },

  pasteSelectedShortcut (e) {
    e.stopPropagation()
    this.onPasteSelected()
  },

  searchShortcut (e) {
    e.stopPropagation()
    this.toggleSearch()
  },

  pasteShortcut (e) {
    const text = readClipboard()
    const check = this.pasteNeedsConfirm(text)
    if (check.need && !window.et.isWebApp) {
      this.askUserConfirm({ text, reason: check.reason })
      e.preventDefault()
      e.stopPropagation()
      return false
    }
    if (isMac) {
      return true
    }
    if (!this.isRemote()) {
      return true
    }
    if (this.term.buffer.active.type !== 'alternate') {
      return false
    }
    return true
  },

  showNormalBufferShortcut (e) {
    e.stopPropagation()
    this.openNormalBuffer()
  }
}
