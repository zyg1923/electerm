import {
  loadTerminal,
  loadFitAddon,
  loadSerializeAddon,
  loadSearchAddon,
  loadLigaturesAddon,
  loadUnicode11Addon,
  loadImageAddon
} from '../xterm-loader.js'
import { CommandTrackerAddon } from '../command-tracker-addon.js'
import { Osc52Addon } from '../osc52-addon.js'
import { rendererTypes } from '../../../common/constants.js'
import { refsStatic } from '../../common/ref.js'
import keyControlPressed from '../../../common/key-control-pressed.js'
import { parseViCommand } from '../../ops/ops-vi.js'

/**
 * Terminal bootstrap: create the xterm instance, load every addon and wire
 * the handlers that must exist before the connection is opened. Connection
 * setup continues in `socketMixin.remoteInit`.
 */
export const initMixin = {
  async initTerminal () {
    const { themeConfig, tab = {}, config = {} } = this.props
    const tc = this.getRendererThemeConfig(themeConfig)
    const Terminal = await loadTerminal()
    const term = new Terminal({
      allowProposedApi: true,
      scrollback: config.scrollback,
      rightClickSelectsWord: config.rightClickSelectsWord || false,
      fontFamily: tab.fontFamily || config.fontFamily,
      theme: tc,
      allowTransparency: true,
      wordSeparator: config.terminalWordSeparator,
      cursorStyle: config.cursorStyle,
      cursorBlink: config.cursorBlink,
      fontSize: tab.fontSize || config.fontSize,
      screenReaderMode: config.screenReaderMode,
      // Follow is handled ourselves: stay at the bottom until the wheel leaves it.
      scrollOnUserInput: false
    })

    term.parent = this
    term.onSelectionChange(this.onSelection)
    term.open(this.domRef.current, true)
    this._followOutput = true
    term.onWriteParsed(() => {
      if (this._followOutput) {
        this.scrollFollowBottom()
      }
      this.scheduleSearchRefresh()
    })
    term.onScroll(() => {
      this.syncFollowFromViewport()
    })
    this.bindClearHistoryWheel(term)
    this.bindLineSelect(term)
    this.bindKeepScrollbackOnClear(term)
    this.bindContainerFit()
    this.registerTerminalColorQueryHandlers(term, themeConfig)
    await this.loadRenderer(term, config)
    this.fixSelectionColors(term)
    // Re-apply the theme after the renderer is loaded. The Terminal was
    // constructed before UiTheme's useEffect ran, so the initial theme
    // may have a stale background. Pass `term` directly because this.term
    // is not assigned yet. Use deferred=true so a second repaint picks up
    // any CSS --main changes applied by UiTheme's useEffect.
    if (config.rendererType === rendererTypes.webGL) {
      this.applyTerminalTheme(true, term)
    }

    const FitAddon = await loadFitAddon()
    this.fitAddon = new FitAddon()
    this.cmdAddon = new CommandTrackerAddon()
    const SerializeAddon = await loadSerializeAddon()
    this.serializeAddon = new SerializeAddon()
  this.cmdAddon.onCommandExecuted((cmd) => {
      if (cmd && cmd.trim()) {
        window.store.addCmdHistory(cmd.trim())
      }
      this.maybeInterceptVi?.(cmd)
    })
    this.cmdAddon.onCwdChanged((cwd) => {
      this.setCwd(cwd)
    })
    const SearchAddon = await loadSearchAddon()
    this.searchAddon = new SearchAddon()
    const LigaturesAddon = await loadLigaturesAddon()
    const ligtureAddon = new LigaturesAddon()
    this.searchAddon.onDidChangeResults(this.onSearchResultsChange)
    const Unicode11Addon = await loadUnicode11Addon()
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    term.loadAddon(ligtureAddon)
    term.unicode.activeVersion = '11'
    term.loadAddon(this.fitAddon)
    term.loadAddon(this.searchAddon)
    term.loadAddon(this.cmdAddon)
    term.loadAddon(this.serializeAddon)
    this.osc52Addon = new Osc52Addon()
    term.loadAddon(this.osc52Addon)
    if (tab.enableTerminalImage) {
      const ImageAddon = await loadImageAddon()
      this.imageAddon = new ImageAddon({
        pixelLimit: 33554432
      })
      term.loadAddon(this.imageAddon)
    }
    term.onData(this.onData)
    this.term = term
    if (this.state?.loading) {
      this.applyLoadingCursor?.(true)
    }
    term.onSelectionChange(this.onSelectionChange)
    term.attachCustomKeyEventHandler(this.handleKeyboardEvent.bind(this))
    // Don't open the shell while the pane is still a sliver. A 2–3 row pty
    // keeps only the prompt, and a later resize does not reprint the banner.
    await this.waitForTerminalSize(term)
    if (this.onClose) {
      return
    }
    await this.restoreReloadScreen(term)
    await this.remoteInit(term)
  },

  terminalBoxReady () {
    const box = this.domRef?.current
    return !!(
      box &&
      box.clientHeight >= 80 &&
      box.clientWidth >= 160
    )
  },

  async waitForTerminalSize (term) {
    const fitNow = () => {
      if (!this.fitAddon || !this.terminalBoxReady()) {
        return false
      }
      try {
        this.fitAddon.fit()
      } catch (e) {
        return false
      }
      return term.rows >= 8 && term.cols >= 40
    }
    if (fitNow()) {
      return
    }
    await new Promise((resolve) => {
      const started = Date.now()
      const tick = () => {
        if (this.onClose || fitNow() || Date.now() - started > 1600) {
          resolve()
          return
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
  },

  onSelectionChange () {
    const hasSelection = this.term.hasSelection()
    const txt = hasSelection ? this.term.getSelection().trim() : ''
    this.setState({ hasSelection })
    refsStatic.get('unix-timestamp-tooltip')?.onSelection(txt)
  },

  guessPromptCwd () {
    const buffer = this.term?.buffer?.active
    if (!buffer) {
      return ''
    }
    const line = buffer.getLine(buffer.baseY + buffer.cursorY)
    const text = line?.translateToString?.(true) || ''
    const matched = text.match(/(?:^|[\s\[:])((?:~|\/)[^\]\s#$%>:]*)\s*[#$%>]\s/)
    return matched ? matched[1] : ''
  },

  interceptViCommand () {
    const enabled = this.props.config?.opsViIntercept !== false &&
      window.store.opsViIntercept !== false
    if (!enabled || !this.term || this.term.buffer.active.type === 'alternate') {
      return false
    }
    const raw = (this.getCurrentInput?.() || '').trim()
    const parsed = parseViCommand(raw)
    if (!parsed) {
      return false
    }
    window.store.addCmdHistory?.(raw)
    let path = parsed.path || ''
    if (path && !path.startsWith('/') && !path.startsWith('~')) {
      const cwd = this.cmdAddon?.getCwd?.() || this.guessPromptCwd()
      if (cwd) {
        const base = cwd === '~' ? '~' : cwd.replace(/\/$/, '')
        path = base + '/' + path
      }
    }
    try {
      this.socket?.send?.('\x15')
    } catch (e) {}
    import('../../ops/ops-file-editor.jsx').then(({ openOpsFileEditor }) => {
      openOpsFileEditor({
        tabId: this.props.tab?.id,
        path
      })
    }).catch(() => {})
    return true
  },

  maybeInterceptVi (cmd) {
    const enabled = this.props.config?.opsViIntercept !== false &&
      window.store.opsViIntercept !== false
    if (!enabled) return
    // dynamic import avoid cycle
    import('../../ops/ops-file-editor.jsx').then(({ parseViCommand, openOpsFileEditor }) => {
      const parsed = parseViCommand(cmd)
      if (!parsed) return
      // interrupt raw vim if it already started
      try {
        this.attachAddon?._sendData('\x03')
      } catch (e) {}
      const cwd = this.cmdAddon?.cwd || ''
      let path = parsed.path
      if (path && !path.startsWith('/') && cwd) {
        path = cwd.replace(/\/$/, '') + '/' + path
      }
      openOpsFileEditor({
        tabId: this.props.tab?.id,
        path
      })
      try {
        this.term?.writeln?.('\r\n\x1b[33m[electerm] 已拦截 vi，打开 GUI 编辑器。使用 vi --raw 可绕过。\x1b[0m\r\n')
      } catch (e) {}
    }).catch(() => {})
  },

  webLinkHandler (event, url) {
    if (event?.button === 2) {
      return false
    }
    if (!this.props.config.ctrlOrMetaOpenTerminalLink) {
      return window.openLink(url, '_blank')
    }
    if (keyControlPressed(event)) {
      window.openLink(url, '_blank')
    }
  }
}
