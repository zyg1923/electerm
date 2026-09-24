import { Component } from 'react'
import { message } from 'antd'
import copy from 'json-deep-copy'
import { isFunction } from 'lodash-es'
import generate from '../../common/uid'
import { typeMap, transferTypeMap, fileOperationsMap, fileActions } from '../../common/constants'
import format, { computeLeftTime, computePassedTime } from './transfer-speed-format'
import {
  getLocalFileInfo,
  getRemoteFileInfo,
  getFolderFromFilePath
} from '../sftp/file-read'
import resolve from '../../common/resolve'
import sanitizeFilename from '../../common/sanitize-filename'
import { refsTransfers, refsStatic, refs } from '../common/ref'
import {
  zipCmd,
  unzipCmd,
  rmCmd,
  mvCmd,
  mkdirCmd
} from './zip'
import './transfer.styl'

const { assign } = Object

export default class TransportAction extends Component {
  constructor (props) {
    super(props)
    const {
      id,
      transferBatch = '',
      tabId
    } = props.transfer
    const sftp = refs.get('sftp-' + tabId)
    this.id = `tr-${transferBatch}-${id}`
    this.tabId = tabId
    refsTransfers.add(this.id, this)
    this.total = 0
    this.transferred = 0
    this.currentProgress = 1
    this.isFtp = sftp?.type === 'ftp'
    this.terminalId = sftp?.terminalId
  }

  componentDidMount () {
    if (this.props.inited) {
      this.initTransfer()
    }
  }

  componentDidUpdate (prevProps) {
    if (this.props.transfer?.tabId && this.props.transfer.tabId !== this.tabId) {
      this.tabId = this.props.transfer.tabId
    }
    if (
      prevProps.inited !== this.props.inited &&
      this.props.inited === true
    ) {
      this.started = false
      this.onCancel = false
      this.initTransfer()
    }
    if (
      this.props.pausing !== prevProps.pausing
    ) {
      if (this.props.pausing) {
        this.pause()
      } else if (!this.props.transfer?.error) {
        this.resume()
      }
    }
  }

  componentWillUnmount () {
    this.transport && this.transport.destroy()
    this.transport = null
    this.fromFile = null
    refsTransfers.remove(this.id)
  }

  localCheckExist = (path) => {
    return getLocalFileInfo(path)
      .catch(() => null)
  }

  remoteCheckExist = (path, tabId) => {
    const sftp = refs.get('sftp-' + tabId)?.sftp
    if (!sftp) {
      console.log('remoteCheckExist error', 'sftp not exist')
      return false
    }
    return getRemoteFileInfo(sftp, path)
      .then(r => r)
      .catch((e) => {
        console.log('remoteCheckExist error', e)
        return false
      })
  }

  checkExist = (type, path, tabId) => {
    return this[type + 'CheckExist'](path, tabId)
  }

  partSuffix = '.electerm.part'

  getPartPath = (finalPath) => {
    return String(finalPath || '') + this.partSuffix
  }

  shouldUsePartFile = (fromFile = this.fromFile) => {
    return !this.isFtp && fromFile && !fromFile.isDirectory
  }

  removePath = async (type, path, tabId) => {
    if (!path) {
      return
    }
    if (type === typeMap.local) {
      await window.fs.unlink(path).catch(() => window.fs.rmrf(path).catch(() => null))
      return
    }
    const sftp = refs.get('sftp-' + tabId)?.sftp
    if (!sftp) {
      return
    }
    await sftp.rm(path).catch(() => null)
  }

  movePath = async (type, from, to, tabId) => {
    if (type === typeMap.local) {
      await window.fs.unlink(to).catch(() => null)
      await window.fs.mv(from, to)
      return
    }
    const sftp = refs.get('sftp-' + tabId)?.sftp
    if (!sftp) {
      throw new Error('会话已断开，无法完成续传收尾')
    }
    await sftp.rm(to).catch(() => null)
    await sftp.rename(from, to)
  }

