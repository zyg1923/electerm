/**
 * file transfer list related functions
 */

import uid from '../common/uid'

const { assign } = Object

function pathBasename (p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  if (!s) {
    return ''
  }
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || s
}

function ensureTransferNames (t) {
  if (!t.fromName) {
    t.fromName = t.fromFile?.name || pathBasename(t.fromPathReal || t.fromPath)
  }
  if (!t.toName) {
    t.toName = t.toFile?.name || pathBasename(t.toPathReal || t.toPath)
  }
  return t
}

export default Store => {
  Store.prototype.handleTransferTab = function (tab) {
    window.store.transferTab = tab
  }

  Store.prototype.updateTransfer = function (id, update) {
    const { fileTransfers } = window.store
    const index = fileTransfers.findIndex(t => t.id === id)
    if (index < 0) {
      return
    }
    assign(fileTransfers[index], update)
    if (update && (update.toPath || update.toPathReal || update.fromPath || update.fromPathReal)) {
      ensureTransferNames(fileTransfers[index])
    }
  }

  Store.prototype.addTransferList = function (items) {
    // console.log('addTransferList', JSON.stringify(items, null, 2))
    const { fileTransfers } = window.store
    const transferBatch = uid()
    const nextItems = items.map(t => {
      t.transferBatch = transferBatch
      return ensureTransferNames(t)
    })
    fileTransfers.push(...nextItems)
  }

  Store.prototype.pauseAll = function () {
    const { fileTransfers } = window.store
    window.store.pauseAllTransfer = true
    const len = fileTransfers.length
    for (let i = 0; i < len; i++) {
      fileTransfers[i].pausing = true
    }
  }

  Store.prototype.resumeAll = function () {
    const { fileTransfers } = window.store
    window.store.pauseAllTransfer = false
    const len = fileTransfers.length
    for (let i = 0; i < len; i++) {
      fileTransfers[i].pausing = false
    }
  }

  Store.prototype.cancelAll = function () {
    window.store.fileTransfers = []
  }
}
