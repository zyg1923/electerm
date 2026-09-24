import { autoRun } from 'manate'
import copy from 'json-deep-copy'
import uid from '../../common/uid'
import resolve from '../../common/resolve'
import { typeMap } from '../../common/constants'
import { getFolderFromFilePath, getLocalFileInfo } from '../sftp/file-read'
import message from '../common/message'

async function ensureRelayTempDir () {
  const custom = String(window.store?.config?.transferTempDir || '').trim()
  if (!custom) {
    return window.pre.tempDir
  }
  const info = await getLocalFileInfo(custom).catch(() => null)
  if (info) {
    return custom
  }
  const made = await window.fs.mkdir(custom).then(() => true).catch(() => false)
  if (made) {
    return custom
  }
  message.warning('中转临时目录不可用，已改用系统临时目录')
  return window.pre.tempDir
}

export default class Remote2RemoteHandler {
  constructor (props) {
    this.props = props
    this.id = uid()
  }

  get store () {
    return window.store
  }

  get fromFile () {
    return this.props.fromFile
  }

  get fromPath () {
    const { path, name } = this.fromFile
    return resolve(path, name)
  }

  get toPath () {
    return this.props.toPath
  }

  buildTempPath = (dir) => {
    const { name, ext, base } = getFolderFromFilePath(this.fromPath, true)
    const tail = uid()
    const tempName = ext
      ? `${base}-${tail}.${ext}`
      : `${name}-${tail}`
    return resolve(dir || window.pre.tempDir, tempName)
  }

  buildStep1Transfer = () => {
    const {
      title,
      tabType,
      sourceTabId,
      sourceHost
    } = this.props
    const transfer = {
      id: uid(),
      typeFrom: typeMap.remote,
      typeTo: typeMap.local,
      fromPath: this.fromPath,
      toPath: this.tempPath,
      tabId: sourceTabId,
      host: sourceHost,
      title,
      tabType,
      operation: '',
      remote2remoteStep: 1,
      remote2remoteId: this.id,
      size: this.fromFile?.size || 0,
      transferred: 0,
      sourceMachine: title || sourceHost || '远程',
      targetMachine: '本机',
      relayNote: `经本机中转，先保存到 ${this.tempPath}`
    }
    return transfer
  }

  buildStep2Transfer = (fromFile) => {
    const {
      targetTabId,
      targetHost,
      targetTitle,
      targetTabType
    } = this.props
    const transfer = {
      id: uid(),
      typeFrom: typeMap.local,
      typeTo: typeMap.remote,
      fromPath: this.tempPath,
      toPath: this.toPath,
      fromFile,
      tabId: targetTabId,
      host: targetHost,
      title: targetTitle,
      tabType: targetTabType,
      operation: '',
      remote2remoteStep: 2,
      remote2remoteId: this.id,
      originalId: this.step1Transfer?.id,
      size: fromFile?.size || 0,
      transferred: 0,
      sourceMachine: '本机',
      targetMachine: targetTitle || targetHost || '远程',
      relayNote: `从本机 ${this.tempPath} 上传到 ${this.toPath}`
    }
    return transfer
  }

  start = async () => {
    const dir = await ensureRelayTempDir()
    this.tempDir = dir
    this.tempPath = this.buildTempPath(dir)
    this.step1Transfer = this.buildStep1Transfer()
    message.info(`经本机中转：${this.tempPath}`, 6)
    this.store.addTransferList([copy(this.step1Transfer)])
    this.startWatch()
  }

  startWatch = () => {
    this.ref = autoRun(() => {
      this.tick()
      return this.store.transferHistory
    })
    this.ref.start()
  }

  stopWatch = () => {
    this.ref?.stop()
    this.ref = null
  }

  tick = async () => {
    const step1 = this.findHistory(this.step1Transfer?.id)

    if (!this.step2Transfer) {
      if (this.creatingStep2) {
        return
      }
      if (!step1) {
        return
      }
      if (step1.error) {
        return this.finish(step1.error)
      }
      this.creatingStep2 = true
      const localFromFile = await getLocalFileInfo(this.tempPath).catch(() => null)
      if (!localFromFile) {
        this.creatingStep2 = false
        return this.finish('本机临时文件已经不在了（可能被系统或手动删除），中转已停止')
      }
      this.step2Transfer = this.buildStep2Transfer(localFromFile)
      this.creatingStep2 = false
      this.store.addTransferList([copy(this.step2Transfer)])
      return
    }

    const step2 = this.findHistory(this.step2Transfer.id)
    if (!step2) {
      return
    }

    return this.finish(step2.error)
  }

  findHistory = (transferId) => {
    if (!transferId) {
      return null
    }
    return this.store.transferHistory.find(item => {
      return item.id === transferId || item.originalId === transferId
    })
  }

  cleanup = async () => {
    if (!this.tempPath) {
      return
    }
    const info = await getLocalFileInfo(this.tempPath).catch(() => null)
    if (!info) {
      return
    }
    await window.fs.rmrf(this.tempPath).catch(() => {})
  }

  finish = async (error) => {
    if (this.finished) {
      return
    }
    this.finished = true
    this.stopWatch()
    await this.cleanup()
    this.props.onDone?.({
      id: this.id,
      error
    })
  }

  stop = async () => {
    await this.finish()
  }
}