  /**
   * Prefer an existing .electerm.part half-file. If only an incomplete final
   * exists, rename it to .part so resume never corrupts a "finished" name.
   */
  prepareResumeTarget = async (transfer) => {
    const {
      typeTo,
      toPath,
      tabId
    } = transfer
    const fromFile = transfer.fromFile || this.fromFile || {}
    if (!this.shouldUsePartFile(fromFile)) {
      const toFile = await this.checkExist(typeTo, toPath, tabId)
      return { finalPath: toPath, partPath: toPath, toFile, usingPart: false }
    }
    const partPath = this.getPartPath(toPath)
    let partFile = await this.checkExist(typeTo, partPath, tabId)
    const finalFile = await this.checkExist(typeTo, toPath, tabId)
    const fromSize = Number(fromFile.size) || Number(transfer.size) || 0
    if (!partFile && finalFile && !finalFile.isDirectory) {
      const finalSize = Number(finalFile.size) || 0
      if (fromSize > 0 && finalSize > 0 && finalSize < fromSize) {
        await this.movePath(typeTo, toPath, partPath, tabId)
        partFile = await this.checkExist(typeTo, partPath, tabId)
        return {
          finalPath: toPath,
          partPath,
          toFile: partFile || null,
          finalFile: null,
          usingPart: true
        }
      }
    }
    return {
      finalPath: toPath,
      partPath,
      toFile: partFile || null,
      finalFile: finalFile || null,
      usingPart: true
    }
  }

  finalizePartFile = async () => {
    if (!this.usingPart || !this.partPath || !this.finalPath) {
      return
    }
    if (this.partPath === this.finalPath) {
      return
    }
    const { typeTo, tabId } = this.props.transfer
    await this.movePath(typeTo, this.partPath, this.finalPath, tabId)
    this.partPath = null
  }

  update = (up) => {
    const { id } = this.props.transfer
    refsStatic.get('transfer-queue')?.addToQueue(
      'update',
      id,
      up
    )
  }

  tagTransferError = (id, errorMsg) => {
    // this.clear()
    const { store } = window
    const { fileTransfers } = store
    const index = fileTransfers.findIndex(d => d.id === id)
    if (index < 0) {
      return
    }

    const tr = copy(fileTransfers[index])
    assign(tr, {
      host: tr.host,
      error: errorMsg,
      statusText: '错误',
      finishTime: Date.now()
    })
    store.addTransferHistory(tr)
    refsStatic.get('transfer-queue')?.addToQueue(
      'delete',
      id
    )
  }

  // insert = (insts) => {
  //   const { fileTransfers } = window.store
  //   const { index } = this.props
  //   fileTransfers.splice(index, 1, ...insts)
  // }

  remoteList = () => {
    window.store.remoteList(this.tabId)
  }

  localList = () => {
    window.store.localList(this.tabId)
  }

  onEnd = (update = {}) => {
    if (this.onCancel) {
      return
    }
    const {
      transfer,
      config
    } = this.props
    const {
      typeTo
    } = transfer
    const finishTime = Date.now()
    if (!config.disableTransferHistory) {
      const fromFile = transfer.fromFile || this.fromFile
      const size = update.size ?? update.transferred ?? fromFile?.size
      const failed = !!(update && update.error)
      const r = copy(transfer)
      const baseName = (p) => {
        const s = String(p || '').replace(/[\\/]+$/, '')
        if (!s) return ''
        const parts = s.split(/[\\/]/)
        return parts[parts.length - 1] || s
      }
      assign(r, {
        finishTime,
        startTime: this.startTime,
        size,
        percent: failed ? (Number(transfer.percent) || 0) : 100,
        statusText: failed ? '错误' : '完成',
        error: failed ? update.error : '',
        next: null,
        speed: format(size, this?.startTime),
        fromName: r.fromName || fromFile?.name || baseName(r.fromPathReal || r.fromPath),
        toName: r.toName || r.toFile?.name || baseName(r.toPathReal || r.toPath)
      })
      window.store.addTransferHistory(
        r
      )
    }
    const cbs = [
      this[typeTo + 'List']
    ]
    const cb = () => {
      cbs.forEach(cb => cb())
    }
    this.cancel(cb)
  }

