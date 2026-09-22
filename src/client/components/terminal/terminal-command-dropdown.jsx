import { Component } from 'manate/react/class-components'
import { refsStatic, refs } from '../common/ref'
import SuggestionItem from './cmd-item'
import { aiSuggestionsCache } from '../../common/cache'
import { appendMandatoryGuardrails } from '../ai/ai-guardrails'
import { isAIDisabled } from '../../common/ai-feature'
import classnames from 'classnames'
import {
  LoadingOutlined
} from '@ant-design/icons'
import { listLocalDirectory } from '../sftp/file-read'
import { fileTypeMap } from '../../common/constants'
import {
  BUILTIN_COMMANDS,
  parsePathCommand,
  isWindowsPathStyle,
  splitArgPath,
  resolveListDir,
  formatPathSuggestions
} from '../../common/builtin-cmd-suggestions'

export default class TerminalCmdSuggestions extends Component {
  state = {
    cursorPosition: {},
    showSuggestions: false,
    loadingAiSuggestions: false,
    aiSuggestions: [],
    cmdIsDescription: false,
    reverse: false,
    cmd: '',
    passwordMode: false,
    selectedIndex: 0,
    pathSuggestions: []
  }

  _pathToken = 0

  componentDidMount () {
    refsStatic.add('terminal-suggestions', this)
  }

  componentDidUpdate (prevProps, prevState) {
    if (
      this.state.showSuggestions &&
      !this.state.passwordMode &&
      (prevState.cmd !== this.state.cmd || !prevState.showSuggestions)
    ) {
      this.fetchPathSuggestions(this.state.cmd)
    }
    if (prevState.selectedIndex !== this.state.selectedIndex) {
      this.scrollSelectedIntoView()
    }
  }

  componentWillUnmount () {
    refsStatic.remove('terminal-suggestions')
    document.removeEventListener('click', this.handleClickOutside)
    document.removeEventListener('keydown', this.handleKeyDown, true)
  }

  parseAiSuggestions = (aiResponse) => {
    try {
      return JSON.parse(aiResponse.response).map(d => {
        return {
          command: d,
          type: 'AI'
        }
      })
    } catch (e) {
      console.log('parseAiSuggestions error:', e)
      return []
    }
  }

  getAiSuggestions = async (event) => {
    event.stopPropagation()
    const { cmd } = this.state
    if (window.store.aiConfigMissing()) {
      window.store.toggleAIConfig()
    }
    this.setState({
      loadingAiSuggestions: true
    })
    const {
      config
    } = window.store
    const prompt = `give me max 5 command suggestions for user input: "${cmd}", return pure json format result only, no extra words, no markdown format, follow this format: ["command1","command2"...]`
    const cached = aiSuggestionsCache.get(cmd)
    if (cached) {
      this.setState({
        loadingAiSuggestions: false,
        aiSuggestions: cached
      })
      return
    }

    const aiResponse = aiSuggestionsCache.get(prompt) || await window.pre.runGlobalAsync(
      'AIchat',
      prompt,
      config.modelAI,
      appendMandatoryGuardrails(config.roleAI),
      config.baseURLAI,
      config.apiPathAI,
      config.apiKeyAI,
      config.proxyAI,
      false,
      config.authHeaderNameAI
    ).catch(
      window.store.onError
    )
    if (cmd !== this.state.cmd) {
      this.setState({
        loadingAiSuggestions: false
      })
      return
    }
    if (aiResponse && aiResponse.error) {
      this.setState({
        loadingAiSuggestions: false
      })
      return window.store.onError(
        new Error(aiResponse.error)
      )
    }
    this.setState({
      loadingAiSuggestions: false,
      aiSuggestions: this.parseAiSuggestions(aiResponse, cmd)
    })
  }

