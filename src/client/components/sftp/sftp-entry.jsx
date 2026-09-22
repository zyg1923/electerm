import { Component } from 'react'
import { refs } from '../common/ref'
import generate from '../../common/uid'
import runIdle from '../../common/run-idle'
import { Spin } from 'antd'
import { notification } from '../common/notification'
import Modal from '../common/modal'
import clone from '../../common/to-simple-obj'
import { isEqual, last, isNumber, some, isArray, pick, uniq, debounce } from 'lodash-es'
import FileSection from './file-item'
import resolve, { osResolve, normalizeWinLocalPath } from '../../common/resolve'
import wait from '../../common/wait'
import classnames from 'classnames'
import sorterIndex from '../../common/index-sorter'
import { handleErr } from '../../common/fetch'
import { getRemoteFileInfo, getFolderFromFilePath, listLocalDirectory } from './file-read'
import {
  typeMap, maxSftpHistory, paneMap,
  fileTypeMap,
  terminalSerialType,
  terminalFtpType,
  terminalTelnetType,
  terminalRdpType,
  terminalVncType,
  terminalSpiceType,
  terminalLocalType,
  terminalWebType,
  unexpectedPacketErrorDesc,
  sftpRetryInterval
} from '../../common/constants'
import { hasFileInClipboardText } from '../../common/clipboard'
import Client from '../../common/sftp'
import ListTable from './list-table-ui'
import FileTreeTable from './file-tree-ui'
import deepCopy from 'json-deep-copy'
import isValidPath from '../../common/is-valid-path'
import normalizeRemotePath from '../../common/normalize-remote-path'
import { LoadingOutlined, ReloadOutlined, UnorderedListOutlined, ApartmentOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import * as owner from './owner-list'
import AddressBar from './address-bar'
import getProxy from '../../common/get-proxy'
import { createTerm } from '../terminal/terminal-apis'
import './sftp.styl'

const e = window.translate
const viewModeKey = type => type === typeMap.local
  ? 'electerm-sftp-view-v4-local'
  : `electerm-sftp-view-v3-${type}`
const panelOpenKey = type => `electerm-sftp-panel-v4-${type}`
const treeDepthKey = type => `electerm-sftp-tree-depth-${type}`

function readStored (key, fallback) {
  try {
    const v = window.localStorage.getItem(key)
    return v == null || v === '' ? fallback : v
  } catch {
    return fallback
  }
}

export default class Sftp extends Component {
  constructor (props) {
    super(props)
    this.state = {
      id: props.id || generate(),
      selectedFiles: new Set(),
      selectedType: '',
      lastClickedFile: null,
      onEditFile: false,
      ...this.defaultState(),
      loadingSftp: false,
      inited: false,
      ready: false
    }
    this.retryCount = 0
  }

  componentDidMount () {
    this.id = 'sftp-' + this.props.tab.id
    refs.add(this.id, this)
    if (this.props.isFtp) {
      this.initFtpData()
    }
    this.timer = setTimeout(() => {
      this.setState({
        ready: true
      })
    }, 0)
  }

  componentDidUpdate (prevProps, prevState) {
    if (
      this.props.config.autoRefreshWhenSwitchToSftp &&
      prevProps.pane !== this.props.pane &&
      this.props.pane === paneMap.fileManager &&
      this.state.inited
    ) {
      this.onGoto(typeMap.local)
      if (this.shouldRenderRemote()) {
        this.onGoto(typeMap.remote)
      }
    }
    if (
      prevState.remotePath !== this.state.remotePath &&
      this.state.selectedType === typeMap.remote
    ) {
      this.setState({
        selectedFiles: new Set()
      })
    } else if (
      prevState.localPath !== this.state.localPath &&
      this.state.selectedType === typeMap.local
    ) {
      this.setState({
        selectedFiles: new Set()
      })
    }
    if (
      this.props.sftpPathFollowSsh &&
      prevProps.cwd !== this.props.cwd
    ) {
      this.updateCwd(this.props.cwd)
    }
    const remoteJustEnabled = this.shouldRenderRemote() && (
      (!prevProps.sshSftpSplitView && this.props.sshSftpSplitView) ||
      (!prevProps.tab?.host && this.props.tab?.host) ||
      (!prevProps.tab?.authType && this.props.tab?.authType)
    )
    if (remoteJustEnabled && !(this.state.remote || []).length && !this.state.remoteLoading) {
      this.initRemoteAll()
    }
  }

  componentWillUnmount () {
    refs.remove(this.id)
    this.sftp && this.sftp.destroy()
    this.sftp = null
    clearTimeout(this.timer)
    this.timer = null
    clearTimeout(this.timer4)
    this.timer4 = null
    clearTimeout(this.retryHandler)
    this.retryHandler = null
    // Clear sort cache to prevent memory leaks
    this._sortCache?.clear()
    this._lastSortArgs = null
  }

  initFtpData = async () => {
    this.type = 'ftp'
    const { tab } = this.props
    const { id } = tab
    const opts = clone({
      tabId: id,
      uid: tab.id,
      srcTabId: tab.id,
      termType: 'ftp',
      ...tab
    })
    const r = await createTerm(opts)
      .catch(err => {
        const text = err.message
        handleErr({ message: text })
      })
    if (!r) {
      return
    }
    const {
      port
    } = r
    this.initData(undefined, port)
  }

  directions = [
    'desc',
    'asc'
  ]

  defaultDirection = (i = 0) => {
    return this.directions[i]
  }

  getFileItemById = (id, type) => {
    if (type) {
      return this.state[`${type}FileTree`].get(id)
    }
    return this.getFileItemById(id, typeMap.local) ||
      this.getFileItemById(id, typeMap.remote)
  }

  defaultState = () => {
    const def = this.props.config.showHiddenFilesOnSftpStart
    return Object.keys(typeMap).reduce((prev, k, i) => {
      Object.assign(prev, {
        [`sortProp.${k}`]: window.store.sftpSortSetting[k].prop,
        [`sortDirection.${k}`]: window.store.sftpSortSetting[k].direction,
        [k]: [],
        [`${k}FileTree`]: new Map(),
        [`${k}Loading`]: false,
        [`${k}InputFocus`]: false,
        [`${k}ShowHiddenFile`]: def,
        [`${k}Path`]: '',
        [`${k}PathTemp`]: '',
        [`${k}PathHistory`]: [],
        [`${k}GidTree`]: new Map(),
        [`${k}UidTree`]: new Map(),
        [`${k}Keyword`]: '',
        [`${k}ViewMode`]: readStored(viewModeKey(k), 'tree'),
        [`${k}TreeDepth`]: Number(readStored(treeDepthKey(k), '1')) || 1,
        [`${k}TreeCache`]: {},
        [`${k}Expanded`]: {},
        [`${k}TreeLoading`]: {},
        [`${k}PanelOpen`]: k === typeMap.local &&
          (this.props.tab?.host || this.props.tab?.authType || this.props.tab?.type === 'ssh')
          ? readStored(panelOpenKey(k), '0') === '1'
          : readStored(panelOpenKey(k), '1') !== '0'
      })
      return prev
    }, {})
  }

  // Cache for memoized sort results
  _sortCache = new Map()
  _lastSortArgs = null

  sort = (list, type, sortDirection, sortProp) => {
    // Create a cache key from the arguments
    const cacheKey = JSON.stringify({
      listLength: list?.length || 0,
      listHash: this._hashList(list),
      type,
      sortDirection,
      sortProp
    })

    // Check if we have a cached result and if args haven't changed
    if (this._lastSortArgs && isEqual(this._lastSortArgs, [list, type, sortDirection, sortProp])) {
      const cached = this._sortCache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    // Compute the result
    if (!list || !list.length) {
      return []
    }

    const isDesc = sortDirection === 'desc'

    const result = list.slice().sort((a, b) => {
      // Handle items with no id first
      if (!a.id && b.id) return -1
      if (a.id && !b.id) return 1
      if (!a.id && !b.id) return 0

      // Sort directories before files
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }

      // Sort by the specified property
      let aValue = a[sortProp]
      let bValue = b[sortProp]

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
        return isDesc
          ? bValue.localeCompare(aValue, { sensitivity: 'base' })
          : aValue.localeCompare(bValue, { sensitivity: 'base' })
      }

      // For non-string values, use simple comparison
      if (aValue < bValue) return isDesc ? 1 : -1
      if (aValue > bValue) return isDesc ? -1 : 1
      return 0
    })

    // Cache the result
    this._lastSortArgs = [list, type, sortDirection, sortProp]
    this._sortCache.set(cacheKey, result)

    // Limit cache size to prevent memory leaks
    if (this._sortCache.size > 10) {
      const firstKey = this._sortCache.keys().next().value
      this._sortCache.delete(firstKey)
    }

    return result
  }

  // Helper method to create a simple hash of the list for cache key
  _hashList = (list) => {
    if (!list || !list.length) return 0
    return list.reduce((hash, item, index) => {
      const str = `${item.id || ''}${item.name || ''}${item.modifyTime || ''}${index}`
      return hash + str.length
    }, 0)
  }

  isActive () {
    const { currentBatchTabId, pane, sshSftpSplitView } = this.props
    const { tab } = this.props
    const isFtp = tab.type === terminalFtpType
    if (isFtp) {
      return true
    }
    if (currentBatchTabId !== tab.id) {
      return false
    }
    return sshSftpSplitView ||
      pane === paneMap.fileManager ||
      pane === paneMap.sftp ||
      pane === paneMap.terminal ||
      pane === paneMap.ssh
  }

  updateKeyword = (keyword, type) => {
    this.setState({
      [`${type}Keyword`]: keyword
    })
  }

  getCwdLocal = () => {
    if (
      !this.shouldRenderRemote() &&
      this.props.sftpPathFollowSsh &&
      this.props.cwd
    ) {
      return this.props.cwd
    }
  }

  gotoHome = async (type) => {
    const n = `${type}Path`
    const nt = n + 'Temp'
    let path

    if (type === typeMap.remote) {
      path = this.props.tab.startDirectoryRemote
      if (!path && this.sftp) {
        path = await this.getPwd(this.props.tab.username)
      }
      path = normalizeRemotePath(path)
    } else {
      path = this.getLocalHome()
    }

    this.setState({
      [n]: path,
      [nt]: path
    }, () => this[`${type}List`]())
  }

  updateCwd = (cwd = this.props.cwd) => {
    if (!this.state.inited) {
      return
    }
    const type = this.shouldRenderRemote()
      ? typeMap.remote
      : typeMap.local
    // this.setState({
    //   [`${type}PathTemp`]: cwd
    // }, () => {
    //   this.onGoto(
    //     type
    //   )
    // })
    const n = `${type}Path`
    const nt = n + 'Temp'
    this.setState({
      [n]: cwd,
      [nt]: cwd
    }, () => this[`${type}List`]())
  }

  getPwd = async (username) => {
    if (this.props.sftpPathFollowSsh && this.props.cwd) {
      return this.props.cwd
    }
    const home = await this.sftp.getHomeDir()
    if (home) {
      return home.trim()
    } else {
      return username === 'root'
        ? '/root'
        : `/home/${this.props.tab.username}`
    }
  }

  getIndex = (file) => {
    const { type } = file
    return this.getFileList(type).findIndex(f => f.id === file.id)
  }

  selectAll = (type, e) => {
    e && e.preventDefault && e.preventDefault()
    this.setState({
      selectedFiles: new Set(this.getFileList(type).map(f => f.id))
    })
  }

  selectNext = type => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    if (!fileList.length) {
      return
    }

    // Convert Set of IDs to array of indices
    const fileIndices = Array.from(selectedFiles)
      .map(id => fileList.findIndex(f => f.id === id))
      .filter(index => index !== -1)
      .sort(sorterIndex)

    const lastOne = last(fileIndices)
    let next = 0
    if (isNumber(lastOne)) {
      next = (lastOne + 1) % fileList.length
    }

    const nextFile = fileList[next]
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      })
    }
  }

  selectPrev = type => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    if (!fileList.length) {
      return
    }

    // Convert Set of IDs to array of indices
    const fileIndices = Array.from(selectedFiles)
      .map(id => fileList.findIndex(f => f.id === id))
      .filter(index => index !== -1)
      .sort(sorterIndex)

    const firstOne = fileIndices[0]
    let next = 0
    const len = fileList.length
    if (isNumber(firstOne)) {
      next = (firstOne - 1 + len) % len
    }

    const nextFile = fileList[next]
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      })
    }
  }

  localDel = async (file) => {
    const { name, isDirectory, path } = file
    const func = !isDirectory
      ? window.fs.unlink
      : window.fs.rmrf
    const p = resolve(path, name)
    await func(p).catch(window.store.onError)
  }

  remoteDel = async (file) => {
    const { name, isDirectory, path } = file
    const { sftp } = this
    const func = isDirectory
      ? sftp.rmdir
      : sftp.rm
    const p = resolve(path, name)
    await func(p).catch(window.store.onError)
  }

  confirmDelete = (files) => {
    return new Promise((resolve) => {
      Modal.confirm({
        title: this.renderDelConfirmTitle(files),
        okText: e('ok'),
        cancelText: e('cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }

  getSelectedFiles = (selectedFiles = this.state.selectedFiles) => {
    // Convert Set of IDs to array of file objects
    return Array.isArray(selectedFiles)
      ? selectedFiles
      : Array.from(selectedFiles)
        .map(id => this.getFileItemById(id))
        .filter(Boolean) // Filter out any undefined items
  }

  delFiles = async (_type, files = this.getSelectedFiles()) => {
    this.onDelete = true
    const confirm = await this.confirmDelete(files)
    this.onDelete = false
    if (!confirm) {
      return
    }
    const type = files[0]?.type || _type
    const func = this[type + 'Del']
    await Promise.all(files.map(f => func(f)))
    if (type === typeMap.remote) {
      await wait(500)
    }
    this[type + 'List']()
  }

  renderDelConfirmTitle (files = this.getSelectedFiles(), pureText) {
    const hasDirectory = some(files, f => f.isDirectory)
    const names = hasDirectory ? e('filesAndFolders') : e('files')
    if (pureText) {
      const t1 = hasDirectory
        ? e('delTip1')
        : ''
      return `${e('delTip')} ${names} ${t1} (${files.length})`
    }
    return (
      <div className='wordbreak'>
        {e('delTip')}
        {names}
        {
          hasDirectory
            ? e('delTip1')
            : ''
        }
        (<b className='mg1x'>{files.length}</b>)
      </div>
    )
  }

  enter = (type, e) => {
    const { selectedFiles, onEditFile } = this.state
    if (onEditFile || selectedFiles.size !== 1) {
      return
    }
    const fileId = Array.from(selectedFiles)[0]
    const file = this.getFileItemById(fileId)
    if (!file) {
      return
    }
    const { isDirectory } = file
    if (isDirectory) {
      this[type + 'Dom'].enterDirectory(e, file)
    } else {
      this.setState({
        filesToConfirm: [file]
      })
    }
  }

  onInputFocus = (type) => {
    this.setState({
      [type + 'InputFocus']: true
    })
    this.inputFocus = true
  }

  onInputBlur = (type, immediate) => {
    this.inputFocus = false
    clearTimeout(this.timer4)
    if (immediate) {
      this.setState({
        [type + 'InputFocus']: false
      })
      return
    }
    this.timer4 = setTimeout(() => {
      this.setState({
        [type + 'InputFocus']: false
      })
    }, 200)
  }

  doCopy = (type, e) => {
    const selectedFiles = this.getSelectedFiles()
    this[type + 'Dom'].onCopy(selectedFiles)
  }

  doCut = (type, e) => {
    const selectedFiles = this.getSelectedFiles()
    this[type + 'Dom'].onCut(selectedFiles)
  }

  doPaste = (type) => {
    if (!hasFileInClipboardText()) {
      return
    }
    this[type + 'Dom'].onPaste()
  }

  initData = (terminalId, port) => {
    this.terminalId = terminalId
    this.port = port
    if (this.shouldRenderRemote()) {
      this.initRemoteAll()
    }
    this.initLocalAll()
  }

  shouldRenderRemote = () => {
    const tab = this.props.tab || {}
    const nonSshTypes = [
      terminalSerialType,
      terminalTelnetType,
      terminalRdpType,
      terminalVncType,
      terminalSpiceType,
      terminalLocalType,
      terminalWebType,
      terminalFtpType
    ]
    if (nonSshTypes.includes(tab.type)) {
      return false
    }
    // Local terminal tabs have no host; never open remote SFTP against them.
    if (!tab.host && !tab.authType && tab.type !== 'ssh') {
      return false
    }
    return !!(
      tab.host ||
      tab.authType ||
      tab.type === 'ssh'
    )
  }

  initLocalAll = () => {
    if (this.state.localPanelOpen === false && this.shouldRenderRemote()) {
      return
    }
    this.localListOwner()
    this.localList()
  }

  initRemoteAll = async () => {
    if (!this.shouldRenderRemote()) {
      return
    }
    await Promise.all([
      this.remoteList(),
      this.remoteListOwner().catch(e => console.debug('remoteListOwner error:', e))
    ])
  }

  modifier = (...args) => {
    // Check if first argument is an object and contains path changes
    if (args[0] && typeof args[0] === 'object') {
      const updates = args[0]

      // Clear respective keyword if path changes
      if (updates.localPath !== undefined) {
        updates.localKeyword = ''
      }
      if (updates.remotePath !== undefined) {
        updates.remoteKeyword = ''
      }

      // Path changes and selection must apply immediately.
      // runIdle here made local folder double-click wait for an idle slot
      // before listing even started.
      if (
        updates.selectedFiles !== undefined ||
        updates.localPath !== undefined ||
        updates.remotePath !== undefined
      ) {
        return this.setState(...args)
      }
    }

    // For other updates, use runIdle to avoid blocking the UI
    runIdle(() => this.setState(...args))
  }

  addTransferList = list => {
    window.store.addTransferList(list)
  }

  onError = e => {
    window.store.onError(e)
    this.setState({
      remoteLoading: false
    })
  }

  getFileList = type => {
    return this.sortFileList(
      this.filterFileList(this.state[type], type),
      type
    )
  }

  filterFileList = (list, type) => {
    const showHide = this.state[`${type}ShowHiddenFile`]
    const keyword = this.state[`${type}Keyword`]
    let arr = isArray(list) ? list : []
    if (!showHide || keyword) {
      const lowerKeyword = (keyword || '').toLowerCase()
      arr = arr.filter(f => {
        if (!showHide && f.name.startsWith('.')) {
          return false
        }
        if (keyword && !f.name.toLowerCase().includes(lowerKeyword)) {
          return false
        }
        return true
      })
    }
    return arr
  }

  sortFileList = (list, type) => {
    return this.sort(
      list,
      type,
      this.state[`sortDirection.${type}`],
      this.state[`sortProp.${type}`]
    )
  }

  toggleShowHiddenFile = type => {
    const prop = `${type}ShowHiddenFile`
    const b = this.state[prop]
    this.setState({
      [prop]: !b
    })
  }

  setViewMode = (type, mode) => {
    try {
      window.localStorage.setItem(viewModeKey(type), mode)
    } catch {
      // ignore
    }
    this.setState({
      [`${type}ViewMode`]: mode
    }, () => {
      if (mode === 'tree') {
        this.ensureTreePrefetch(type)
      }
    })
  }

  setTreeDepth = (type, depth) => {
    const next = Math.min(5, Math.max(1, Number(depth) || 1))
    try {
      window.localStorage.setItem(treeDepthKey(type), String(next))
    } catch {
      // ignore
    }
    this._treePrefetchKey = {
      ...this._treePrefetchKey,
      [type]: ''
    }
    this.setState({
      [`${type}TreeDepth`]: next
    }, () => this.ensureTreePrefetch(type))
  }

  rememberTreePath = (type, dirPath, files) => {
    this.setState(prev => ({
      [`${type}TreeCache`]: {
        ...prev[`${type}TreeCache`],
        [dirPath]: files
      }
    }), () => {
      if (this.state[`${type}ViewMode`] === 'tree') {
        this.ensureTreePrefetch(type)
      }
    })
  }

  mergeTreeItems = (treeMap, type) => {
    const cache = this.state[`${type}TreeCache`] || {}
    Object.values(cache).forEach(list => {
      (list || []).forEach(d => {
        if (d?.id) {
          treeMap.set(d.id, d)
        }
      })
    })
    return treeMap
  }

  joinFsPath = (type, parent, name) => {
    if (type === typeMap.local) {
      return osResolve(normalizeWinLocalPath(parent) || parent, name)
    }
    return resolve(parent, name)
  }

  togglePanel = (type) => {
    if (type === typeMap.remote && !this.shouldRenderRemote()) {
      return
    }
    const key = `${type}PanelOpen`
    const next = !this.state[key]
    try {
      window.localStorage.setItem(panelOpenKey(type), next ? '1' : '0')
    } catch {
      // ignore
    }
    this.setState({
      [key]: next
    }, () => {
      if (!next) {
        return
      }
      if (type === typeMap.local && !(this.state.local || []).length) {
        this.localListOwner()
        this.localList()
      }
      if (type === typeMap.remote && this.shouldRenderRemote() && !(this.state.remote || []).length) {
        this.remoteList()
      }
    })
  }

  buildTree = (arr, type) => {
    const parent = this.renderParentItem(type)
    const treeMap = new Map(arr.map(d => [d.id, d]))
    if (parent) {
      treeMap.set(parent.id, parent)
    }
    if (this.state[`${type}ViewMode`] !== 'tree') {
      return treeMap
    }
    return this.mergeTreeItems(treeMap, type)
  }

  remoteListOwner = async () => {
    const [remoteUidTree, remoteGidTree] = await Promise.all([
      owner.remoteListUsers(this.props.pid),
      owner.remoteListGroups(this.props.pid)
    ])
    this.setState({
      remoteGidTree,
      remoteUidTree
    })
  }

  localListOwner = async () => {
    const [localUidTree, localGidTree] = await Promise.all([
      owner.localListUsers(),
      owner.localListGroups()
    ])
    this.setState({
      localGidTree,
      localUidTree
    })
  }

  sftpList = (sftp, remotePath) => {
    return sftp.list(remotePath)
      .then(arr => {
        return arr.map(item => {
          const { type } = item
          return {
            ...pick(
              item,
              ['name', 'size', 'accessTime', 'modifyTime', 'mode', 'owner', 'group']
            ),
            isDirectory: type === fileTypeMap.directory,
            type: typeMap.remote,
            path: remotePath,
            fullPath: resolve(remotePath, item.name),
            isSymbol: type === fileTypeMap.link,
            id: generate()
          }
        })
      })
  }

  resolveRemoteSymbols = async (remotes, remotePath, sftp) => {
    const results = await Promise.all(
      remotes.map(async r => {
        if (!r.isSymbol) {
          r.isSymbolicLink = false
          return r
        }
        const linkPath = resolve(remotePath, r.name)
        const [realFileInfo, target] = await Promise.all([
          getRemoteFileInfo(sftp, linkPath).catch(() => null),
          sftp.readlink(linkPath).catch(() => '')
        ])
        r.isSymbolicLink = true
        r.target = target || ''
        if (realFileInfo) {
          r.isDirectory = realFileInfo.isDirectory
        }
        return r
      })
    )
    return results.filter(Boolean)
  }

  listDirFiles = async (type, dirPath) => {
    if (type === typeMap.local) {
      return listLocalDirectory(dirPath)
    }
    if (!this.sftp) {
      return []
    }
    const remotes = await this.sftpList(this.sftp, dirPath)
    return this.resolveRemoteSymbols(remotes, dirPath, this.sftp)
  }

  getTreeChildren = (type, dirPath) => {
    const cache = this.state[`${type}TreeCache`] || {}
    const currentPath = this.state[`${type}Path`]
    const list = cache[dirPath] || (dirPath === currentPath ? this.state[type] : [])
    return this.sortFileList(this.filterFileList(list, type), type)
  }

  nodeDirPath = (file) => {
    if (!file) {
      return ''
    }
    if (file.fullPath) {
      return file.fullPath
    }
    return this.joinFsPath(file.type, file.path, file.name)
  }

  fillHasChildren = async (type, files) => {
    const dirs = (files || []).filter(f => f.isDirectory && !f.isParent && f.hasChildren == null)
    if (!dirs.length) {
      return
    }
    const results = await Promise.all(dirs.slice(0, 40).map(async d => {
      const p = this.nodeDirPath(d)
      try {
        const kids = await this.listDirFiles(type, p)
        return { id: d.id, hasChildren: kids.length > 0, path: p, kids }
      } catch {
        return { id: d.id, hasChildren: false, path: p, kids: [] }
      }
    }))
    this.setState(prev => {
      const byId = new Map(results.map(r => [r.id, r]))
      const list = (prev[type] || []).map(f => {
        const hit = byId.get(f.id)
        return hit ? { ...f, hasChildren: hit.hasChildren } : f
      })
      const cache = { ...prev[`${type}TreeCache`] }
      results.forEach(r => {
        if (r.path) {
          cache[r.path] = r.kids || []
        }
      })
      return {
        [type]: list,
        [`${type}TreeCache`]: cache
      }
    })
  }

  storeTreeFiles = (type, dirPath, files, extra = {}) => {
    this.setState(prev => {
      const cacheProp = `${type}TreeCache`
      const nextCache = {
        ...prev[cacheProp],
        [dirPath]: files
      }
      const treeMap = new Map((prev[type] || []).map(d => [d.id, d]))
      const parent = this.renderParentItem(type)
      if (parent) {
        treeMap.set(parent.id, parent)
      }
      Object.values(nextCache).forEach(arr => {
        (arr || []).forEach(d => {
          if (d?.id) {
            treeMap.set(d.id, d)
          }
        })
      })
      const next = {
        [cacheProp]: nextCache,
        [`${type}FileTree`]: treeMap
      }
      const expandedProp = `${type}Expanded`
      if (extra[expandedProp]) {
        next[expandedProp] = {
          ...prev[expandedProp],
          ...extra[expandedProp]
        }
      }
      const loadingProp = `${type}TreeLoading`
      if (extra[loadingProp]) {
        next[loadingProp] = {
          ...prev[loadingProp],
          ...extra[loadingProp]
        }
      }
      return next
    })
  }

  toggleTreeNode = async (file) => {
    if (!file?.isDirectory || file.isParent) {
      return
    }
    const { type } = file
    const dirPath = this.nodeDirPath(file)
    const expandedProp = `${type}Expanded`
    const expanded = { ...this.state[expandedProp] }
    const key = file.id || dirPath
    if (expanded[key] || expanded[dirPath]) {
      delete expanded[key]
      delete expanded[dirPath]
      this.setState({ [expandedProp]: expanded })
      return
    }
    expanded[key] = true
    expanded[dirPath] = true
    const cached = this.state[`${type}TreeCache`]?.[dirPath]
    if (cached) {
      this.setState({ [expandedProp]: expanded })
      return
    }
    this.setState({
      [`${type}TreeLoading`]: {
        ...this.state[`${type}TreeLoading`],
        [dirPath]: true,
        [key]: true
      }
    })
    try {
      const files = await this.listDirFiles(type, dirPath)
      this.storeTreeFiles(type, dirPath, files, {
        [expandedProp]: { [key]: true, [dirPath]: true },
        [`${type}TreeLoading`]: { [dirPath]: false, [key]: false }
      })
    } catch (e) {
      console.debug(e)
      this.setState({
        [`${type}TreeLoading`]: {
          ...this.state[`${type}TreeLoading`],
          [dirPath]: false,
          [key]: false
        }
      })
    }
  }

  refreshTreeNode = async (file) => {
    if (!file) return
    const { type } = file
    const dirPath = (file.isDirectory && !file.isParent)
      ? this.joinFsPath(type, file.path, file.name)
      : this.state[`${type}Path`]
    if (!dirPath) return
    this._treePrefetchKey = { ...this._treePrefetchKey, [type]: '' }
    this.setState(prev => {
      const cache = { ...prev[`${type}TreeCache`] }
      delete cache[dirPath]
      return { [`${type}TreeCache`]: cache }
    })
    if (dirPath === this.state[`${type}Path`]) {
      return this[`${type}List`]()
    }
    this.setState({
      [`${type}TreeLoading`]: {
        ...this.state[`${type}TreeLoading`],
        [dirPath]: true
      }
    })
    try {
      const files = await this.listDirFiles(type, dirPath)
      this.storeTreeFiles(type, dirPath, files, {
        [`${type}Expanded`]: { [dirPath]: true },
        [`${type}TreeLoading`]: { [dirPath]: false }
      })
    } catch (e) {
      this.setState({
        [`${type}TreeLoading`]: {
          ...this.state[`${type}TreeLoading`],
          [dirPath]: false
        }
      })
      this.onError(e)
    }
  }

  ensureTreePrefetch = (type) => {
    const dirPath = this.state[`${type}Path`]
    if (!dirPath || this.state[`${type}ViewMode`] !== 'tree') {
      return
    }
    const files = this.state[type] || []
    this.storeTreeFiles(type, dirPath, files)
    const depth = Number(this.state[`${type}TreeDepth`]) || 1
    if (depth <= 1 || !files.length) {
      return
    }
    const key = `${dirPath}:${depth}:${files.length}`
    if (this._treePrefetchKey?.[type] === key) {
      return
    }
    this._treePrefetchKey = {
      ...this._treePrefetchKey,
      [type]: key
    }
    this.prefetchTree(type, files, depth)
  }

  prefetchTree = async (type, files, remaining, acc) => {
    if (remaining <= 1 || !files?.length) {
      return acc
    }
    const bag = acc || {
      cache: {},
      expanded: {}
    }
    const dirs = files
      .filter(f => f.isDirectory && !f.isParent && f.name !== '..')
      .slice(0, 24)
    const batchSize = 6
    for (let i = 0; i < dirs.length; i += batchSize) {
      const batch = dirs.slice(i, i + batchSize)
      const childrenList = await Promise.all(batch.map(async d => {
        const dirPath = this.joinFsPath(type, d.path, d.name)
        let children = this.state[`${type}TreeCache`]?.[dirPath] || bag.cache[dirPath]
        if (!children) {
          try {
            children = await this.listDirFiles(type, dirPath)
          } catch (e) {
            console.debug(e)
            return null
          }
        }
        bag.cache[dirPath] = children
        bag.expanded[dirPath] = true
        return children
      }))
      for (const children of childrenList) {
        if (children?.length) {
          await this.prefetchTree(type, children, remaining - 1, bag)
        }
      }
    }
    if (!acc) {
      this.setState(prev => ({
        [`${type}TreeCache`]: {
          ...prev[`${type}TreeCache`],
          ...bag.cache
        },
        [`${type}Expanded`]: {
          ...prev[`${type}Expanded`],
          ...bag.expanded
        }
      }))
    }
    return bag
  }

  remoteList = async (
    returnList = false,
    remotePathReal,
    oldPath
  ) => {
    if (!this.shouldRenderRemote()) {
      if (!returnList) {
        this.setState({ remoteLoading: false })
      }
      return returnList ? [] : undefined
    }
    const { tab, sessionOptions } = this.props
    const { username, startDirectory } = tab
    let remotePath
    const noPathInit = remotePathReal || this.state.remotePath
    if (noPathInit) {
      remotePath = noPathInit
    }
    if (!returnList) {
      this.setState({
        remoteLoading: true
      })
    }
    const oldRemote = deepCopy(
      this.state.remote
    )
    let sftp = this.sftp
    try {
      if (!this.sftp) {
        sftp = await Client(this.terminalId, this.type, this.port)
        if (!sftp) {
          return
        }
        const config = deepCopy(
          this.props.config
        )
        this.setState({
          loadingSftp: true
        })
        const opts = deepCopy({
          ...tab,
          readyTimeout: config.sshReadyTimeout,
          terminalId: this.terminalId,
          keepaliveInterval: config.keepaliveInterval,
          proxy: getProxy(tab, config),
          ...sessionOptions
        })
        const r = await sftp.connect(opts)
          .catch(e => {
            if (
              e &&
              e.message.includes(unexpectedPacketErrorDesc) && this.retryCount
            ) {
              this.retryHandler = setTimeout(
                () => this.initData(
                  true
                ),
                sftpRetryInterval
              )
              this.retryCount++
            } else if (
              e &&
              /SSH connection not ready|Terminal session not found/i.test(e.message || '') &&
              (this.retryCount || 0) < 3
            ) {
              this.retryCount = (this.retryCount || 0) + 1
              this.retryHandler = setTimeout(
                () => this.initData(this.terminalId, this.port),
                800
              )
            } else {
              throw e
            }
          })
        this.setState(() => {
          return {
            loadingSftp: false
          }
        })
        if (!r) {
          sftp.destroy()
          return this.props.editTab(tab.id, {
            sftpCreated: false
          })
        } else {
          this.sftp = sftp
        }
      }

      if (!remotePath) {
        if (startDirectory) {
          remotePath = normalizeRemotePath(startDirectory)
        } else {
          remotePath = await this.getPwd(username)
        }
      }

      const remote = await this.sftpList(sftp, remotePath)
      this.sftp = sftp
      const update = {
        remote,
        remoteFileTree: this.buildTree(remote, typeMap.remote),
        inited: true,
        remoteLoading: false
      }
      if (!noPathInit) {
        update.remotePath = remotePath
        update.remotePathTemp = remotePath
      }
      if (returnList) {
        return remote
      } else {
        update.onEditFile = false
      }
      if (oldPath) {
        update.remotePathHistory = uniq([
          oldPath,
          ...this.state.remotePathHistory
        ]).slice(0, maxSftpHistory)
      }
      this.setState(update, () => {
        if (this.type !== 'ftp') {
          this.updateRemoteList(remote, remotePath, sftp)
        } else {
          this.rememberTreePath(typeMap.remote, remotePath, remote)
        }
        this.fillHasChildren(typeMap.remote, remote)
        this.props.editTab(tab.id, {
          sftpCreated: true
        })
      })
    } catch (e) {
      const update = {
        remoteLoading: false,
        remote: oldRemote,
        loadingSftp: false
      }
      if (oldPath) {
        update.remotePath = oldPath
        update.remotePathTemp = oldPath
      }
      this.setState(update)
      this.onError(e)
    }
  }

  updateRemoteList = async (
    remotes,
    remotePath,
    sftp
  ) => {
    const remote = await this.resolveRemoteSymbols(remotes, remotePath, sftp)
    const update = {
      remote,
      remoteFileTree: this.buildTree(remote, typeMap.remote)
    }
    this.setState(update, () => {
      this.rememberTreePath(typeMap.remote, remotePath, remote)
    })
  }

  getLocalHome = () => {
    return this.props.tab.startDirectoryLocal ||
    this.props.config.startDirectoryLocal ||
    window.pre.homeOrTmp
  }

  localList = async (returnList = false, localPathReal, oldPath) => {
    if (!window.fs) return
    if (!returnList) {
      this.setState({
        localLoading: true
      })
    }
    const oldLocal = this.state.local
    try {
      const noPathInit = localPathReal || this.state.localPath
      const localPath = normalizeWinLocalPath(
        noPathInit ||
        this.getCwdLocal() ||
        this.getLocalHome()
      )
      const local = await listLocalDirectory(localPath)
      const update = {
        local,
        inited: true,
        localFileTree: this.buildTree(local, typeMap.local),
        localLoading: false
      }
      if (!noPathInit || localPath !== noPathInit) {
        update.localPath = localPath
        update.localPathTemp = localPath
      }
      if (returnList) {
        return local
      } else {
        update.onEditFile = false
      }
      if (oldPath) {
        update.localPathHistory = uniq([
          oldPath,
          ...this.state.localPathHistory
        ]).slice(0, maxSftpHistory)
      }
      this.setState(update, () => {
        if (this.state[`${typeMap.local}ViewMode`] === 'tree') {
          this.rememberTreePath(typeMap.local, this.state.localPath, local)
        }
        this.fillHasChildren(typeMap.local, local)
      })
    } catch (e) {
      const update = {
        localLoading: false,
        local: oldLocal
      }
      if (oldPath) {
        update.localPath = oldPath
        update.localPathTemp = oldPath
      }
      this.setState(update)
      this.onError(e)
    }
  }

  remoteListDebounce = debounce(this.remoteList, 1000)

  localListDebounce = debounce(this.localList, 1000)

  timers = {}

  onChange = (e, prop) => {
    this.setState({
      [prop]: e.target.value
    })
  }

  goToPath = (type, np, oldPath) => {
    const next = type === typeMap.local
      ? (normalizeWinLocalPath(np) || np)
      : np
    clearTimeout(this.timer4)
    this.inputFocus = false
    this.setState({
      [`${type}Path`]: next,
      [`${type}PathTemp`]: next,
      [`${type}InputFocus`]: false
    }, () => this[`${type}List`](undefined, undefined, oldPath))
  }

  onClickHistory = (type, path) => {
    const n = `${type}Path`
    const oldPath = this.state[type + 'Path']
    clearTimeout(this.timer4)
    this.inputFocus = false
    this.goToPath(type, path, oldPath)
    this.setState({
      [`${type}InputFocus`]: false
    })
  }

  handleReloadRemoteSftp = async () => {
    if (!this.shouldRenderRemote()) {
      return
    }
    if (this.sftp) {
      this.sftp.destroy()
      this.sftp = null
    }
    this.setState({
      remoteLoading: true,
      remote: [],
      remoteFileTree: new Map()
    }, () => {
      this.initRemoteAll()
    })
  }

  handleUploadFromBrowser = () => {
    if (window.et.handleUploadFromBrowser) {
      return window.et.handleUploadFromBrowser(
        this.state.localPath,
        this.localList
      )
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files
      if (!files || !files.length) return
      const { localPath } = this.state
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('path', localPath)
        await window.api.fetch('/api/upload', {
          method: 'POST',
          body: formData
        }).catch(handleErr)
      }
      this.localList()
    }
    input.click()
  }

  parsePath = async (type, pth) => {
    const reg = /^%([^%]+)%/
    if (!reg.test(pth)) {
      return pth
    }
    const m = pth.match(reg)
    if (!m || !m[1]) {
      return pth
    }
    const envName = m[1]
    const envPath = await window.pre.runGlobalAsync('getEnv', envName)
    if (envPath) {
      return pth.replace(reg, envPath)
    }
    return pth
  }

  onGoto = async (type, e) => {
    e && e.preventDefault()
    if (type === typeMap.remote && !this.shouldRenderRemote()) {
      return
    }
    if (type === typeMap.remote && !this.sftp) {
      return this.initData(this.terminalId, this.port)
    }
    const n = `${type}Path`
    const nt = n + 'Temp'
    const oldPath = this.state[type + 'Path']
    let np = await this.parsePath(type, this.state[nt])
    if (type === typeMap.remote) {
      np = normalizeRemotePath(np)
    } else {
      np = normalizeWinLocalPath(np) || np
      if (!/^[a-zA-Z]:[\\/]/.test(np) && !np.startsWith('\\\\') && !np.startsWith('/')) {
        const base = normalizeWinLocalPath(oldPath) || this.getLocalHome()
        np = osResolve(base, np)
      }
      if (np.length > 1 && np.endsWith('/') && !/^[a-zA-Z]:\/$/.test(np)) {
        np = np.replace(/\/+$/, '')
      }
    }
    if (!isValidPath(np)) {
      return notification.warning({
        message: 'path not valid'
      })
    }
    this.setState({
      [n]: np,
      [nt]: np,
      [`${type}Keyword`]: '',
      [`${type}InputFocus`]: false
    }, () => this[`${type}List`](undefined, undefined, oldPath))
  }

  goParent = (type) => {
    const n = `${type}Path`
    const p = this.state[n]
    let np = resolve(p, '..')
    if (type === typeMap.local) {
      np = normalizeWinLocalPath(np) || np
    } else {
      np = normalizeRemotePath(np)
    }
    const op = this.state[n]
    if (np !== p) {
      this.setState({
        [n]: np,
        [n + 'Temp']: np
      }, () => this[`${type}List`](
        undefined,
        undefined,
        op
      ))
    }
  }

  getFileProps = (file, type) => {
    return {
      ...this.props,
      file,
      type,
      ...pick(this, [
        'sftp',
        'modifier',
        'localList',
        'remoteList',
        'localDel',
        'remoteDel',
        'delFiles',
        'getIndex',
        'selectAll',
        'getFileList',
        'onGoto',
        'addTransferList',
        'renderDelConfirmTitle',
        'getSelectedFiles',
        'getFileItemById',
        'toggleTreeNode',
        'refreshTreeNode',
        'goToPath'
      ]),
      ...pick(this.state, [
        'id',
        'localPath',
        'remotePath',
        'localFileTree',
        'remoteFileTree',
        'localOrder',
        'remoteOrder',
        'sortData',
        typeMap.local,
        typeMap.remote,
        'lastClickedFile',
        'lastMataKey',
        'targetTransferType',
        'selectedFiles',
        'localGidTree',
        'remoteUidTree',
        'localUidTree',
        'remoteGidTree'
      ])
    }
  }

  renderEmptyFile = (type, extra = {}) => {
    const uniqueId = this.getPathUid(type, 'empty')
    const item = {
      type,
      name: '',
      isDirectory: true,
      id: uniqueId,
      isEmpty: true
    }
    const allProps = {
      ...this.getFileProps(item, type),
      ...extra,
      cls: 'virtual-file-unit',
      key: 'empty' + type,
      isEmpty: true,
      draggable: false,
      ref: ref => {
        this[type + 'Dom'] = ref
      }
    }
    return (
      <div
        className={`virtual-file virtual-file-${type}`}
      >
        <FileSection
          {...allProps}
          key={uniqueId}
        />
      </div>
    )
  }

  getPathUid = (type, type1) => {
    const currentPath = this.state[`${type}Path`]
    const parentPath = resolve(currentPath, '..')
    const { id } = this.props.tab
    return `${type1}-${parentPath}-${id}-${type}`
  }

  renderParentItem = (type) => {
    const currentPath = this.state[`${type}Path`]
    const parentPath = resolve(currentPath, '..')
    // Don't render parent item if we're at the root
    if (parentPath === currentPath) {
      return null
    }

    const uniqueId = this.getPathUid(type, 'parent')

    return {
      type,
      isDirectory: true,
      ...getFolderFromFilePath(parentPath, type === typeMap.remote),
      id: uniqueId,
      size: 0,
      modifyTime: 0,
      accessTime: 0,
      mode: 0,
      owner: '',
      group: '',
      isParent: true
    }
  }

  renderHistory = (type) => {
    const currentPath = this.state[type + 'Path']
    const options = this.state[type + 'PathHistory']
      .filter(o => o !== currentPath)
    const focused = this.state[type + 'InputFocus']
    if (!options.length) {
      return null
    }
    const cls = classnames(
      'sftp-history',
      `sftp-history-${type}`,
      { focused }
    )
    return (
      <div
        className={cls}
      >
        {
          options.map(o => {
            return (
              <div
                key={o}
                className='sftp-history-item'
                onClick={() => this.onClickHistory(type, o)}
              >
                {o}
              </div>
            )
          })
        }
      </div>
    )
  }

  renderPanelToggles () {
    if (!this.shouldRenderRemote()) {
      return null
    }
    const localOpen = this.state.localPanelOpen !== false
    const remoteOpen = this.state.remotePanelOpen !== false
    return (
      <div className='sftp-panel-toggles'>
        <span
          className={classnames('sftp-panel-toggle', { open: localOpen })}
          onClick={() => this.togglePanel(typeMap.local)}
        >
          {localOpen ? <MinusOutlined /> : <PlusOutlined />}
          <span>{localOpen ? '关闭本地' : '打开本地'}</span>
        </span>
        <span
          className={classnames('sftp-panel-toggle', { open: remoteOpen })}
          onClick={() => this.togglePanel(typeMap.remote)}
        >
          {remoteOpen ? <MinusOutlined /> : <PlusOutlined />}
          <span>{remoteOpen ? '关闭远程' : '打开远程'}</span>
        </span>
      </div>
    )
  }

  renderViewControls (type) {
    const other = type === typeMap.local ? typeMap.remote : typeMap.local
    const otherOpen = this.state[`${other}PanelOpen`] !== false
    const selfOpen = this.state[`${type}PanelOpen`] !== false
    const showRemoteToggles = this.shouldRenderRemote()
    return (
      <span className='sftp-view-controls'>
        {
          showRemoteToggles
            ? (
              <>
                {
                  !otherOpen
                    ? (
                      <span
                        className='sftp-panel-toggle'
                        onClick={() => this.togglePanel(other)}
                      >
                        <PlusOutlined />
                        <span>{other === typeMap.local ? '打开本地' : '打开远程'}</span>
                      </span>
                      )
                    : null
                }
                <span
                  className='sftp-panel-toggle'
                  onClick={() => this.togglePanel(type)}
                >
                  {selfOpen ? <MinusOutlined /> : <PlusOutlined />}
                  <span>{selfOpen ? (type === typeMap.local ? '关闭本地' : '关闭远程') : (type === typeMap.local ? '打开本地' : '打开远程')}</span>
                </span>
              </>
              )
            : null
        }
      </span>
    )
  }

  renderViewModeBar (type) {
    const viewMode = this.state[`${type}ViewMode`]
    return (
      <div className='sftp-view-bar'>
        <span
          className={classnames('sftp-panel-toggle', { open: viewMode !== 'tree' })}
          onClick={() => this.setViewMode(type, 'list')}
        >
          <UnorderedListOutlined />
          <span>列表</span>
        </span>
        <span
          className={classnames('sftp-panel-toggle', { open: viewMode === 'tree' })}
          onClick={() => this.setViewMode(type, 'tree')}
        >
          <ApartmentOutlined />
          <span>树形</span>
        </span>
      </div>
    )
  }

  renderSftpPanelTitle (type, username, host) {
    const ops = (
      <span className='sftp-panel-title-ops'>
        {this.renderViewControls(type)}
        {
          type === typeMap.remote
            ? (
              <ReloadOutlined
                className='mg1r pointer'
                onClick={this.handleReloadRemoteSftp}
              />
              )
            : null
        }
      </span>
    )
    if (type === typeMap.remote) {
      return (
        <div className='sftp-panel-title pd1t pd1b pd1x'>
          <span className='sftp-panel-title-text elli'>
            {e('remote')}: {username}@{host}
          </span>
          {ops}
        </div>
      )
    }
    return (
      <div className='sftp-panel-title pd1t pd1b pd1x'>
        <span className='sftp-panel-title-text elli'>{e('local')}</span>
        {ops}
      </div>
    )
  }

  renderSection (type, style, width, alone = false) {
    const {
      id
    } = this.state
    const arr = this.getFileList(type)
    const loading = this.state[`${type}Loading`]
    const viewMode = this.state[`${type}ViewMode`]
    const { host, username } = this.props.tab
    const listProps = {
      store: window.store,
      id,
      type,
      parentItem: this.renderParentItem(type),
      ...this.props,
      ...pick(
        this,
        [
          'directions',
          'renderEmptyFile',
          'getFileProps',
          'defaultDirection',
          'modifier',
          'sort'
        ]
      ),
      sortProp: this.state[`sortProp.${type}`],
      sortDirection: this.state[`sortDirection.${type}`],
      width,
      fileList: arr,
      height: (style && style.height) || this.props.height,
      onToggleTree: this.toggleTreeNode,
      getTreeChildren: this.getTreeChildren,
      expandedMap: this.state[`${type}Expanded`] || {},
      loadingMap: this.state[`${type}TreeLoading`] || {}
    }
    const addrProps = {
      host,
      type,
      handleUploadFromBrowser: this.handleUploadFromBrowser,
      ...pick(
        this,
        [
          'onChange',
          'onGoto',
          'gotoHome',
          'onInputFocus',
          'onInputBlur',
          'toggleShowHiddenFile',
          'goParent',
          'onClickHistory',
          'updateKeyword'
        ]
      ),
      ...pick(
        this.state,
        [
          `${type}ShowHiddenFile`,
          'onGoto',
          `${type}PathTemp`,
          `${type}Path`,
          `${type}PathHistory`,
          `${type}InputFocus`,
          'loadingSftp',
          `${type}Keyword`
        ]
      )
    }
    return (
      <div
        className={classnames(`sftp-section sftp-${type}-section tw-${type}`, {
          'sftp-section-alone': alone
        })}
        style={style}
        key={type}
        {...style}
      >
        <Spin spinning={loading}>
          <div className='pd1 sftp-panel'>
            {
              this.renderSftpPanelTitle(type, username, host)
            }
            {this.renderViewModeBar(type)}
            <AddressBar
              {...addrProps}
            />
            <div
              className={`file-list ${type} relative`}
            >
              {
                viewMode === 'tree'
                  ? <FileTreeTable {...listProps} />
                  : <ListTable {...listProps} />
              }
            </div>
          </div>
        </Spin>
      </div>
    )
  }

  renderSections () {
    if (!this.isActive()) {
      return null
    }
    const {
      height, width, sshSftpSplitView
    } = this.props
    const shouldRenderRemote = this.shouldRenderRemote()
    const showLocal = this.state.localPanelOpen !== false
    const showRemote = shouldRenderRemote && this.state.remotePanelOpen !== false
    const barH = shouldRenderRemote ? 36 : 0
    const bodyH = Math.max(80, height - barH)
    if (!showLocal && !showRemote) {
      return (
        <div className='sftp-panels-closed'>
          <div className='sftp-panels-closed-msg'>本地和远程都已关闭</div>
          <div className='sftp-panels-closed-actions'>
            {
              shouldRenderRemote
                ? (
                  <span
                    className='sftp-panel-toggle'
                    onClick={() => this.togglePanel(typeMap.remote)}
                  >
                    <PlusOutlined />
                    <span>打开远程</span>
                  </span>
                  )
                : null
            }
            <span
              className='sftp-panel-toggle'
              onClick={() => this.togglePanel(typeMap.local)}
            >
              <PlusOutlined />
              <span>打开本地</span>
            </span>
          </div>
        </div>
      )
    }
    if (sshSftpSplitView && shouldRenderRemote) {
      if (showLocal && showRemote) {
        const remoteH = Math.floor(bodyH * 0.58)
        const localH = bodyH - remoteH
        return [
          this.renderSection(typeMap.remote, {
            width,
            left: 0,
            top: 0,
            height: remoteH
          }, width),
          this.renderSection(typeMap.local, {
            width,
            left: 0,
            top: remoteH,
            height: localH
          }, width)
        ]
      }
      const only = showLocal ? typeMap.local : typeMap.remote
      return this.renderSection(only, {
        width,
        left: 0,
        top: 0,
        height: bodyH
      }, width, true)
    }
    if (!shouldRenderRemote || !showRemote) {
      return this.renderSection(typeMap.local, {
        width,
        left: 0,
        top: 0,
        height: bodyH
      }, width, true)
    }
    if (!showLocal) {
      return this.renderSection(typeMap.remote, {
        width,
        left: 0,
        top: 0,
        height: bodyH
      }, width, true)
    }
    const remoteH = Math.floor(bodyH * 0.58)
    const localH = bodyH - remoteH
    return [
      this.renderSection(typeMap.remote, {
        width,
        left: 0,
        top: 0,
        height: remoteH
      }, width),
      this.renderSection(typeMap.local, {
        width,
        left: 0,
        top: remoteH,
        height: localH
      }, width)
    ]
  }

  render () {
    const {
      id,
      ready
    } = this.state
    if (!ready) {
      return (
        <div className='pd3 aligncenter'>
          <LoadingOutlined />
        </div>
      )
    }
    const { height } = this.props
    const all = {
      className: classnames('sftp-wrap relative', {
        'ssh-sftp-split': this.props.sshSftpSplitView,
        'sftp-has-toggles': this.shouldRenderRemote()
      }),
      id: `id-${id}`,
      style: { height }
    }
    return (
      <div
        {...all}
      >
        {
          this.renderPanelToggles()
        }
        {
          this.renderSections()
        }
      </div>
    )
  }
}
