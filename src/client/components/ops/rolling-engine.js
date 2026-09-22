/**
 * Rolling execution state machine
 */

import {
  opsItemStatus,
  opsTaskStatus,
  opsFailPolicy,
  opsStrategy
} from '../../common/ops-constants'
import { execCmd } from '../terminal/terminal-apis'
import { refs } from '../common/ref'
import uid from '../../common/uid'

export default class RollingEngine {
  constructor (options = {}) {
    this.id = options.id || uid()
    this.command = options.command || ''
    this.tabIds = [...(options.tabIds || [])]
    this.strategy = options.strategy || opsStrategy.rolling
    this.maxConcurrency = Math.max(1, options.maxConcurrency || 1)
    this.failPolicy = options.failPolicy || opsFailPolicy.stop
    this.timeoutMs = options.timeoutMs || 120000
    this.useExec = options.useExec !== false
    this.onUpdate = options.onUpdate || (() => {})
    this.onAskConfirm = options.onAskConfirm || null
    this.onItemOutput = options.onItemOutput || (() => {})

    this.status = opsTaskStatus.created
    this.items = this.tabIds.map(tabId => ({
      tabId,
      status: opsItemStatus.pending,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: '',
      startedAt: 0,
      finishedAt: 0
    }))
    this._paused = false
    this._aborted = false
    this._running = new Set()
    this._cursor = 0
    this.startedAt = 0
    this.finishedAt = 0
  }

  get snapshot () {
    return {
      id: this.id,
      command: this.command,
      status: this.status,
      strategy: this.strategy,
      maxConcurrency: this.maxConcurrency,
      failPolicy: this.failPolicy,
      items: this.items.map(i => ({ ...i })),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      progress: {
        total: this.items.length,
        done: this.items.filter(i =>
          [opsItemStatus.success, opsItemStatus.failed, opsItemStatus.skipped, opsItemStatus.cancelled]
            .includes(i.status)
        ).length,
        success: this.items.filter(i => i.status === opsItemStatus.success).length,
        failed: this.items.filter(i => i.status === opsItemStatus.failed).length
      }
    }
  }

  _emit () {
    this.onUpdate(this.snapshot)
  }

  pause () {
    if (this.status !== opsTaskStatus.running) return
    this._paused = true
    this.status = opsTaskStatus.paused
    this._emit()
  }

  resume () {
    if (this.status !== opsTaskStatus.paused && this.status !== opsTaskStatus.waitingConfirm) return
    this._paused = false
    this.status = opsTaskStatus.running
    this._emit()
    this._pump()
  }

  abort () {
    this._aborted = true
    this._paused = false
    for (const item of this.items) {
      if (
        item.status === opsItemStatus.pending ||
        item.status === opsItemStatus.queued
      ) {
        item.status = opsItemStatus.cancelled
      }
    }
    this.status = opsTaskStatus.aborted
    this.finishedAt = Date.now()
    this._emit()
  }

  async start () {
    if (this.status !== opsTaskStatus.created && this.status !== opsTaskStatus.paused) {
      return this.snapshot
    }
    this._aborted = false
    this._paused = false
    this.startedAt = Date.now()
    this.status = opsTaskStatus.running
    this._emit()
    await this._pump()
    return this.snapshot
  }

  async _pump () {
    while (!this._aborted && !this._paused) {
      if (this.status === opsTaskStatus.waitingConfirm) {
        break
      }

      const concurrency = this.strategy === opsStrategy.parallel
        ? this.maxConcurrency
        : Math.min(this.maxConcurrency, this.maxConcurrency)

      while (
        this._running.size < concurrency &&
        this._cursor < this.items.length &&
        !this._aborted &&
        !this._paused
      ) {
        const idx = this._cursor++
        const item = this.items[idx]
        if (item.status !== opsItemStatus.pending) continue
        item.status = opsItemStatus.queued
        this._running.add(idx)
        this._runOne(idx).finally(() => {
          this._running.delete(idx)
          this._pump()
        })
      }

      if (this._running.size === 0) {
        const remaining = this.items.some(i => i.status === opsItemStatus.pending)
        if (!remaining) {
          this._finish()
        }
        break
      }
      // wait for in-flight; _runOne finally retriggers pump
      break
    }
  }

  async _runOne (idx) {
    const item = this.items[idx]
    if (this._aborted) {
      item.status = opsItemStatus.cancelled
      this._emit()
      return
    }
    item.status = opsItemStatus.running
    item.startedAt = Date.now()
    this._emit()

    try {
      let result
      if (this.useExec) {
        result = await execCmd(item.tabId, this.command, this.timeoutMs)
      } else {
        const term = refs.get('term-' + item.tabId)
        if (!term?.batchInput) {
          throw new Error('terminal not ready')
        }
        term.batchInput(this.command)
        result = { code: 0, stdout: '', stderr: '' }
      }

      const code = typeof result?.code === 'number'
        ? result.code
        : (typeof result?.exitCode === 'number' ? result.exitCode : 0)
      item.exitCode = code
      item.stdout = result?.stdout || result?.out || (typeof result === 'string' ? result : '')
      item.stderr = result?.stderr || ''
      this.onItemOutput(item)

      if (code === 0) {
        item.status = opsItemStatus.success
      } else {
        item.status = opsItemStatus.failed
        item.error = item.stderr || ('exit code ' + code)
        await this._handleFail(item)
      }
    } catch (err) {
      item.status = opsItemStatus.failed
      item.error = err?.message || String(err)
      item.exitCode = -1
      this.onItemOutput(item)
      await this._handleFail(item)
    } finally {
      item.finishedAt = Date.now()
      this._emit()
    }
  }

  async _handleFail (item) {
    if (this.failPolicy === opsFailPolicy.skip) {
      return
    }
    if (this.failPolicy === opsFailPolicy.stop) {
      this._aborted = true
      for (const it of this.items) {
        if (it.status === opsItemStatus.pending || it.status === opsItemStatus.queued) {
          it.status = opsItemStatus.cancelled
        }
      }
      this.status = opsTaskStatus.stopped
      this.finishedAt = Date.now()
      this._emit()
      return
    }
    // ask
    this.status = opsTaskStatus.waitingConfirm
    this._paused = true
    this._emit()
    if (typeof this.onAskConfirm === 'function') {
      const action = await this.onAskConfirm(item, this.snapshot)
      if (action === 'stop') {
        this.abort()
      } else if (action === 'skip' || action === 'continue') {
        this._paused = false
        this.status = opsTaskStatus.running
        this._emit()
      }
    }
  }

  _finish () {
    if (this.status === opsTaskStatus.aborted || this.status === opsTaskStatus.stopped) {
      return
    }
    const hasFail = this.items.some(i => i.status === opsItemStatus.failed)
    this.status = hasFail ? opsTaskStatus.failed : opsTaskStatus.completed
    this.finishedAt = Date.now()
    this._emit()
  }
}