  openSuggestions = (cursorPosition, cmd) => {
    if (this.state.passwordMode) {
      return
    }
    if (!this.state.showSuggestions) {
      document.addEventListener('click', this.handleClickOutside)
      document.addEventListener('keydown', this.handleKeyDown, true)
    }

    const {
      left,
      top,
      cellHeight
    } = cursorPosition
    const w = window.innerWidth
    const h = window.innerHeight

    const position = {}

    // Use right position if close to right edge
    if (left > w / 2) {
      position.right = w - left
    } else {
      position.left = left
    }

    // Sit well below the prompt so the panel is not glued to the tab bar.
    const line = cellHeight || 18
    const below = Math.max(220, top + line + 96)
    const reverse = top > h / 2 || below + 280 > h
    if (reverse) {
      position.bottom = Math.max(24, h - top + line + 12)
    } else {
      position.top = below
    }
    this._suggestionsCache = null
    this.setState({
      showSuggestions: true,
      cursorPosition: position,
      cmd,
      reverse,
      passwordMode: false,
      selectedIndex: 0
    })
  }

  openPasswordSuggestions = (cursorPosition) => {
    if (!this.state.showSuggestions) {
      document.addEventListener('click', this.handleClickOutside)
      document.addEventListener('keydown', this.handleKeyDown, true)
    }

    const {
      left,
      top,
      cellHeight
    } = cursorPosition
    const w = window.innerWidth
    const h = window.innerHeight

    const position = {}

    if (left > w / 2) {
      position.right = w - left
    } else {
      position.left = left
    }

    const line = cellHeight || 18
    const below = Math.max(220, top + line + 96)
    const reverse = top > h / 2 || below + 280 > h
    if (reverse) {
      position.bottom = Math.max(24, h - top + line + 12)
    } else {
      position.top = below
    }
    this.setState({
      showSuggestions: true,
      cursorPosition: position,
      cmd: '',
      reverse,
      passwordMode: true
    })
  }

  closeSuggestions = () => {
    document.removeEventListener('click', this.handleClickOutside)
    document.removeEventListener('keydown', this.handleKeyDown, true)
    const {
      aiSuggestions
    } = this.state
    if (aiSuggestions.length) {
      aiSuggestionsCache.set(this.state.cmd, aiSuggestions)
      aiSuggestions.forEach(item => {
        window.store.addCmdHistory(item.command, 'aiCmdHistory')
      })
    }
    this._pathToken += 1
    this._suggestionsCache = null
    this.setState({
      showSuggestions: false,
      aiSuggestions: [],
      passwordMode: false,
      selectedIndex: 0,
      pathSuggestions: []
    })
  }

  handleClickOutside = (event) => {
    const suggestionElement = document.querySelector('.terminal-suggestions-wrap')
    if (suggestionElement && !suggestionElement.contains(event.target)) {
      this.closeSuggestions()
    }
  }

