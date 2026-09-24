/**
 * file section
 */

import React from 'react'
import ExtIcon from './file-icon'
import {
  FolderOutlined,
  FileOutlined,
  ArrowRightOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  LoadingOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { Tooltip } from 'antd'
import classnames from 'classnames'
import copy from 'json-deep-copy'
import { pick, some } from 'lodash-es'
import Input from '../common/input-auto-focus'
import resolve, { osResolve, normalizeWinLocalPath } from '../../common/resolve'
import normalizeRemotePath from '../../common/normalize-remote-path'
import { addClass, removeClass } from '../../common/class'
import {
  mode2permission,
  permission2mode
} from '../../common/mode2permission'
import FileHoverTip from './file-hover-tip'
import wait from '../../common/wait'
import { openArchiveDialog } from '../ops/archive-modal'
import { detectFormatFromName } from '../ops/ops-archive'
import {
  fileOperationsMap,
  isWin, transferTypeMap, typeMap,
  paneMap,
  isMacJs, maxEditFileSize, ctrlOrCmd
} from '../../common/constants'
import sorter from '../../common/index-sorter'
import { getFolderFromFilePath, getLocalFileInfo } from './file-read'
import { readClipboard, copy as copyToClipboard, hasFileInClipboardText } from '../../common/clipboard'
import { getDropFileList } from '../../common/file-drop-utils'
import time from '../../common/time'
import { formatBytes } from '../../common/byte-format'
import { createTransferProps } from './transfer-common'
import generate from '../../common/uid'
import sanitizeFilename from '../../common/sanitize-filename'
import { openTextEditor } from '../text-editor/open-text-editor'
import { refsStatic, refs, filesRef } from '../common/ref'
import iconsMap from '../sys-menu/icons-map'
import message from '../common/message'

const e = window.translate

const fileItemCls = 'sftp-item'
const onDragCls = 'sftp-ondrag'
const onDragOverCls = 'sftp-dragover'
const onMultiDragCls = 'sftp-dragover-multi'

export default class FileSection extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      file: props.file,
      overwriteStrategy: '',
      dropdownOpen: false
    }
    // Create ref
    this.domRef = React.createRef()
    this.id = 'file-' + this.props.file.id
  }

  componentDidMount () {
    filesRef.add(this.id, this)
    this.applyStyle()
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevProps.file !== this.props.file) {
      this.setState({
        file: this.props.file
      })
    }
    if (
      !prevState.file.id &&
      this.state.file.id
    ) {
      this.applyStyle()
    }
  }

  componentWillUnmount () {
    filesRef.remove(this.id)
    clearTimeout(this.timer)
    this.timer = null
    this.domRef = null
    this.dropTarget = null
    this.removeFileEditEvent()
  }

  clearRef = () => {
    refs.remove(this.id)
  }

  get editor () {
    return refsStatic.get('text-editor')
  }

  // handleDropdownOpenChange = (open) => {
  //   if (open) {
  //     this.forceUpdate()
  //   }
  // }

  applyStyle = () => {
    if (!this.domRef || this.props.layout === 'tree') {
      return
    }
    const {
      id,
      type
    } = this.props
    const headers = document.querySelectorAll(
      `#id-${id} .${type} .sftp-file-table-header .sftp-header-box`
    )
    this.domRef.current?.querySelectorAll('.sftp-file-prop').forEach((n, i) => {
      const h = headers[i]
      if (h) {
        const s = pick(h.style, ['width', 'left'])
        Object.assign(n.style, s)
      }
    })
  }

  onCopy = (targetFiles, isCut) => {
    const { file } = this.state
    const selected = this.isSelected(file.id)
    const files = targetFiles ||
      (
        selected
          ? this.props.getSelectedFiles()
          : [file]
      )
    const realFiles = files.filter(f => f && !f.isParent && !f.isEmpty && f.name)
    const prefix = file.type === typeMap.remote
      ? 'remote:'
      : ''
    const textToCopy = realFiles.map(f => {
      return prefix + resolve(f.path, f.name)
    }).join('\n')
    const transferProps = createTransferProps(this.props)
    window._fileClipboardFiles = realFiles.map(f => {
      return {
        name: f.name,
        path: f.path,
        isDirectory: !!f.isDirectory,
        size: f.size,
        modifyTime: f.modifyTime,
        type: file.type,
        host: this.props.tab?.host,
        tabId: transferProps.tabId,
        tabType: this.props.tab?.type,
        title: transferProps.title
      }
    })
    copyToClipboard(textToCopy)
    window.store.fileOperation = isCut ? fileOperationsMap.mv : fileOperationsMap.cp
  }

  onCopyPath = (targetFiles) => {
    const { file } = this.state
    const selected = this.isSelected(file.id)
    const files = targetFiles ||
      (
        selected
          ? this.props.getSelectedFiles()
          : [file]
      )
    const textToCopy = files.map(f => {
      return resolve(f.path, f.name)
    }).join('\n')
    copyToClipboard(textToCopy)
  }

  onCut = (targetFiles) => {
    this.onCopy(targetFiles, true)
  }

  getTransferType = fileType => {
    return fileType !== typeMap.local
      ? transferTypeMap.upload
      : transferTypeMap.download
  }

  clipboardMatchesClips = (clips, text) => {
    const expected = clips.map(f => {
      const prefix = f.type === typeMap.remote ? 'remote:' : ''
      return prefix + resolve(f.path, f.name)
    }).join('\n')
    const got = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    return expected === got
  }

  onPaste = async () => {
    const { type } = this.state.file
    const path = this.props[type + 'Path']
    const clickBoardText = readClipboard()
    const operation = this.props.fileOperation || fileOperationsMap.cp
    const clips = Array.isArray(window._fileClipboardFiles)
      ? window._fileClipboardFiles
      : null
    if (clips?.length && this.clipboardMatchesClips(clips, clickBoardText)) {
      const relay = []
      const normal = []
      for (const f of clips) {
        const cross = f.type === typeMap.remote &&
          type === typeMap.remote &&
          f.tabId &&
          f.tabId !== this.props.tab?.id
        if (cross) {
          relay.push(f)
        } else {
          normal.push(f)
        }
      }
      if (relay.length) {
        refsStatic.get('remote2remote-handlers')?.relayToDirectory({
          fromFiles: relay,
          targetDir: path,
          targetTab: this.props.tab
        })
      }
      if (normal.length) {
        const destProps = createTransferProps(this.props)
        const res = normal.map(f => {
          const fromPath = resolve(f.path, f.name)
          const toPath = resolve(path, sanitizeFilename(f.name))
          const typeFrom = f.type === typeMap.remote ? typeMap.remote : typeMap.local
          const useSourceTab = typeFrom === typeMap.remote && type === typeMap.local && f.tabId
          return {
            typeFrom,
            typeTo: type,
            fromPath,
            toPath,
            id: generate(),
            host: useSourceTab ? f.host : this.props.tab?.host,
            tabType: useSourceTab ? f.tabType : this.props.tab?.type,
            title: useSourceTab ? (f.title || destProps.title) : destProps.title,
            tabId: useSourceTab ? f.tabId : destProps.tabId,
            operation
          }
        })
        this.props.addTransferList(res)
      }
      return
    }
    const fileNames = String(clickBoardText || '').split('\n').filter(Boolean)
    const res = []
    for (let i = 0, len = fileNames.length; i < len; i++) {
      const item = fileNames[i]
      const isRemote = item.startsWith('remote:')
      const fromPath = isRemote
        ? item.replace(/^remote:/, '')
        : item
      const { name } = getFolderFromFilePath(fromPath, isRemote)
      const toPath = resolve(path, sanitizeFilename(name))
      res.push({
        typeFrom: isRemote ? typeMap.remote : typeMap.local,
        typeTo: type,
        fromPath,
        toPath,
        id: generate(),
        host: this.props.tab?.host,
        tabType: this.props.tab?.type,
        ...createTransferProps(this.props),
        operation
      })
    }
    if (res.length) {
      this.props.addTransferList(res)
    }
  }

  onDragStart = e => {
    this.props.modifier({
      onDrag: true
    })
    const cls = this.props.selectedFiles.size > 1
      ? onDragCls + ' ' + onMultiDragCls
      : onDragCls
    addClass(this.domRef.current, cls)
    const transferProps = createTransferProps(this.props)
    const selected = this.isSelected(this.props.file.id)
    const dragFiles = selected
      ? this.props.getSelectedFiles()
      : [this.props.file]
    const filesWithMeta = dragFiles.map(file => {
      return {
        ...file,
        host: this.props.tab?.host,
        tabType: this.props.tab?.type,
        tabId: transferProps.tabId,
        title: transferProps.title,
        internalDrag: true
      }
    })
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('fromFile', JSON.stringify(filesWithMeta))
  }

  getDropFileList = data => {
    return getDropFileList(data)
  }

  onDragEnd = () => {
    this.props.modifier({
      onDrag: false
    })
    removeClass(this.domRef.current, onDragCls, onMultiDragCls)
    document.querySelectorAll('.' + onDragOverCls).forEach((d) => {
      removeClass(d, onDragOverCls)
    })
  }

  onDrop = async (e, opts) => {
    e.preventDefault()
    const fromFiles = this.getDropFileList(e.dataTransfer)
    if (!fromFiles?.length) {
      return
    }
    const internalDrag = fromFiles.some(file => file?.internalDrag)
    const fromFileManager = !internalDrag && !!e?.dataTransfer?.files?.length
    const type = this.props.file?.type || this.props.type
    let toFile
    if (opts?.intoCurrent) {
      toFile = {
        type,
        ...getFolderFromFilePath(this.props[type + 'Path'], type === typeMap.remote),
        isDirectory: true,
        isParent: true
      }
    } else {
      let { target } = e
      if (!target) {
        return
      }
      while (target && !String(target.className || '').includes(fileItemCls)) {
        target = target.parentNode
      }
      if (!target) {
        return
      }
      const id = target.getAttribute('data-id')
      const rowType = target.getAttribute('data-type') || type
      toFile = this.props[rowType + 'FileTree']?.get(id) || {}
      if (!toFile.id || !toFile.isDirectory) {
        toFile = {
          type: rowType,
          ...getFolderFromFilePath(this.props[rowType + 'Path'], rowType === typeMap.remote),
          isDirectory: false
        }
      }
    }
    this.onDropFile(fromFiles, toFile, fromFileManager)
  }

  onDropFile = async (fromFiles, toFile, fromFileManager) => {
    const { type: fromType } = fromFiles[0]
    const {
      id,
      type: toType,
      isDirectory: isDirectoryTo
    } = toFile

    let operation = ''
    const sourceTabId = fromFiles.find(file => file?.tabId)?.tabId
    const crossSessionRemote = !fromFileManager &&
      fromType === typeMap.remote &&
      toType === typeMap.remote &&
      sourceTabId &&
      sourceTabId !== this.props.tab?.id

    if (crossSessionRemote) {
      const intoFolder = isDirectoryTo && id && !toFile.isParent
      const targetDir = intoFolder
        ? resolve(toFile.path, toFile.name)
        : this.props[toType + 'Path']
      const handled = refsStatic.get('remote2remote-handlers')?.relayToDirectory({
        fromFiles,
        targetDir,
        targetTab: this.props.tab
      })
      if (handled) {
        return
      }
    }

    // same side and drop to file = drop to folder
    if (!fromFileManager && fromType === toType && !isDirectoryTo) {
      return
    }

    // drop from file manager
    if (fromFileManager && toType === typeMap.local) {
      operation = fileOperationsMap.cp
      if (id) {
        toFile = {
          ...toFile,
          ...getFolderFromFilePath(
            resolve(toFile.path, sanitizeFilename(toFile.name))
          ),
          id: undefined
        }
      }
    }

    // same side and drop to folder, do mv
    if (fromType === toType && isDirectoryTo && !fromFileManager) {
      operation = fileOperationsMap.mv
    }

    // other side, do transfer
    let files = fromFiles
    if (fromFileManager) {
      files = await this.filterFiles(fromFiles)
    }
    this.transferDrop(files, toFile, operation)
  }

  filterFiles = async (files) => {
    const res = []
    for (const file of files) {
      const { name, path } = file
      const info = await getLocalFileInfo(
        resolve(path, name)
      ).catch(console.log)
      if (info) {
        res.push(info)
      }
    }
    return res
  }

  transferDrop = (fromFiles, toFile, operation) => {
    const files = this.isSelected(fromFiles[0]?.id)
      ? this.props.getSelectedFiles()
      : fromFiles
    return this.doTransferSelected(
      null,
      files,
      resolve(toFile.path, sanitizeFilename(toFile.name)),
      toFile.type,
      operation
    )
  }

  isSelected = (fileId = '') => {
    return this.props.selectedFiles.has(fileId)
  }

  doRename = () => {
    const file = copy(this.state.file)
    file.nameTemp = file.name
    file.isEditing = true
    this.props.modifier({
      onEditFile: true
    })
    this.setState({
      file
    })
  }

  editPermission = () => {
    this.openFileModeModal(this.state.file)
  }

  showInfo = () => {
    const { type } = this.props
    refsStatic.get('file-modal')?.showFileInfoModal({
      file: this.state.file,
      tab: this.props.tab,
      visible: true,
      pid: this.props.pid,
      uidTree: this.props[`${type}UidTree`],
      gidTree: this.props[`${type}GidTree`]
    })
  }

  getExt = (name = '') => {
    const parts = String(name).split('.')
    if (parts.length < 2) {
      return ''
    }
    return parts[parts.length - 1].toLowerCase()
  }

  showCompare = () => {
    const { type } = this.props
    const selected = this.props.getSelectedFiles().filter(f => !f.isDirectory)
    if (selected.length !== 2) {
      return
    }
    refsStatic.get('file-compare-modal')?.showFileCompareModal({
      file1: selected[0],
      file2: selected[1],
      tab: this.props.tab,
      uidTree: this.props[`${type}UidTree`],
      gidTree: this.props[`${type}GidTree`]
    })
  }

  canCompare = () => {
    const { selectedFiles } = this.props
    if (!selectedFiles || selectedFiles.size !== 2) {
      return false
    }
    const selected = this.props.getSelectedFiles()
    if (selected.length !== 2) {
      return false
    }
    if (selected.some(f => f.isDirectory || !f.id)) {
      return false
    }
    const ext1 = this.getExt(selected[0].name)
    const ext2 = this.getExt(selected[1].name)
    return ext1 === ext2
  }

  cancelNew = (type) => {
    let list = this.props[type]
    list = list.filter(p => p.id)
    this.props.modifier({
      [type]: list
    })
  }

  localCreateNew = async file => {
    const { nameTemp, isDirectory } = file
    const { localPath } = this.props
    const p = resolve(localPath, nameTemp)
    const func = isDirectory
      ? window.fs.mkdir
      : window.fs.touch
    const res = await func(p)
      .then(() => true)
      .catch(window.store.onError)
    if (res) {
      this.props.localList()
    }
  }

  remoteCreateNew = async file => {
    const { nameTemp, isDirectory } = file
    const { remotePath, sftp } = this.props
    const p = resolve(remotePath, nameTemp)
    const func = isDirectory
      ? sftp.mkdir
      : sftp.touch
    const res = await func(p)
      .then(() => true)
      .catch(window.store.onError)
    if (res) {
      await wait(500)
      await this.props.remoteList()
    }
  }

  selectAll = (e) => {
    const { type } = this.props.file
    this.props.selectAll(type, e)
  }

  createNew = file => {
    const { type } = file
    return this[`${type}CreateNew`](file)
  }

  getShiftSelected (file, type) {
    const indexs = this.props.getSelectedFiles().map(
      this.props.getIndex
    )
    const i = this.props.getIndex(file)
    const lastI = this.props.getIndex(this.props.lastClickedFile)
    const arr = [...indexs, i].sort(sorter)
    const last = arr.length - 1
    const from = arr[0]
    const to = arr[last]
    let [start, end] = [from, to]
    if (indexs.includes(i)) {
      const other = lastI > i ? from : to
      ;[start, end] = [other, i].sort(sorter)
    }
    return this.props.getFileList(type).slice(start, end + 1)
  }

  onClick = e => {
    const { file } = this.state
    const {
      id,
      type,
      isParent,
      isEmpty
    } = file
    if (isEmpty || isParent) {
      return this.props.modifier({
        selectedFiles: new Set()
      })
    }
    this.props.modifier({
      lastClickedFile: file
    })
    this.onDragEnd(e)
    const selectedFilesOld = this.props.getSelectedFiles()
    const isSameSide = selectedFilesOld.length &&
      type === selectedFilesOld[0].type
    let selectedFiles = [file]
    if (isSameSide) {
      if (
        (e.ctrlKey && !isMacJs) ||
        (e.metaKey && isMacJs)
      ) {
        const isSelected = some(
          selectedFilesOld,
          s => s.id === id
        )
        selectedFiles = isSelected
          ? selectedFilesOld.filter(s => s.id !== id)
          : [
              ...copy(selectedFilesOld),
              file
            ]
      } else if (e.shiftKey) {
        selectedFiles = this.getShiftSelected(file, type)
      }
    }
    this.props.modifier({
      selectedFiles: new Set(selectedFiles.map(f => f.id)),
      selectedType: type,
      lastClickedFile: file
    })
  }

  changeFileMode = async (file) => {
    this.clearRef()
    const { permission, type, path, name } = file
    const func = type === typeMap.local
      ? window.fs.chmod
      : this.props.sftp.chmod
    const p = resolve(path, name)
    await func(p, permission).catch(window.store.onError)
    this.props[type + 'List']()
  }

  openFileModeModal = () => {
    const { type } = this.props
    refs.add(this.id, this)
    refsStatic.get('file-modal')?.showFileModeModal(
      {
        tab: this.props.tab,
        visible: true,
        uidTree: this.props[`${type}UidTree`],
        gidTree: this.props[`${type}GidTree`]
      },
      this.state.file,
      this.id
    )
  }

  handleBlur = () => {
    const file = copy(this.state.file)
    const { nameTemp, name, type, id } = this.state.file
    if (name === nameTemp) {
      if (!id) {
        return this.cancelNew(type)
      }
      delete file.nameTemp
      delete file.isEditing
      return this.setState({
        file
      })
    }
    if (!id) {
      return this.createNew(file)
    }
    this.rename(name, nameTemp)
  }

  rename = (oldname, newname) => {
    const { type } = this.props.file
    return this[`${type}Rename`](oldname, newname)
  }

  localRename = async (oldname, newname) => {
    const { localPath } = this.props
    const p1 = resolve(localPath, oldname)
    const p2 = resolve(localPath, newname)
    await window.fs.rename(p1, p2).catch(window.store.onError)
    this.props.localList()
  }

  remoteRename = async (oldname, newname) => {
    const { remotePath, sftp } = this.props
    const p1 = resolve(remotePath, oldname)
    const p2 = resolve(remotePath, newname)
    const res = await sftp.rename(p1, p2)
      .catch(window.store.onError)
      .then(() => true)
    if (res) {
      this.props.remoteList()
    }
  }

  handleChange = e => {
    const nameTemp = e.target.value
    const file = copy(this.state.file)
    file.nameTemp = nameTemp
    this.setState({
      file
    })
  }

  enterDirectory = (e, file = this.state.file) => {
    e && e.stopPropagation && e.stopPropagation()
    const { type, name, isParent, path: filePath } = file
    const n = `${type}Path`
    let np
    if (isParent) {
      np = filePath
    } else {
      const parent = filePath || this.props[n]
      np = type === typeMap.local
        ? osResolve(normalizeWinLocalPath(parent) || parent, name)
        : resolve(parent, name)
    }
    if (type === typeMap.remote) {
      np = normalizeRemotePath(np)
    }
    const op = this.props[type + 'Path']
    if (this.props.goToPath) {
      return this.props.goToPath(type, np, op)
    }
    this.props.modifier({
      [n]: np,
      [n + 'Temp']: np
    }, () => this.props[`${type}List`](
      undefined,
      undefined,
      op
    ))
  }

  openFile = file => {
    const filePath = file.type === typeMap.local
      ? osResolve(normalizeWinLocalPath(file.path) || file.path, file.name)
      : resolve(file.path, file.name)
    const open = window.pre.runGlobalAsync
      ? window.pre.runGlobalAsync('openPath', filePath)
      : window.fs.openFile(filePath)
    Promise.resolve(open).catch(window.store.onError)
  }

  removeFileEditEvent = () => {
    this.clearRef()
    if (this.watchingFile) {
      window.pre.ipcOffEvent('file-change', this.onFileChange)
      window.pre.ipcOffEvent('file-deleted', this.onTempFileDeleted)
      window.pre.runGlobalAsync('unwatchFile', this.watchingFile)
      const tempPath = this.watchingFile
      delete this.watchingFile
      if (tempPath && String(tempPath).startsWith(window.pre.tempDir + window.pre.sep)) {
        window.fs.unlink(tempPath).catch(console.log)
      }
    }
  }

  editWithSystemEditor = async (text) => {
    const {
      path,
      name,
      type
    } = this.state.file
    let tempPath = ''
    if (type === typeMap.local) {
      tempPath = window.pre.resolve(path, name)
    } else {
      const id = generate()
      const safeName = sanitizeFilename(name)
      tempPath = window.pre.resolve(
        window.pre.tempDir, `electerm-temp-${id}-${safeName}`
      )
      // Defense-in-depth: verify the resolved path stays within tempDir
      if (!tempPath.startsWith(window.pre.tempDir + window.pre.sep)) {
        message.error(e('invalidTempFilePath'))
        return
      }
      await window.fs.writeFile(tempPath, text)
    }
    this.watchingFile = tempPath
    this.watchFile(tempPath)
  }

  editWithCustomEditor = async (text, editorCommand) => {
    const {
      path,
      name,
      type
    } = this.state.file
    let tempPath = ''
    if (type === typeMap.local) {
      tempPath = window.pre.resolve(path, name)
    } else {
      const id = generate()
      const safeName = sanitizeFilename(name)
      tempPath = window.pre.resolve(
        window.pre.tempDir, `electerm-temp-${id}-${safeName}`
      )
      // Defense-in-depth: verify the resolved path stays within tempDir
      if (!tempPath.startsWith(window.pre.tempDir + window.pre.sep)) {
        message.error(e('invalidTempFilePath'))
        return
      }
      await window.fs.writeFile(tempPath, text)
    }
    this.watchingFile = tempPath
    window.pre.runGlobalAsync('watchFile', tempPath)
    await window.pre.runGlobalAsync('openFileWithEditor', tempPath, editorCommand)
    window.pre.ipcOnEvent('file-change', this.onFileChange)
    window.pre.ipcOnEvent('file-deleted', this.onTempFileDeleted)
  }

  onFileChange = async (e, text) => {
    if (this.editor) {
      this.editor.editWithSystemEditorDone({
        id: this.id,
        text
      })
      return
    }
    const { file } = this.state
    if (file.type === typeMap.remote) {
      await this.onSubmitEditFile(
        file.mode,
        file.type,
        resolve(file.path, file.name),
        text,
        true
      )
    }
  }

  onTempFileDeleted = () => {
    this.removeFileEditEvent()
  }

  watchFile = async (tempPath) => {
    window.pre.runGlobalAsync('watchFile', tempPath)
    if (window.pre.runGlobalAsync) {
      await window.pre.runGlobalAsync('openPath', tempPath)
        .catch(() => window.fs.openFile(tempPath))
    } else {
      window.fs.openFile(tempPath)
        .catch(window.store.onError)
    }
    window.pre.ipcOnEvent('file-change', this.onFileChange)
    window.pre.ipcOnEvent('file-deleted', this.onTempFileDeleted)
  }

  gotoFolderInTerminal = () => {
    const {
      path, name
    } = this.state.file
    let rp = path ? resolve(path, name) : this.props[`${this.props.type}Path`]
    if (this.props.type === typeMap.remote) {
      rp = this.convertSftpPathToTerminalPath(rp)
    }
    this.props.tab.pane = paneMap.terminal
    refs.get('term-' + this.props.tab.id)?.cd(rp)
  }

  convertSftpPathToTerminalPath = (p) => {
    const m = p.match(/^\/([a-zA-Z]:)(.*)$/)
    if (m) {
      return m[1] + m[2].replace(/\//g, '\\')
    }
    return p
  }

  fetchEditorText = async (path, type) => {
    // const sftp = sftpFunc()
    const text = typeMap.remote === type
      ? await this.props.sftp.readFile(path)
      : await window.fs.readFile(path)
    return text
  }

  onSubmitEditFile = async (mode, type, path, text, noClose) => {
    const r = typeMap.remote === type
      ? await this.props.sftp.writeFile(
        path,
        text,
        mode
      ).catch(window.store.onError)
      : await window.fs.writeFile(
        path,
        text,
        mode
      ).catch(window.store.onError)
    const data = {
      loading: false
    }
    if (r && !noClose) {
      data.id = ''
      data.file = null
      data.text = ''
    }
    this.clearRef()
    this.editor?.setState(data)
    if (r && !noClose) {
      this.props[`${type}List`]()
    }
  }

  editFile = () => {
    refs.add(this.id, this)
    // editor is lazy loaded, this will mount it on demand
    openTextEditor({
      id: this.id,
      file: this.state.file
    })
  }

  openGuiEditor = () => {
    const file = this.state.file
    if (!file || file.isParent || file.isEmpty || file.isDirectory) {
      return
    }
    const full = file.fullPath || (
      file.type === typeMap.local
        ? osResolve(normalizeWinLocalPath(file.path) || file.path, file.name)
        : resolve(file.path, file.name)
    )
    window.store.opsFileEditRequest = {
      tabId: this.props.tab?.id,
      path: full,
      token: Date.now()
    }
    window.store.openOpsCenter('editor')
  }

  transferOrEnterDirectory = async (e, edit) => {
    const { file } = this.state
    const { isDirectory } = file
    if (isDirectory) {
      return this.enterDirectory(e)
    }
    if (edit === true) {
      return this.editFile()
    }
    return this.openWithDefaultApp()
  }

  getTransferList = async (
    file,
    toPathBase,
    _typeTo,
    operation
  ) => {
    const { name, path, type } = file
    const isLocal = type === typeMap.local
    let typeTo = isLocal
      ? typeMap.remote
      : typeMap.local
    if (_typeTo) {
      typeTo = _typeTo
    }
    let toPath = isLocal
      ? this.props[typeMap.remote + 'Path']
      : this.props[typeMap.local + 'Path']
    if (!toPath) {
      toPath = isLocal
        ? (this.props.remotePath || '/')
        : (window.pre?.homeOrTmp || '')
    }
    if (toPathBase) {
      toPath = toPathBase
    }
    toPath = resolve(toPath, sanitizeFilename(name))
    const remoteName = this.props.tab?.title || this.props.tab?.host || '远程'
    const fromLocal = type === typeMap.local
    const obj = {
      host: this.props.tab?.host,
      tabType: this.props.tab?.type,
      typeFrom: type,
      typeTo,
      fromPath: resolve(path, name),
      toPath,
      fromFile: file,
      size: Number(file.size) || 0,
      sourceMachine: fromLocal ? '本机' : remoteName,
      targetMachine: fromLocal ? remoteName : '本机',
      id: generate(),
      ...createTransferProps(this.props),
      operation
    }
    return [obj]
  }

  doTransferSelected = async (
    e,
    selectedFiles = this.props.getSelectedFiles(),
    toPathBase,
    typeTo,
    operation
  ) => {
    let all = []
    for (const f of selectedFiles) {
      const arr = await this.getTransferList(f, toPathBase, typeTo, operation)
      all = [
        ...all,
        ...arr
      ]
    }
    this.props.addTransferList(all)
  }

  transfer = async (mapper) => {
    const { file } = this.state
    const arr = await this.getTransferList(file)
    if (mapper) {
      arr.forEach(mapper)
    }
    this.props.addTransferList(arr)
  }

  doEnterDirectory = (e) => {
    this.enterDirectory(e)
  }

  refresh = () => {
    const { file } = this.state
    if (this.props.refreshFolder) {
      return this.props.refreshFolder(file)
    }
    this.props.onGoto(file.type)
  }

  enqueueTransfer = async () => {
    const hold = (item) => {
      item.pausing = true
      item.inited = false
    }
    if (this.shouldShowSelectedMenu()) {
      let all = []
      for (const file of this.props.getSelectedFiles()) {
        const arr = await this.getTransferList(file)
        arr.forEach(hold)
        all = all.concat(arr)
      }
      if (all.length) {
        this.props.addTransferList(all)
        message.info('已加入传输队列，需要手动开始')
      }
      return
    }
    await this.transfer(hold)
    message.info('已加入传输队列，需要手动开始')
  }

  openWithDefaultApp = async () => {
    const { file } = this.state
    if (file.isDirectory || file.isParent || file.isEmpty) {
      return this.enterDirectory()
    }
    if (file.type === typeMap.local) {
      return this.openFile(file)
    }
    const remotePath = resolve(file.path, file.name)
    const safeName = sanitizeFilename(file.name)
    const tempPath = window.pre.resolve(
      window.pre.tempDir,
      `electerm-open-${generate()}-${safeName}`
    )
    if (!tempPath.startsWith(window.pre.tempDir + window.pre.sep)) {
      message.error(e('invalidTempFilePath'))
      return
    }
    const text = await this.fetchEditorText(remotePath, file.type)
    await window.fs.writeFile(tempPath, text)
    this.watchingFile = tempPath
    this.watchFile(tempPath)
  }

  openWithSystemEditorDirect = async () => {
    const { file } = this.state
    if (file.isDirectory || file.isParent || file.isEmpty) {
      return
    }
    let filePath
    if (file.type === typeMap.local) {
      filePath = window.pre.resolve(file.path, file.name)
    } else {
      const remotePath = resolve(file.path, file.name)
      const text = await this.fetchEditorText(remotePath, file.type)
      const safeName = sanitizeFilename(file.name)
      filePath = window.pre.resolve(
        window.pre.tempDir,
        `electerm-edit-${generate()}-${safeName}`
      )
      if (!filePath.startsWith(window.pre.tempDir + window.pre.sep)) {
        message.error(e('invalidTempFilePath'))
        return
      }
      await window.fs.writeFile(filePath, text)
      this.watchingFile = filePath
      window.pre.runGlobalAsync('watchFile', filePath)
      window.pre.ipcOnEvent('file-change', this.onFileChange)
      window.pre.ipcOnEvent('file-deleted', this.onTempFileDeleted)
    }
    const editor = window.store.config?.defaultEditor
    const cmd = editor || (isWin ? 'notepad.exe' : (isMacJs ? 'open -t' : ''))
    if (cmd) {
      await window.pre.runGlobalAsync('openFileWithEditor', filePath, cmd)
        .catch(window.store.onError)
      return
    }
    window.fs.openFile(filePath)
      .catch(window.store.onError)
  }

  shouldShowSelectedMenu = () => {
    const {
      file: {
        id
      },
      selectedFiles
    } = this.props
    return id &&
      selectedFiles.size > 1 &&
      selectedFiles.has(id)
  }

  del = async () => {
    const delSelected = this.shouldShowSelectedMenu()
    const { file } = this.props
    const { type } = file
    const files = delSelected
      ? this.props.getSelectedFiles()
      : [file]
    await this.props.delFiles(type, files)
  }

  doTransfer = () => {
    this.transfer()
  }

  zipAndTransfer = async () => {
    this.transfer(transfer => {
      transfer.zip = true
    })
  }

  openCompressDialog = () => {
    const multi = this.shouldShowSelectedMenu()
    const files = multi
      ? this.props.getSelectedFiles()
      : [this.props.file]
    const paths = files
      .filter(f => f && !f.isParent)
      .map(f => {
        const isRemote = f.type === typeMap.remote
        return isRemote
          ? resolve(f.path, f.name)
          : osResolve(normalizeWinLocalPath(f.path) || f.path, f.name)
      })
      .filter(Boolean)
    if (!paths.length) {
      return
    }
    openArchiveDialog({
      mode: 'compress',
      tabId: this.props.tab.id,
      paths
    })
  }

  openExtractDialog = () => {
    const { file } = this.props
    const isRemote = file.type === typeMap.remote
    const path = isRemote
      ? resolve(file.path, file.name)
      : osResolve(normalizeWinLocalPath(file.path) || file.path, file.name)
    openArchiveDialog({
      mode: 'extract',
      tabId: this.props.tab.id,
      archive: path,
      paths: []
    })
  }

  newFile = () => {
    return this.newItem(false)
  }

  newDirectory = () => {
    return this.newItem(true)
  }

  uniqueNewName = (list, preset) => {
    const names = new Set((list || []).map(f => f.name).filter(Boolean))
    if (!names.has(preset)) {
      return preset
    }
    const dot = preset.lastIndexOf('.')
    const hasExt = dot > 0
    const base = hasExt ? preset.slice(0, dot) : preset
    const ext = hasExt ? preset.slice(dot) : ''
    for (let i = 2; i < 100; i++) {
      const next = `${base} (${i})${ext}`
      if (!names.has(next)) {
        return next
      }
    }
    return `${base} (${Date.now()})${ext}`
  }

  newItem = (isDirectory, presetName = '') => {
    const { type } = this.state.file
    const list = copy(this.props[type])
    const nameTemp = presetName
      ? this.uniqueNewName(list, presetName)
      : ''
    list.unshift({
      name: '',
      nameTemp,
      isDirectory,
      isEditing: true,
      type
    })
    this.props.modifier({
      [type]: list,
      onEditFile: true
    })
  }

  newFolder = () => {
    return this.newItem(true, '新建文件夹')
  }

  newTextFile = () => {
    return this.newItem(false, '新建文本文档.txt')
  }

  newMarkdown = () => {
    return this.newItem(false, '新建 Markdown.md')
  }

  newJson = () => {
    return this.newItem(false, '新建 JSON.json')
  }

  newShell = () => {
    return this.newItem(false, '新建脚本.sh')
  }

  newEmpty = () => {
    return this.newItem(false, '新建文件')
  }

  showInDefaultFileManager = () => {
    const { path, name } = this.state.file
    const p = resolve(path, name)
    window.pre.showItemInFolder(p)
  }

  downloadFromBrowser = async () => {
    const { path, name, isDirectory } = this.state.file
    const p = resolve(path, name)
    if (window.et.downloadFromBrowser) {
      return window.et.downloadFromBrowser(p)
    }
    const url = '/api/download?path=' + encodeURIComponent(p)
    const res = await window.api.fetch(url)
      .catch(window.store.onError)
    if (!res) return
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = isDirectory ? name + '.tar.gz' : name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  renderDelConfirmTitle (shouldShowSelectedMenu) {
    const { file } = this.props
    const files = shouldShowSelectedMenu
      ? this.props.getSelectedFiles()
      : [file]
    return this.props.renderDelConfirmTitle(files, true)
  }

  showModeEdit (type, isRealFile) {
    if (!isRealFile) {
      return false
    }
    if (type === typeMap.remote) {
      return true
    }
    return !isWin
  }

  handleContextMenuCapture = (e) => {
    this.props.setClickFileId?.(this.id)
    if (!this.isSelected(this.state.file.id)) {
      this.onClick(e)
    }
    this.contextMenuPosition = {
      clientY: e.clientY
    }
  }

  handleTreeToggle = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const { file } = this.state
    if (!file.isDirectory || file.isParent || file.isEmpty) {
      return
    }
    const fn = this.props.onToggleTree || this.props.toggleTreeNode
    fn?.(file)
  }

  renderTreeToggle () {
    const { file } = this.state
    const {
      isDirectory,
      isParent,
      isEmpty,
      hasChildren
    } = file
    if (!isDirectory || isParent || isEmpty || hasChildren === false) {
      return <span className='sftp-tree-toggle sftp-tree-leaf' />
    }
    if (this.props.treeLoading) {
      return (
        <span className='sftp-tree-toggle'>
          <LoadingOutlined />
        </span>
      )
    }
    const Icon = this.props.treeExpanded
      ? CaretDownOutlined
      : CaretRightOutlined
    return (
      <span
        className='sftp-tree-toggle'
        onClick={this.handleTreeToggle}
        onDoubleClick={e => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <Icon />
      </span>
    )
  }

  stopInfoEvent = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  renderLinkName (name) {
    const { file } = this.state
    const linked = file.isSymbolicLink || file.isSymbol
    const target = file.target
    return (
      <>
        {name}
        {
          linked && target
            ? <span className='sftp-link-target'> {'->'} {target}</span>
            : null
        }
      </>
    )
  }

  renderTreeBody () {
    const { file } = this.state
    const {
      isSymbolicLink,
      isSymbol,
      name
    } = file
    const pad = 6 + (this.props.treeLevel || 0) * 14
    return (
      <div
        className='sftp-tree-row'
        style={{ paddingLeft: pad }}
      >
        {this.renderTreeToggle()}
        <ExtIcon file={file} className='mg1r' />
        {
          (isSymbolicLink || isSymbol)
            ? <sup className='color-blue symbolic-link-icon'>*</sup>
            : null
        }
        <span className='sftp-tree-name elli'>
          {this.renderLinkName(name)}
        </span>
      </div>
    )
  }

  renderInfoBtn () {
    const { file } = this.state
    if (file.isParent || file.isEmpty) {
      return null
    }
    return (
      <Tooltip
        title={<FileHoverTip file={file} />}
        mouseEnterDelay={0}
        mouseLeaveDelay={0.05}
        placement='left'
        destroyOnHidden
      >
        <span
          className='sftp-file-info-btn'
          onClick={this.stopInfoEvent}
          onDoubleClick={this.stopInfoEvent}
          onMouseDown={this.stopInfoEvent}
          onContextMenu={this.stopInfoEvent}
        >
          <InfoCircleOutlined />
        </span>
      </Tooltip>
    )
  }

  renderItemInner () {
    const { layout = 'table', properties = [] } = this.props
    if (layout === 'tree') {
      return this.renderTreeBody()
    }
    return (
      <div className='file-props-div'>
        {
          properties.map(this.renderProp)
        }
      </div>
    )
  }

  itemToMenuFormat = (r) => {
    const { func, text, disabled, icon, subText, requireConfirm, children } = r
    const IconCom = iconsMap[icon]
    const item = {
      key: func,
      label: text,
      disabled,
      extra: subText,
      danger: requireConfirm
    }
    if (IconCom) {
      item.icon = <IconCom />
    }
    if (children?.length) {
      item.children = children.map(this.itemToMenuFormat)
    }
    return item
  }

  renderContextMenu = () => {
    const items = this.renderContextItems()

    // Check if we need to split the menu
    if (this.contextMenuPosition) {
      const windowHeight = window.innerHeight
      const { clientY } = this.contextMenuPosition
      const estimatedMenuHeight = items.length * 32 // Approximate height per menu item
      const availableHeight = windowHeight - clientY

      // If menu would extend beyond window, split into two parts
      if (estimatedMenuHeight > availableHeight && items.length > 6) {
        const firstHalf = items.slice(0, Math.ceil(items.length / 2))
        const secondHalf = items.slice(Math.ceil(items.length / 2))

        // Create "More..." submenu with second half of items
        const moreSubmenu = {
          key: 'more-submenu',
          label: '…',
          icon: <ArrowRightOutlined />,
          children: secondHalf.map(this.itemToMenuFormat)
        }

        // Return first half + "More..." submenu
        return [...firstHalf.map(this.itemToMenuFormat), moreSubmenu]
      }
    }

    // Otherwise return normal menu
    return items.map(this.itemToMenuFormat)
  }

  renderContextItems () {
    const {
      file: {
        type,
        isDirectory,
        size,
        id,
        isEmpty,
        isParent
      },
      selectedFiles,
      tab
    } = this.props
    const isRealFile = !isEmpty && !isParent
    const hasHost = !!tab.host
    const { enableSsh } = tab
    const isLocal = type === typeMap.local
    const isRemote = type === typeMap.remote
    const transferText = isLocal
      ? e(transferTypeMap.upload)
      : e(transferTypeMap.download)
    const iconType = isLocal
      ? 'CloudUploadOutlined'
      : 'CloudDownloadOutlined'
    const len = selectedFiles.size
    const shouldShowSelectedMenu = id &&
      len > 1 &&
      selectedFiles.has(id)
    const delTxt = shouldShowSelectedMenu ? `${e('del')}:${e('selected')}(${len})` : e('del')
    const canPaste = hasFileInClipboardText()
    const showEdit = !isDirectory && id &&
      size < maxEditFileSize
    const res = []
    if (isDirectory && isRealFile) {
      res.push({
        func: 'refresh',
        icon: 'ReloadOutlined',
        text: '刷新'
      })
      res.push({
        func: 'doEnterDirectory',
        icon: 'EnterOutlined',
        text: e('enter')
      })
    }
    if (shouldShowSelectedMenu && hasHost) {
      res.push({
        func: 'enqueueTransfer',
        icon: iconType,
        text: `加入传输队列:${e('selected')}(${len})`
      })
    }
    if (
      isDirectory &&
      (
        (hasHost && enableSsh !== false && isRemote) ||
        (isLocal && !hasHost)
      ) &&
      !this.props.isFtp
    ) {
      res.push({
        func: 'gotoFolderInTerminal',
        icon: 'CodeOutlined',
        text: e('gotoFolderInTerminal')
      })
    }
    if (!(!isRealFile || !hasHost || shouldShowSelectedMenu)) {
      res.push({
        func: 'enqueueTransfer',
        icon: iconType,
        text: '加入传输队列'
      })
      // if (isDirectory && !this.props.isFtp) {
      //   res.push({
      //     func: 'zipAndTransfer',
      //     icon: 'FileZipOutlined',
      //     text: e('compressAndTransfer')
      //   })
      // }
    }
    if (!isDirectory && isRealFile) {
      res.push({
        func: 'openGuiEditor',
        icon: 'EditOutlined',
        text: '打开内置编辑'
      })
      res.push({
        func: 'openWithDefaultApp',
        icon: 'ArrowRightOutlined',
        text: '默认程序打开'
      })
      res.push({
        func: 'openWithSystemEditorDirect',
        icon: 'EditOutlined',
        text: '使用系统编辑器编辑'
      })
    }
    if (isRealFile && isLocal) {
      res.push({
        func: 'showInDefaultFileManager',
        icon: 'ContainerOutlined',
        text: e('showInDefaultFileMananger')
      })
    }
    if (isLocal && isRealFile && window.et.isWebApp) {
      res.push({
        func: 'downloadFromBrowser',
        icon: 'DownloadOutlined',
        text: e('downloadFromBrowser')
      })
    }
    if (showEdit) {
      res.push({
        func: 'editFile',
        icon: 'EditOutlined',
        text: e('edit')
      })
    }
    if (isRealFile) {
      const compressTxt = shouldShowSelectedMenu
        ? `压缩为…:${e('selected')}(${len})`
        : '压缩为…'
      res.push({
        func: 'openCompressDialog',
        icon: 'FileZipOutlined',
        text: compressTxt
      })
      const fileName = this.props.file?.name || ''
      if (!shouldShowSelectedMenu && detectFormatFromName(fileName)) {
        res.push({
          func: 'openExtractDialog',
          icon: 'FileZipOutlined',
          text: '解压到…'
        })
      }
      res.push({
        func: 'del',
        icon: 'CloseCircleOutlined',
        text: delTxt,
        requireConfirm: true
      })
      res.push({
        func: 'onCopy',
        icon: 'CopyOutlined',
        text: e('copy'),
        subText: `${ctrlOrCmd}+c`
      })
      res.push({
        func: 'onCut',
        icon: 'FileExcelOutlined',
        text: e('cut'),
        subText: `${ctrlOrCmd}+x`
      })
    }
    res.push({
      func: 'onPaste',
      icon: 'CopyOutlined',
      text: e('paste'),
      disabled: !canPaste,
      subText: `${ctrlOrCmd}+v`
    })
    if (isRealFile) {
      res.push({
        func: 'doRename',
        icon: 'EditOutlined',
        text: e('rename')
      })
      res.push({
        func: 'onCopyPath',
        icon: 'CopyOutlined',
        text: e('copyFilePath')
      })
    }
    if (enableSsh !== false || isLocal) {
      res.push({
        func: 'new-submenu',
        icon: 'FileAddOutlined',
        text: '新增',
        children: [
          {
            func: 'newFolder',
            icon: 'FolderAddOutlined',
            text: '文件夹'
          },
          {
            func: 'newTextFile',
            icon: 'FileAddOutlined',
            text: '文本文档'
          },
          {
            func: 'newMarkdown',
            icon: 'FileAddOutlined',
            text: 'Markdown 文档'
          },
          {
            func: 'newJson',
            icon: 'FileAddOutlined',
            text: 'JSON 文件'
          },
          {
            func: 'newShell',
            icon: 'FileAddOutlined',
            text: 'Shell 脚本'
          },
          {
            func: 'newEmpty',
            icon: 'FileAddOutlined',
            text: '空文件'
          }
        ]
      })
    }
    res.push({
      func: 'selectAll',
      icon: 'CheckSquareOutlined',
      text: e('selectAll'),
      subText: `${ctrlOrCmd}+a`
    })
    if (!(isDirectory && isRealFile)) {
      res.push({
        func: 'refresh',
        icon: 'ReloadOutlined',
        text: e('refresh')
      })
    }
    if (
      this.showModeEdit(type, isRealFile) &&
      !this.props.isFtp
    ) {
      res.push({
        func: 'editPermission',
        icon: 'LockOutlined',
        text: e('editPermission')
      })
    }
    if (isRealFile) {
      res.push({
        func: 'showInfo',
        icon: 'InfoCircleOutlined',
        text: e('info')
      })
    }
    if (this.canCompare()) {
      res.push({
        func: 'showCompare',
        icon: 'SwapOutlined',
        text: e('compare')
      })
    }
    return res
  }

  onContextMenu = ({ key }) => {
    // If it's not the submenu itself
    if (key === 'more-submenu' || key === 'new-submenu' || typeof this[key] !== 'function') {
      return
    }
    this[key]()
  }

  renderEditing (file) {
    const {
      nameTemp,
      isDirectory
    } = file
    const Icon = isDirectory ? FolderOutlined : FileOutlined
    const pre = <Icon />
    return (
      <div className='sftp-item'>
        <Input
          value={nameTemp}
          prefix={pre}
          onChange={this.handleChange}
          onBlur={this.handleBlur}
          onPressEnter={this.handleBlur}
        />
      </div>
    )
  }

  renderProp = ({ id, size }) => {
    const { file } = this.state
    let value = file[id]
    let typeIcon = null
    let symbolicLinkText = null
    const {
      isDirectory,
      isSymbolicLink,
      isParent
    } = file
    if (isDirectory && id === 'size') {
      value = null
    } else if (!isDirectory && id === 'size') {
      value = formatBytes(Number(value) || 0)
    } else if (id === 'owner') {
      const { type } = this.props
      value = this.props[`${type}UidTree`]['' + value] || value
    } else if (id === 'group') {
      const { type } = this.props
      value = this.props[`${type}GidTree`]['' + value] || value
    }
    if (id === 'name') {
      typeIcon = <ExtIcon file={file} className='mg1r' />
      symbolicLinkText = (isSymbolicLink || file.isSymbol)
        ? <sup className='color-blue symbolic-link-icon'>*</sup>
        : null
      if ((isSymbolicLink || file.isSymbol) && file.target) {
        value = this.renderLinkName(file.name)
      }
    } else if (id === 'mode') {
      value = permission2mode(mode2permission(value))
    } else if (id.toLowerCase().includes('time')) {
      value = time(value)
    }
    const divProps = {
      className: `sftp-file-prop noise shi-${id}`,
      style: {
        width: size + '%',
        flexBasis: `${size}%`
      },
      title: typeof value === 'string' || typeof value === 'number'
        ? value
        : (file.name || '')
    }
    if (isParent && id !== 'name') {
      value = null
      divProps.title = ''
    }
    return (
      <div
        {...divProps}
        key={id}
      >
        {typeIcon}
        {symbolicLinkText}
        {value}
      </div>
    )
  }

  render () {
    const { type, selectedFiles, draggable = true, onDragStart, cls = '' } = this.props
    const { file } = this.state
    const {
      isDirectory,
      id,
      isEditing,
      isParent
    } = file
    if (isEditing) {
      return this.renderEditing(file)
    }
    const selected = selectedFiles.has(id)
    const className = classnames('sftp-item', cls, type, {
      directory: isDirectory,
      selected,
      'sftp-tree-item': this.props.layout === 'tree'
    })
    const props = {
      className,
      draggable: draggable && !isParent,
      onDragStart: onDragStart || this.onDragStart,
      'data-id': id,
      id: this.id,
      'data-type': type
    }
    return (
      <div
        ref={this.domRef}
        {...props}
        onContextMenu={this.handleContextMenuCapture}
      >
        <div className='file-bg' />
        {this.renderItemInner()}
      </div>
    )
  }
}