  onData = (transferred) => {
    if (this.onCancel) {
      return
    }
    const { transfer } = this.props
    const fromFile = transfer.fromFile || this.fromFile || {}
    const transferredValue = typeof transferred === 'object' && transferred !== null
      ? transferred.transferred
      : transferred
    const known = Number(fromFile.size) || Number(transfer.size) || Number(this.total) || 0
    const total = typeof transferred === 'object' && transferred !== null
      ? (transferred.total || known)
      : known
    const up = {}
    let percent = total === 0
      ? (transferredValue > 0 ? 0 : 100)
      : Math.floor(100 * transferredValue / total)
    percent = percent >= 100 ? 100 : percent
    if (total > 0) {
      this.total = total
    }
    up.percent = percent
    up.status = 'active'
    up.transferred = transferredValue
    up.size = this.total || known || total
    up.startTime = this.startTime
    up.speed = format(transferredValue, up.startTime)
    assign(
      up,
      computeLeftTime(transferredValue, total, up.startTime)
    )
    up.passedTime = computePassedTime(up.startTime)
    this.update(up)
  }

  cancel = (callback) => {
    if (this.onCancel) {
      return
    }
    this.onCancel = true
    this.transport && this.transport.destroy()
    this.transport = null
    // window.store.cancelTransfer(this.props.transfer.id)
    refsStatic.get('transfer-queue')?.addToQueue(
      'delete',
      this.props.transfer.id
    )
    if (isFunction(callback)) {
      callback()
    }
  }

  pause = () => {
    this.transport?.pause()
  }

  resume = () => {
    this.transport?.resume()
  }

  mvOrCp = () => {
    const {
      transfer
    } = this.props
    const {
      fromPath,
      toPath,
      typeFrom,
      tabId,
      operation // 'mv' or 'cp'
    } = transfer

    // Use this.newPath when set (e.g. user chose rename from conflict modal)
    let finalToPath = this.newPath || toPath

    // Check if it's a copy operation to the same path (no rename decision pending)
    if (!this.newPath && fromPath === toPath && operation === fileOperationsMap.cp) {
      finalToPath = this.handleRename(toPath, typeFrom === typeMap.remote).newPath
      transfer.toPath = finalToPath
      this.update({
        toPath: finalToPath
      })
    }
    if (typeFrom === typeMap.local) {
      return window.fs[operation](fromPath, finalToPath)
        .then(this.onEnd)
        .catch(e => {
          this.onEnd()
          this.onError(e)
        })
    }
    const sftp = refs.get('sftp-' + tabId)?.sftp
    return sftp[operation](fromPath, finalToPath)
      .then(this.onEnd)
      .catch(e => {
        this.onEnd()
        this.onError(e)
      })
  }

