import { throttle } from 'lodash-es'
import { resizeTerm } from '../terminal-apis.js'
import { minTerminalFontSize } from '../../../common/constants.js'

/**
 * Sizing: fitting the terminal into its (possibly hidden) container, font
 * zoom, and keeping the remote pty in sync with the on-screen size.
 */
export const resizeMixin = {
  // 判断终端挂载容器当前是否真实可见（非 display:none）。
  // 隐藏标签的 clientWidth/clientHeight 为 0，此时不应 fit，否则会算出 0 列。
  isElementVisible () {
    const el = this.domRef.current
    if (!el) {
      return false
    }
    return el.clientWidth > 0 && el.clientHeight > 0
  },

  // 重新适配终端尺寸并强制重绘可见区域。
  // 仅当容器真正可见时才 fit：隐藏标签(display:none)下 clientWidth 为 0，
  // 若在此时 fit 会算出 0/极小列数，使 shell 提示符被逐字符错误换行，
  // 出现快速连续打开多个连接时的虚假/重复提示符。因此隐藏态跳过 fit，
  // 保留 xterm 默认 80x24，待标签激活可见后再 fit 重绘，从根上避免换行损坏。
  fitAndRefresh () {
    if (!this.term || !this.fitAddon || this.onClose) {
      return
    }
    if (!this.isElementVisible()) {
      return
    }
    const box = this.domRef.current
    // A tab that is still display:none, or mid-layout, reports a sliver.
    // Fitting that locks the cell size and row count, so the session looks empty.
    if (!box || box.clientHeight < 80 || box.clientWidth < 160) {
      return
    }
    const w = box.clientWidth
    const h = box.clientHeight
    const font = this.term.options.fontSize
    // A 1px layout twitch (scrollbar, padding) must not SIGWINCH the shell.
    // That resize is what leaves a blank line between prompts.
    if (
      this._fitBox &&
      this._fitBox.font === font &&
      Math.abs(w - this._fitBox.w) < 2 &&
      Math.abs(h - this._fitBox.h) < 2
    ) {
      return
    }
    try {
      this.fitAddon.fit()
      if (this.term.rows < 4 || this.term.cols < 20) {
        return
      }
      this._fitBox = { w, h, font }
      this.term.refresh(0, Math.max(0, this.term.rows - 1))
    } catch (e) {
      console.info('resize failed', e)
    }
  },

  // Split view keeps the terminal at height 100%, so zoom does not change
  // the height prop and componentDidUpdate never refits. Watch the box.
  bindContainerFit () {
    const el = this.domRef?.current
    if (!el || typeof ResizeObserver === 'undefined') {
      return
    }
    this._fitObserver?.disconnect()
    this._fitObserver = new ResizeObserver(() => {
      this.onResize()
    })
    this._fitObserver.observe(el)
  },

  // One throttled runner per terminal: a module level one would let tabs
  // throttle each other.
  onResize () {
    if (!this._resizeThrottled) {
      this._resizeThrottled = throttle(() => this.fitAndRefresh(), 200, {
        leading: false,
        trailing: true
      })
    }
    this._resizeThrottled()
  },

  onResizeTerminal (size) {
    const { cols, rows } = size
    resizeTerm(this.pid, cols, rows)
  },

  zoom (v) {
    const { term } = this
    if (!term) {
      return
    }
    const next = Math.max(
      minTerminalFontSize,
      term.options.fontSize + v
    )
    const changed = next - term.options.fontSize
    if (changed === 0) {
      return
    }
    term.options.fontSize = next
    window.store.triggerResize()
    if (this.originalFontSize == null) {
      this.originalFontSize = next - changed
    }
    window.store.terminalFontSize = next
    window.store.terminalFontBase = this.originalFontSize
    this.setState({
      fontSizeChanged: next !== this.originalFontSize
    }, () => this.onResize())
  },

  handleResetFontSize () {
    const { term } = this
    if (!term || this.originalFontSize == null) {
      return
    }
    term.options.fontSize = this.originalFontSize
    window.store.terminalFontSize = this.originalFontSize
    window.store.terminalFontBase = this.originalFontSize
    window.store.triggerResize()
    this.setState({ fontSizeChanged: false }, () => this.onResize())
    term.focus()
  }
}