  handleKeyDown = (event) => {
    if (!this.state.showSuggestions) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      this.closeSuggestions()
      return
    }
    const suggestions = this.state.passwordMode
      ? this.getPasswordSuggestions()
      : this.getSuggestions()
    if (!suggestions.length) {
      return
    }
    const len = suggestions.length
    const idx = Math.max(0, Math.min(this.state.selectedIndex, len - 1))
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      this.setState({
        selectedIndex: (idx + 1) % len
      })
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      this.setState({
        selectedIndex: (idx - 1 + len) % len
      })
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      const item = suggestions[idx]
      if (!item) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      this.handleSelect(item)
    }
  }

  scrollSelectedIntoView = () => {
    const el = document.querySelector('.suggestion-item.selected')
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  getPathContext = () => {
    const tabId = window.store.activeTabId
    const terminal = refs.get('term-' + tabId)
    const sftpComp = refs.get('sftp-' + tabId)
    const tab = window.store.currentTab || {}
    const isRemote = !!(tab.host || tab.authType || tab.type === 'ssh')
    let cwd = ''
    try {
      cwd = terminal?.getCwd?.() || ''
    } catch {
      cwd = ''
    }
    if (!cwd && sftpComp?.state) {
      cwd = isRemote ? sftpComp.state.remotePath : sftpComp.state.localPath
    }
    const win = isWindowsPathStyle(cwd, isRemote)
    return { cwd, win, isRemote, sftpComp }
  }

  listPathEntries = async (listDir, isRemote, sftpComp) => {
    if (!listDir || listDir.startsWith('~')) {
      return []
    }
    if (sftpComp?.state) {
      const current = isRemote ? sftpComp.state.remotePath : sftpComp.state.localPath
      if (current && current.replace(/[\\/]+$/, '') === listDir.replace(/[\\/]+$/, '')) {
        const arr = isRemote ? sftpComp.state.remote : sftpComp.state.local
        return Array.isArray(arr) ? arr : []
      }
    }
    if (isRemote) {
      const sftp = sftpComp?.sftp
      if (!sftp || typeof sftp.list !== 'function') {
        return []
      }
      try {
        const arr = await sftp.list(listDir)
        return (arr || []).map(item => ({
          name: item.name,
          isDirectory: item.type === fileTypeMap.directory
        }))
      } catch {
        return []
      }
    }
    try {
      const arr = await listLocalDirectory(listDir)
      return arr || []
    } catch {
      return []
    }
  }

  fetchPathSuggestions = async (cmd) => {
    const parsed = parsePathCommand(cmd)
    if (!parsed || (parsed.arg && parsed.arg.startsWith('-'))) {
      if (this.state.pathSuggestions.length) {
        this.setState({ pathSuggestions: [] })
      }
      return
    }
    const token = ++this._pathToken
    const { cwd, win, isRemote, sftpComp } = this.getPathContext()
    const { dirRel } = splitArgPath(parsed.arg, win)
    const listDir = resolveListDir(cwd, dirRel, win)
    const entries = await this.listPathEntries(listDir, isRemote, sftpComp)
    if (token !== this._pathToken) {
      return
    }
    this._suggestionsCache = null
    this.setState({
      pathSuggestions: formatPathSuggestions(cmd, entries, { win }),
      selectedIndex: 0
    })
  }

  handleDelete = (item) => {
    window.store.deleteCmdHistory(item.command)
  }

  handleSelect = (item) => {
    const { activeTabId } = window.store
    const terminal = refs.get('term-' + activeTabId)
    if (!terminal) {
      console.log('No active terminal found')
      this.closeSuggestions()
      return
    }

    if (item.type === 'PW') {
      try {
        // Send password + Enter directly, no backspace needed
        terminal.attachAddon._sendData(item.command + '\r')
        terminal.attachAddon._passwordPromptDetected = false
        terminal.attachAddon._lastOutputLine = ''
      } catch (e) {
        console.error('Failed to send password:', e)
      }
      terminal.term.focus()
      this.closeSuggestions()
      return
    }

    const { command } = item
    // Read current input from buffer directly to avoid stale state
    // (onData fires before echo, so this.state.cmd may lag behind)
    const currentInput = terminal.getCurrentInput() || ''
    let txt = ''
    if (currentInput && command.startsWith(currentInput)) {
      txt = command.slice(currentInput.length)
    } else {
      const pre = '\b'.repeat(currentInput.length)
      txt = pre + command
    }
    terminal.attachAddon._sendData(txt)
    // Update the terminal's currentInput to reflect the full command
    terminal.setCurrentInput(command)
    terminal.term.focus()
    this.closeSuggestions()
  }

  processCommands = (commands = [], type, uniqueCommands, res) => {
    const { cmd } = this.state
    commands
      .filter(command => command && command.startsWith(cmd))
      .forEach(command => {
        if (!uniqueCommands.has(command)) {
          uniqueCommands.add(command)
          res.push({
            // Use stable key to avoid React re-mounting items on every render
            id: type + ':' + command,
            command,
            type
          })
        }
      })
  }

  getPasswordSuggestions = () => {
    const bookmarks = window.store.bookmarks || []
    const seen = new Set()
    const res = []
    for (const b of bookmarks) {
      if (b.password && !seen.has(b.password)) {
        seen.add(b.password)
        res.push({
          id: 'PW:' + b.password,
          command: b.password,
          type: 'PW',
          hint: [b.username, [b.host, b.port].filter(Boolean).join(':')].filter(Boolean).join('@')
        })
      }
    }
    return this.state.reverse ? res.reverse() : res
  }

  _suggestionsCache = null
  _suggestionsCacheKey = ''

  getSuggestions = () => {
    // Memoize: only recompute when cmd, reverse, aiSuggestions, or props change
    const { cmd, reverse, aiSuggestions, pathSuggestions } = this.state
    const { suggestions } = this.props
    const cacheKey = cmd + '|' + reverse + '|' + (aiSuggestions?.length || 0) + '|' + (pathSuggestions?.length || 0) + '|' + (suggestions?.history?.length || 0) + '|' + (suggestions?.batch?.length || 0) + '|' + (suggestions?.quick?.length || 0)
    if (this._suggestionsCache && this._suggestionsCacheKey === cacheKey) {
      return this._suggestionsCache
    }
    const uniqueCommands = new Set()
    const {
      history = [],
      batch = [],
      quick = []
    } = suggestions || {}
    const res = []
    this.processCommands(pathSuggestions, 'P', uniqueCommands, res)
    this.processCommands(history, 'H', uniqueCommands, res)
    this.processCommands(BUILTIN_COMMANDS, 'C', uniqueCommands, res)
    this.processCommands(quick, 'Q', uniqueCommands, res)
    this.processCommands(batch, 'B', uniqueCommands, res)
    aiSuggestions
      .forEach(item => {
        if (!uniqueCommands.has(item.command)) {
          uniqueCommands.add(item.command)
        }
        res.push({
          id: 'AI:' + item.command,
          ...item
        })
      })
    const capped = res.slice(0, 50)
    this._suggestionsCache = capped
    this._suggestionsCacheKey = cacheKey
    return capped
  }

  renderAIIcon () {
    const e = window.translate
    const {
      loadingAiSuggestions
    } = this.state
    if (loadingAiSuggestions) {
      return (
        <>
          <LoadingOutlined /> {e('getAiSuggestions')}
        </>
      )
    }
    const aiProps = {
      onClick: this.getAiSuggestions,
      className: 'pointer'
    }
    return (
      <div {...aiProps}>
        {e('getAiSuggestions')}
      </div>
    )
  }

  renderHint () {
    const lang = window.store?.config?.language || window.initLanguage || ''
    const txt = String(lang).startsWith('zh')
      ? '↑↓ 选择，Ctrl+回车 确认，Esc 关闭'
      : '↑↓ select, Ctrl+Enter confirm, Esc close'
    return (
      <div className='terminal-suggestions-hint'>
        {txt}
      </div>
    )
  }

  renderSticky (pos) {
    const {
      reverse
    } = this.state
    if (isAIDisabled()) {
      return null
    }
    if (
      (pos === 'top' && !reverse) ||
      (pos === 'bottom' && reverse)
    ) {
      return null
    }
    return (
      <div className='terminal-suggestions-sticky'>
        {this.renderAIIcon()}
      </div>
    )
  }

  render () {
    const { showSuggestions, cursorPosition, reverse, passwordMode } = this.state
    if (!showSuggestions) {
      return null
    }
    const suggestions = passwordMode
      ? this.getPasswordSuggestions()
      : this.getSuggestions()
    const selectedIndex = Math.max(0, Math.min(this.state.selectedIndex, Math.max(suggestions.length - 1, 0)))
    const cls = classnames('terminal-suggestions-wrap', {
      reverse
    })
    return (
      <div className={cls} style={cursorPosition}>
        {!passwordMode && this.renderSticky('top')}
        <div className='terminal-suggestions-list'>
          {
            suggestions.map((item, index) => {
              return (
                <SuggestionItem
                  key={item.id}
                  item={item}
                  selected={index === selectedIndex}
                  onSelect={this.handleSelect}
                  onDelete={this.handleDelete}
                />
              )
            })
          }
        </div>
        {this.renderHint()}
        {!passwordMode && this.renderSticky('bottom')}
      </div>
    )
  }
}