  transferFile = async (transfer = this.props.transfer, onEnd = this.onEnd) => {
    const {
      fromPath,
      typeFrom,
      toFile = {}
    } = transfer
    const toPath = transfer.zip
      ? transfer.toPath
      : this.newPath || transfer.toPath
    const fromFile = transfer.fromFile || this.fromFile
    const fromMode = fromFile.mode
    const transferType = typeFrom === typeMap.local ? transferTypeMap.upload : transferTypeMap.download
    const isDown = transferType === transferTypeMap.download
    const usePart = this.shouldUsePartFile(fromFile)
    const partPath = this.getPartPath(toPath)
    this.usingPart = usePart
    this.finalPath = toPath
    this.partPath = usePart ? partPath : toPath

    // Half-done data lives in .electerm.part; rename to final only after success.
    const localPath = isDown
      ? (usePart ? partPath : toPath)
      : fromPath
    const remotePath = isDown
      ? fromPath
      : (usePart ? partPath : toPath)

    let startFrom = Math.max(
      0,
      Number(this.startFrom) ||
      Number(transfer.startFrom) ||
      0
    )
    if (usePart && startFrom <= 0) {
      const existing = await this.checkExist(
        isDown ? typeMap.local : typeMap.remote,
        partPath,
        transfer.tabId
      )
      startFrom = Number(existing?.size) || 0
      this.startFrom = startFrom
    }

    const mode = toFile.mode || fromMode
    const sftp = refs.get('sftp-' + this.tabId)?.sftp
    if (!sftp) {
      return this.tagTransferError(transfer.id, '会话已断开，无法传输')
    }
    const finish = async (arg) => {
      try {
        if (usePart) {
          await this.finalizePartFile()
        }
      } catch (e) {
        return this.onError(e)
      }
      return onEnd(arg)
    }
    this.transport = await sftp[transferType]({
      remotePath,
      localPath,
      isDirectory: !!fromFile.isDirectory,
      options: { mode, startFrom },
      onData: this.onData,
      onError: this.onError,
      onEnd: finish
    })
  }

  isTransferAction = (action) => {
    return action.includes('rename') || action === 'transfer'
  }

  initTransfer = async () => {
    if (this.started) {
      return
    }
    this.started = true
    try {
      await this.runTransfer()
    } catch (e) {
      this.onError(e)
    }
  }

  runTransfer = async () => {
    const { transfer } = this.props
    const {
      id,
      typeFrom,
      typeTo,
      fromPath,
      toPath,
      operation
    } = transfer

    if (
      typeFrom === typeTo &&
      fromPath === toPath &&
      operation === fileOperationsMap.mv
    ) {
      return this.cancel()
    }

    const t = Date.now()
    this.update({
      startTime: t
    })
    this.startTime = t

    const fromFile = transfer.fromFile
      ? transfer.fromFile
      : await this.checkExist(typeFrom, fromPath, this.tabId)
    if (!fromFile) {
      return this.tagTransferError(id, 'file not exist')
    }
    this.fromFile = fromFile
    let size = Number(fromFile.size) || Number(transfer.size) || 0
    if (!size && typeFrom === typeMap.local && !fromFile.isDirectory) {
      const info = await getLocalFileInfo(fromPath).catch(() => null)
      size = Number(info?.size) || 0
    }
    this.total = size
    this.update({
      fromFile: size && !fromFile.size
        ? { ...fromFile, size }
        : fromFile,
      size
    })
    if (fromPath === toPath && typeFrom === typeTo) {
      if (operation === fileOperationsMap.cp) {
        const picked = await this.pickKeepBothPath(toPath, typeTo, transfer.tabId)
        this.newPath = picked.newPath
        this.newName = picked.newName
        this.update({
          toPath: picked.newPath
        })
      }
      return this.mvOrCp()
    }
    const hasConflict = await this.checkConflict()
    if (hasConflict) {
      return
    }

    if (typeFrom === typeTo) {
      return this.mvOrCp()
    }
    this.startTransfer()
  }

