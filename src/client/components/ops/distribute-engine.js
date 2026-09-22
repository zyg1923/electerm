/**
 * File distribute engine with file-level checkpoint resume
 */

import uid from '../../common/uid'
import resolve from '../../common/resolve'
import {
  opsChecksum,
  opsItemStatus,
  opsStrategy,
  opsTaskStatus
} from '../../common/ops-constants'
import { execCmd } from '../terminal/terminal-apis'
import { typeMap } from '../../common/constants'
import { autoRun } from 'manate'
import {
  resumeUploadLocalToRemote,
  finalizePart
} from './resume-upload'

function pathBase (p) {
  const s = String(p || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

export default class DistributeEngine {
  constructor (options = {}) {
    this.id = options.id || uid()
    this.sourceType = options.sourceType || 'local' // local | remote
    this.sourceTabId = options.sourceTabId || ''
    this.sourceHost = options.sourceHost || ''
    this.files = [...(options.files || [])].filter(Boolean)
    this.targets = (options.targets || []).map(t => ({
      tabId: t.tabId,
      host: t.host || '',
      title: t.title || t.tabId,
      path: t.path || options.targetPath || '/tmp'
    }))
    this.targetPath = options.targetPath || '/tmp'
    this.strategy = options.strategy || opsStrategy.parallel
    this.maxConcurrency = Math.max(1, options.maxConcurrency || 4)
    this.checksum = options.checksum || opsChecksum.none
    this.hostBandwidth = options.hostBandwidth || 0
    this.totalBandwidth = options.totalBandwidth || 0
    this.checkpoints = options.checkpoints || {} // key: `${tabId}::${src}` -> { status, dstPath, verified }
    this.onUpdate = options.onUpdate || (() => {})

    this.status = opsTaskStatus.created
    this.items = []
    this.startedAt = 0
    this.finishedAt = 0
    this._aborted = false
    this._paused = false
    this._watchRef = null
    this._pendingTransfers = new Map()
  }

  get snapshot () {
    const items = this.items.map(i => ({ ...i }))
    return {
      id: this.id,
      type: 'distribute',
      status: this.status,
      strategy: this.strategy,
      checksum: this.checksum,
      files: this.files,
      targets: this.targets,
      checkpoints: { ...this.checkpoints },
      items,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      progress: {
        total: items.length,
        success: items.filter(i => i.status === opsItemStatus.success).length,
        failed: items.filter(i => i.status === opsItemStatus.failed).length,
        running: items.filter(i => i.status === opsItemStatus.running).length,
        pending: items.filter(i => i.status === opsItemStatus.pending).length
      }
    }
  }

  _emit () {
    this.onUpdate(this.snapshot)
  }

  _ckKey (tabId, src) {
    return `${tabId}::${src}`
  }

  buildItems () {
    const items = []
    for (const target of this.targets) {
      for (const src of this.files) {
        const key = this._ckKey(target.tabId, src)
        const ck = this.checkpoints[key]
        const name = pathBase(src)
        const dstPath = resolve(target.path || this.targetPath, name)
        const item = {
          id: uid(),
          key,
          tabId: target.tabId,
          host: target.host,
          title: target.title,
          srcPath: src,
          dstPath,
          status: ck?.status === opsItemStatus.success
            ? opsItemStatus.success
            : opsItemStatus.pending,
          transferId: '',
          error: '',
          verified: !!ck?.verified,
          transferred: 0,
          total: 0
        }
        items.push(item)
      }
    }
    this.items = items
    return items
  }

  pause () {
    this._paused = true
    this.status = opsTaskStatus.paused
    window.store.pauseAll?.()
    this._emit()
  }

  resume () {
    this._paused = false
    this.status = opsTaskStatus.running
    window.store.resumeAll?.()
    this._emit()
    this._schedule()
  }

  abort () {
    this._aborted = true
    this._paused = false
    this.status = opsTaskStatus.aborted
    this.finishedAt = Date.now()
    this._stopWatch()
    this._emit()
  }

  async start () {
    this.buildItems()
    this._aborted = false
    this._paused = false
    this.startedAt = Date.now()
    this.status = opsTaskStatus.running
    this._emit()
    this._startWatch()
    await this._schedule()
    return this.snapshot
  }

  async retryFailed () {
    for (const item of this.items) {
      if (item.status === opsItemStatus.failed) {
        item.status = opsItemStatus.pending
        item.error = ''
        delete this.checkpoints[item.key]
      }
    }
    this._aborted = false
    this.status = opsTaskStatus.running
    this._emit()
    this._startWatch()
    await this._schedule()
  }

  async retryOne (itemId) {
    const item = this.items.find(i => i.id === itemId)
    if (!item) return
    item.status = opsItemStatus.pending
    item.error = ''
    delete this.checkpoints[item.key]
    this.status = opsTaskStatus.running
    this._emit()
    this._startWatch()
    await this._schedule()
  }

  _startWatch () {
    if (this._watchRef) return
    this._watchRef = autoRun(() => {
      this._tickHistory()
      return window.store.transferHistory
    })
    this._watchRef.start()
  }

  _stopWatch () {
    this._watchRef?.stop()
    this._watchRef = null
  }

  _tickHistory () {
    const history = window.store.transferHistory || []
    let changed = false
    for (const [transferId, itemId] of this._pendingTransfers.entries()) {
      const h = history.find(t => t.id === transferId || t.originalId === transferId)
      if (!h) continue
      const item = this.items.find(i => i.id === itemId)
      if (!item) continue
      if (h.error) {
        item.status = opsItemStatus.failed
        item.error = h.errorMessage || h.error || 'transfer failed'
        this._pendingTransfers.delete(transferId)
        changed = true
      } else if (h.finishTime || h.isDone) {
        item.status = opsItemStatus.success
        this.checkpoints[item.key] = {
          status: opsItemStatus.success,
          dstPath: item.dstPath,
          verified: false
        }
        this._pendingTransfers.delete(transferId)
        changed = true
        this._verify(item).catch(() => {})
      }
    }
    if (changed) {
      this._emit()
      this._schedule()
      this._maybeFinish()
    }
  }

  async _verify (item) {
    if (this.checksum === opsChecksum.none) return
    const bin = this.checksum === opsChecksum.sha1 ? 'sha1sum' : 'md5sum'
    try {
      const r = await execCmd(item.tabId, `${bin} '${item.dstPath.replace(/'/g, `'\\''`)}'`, 60000)
      const out = r?.stdout || r?.out || ''
      item.verifyOut = out.trim()
      item.verified = !r?.code || r.code === 0
      if (this.checkpoints[item.key]) {
        this.checkpoints[item.key].verified = item.verified
      }
      if (!item.verified) {
        item.status = opsItemStatus.failed
        item.error = 'checksum verify failed'
      }
      this._emit()
    } catch (err) {
      item.verified = false
      item.error = (item.error || '') + ' verify: ' + (err.message || err)
      this._emit()
    }
  }

  async _schedule () {
    if (this._aborted || this._paused) return

    const concurrency = this.strategy === opsStrategy.rolling
      ? 1
      : this.maxConcurrency

    const running = this.items.filter(i => i.status === opsItemStatus.running).length
    const slots = concurrency - running
    if (slots <= 0) return

    const pending = this.items.filter(i => i.status === opsItemStatus.pending)
    const batch = pending.slice(0, slots)
    for (const item of batch) {
      this._startItem(item)
    }
  }

  _startItem (item) {
    if (this._aborted || this._paused) return
    if (item.status === opsItemStatus.success) return

    item.status = opsItemStatus.running
    this._emit()

    // Local -> remote: byte-level resume + bandwidth limit
    if (this.sourceType !== 'remote') {
      this._startResumeLocal(item)
      return
    }

    const transferId = uid()
    item.transferId = transferId
    this._pendingTransfers.set(transferId, item.id)

    const transfer = {
      id: transferId,
      typeFrom: typeMap.remote,
      typeTo: typeMap.remote,
      fromPath: item.srcPath,
      toPath: item.dstPath,
      tabId: item.tabId,
      host: item.host,
      title: item.title,
      operation: '',
      opsDistributeId: this.id
    }

    if (this.sourceTabId && this.sourceTabId !== item.tabId) {
      const tempName = pathBase(item.srcPath) + '-' + uid()
      const tempPath = resolve(window.pre.tempDir, 'ops-dist', this.id, tempName)
      const step1 = {
        id: uid(),
        typeFrom: typeMap.remote,
        typeTo: typeMap.local,
        fromPath: item.srcPath,
        toPath: tempPath,
        tabId: this.sourceTabId,
        host: this.sourceHost,
        title: 'ops-dist-dl',
        operation: '',
        opsDistributeId: this.id,
        opsDistItemId: item.id,
        opsDistPhase: 1
      }
      const step2Id = transferId
      item._tempPath = tempPath
      item._step1Id = step1.id
      window.store.addTransferList([step1])
      this._watchStep1(item, step1.id, step2Id, tempPath)
      return
    }

    window.store.addTransferList([transfer])
  }

  async _startResumeLocal (item) {
    const partPath = item.dstPath + '.electerm.part'
    item.partPath = partPath
    try {
      const r = await resumeUploadLocalToRemote({
        tabId: item.tabId,
        localPath: item.srcPath,
        remotePartPath: partPath,
        hostBandwidth: this.hostBandwidth,
        totalBandwidth: this.totalBandwidth,
        onProgress: ({ transferred, total }) => {
          item.transferred = transferred
          item.total = total
          this.checkpoints[item.key] = {
            status: opsItemStatus.running,
            dstPath: item.dstPath,
            partPath,
            offset: transferred,
            total
          }
          this._emit()
        },
        shouldAbort: () => this._aborted || this._paused
      })
      if (!r.ok) {
        item.status = opsItemStatus.failed
        item.error = r.error || 'upload failed'
        this._emit()
        this._schedule()
        this._maybeFinish()
        return
      }
      const moved = await finalizePart(item.tabId, partPath, item.dstPath)
      if (!moved) {
        item.status = opsItemStatus.failed
        item.error = 'finalize mv failed'
        this._emit()
        this._schedule()
        this._maybeFinish()
        return
      }
      item.status = opsItemStatus.success
      item.transferred = r.total
      item.total = r.total
      this.checkpoints[item.key] = {
        status: opsItemStatus.success,
        dstPath: item.dstPath,
        verified: false,
        offset: r.total,
        total: r.total
      }
      this._emit()
      await this._verify(item)
      this._schedule()
      this._maybeFinish()
    } catch (e) {
      item.status = opsItemStatus.failed
      item.error = e.message || String(e)
      this._emit()
      this._schedule()
      this._maybeFinish()
    }
  }

  _watchStep1 (item, step1Id, step2Id, tempPath) {
    const ref = autoRun(() => {
      const history = window.store.transferHistory || []
      const h = history.find(t => t.id === step1Id)
      if (!h) return window.store.transferHistory
      ref.stop()
      if (h.error) {
        item.status = opsItemStatus.failed
        item.error = h.errorMessage || 'download failed'
        this._emit()
        this._schedule()
        return window.store.transferHistory
      }
      const step2 = {
        id: step2Id,
        typeFrom: typeMap.local,
        typeTo: typeMap.remote,
        fromPath: tempPath,
        toPath: item.dstPath,
        tabId: item.tabId,
        host: item.host,
        title: item.title,
        operation: '',
        opsDistributeId: this.id
      }
      this._pendingTransfers.set(step2Id, item.id)
      window.store.addTransferList([step2])
      return window.store.transferHistory
    })
    ref.start()
  }

  _maybeFinish () {
    const busy = this.items.some(i =>
      i.status === opsItemStatus.pending ||
      i.status === opsItemStatus.running ||
      i.status === opsItemStatus.queued
    )
    if (busy || this._aborted) return
    const hasFail = this.items.some(i => i.status === opsItemStatus.failed)
    this.status = hasFail ? opsTaskStatus.failed : opsTaskStatus.completed
    this.finishedAt = Date.now()
    this._stopWatch()
    this._emit()
  }
}
