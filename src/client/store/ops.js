/**
 * Ops Center store extension
 */

import uid from '../common/uid'
import { insert } from '../common/db'
import {
  opsApprovalStatus
} from '../common/ops-constants'
import {
  buildDefaultRules,
  checkCommandNeedsApproval
} from '../components/ops/approval-gate'

export default Store => {
  Store.prototype.openOpsCenter = function (tab = 'distribute') {
    const { store } = window
    store.opsCenterTab = tab
    store.opsCenterVisible = true
    store.opsCenterReveal = (store.opsCenterReveal || 0) + 1
  }

  Store.prototype.closeOpsCenter = function () {
    window.store.opsCenterVisible = false
  }

  Store.prototype.setOpsCenterTab = function (tab) {
    window.store.opsCenterTab = tab
  }

  Store.prototype.addOpsAuditLog = function (entry) {
    const { store } = window
    const row = {
      id: uid(),
      at: Date.now(),
      ...entry
    }
    store.opsAuditLogs.unshift(row)
    if (store.opsAuditLogs.length > 500) {
      store.opsAuditLogs.length = 500
    }
    return row
  }

  Store.prototype.createOpsTask = function (task) {
    const { store } = window
    const row = {
      id: task.id || uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...task
    }
    store.opsTasks.unshift(row)
    store.addOpsAuditLog({
      action: 'task-create',
      taskId: row.id,
      type: row.type,
      detail: { status: row.status }
    })
    return row
  }

  Store.prototype.updateOpsTask = function (id, patch) {
    const { store } = window
    const item = store.opsTasks.find(t => t.id === id)
    if (!item) return null
    Object.assign(item, patch, { updatedAt: Date.now() })
    return item
  }

  Store.prototype.checkOpsApproval = function (command, ctx = {}) {
    const { store } = window
    return checkCommandNeedsApproval(command, {
      rules: store.opsApprovalRules,
      whitelist: store.opsApprovalWhitelist,
      ...ctx
    })
  }

  Store.prototype.createApprovalRequest = function (payload) {
    const { store } = window
    const timeoutMin = payload.timeoutMinutes ?? store.config.opsApprovalTimeoutMinutes ?? 30
    const row = {
      id: uid(),
      submitterId: payload.submitterId || 'local',
      command: payload.command,
      targets: payload.targets || [],
      riskMatchedRules: payload.riskMatchedRules || [],
      status: opsApprovalStatus.pending,
      approvalMode: payload.approvalMode || 'modal',
      approverId: '',
      comment: '',
      expiresAt: Date.now() + timeoutMin * 60 * 1000,
      payload: payload.payload || null,
      createdAt: Date.now(),
      decidedAt: 0,
      executedAt: 0
    }
    store.opsApprovalRequests.unshift(row)
    store.addOpsAuditLog({
      action: 'approval-submit',
      requestId: row.id,
      detail: { command: row.command, targets: row.targets }
    })
    store.notifyOpsApproval(row)
    return row
  }

  Store.prototype.decideApproval = function (id, decision, comment = '') {
    const { store } = window
    const row = store.opsApprovalRequests.find(r => r.id === id)
    if (!row || row.status !== opsApprovalStatus.pending) return null

    if (row.expiresAt && Date.now() > row.expiresAt) {
      row.status = opsApprovalStatus.timeout
      row.decidedAt = Date.now()
      row.comment = comment || 'timeout'
      store.addOpsAuditLog({ action: 'approval-timeout', requestId: id })
      return row
    }

    row.status = decision === 'approve'
      ? opsApprovalStatus.approved
      : opsApprovalStatus.rejected
    row.comment = comment
    row.approverId = 'local'
    row.decidedAt = Date.now()
    store.addOpsAuditLog({
      action: decision === 'approve' ? 'approval-approve' : 'approval-reject',
      requestId: id,
      detail: { comment }
    })
    return row
  }

  Store.prototype.expireApprovals = function () {
    const { store } = window
    const now = Date.now()
    for (const row of store.opsApprovalRequests) {
      if (row.status === opsApprovalStatus.pending && row.expiresAt && now > row.expiresAt) {
        row.status = opsApprovalStatus.timeout
        row.decidedAt = now
        row.comment = row.comment || 'timeout'
        store.addOpsAuditLog({ action: 'approval-timeout', requestId: row.id })
      }
    }
  }

  Store.prototype.saveApprovalRules = function (rules) {
    window.store.opsApprovalRules = rules
  }

  Store.prototype.saveApprovalWhitelist = function (list) {
    window.store.opsApprovalWhitelist = list
  }

  Store.prototype.notifyOpsApproval = function (request) {
    const { store } = window
    try {
      import('../components/common/message').then(mod => {
        const message = mod.default
        message.warning?.(
          (window.translate?.('needsApproval') || '需要审批') + ': ' + (request.command || '').slice(0, 80)
        )
      }).catch(() => {})
    } catch (e) {}

    const webhook = store.config?.opsApprovalWebhook || store.opsApprovalWebhook
    if (webhook) {
      const body = {
        type: 'ops-approval',
        id: request.id,
        command: request.command,
        targets: request.targets,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt
      }
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(err => {
        console.error('approval webhook failed', err)
        store.addOpsAuditLog({
          action: 'approval-webhook-fail',
          requestId: request.id,
          detail: { error: err.message, webhook }
        })
      })
      store.addOpsAuditLog({
        action: 'approval-webhook-sent',
        requestId: request.id,
        detail: { webhook }
      })
    }
  }

  Store.prototype.ensureOpsDefaults = async function () {
    const { store } = window
    if (!store.opsApprovalRules?.length) {
      const rules = buildDefaultRules()
      store.opsApprovalRules = rules
      // seed once into DB so next cold start has them even before watch
      for (const rule of rules) {
        try {
          await insert('opsApprovalRules', { _id: rule.id, ...rule })
        } catch (e) {}
      }
    }
    store.expireApprovals()
  }

  Store.prototype.loadOpsData = async function () {
    // data already loaded via dbNames in initData; just ensure defaults
    await window.store.ensureOpsDefaults()
  }
}