  checkConflict = async (transfer = this.props.transfer) => {
    const transferStillExists = window.store.fileTransfers.some(t => t.id === transfer.id)
    if (!transferStillExists) {
      return false
    }
    const fromFile = transfer.fromFile || this.fromFile || {}
    const prepared = await this.prepareResumeTarget(transfer)
    this.usingPart = prepared.usingPart
    this.partPath = prepared.partPath
    this.finalPath = prepared.finalPath

    const partFile = prepared.toFile
    const finalFile = prepared.usingPart
      ? prepared.finalFile
      : prepared.toFile
    const conflictFile = partFile || finalFile
    if (!conflictFile) {
      // No final/part yet — still write into .part for clean finalize later.
      return false
    }

    const fromSize = Number(fromFile.size) || Number(transfer.size) || 0
    const toSize = Number(conflictFile.size) || 0
    const canResume = !fromFile.isDirectory &&
      toSize > 0 &&
      fromSize > 0 &&
      toSize < fromSize

    this.update({
      toFile: conflictFile,
      partPath: prepared.usingPart ? prepared.partPath : '',
      startFrom: canResume ? toSize : 0
    })

    // Incomplete .electerm.part → auto resume (fake cut already on disk)
    if (canResume && partFile && prepared.usingPart) {
      this.startFrom = toSize
      this.onDecision(fileActions.resume)
      return true
    }
    if (canResume && (
      transfer.resolvePolicy === fileActions.resume ||
      Number(transfer.startFrom) > 0 ||
      Number(transfer.transferred) > 0
    )) {
      this.startFrom = toSize
      this.onDecision(fileActions.resume)
      return true
    }
    if (transfer.resolvePolicy) {
      this.onDecision(transfer.resolvePolicy)
      return true
    }
    if (this.resolvePolicy) {
      this.onDecision(this.resolvePolicy)
      return true
    }

    const transferWithToFile = {
      ...copy(transfer),
      toFile: conflictFile,
      fromFile: copy(fromFile),
      partPath: prepared.usingPart ? prepared.partPath : ''
    }
    const conflict = refsStatic.get('transfer-conflict')
    if (!conflict) {
      if (canResume) {
        this.startFrom = toSize
        this.onDecision(fileActions.resume)
        return true
      }
      this.tagTransferError(transfer.id, '无法确认是否覆盖已有文件')
      return true
    }
    this.update({
      waitingConfirm: true
    })
    conflict.addConflict(transferWithToFile)
    return true
  }

  onDecision = async (policy) => {
    this.update({
      waitingConfirm: false
    })
    if (policy === fileActions.skip || policy === fileActions.cancel) {
      return this.onEnd()
    }

    const {
      typeTo,
      toPath,
      tabId
    } = this.props.transfer
    const finalPath = this.newPath || toPath
    const partPath = this.getPartPath(finalPath)

    if (policy === fileActions.resume) {
      if (this.isFtp) {
        message.warning('FTP 暂不支持断点续传，将整文件重新传输')
        this.startFrom = 0
        this.update({
          startFrom: 0,
          resolvePolicy: fileActions.mergeOrOverwrite
        })
      } else {
        const toSize = Number(this.props.transfer.toFile?.size) || Number(this.startFrom) || 0
        this.startFrom = toSize
        this.usingPart = true
        this.partPath = partPath
        this.finalPath = finalPath
        this.update({
          startFrom: toSize,
          resolvePolicy: fileActions.resume,
          transferred: toSize,
          partPath
        })
      }
    } else {
      this.startFrom = 0
      if (policy === fileActions.mergeOrOverwrite) {
        if (this.shouldUsePartFile()) {
          await this.removePath(typeTo, partPath, tabId)
          await this.removePath(typeTo, finalPath, tabId)
          this.usingPart = true
          this.partPath = partPath
          this.finalPath = finalPath
        }
        this.update({
          startFrom: 0,
          partPath: this.shouldUsePartFile() ? partPath : ''
        })
      } else if (policy === fileActions.rename) {
        this.update({
          startFrom: 0
        })
      }
    }

    if (policy === fileActions.rename) {
      this.oldPath = toPath
      const { newPath, newName } = await this.pickKeepBothPath(toPath, typeTo, tabId)
      this.update({
        toPath: newPath
      })
      this.newPath = newPath
      this.newName = newName
      if (this.shouldUsePartFile()) {
        this.usingPart = true
        this.partPath = this.getPartPath(newPath)
        this.finalPath = newPath
      }
    }

    const { typeFrom, typeTo: tTo } = this.props.transfer
    if (typeFrom === tTo) {
      return this.mvOrCp()
    }
    this.startTransfer()
  }

  zipTransferFolder = async () => {
    const {
      transfer
    } = this.props
    const {
      fromPath,
      typeFrom
    } = transfer
    const toPath = this.oldPath || transfer.toPath
    let p
    let isFromRemote
    if (typeFrom === typeMap.local) {
      isFromRemote = false
      p = await window.fs.zipFolder(fromPath)
    } else {
      isFromRemote = true
      const terminalId = refs.get('sftp-' + this.tabId)?.terminalId
      p = await zipCmd(terminalId, fromPath)
    }
    this.zipSrc = p
    const { name } = getFolderFromFilePath(p, isFromRemote)
    const { path } = getFolderFromFilePath(toPath, !isFromRemote)
    const nTo = resolve(path, name)
    this.zipPath = nTo
    const newTrans1 = {
      ...copy(transfer),
      toPath: nTo,
      fromPath: p
    }
    this.transferFile(newTrans1, this.unzipFile)
  }

  unzipFile = async () => {
    const { transfer } = this.props
    const {
      typeTo
    } = transfer
    const toPath = this.zipPath
    const fromPath = this.zipSrc
    const isToRemote = typeTo === typeMap.remote
    const {
      path,
      name,
      targetPath
    } = this.buildUnzipPath(transfer)
    const {
      newName,
      terminalId
    } = this
    if (isToRemote) {
      if (newName) {
        await mkdirCmd(terminalId, path)
      }
      await unzipCmd(terminalId, toPath, path)
      if (newName) {
        const mvFrom = resolve(path, name)
        const mvTo = resolve(targetPath, newName)
        await mvCmd(terminalId, mvFrom, mvTo)
      }
    } else {
      if (newName) {
        await window.fs.mkdir(path)
      }
      await window.fs.unzipFile(toPath, path)
      if (newName) {
        const mvFrom = resolve(path, name)
        const mvTo = resolve(targetPath, newName)
        await window.fs.mv(mvFrom, mvTo)
      }
    }
    await rmCmd(terminalId, !isToRemote ? fromPath : toPath)
    await window.fs.rmrf(!isToRemote ? toPath : fromPath)
    if (newName) {
      if (isToRemote) {
        await rmCmd(terminalId, path)
      } else {
        await window.fs.rmrf(path)
      }
    }
    this.onEnd()
  }

  buildUnzipPath = (transfer) => {
    const {
      typeTo
    } = transfer
    const isToRemote = typeTo === typeMap.remote
    const toPath = this.oldPath || transfer.toPath
    const {
      newName
    } = this
    const { path } = getFolderFromFilePath(toPath, isToRemote)
    const oldName = getFolderFromFilePath(toPath, isToRemote).name
    const np = newName
      ? resolve(path, 'temp-' + newName)
      : path
    return {
      targetPath: path,
      path: np,
      name: oldName
    }
  }

  startTransfer = async () => {
    const { fromFile = this.fromFile, zip } = this.props.transfer
    if (!fromFile) {
      return
    }
    if (!fromFile.isDirectory) {
      return this.transferFile()
    }
    if (zip) {
      return this.zipTransferFolder()
    }
    if (!this.isFtp) {
      return this.transferFile()
    } else {
      await this.transferFolderRecursive()
    }
    this.onEnd({
      transferred: this.transferred,
      size: this.total
    })
  }

  list = async (type, path, tabId) => {
    const sftp = refs.get('sftp-' + tabId)
    return sftp[type + 'List'](true, path)
  }

  handleRename = (fromPath, isRemote, index = 2) => {
    const { path, base, ext } = getFolderFromFilePath(fromPath, isRemote)
    const newName = ext
      ? `${base} (${index}).${ext}`
      : `${base} (${index})`
    return {
      newPath: resolve(path, newName),
      newName
    }
  }

  pickKeepBothPath = async (toPath, typeTo, tabId) => {
    const isRemote = typeTo === typeMap.remote
    for (let i = 2; i < 100; i++) {
      const picked = this.handleRename(toPath, isRemote, i)
      const exists = await this.checkExist(typeTo, picked.newPath, tabId)
      if (!exists) {
        return picked
      }
    }
    return this.handleRename(toPath, isRemote, Date.now() % 100000)
  }

  onFolderData = (transferred) => {
    if (this.onCancel) {
      return
    }
    this.transferred += transferred
    const up = {}

    // Increment progress slightly with each file/folder (but never exceed 99%)
    this.currentProgress = Math.min(this.currentProgress + 0.2, 99)

    up.percent = Math.floor(this.currentProgress)
    up.status = 'active'
    up.transferred = this.transferred
    up.startTime = this.startTime
    up.speed = format(this.transferred, up.startTime)
    assign(
      up,
      computeLeftTime(this.transferred, this.total, up.startTime)
    )
    up.passedTime = computePassedTime(up.startTime)
    this.update(up)
  }

  transferFileAsSubTransfer = async (transfer) => {
    const {
      fromPath,
      toPath,
      typeFrom,
      fromFile: {
        mode: fromMode,
        size: fileSize
      },
      toFile = {}
    } = transfer

    const transferType = typeFrom === typeMap.local ? transferTypeMap.upload : transferTypeMap.download
    const isDown = transferType === transferTypeMap.download
    const localPath = isDown ? toPath : fromPath
    const remotePath = isDown ? fromPath : toPath
    const mode = toFile.mode || fromMode
    const sftp = refs.get('sftp-' + this.tabId).sftp

    return new Promise((resolve, reject) => {
      let transport

      const onSubEnd = () => {
        if (fileSize) {
          this.onFolderData(fileSize)
        }
        if (transport) {
          transport.destroy()
          transport = null
        }
        resolve(fileSize)
      }

      const onSubError = (error) => {
        if (transport) {
          transport.destroy()
          transport = null
        }
        reject(error)
      }

      sftp[transferType]({
        remotePath,
        localPath,
        options: { mode },
        onData: () => {},
        onError: onSubError,
        onEnd: onSubEnd
      }).then(transportInstance => {
        transport = transportInstance
      }).catch(onSubError)
    })
  }

  getDefaultTransfer = () => {
    const transfer = this.props.transfer
    if (this.newPath) {
      const modifiedTransfer = {
        ...transfer,
        toPath: this.newPath,
        isRenamed: true
      }
      return modifiedTransfer
    }
    return transfer
  }

  // Handle file transfers in parallel batches
  transferFiles = async (files, batch, transfer) => {
    if (this.onCancel) {
      return
    }

    const { fromPath, toPath } = transfer

    // Process files in batches
    for (let i = 0; i < files.length; i += batch) {
      if (this.onCancel) {
        return
      }

      const batchFiles = files.slice(i, i + batch)
      const promises = batchFiles.map(file => {
        if (this.onCancel) {
          return Promise.resolve(0)
        }

        const fromItemPath = resolve(fromPath, file.name)
        const toItemPath = resolve(toPath, sanitizeFilename(file.name))

        const itemTransfer = {
          ...transfer,
          fromPath: fromItemPath,
          toPath: toItemPath,
          fromFile: file
        }

        return this.transferFileAsSubTransfer(itemTransfer)
      })

      // Wait for all files in batch to complete
      const results = await Promise.all(promises)

      // Update progress once for the entire batch
      const batchTotalSize = results.reduce((sum, size) => sum + size, 0)
      if (batchTotalSize > 0) {
        this.onFolderData(batchTotalSize)
      }
    }
  }

  // Handle folder transfers sequentially to prevent concurrency explosion
  transferFolders = async (folders, batch, transfer) => {
    if (this.onCancel) {
      return
    }

    const { fromPath, toPath } = transfer

    // Step 1: Create all folders concurrently in batches
    for (let i = 0; i < folders.length; i += batch) {
      if (this.onCancel) {
        return
      }

      const batchFolders = folders.slice(i, i + batch)
      const createFolderPromises = batchFolders.map(folder => {
        const toItemPath = resolve(toPath, sanitizeFilename(folder.name))

        // Create folder itself (don't process contents)
        const createTransfer = {
          ...transfer,
          toPath: toItemPath,
          fromFile: folder
        }

        return this.mkdir(createTransfer)
      })

      // Create all folders in this batch concurrently
      await Promise.all(createFolderPromises)
    }

    // Step 2: Process contents of each folder sequentially
    for (const folder of folders) {
      if (this.onCancel) {
        return
      }

      const fromItemPath = resolve(fromPath, folder.name)
      const toItemPath = resolve(toPath, sanitizeFilename(folder.name))

      const itemTransfer = {
        ...transfer,
        fromPath: fromItemPath,
        toPath: toItemPath,
        fromFile: folder
      }

      // Transfer folder contents (set createFolder = false since we already created it)
      await this.transferFolderRecursive(itemTransfer, false)
    }
  }

  // Main recursive function using the separate handlers
  transferFolderRecursive = async (transfer = this.getDefaultTransfer(), createFolder = true) => {
    if (this.onCancel) {
      return
    }
    const {
      fromPath,
      typeFrom,
      tabId,
      toFile,
      isRenamed
    } = transfer

    if (createFolder && (!toFile || isRenamed)) {
      const folderCreated = await this.mkdir(transfer)
      if (!folderCreated) {
        return
      }
    }

    const list = await this.list(typeFrom, fromPath, tabId)
    const bigFileSize = 1024 * 1024
    const smallFilesBatch = 30
    const BigFilesBatch = 3
    const foldersBatch = 50

    const {
      folders,
      smallFiles,
      largeFiles
    } = list.reduce((p, c) => {
      if (c.isDirectory) {
        p.folders.push(c)
      } else {
        this.total += c.size
        if (c.size < bigFileSize) {
          p.smallFiles.push(c)
        } else {
          p.largeFiles.push(c)
        }
      }
      return p
    }, {
      folders: [],
      smallFiles: [],
      largeFiles: []
    })

    // Process files with parallel batching
    await this.transferFiles(smallFiles, smallFilesBatch, transfer)
    await this.transferFiles(largeFiles, BigFilesBatch, transfer)

    // Process folders sequentially
    await this.transferFolders(folders, foldersBatch, transfer)
  }

  onError = (e) => {
    const msg = e?.message || String(e || '传输失败')
    const disconnected = /连接已断开|会话已断开|会话已|ECONNRESET|ECONNREFUSED|not found|closed|disconnect|SSH connection/i.test(msg)
    if (disconnected) {
      try {
        this.transport && this.transport.destroy()
      } catch (err) {}
      this.transport = null
      this.started = false
      this.onCancel = false
      this.update({
        error: msg,
        statusText: '错误',
        pausing: true,
        inited: false,
        waitingConfirm: false,
        speed: ''
      })
      return
    }
    const up = {
      status: 'exception',
      error: msg
    }
    this.onEnd(up)
    window.store.onError(e)
  }

  mkdir = async (transfer = this.props.transfer) => {
    const {
      typeTo,
      toPath,
      tabId
    } = transfer
    if (typeTo === typeMap.local) {
      return window.fs.mkdir(toPath)
        .then(() => true)
        .catch(() => false)
    }
    const sftp = refs.get('sftp-' + tabId).sftp
    return sftp.mkdir(toPath)
      .then(() => true)
      .catch(() => false)
  }

  render () {
    return null
  }
}
