/**
 * Cross-link relay transfer: try direct scp, fallback local relay
 */

import uid from '../../common/uid'
import resolve from '../../common/resolve'
import { typeMap } from '../../common/constants'
import { execCmd } from '../terminal/terminal-apis'
import { autoRun } from 'manate'
import { opsTaskStatus } from '../../common/ops-constants'
import { generateRelayKey, encryptLocalFile } from './relay-crypto'

function shellQuote (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

function pathBase (p) {
  const s = String(p || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

/**
 * Ensure relay temp dir with restrictive permissions (best-effort on win).
 */
export function ensureRelayTempDir (taskId) {
  const dir = resolve(window.pre.tempDir, 'relay-tmp', taskId)
  try {
    window.pre.runGlobalAsync?.('mkdirp', dir)
  } catch (e) {
    // fallback: transfers may still create parents
  }
  // Unix: chmod 700 via local shell if available
  try {
    if (window.pre.isWin !== true && window.pre.runGlobalAsync) {
      window.pre.runGlobalAsync('runLocalCmd', `chmod 700 "${dir}"`).catch(() => {})
    }
  } catch (e) {
    // ignore
  }
  return dir
}

export async function tryDirectTransfer ({
  sourceTabId,
  targetHost,
  targetUser,
  targetPort,
  fromPath,
  toPath,
  timeoutMs = 15000
}) {
  if (!targetHost) {
    return { ok: false, reason: 'no target host' }
  }
  const dest = `${targetUser || ''}@${targetHost}:${toPath}`
  // Prefer scp with BatchMode / ConnectTimeout; fall back to failure
  const cmd = [
    'scp',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.max(3, Math.floor(timeoutMs / 1000))}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    targetPort ? `-P ${targetPort}` : '',
    shellQuote(fromPath),
    shellQuote(dest)
  ].filter(Boolean).join(' ')

  try {
    const r = await execCmd(sourceTabId, cmd, timeoutMs + 5000)
    const code = typeof r?.code === 'number' ? r.code : (r?.exitCode ?? 1)
    if (code === 0) {
      return { ok: true, mode: 'direct', result: r }
    }
    return {
      ok: false,
      reason: r?.stderr || r?.stdout || ('exit ' + code),
      result: r
    }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Start relay (or direct) transfer with merged progress callback.
 */
export function startRelayTransfer (options = {}) {
  const id = options.id || uid()
  const {
    sourceTabId,
    sourceHost,
    sourceTitle,
    targetTabId,
    targetHost,
    targetTitle,
    targetUser,
    targetPort,
    fromPath,
    toPath,
    onUpdate,
    onAudit
  } = options

  const state = {
    id,
    mode: 'probing',
    status: opsTaskStatus.running,
    phase: 0,
    progress: 0,
    error: '',
    fromPath,
    toPath,
    sourceTabId,
    targetTabId,
    startedAt: Date.now(),
    finishedAt: 0
  }

  const emit = () => onUpdate?.({ ...state })
  emit()

  const finish = (status, error = '') => {
    state.status = status
    state.error = error
    state.finishedAt = Date.now()
    state.progress = status === opsTaskStatus.completed ? 100 : state.progress
    emit()
    onAudit?.({
      action: 'relay-transfer',
      mode: state.mode,
      fromPath,
      toPath,
      sourceTabId,
      targetTabId,
      status,
      error,
      duration: state.finishedAt - state.startedAt
    })
  }

  const runRelay = async () => {
    state.mode = 'relay'
    state.phase = 1
    state.progress = 5
    state.encrypted = false
    emit()

    const tmpDir = ensureRelayTempDir(id)
    const tempPath = resolve(tmpDir, pathBase(fromPath) + '-' + uid())
    let cryptoKey = null
    try {
      cryptoKey = await generateRelayKey()
      state.hasCryptoKey = true
    } catch (e) {
      state.hasCryptoKey = false
    }

    const step1Id = uid()
    const step2Id = uid()

    const step1 = {
      id: step1Id,
      typeFrom: typeMap.remote,
      typeTo: typeMap.local,
      fromPath,
      toPath: tempPath,
      tabId: sourceTabId,
      host: sourceHost,
      title: sourceTitle || 'relay-dl',
      operation: '',
      opsRelayId: id,
      opsRelayStep: 1
    }

    window.store.addTransferList([step1])

    const ref = autoRun(() => {
      const history = window.store.transferHistory || []
      const h1 = history.find(t => t.id === step1Id)
      if (!h1) return window.store.transferHistory

      if (h1.error) {
        ref.stop()
        cleanupTemp(tempPath)
        cleanupTemp(tempPath + '.enc.json')
        finish(opsTaskStatus.failed, h1.errorMessage || 'relay download failed')
        return window.store.transferHistory
      }

      if (!(h1.finishTime || h1.isDone)) {
        state.progress = 10 + Math.min(40, Number(h1.percent) || 0) * 0.4
        emit()
        return window.store.transferHistory
      }

      if (state.phase === 1) {
        state.phase = 1.5
        emit()
        ;(async () => {
          let uploadFrom = tempPath
          if (cryptoKey) {
            try {
              const enc = await encryptLocalFile(tempPath, cryptoKey)
              if (enc.encrypted) {
                // decrypt back to plain for upload (at-rest encryption between hops)
                const { decryptLocalFileTo } = await import('./relay-crypto')
                uploadFrom = tempPath + '.plain'
                await decryptLocalFileTo(enc.path, uploadFrom, cryptoKey)
                state.encrypted = true
                cleanupTemp(enc.path)
              }
            } catch (e) {
              state.encryptError = e.message
            }
          }
          state.phase = 2
          state.progress = 50
          emit()
          const step2 = {
            id: step2Id,
            typeFrom: typeMap.local,
            typeTo: typeMap.remote,
            fromPath: uploadFrom,
            toPath,
            tabId: targetTabId,
            host: targetHost,
            title: targetTitle || 'relay-ul',
            operation: '',
            opsRelayId: id,
            opsRelayStep: 2,
            originalId: step1Id
          }
          window.store.addTransferList([step2])
        })()
      }

      const h2 = history.find(t => t.id === step2Id)
      if (!h2) return window.store.transferHistory

      if (h2.error) {
        ref.stop()
        cleanupTemp(tempPath)
        cleanupTemp(tempPath + '.plain')
        cleanupTemp(tempPath + '.enc.json')
        finish(opsTaskStatus.failed, h2.errorMessage || 'relay upload failed')
        return window.store.transferHistory
      }

      if (h2.finishTime || h2.isDone) {
        ref.stop()
        cleanupTemp(tempPath)
        cleanupTemp(tempPath + '.plain')
        cleanupTemp(tempPath + '.enc.json')
        state.progress = 100
        finish(opsTaskStatus.completed)
      } else {
        state.progress = 50 + Math.min(50, (Number(h2.percent) || 0) * 0.5)
        emit()
      }
      return window.store.transferHistory
    })
    ref.start()
  }

  // probe direct first
  ;(async () => {
    const direct = await tryDirectTransfer({
      sourceTabId,
      targetHost,
      targetUser,
      targetPort,
      fromPath,
      toPath
    })
    if (direct.ok) {
      state.mode = 'direct'
      state.progress = 100
      finish(opsTaskStatus.completed)
      return
    }
    state.mode = 'relay'
    state.error = ''
    emit()
    runRelay()
  })()

  return {
    id,
    getState: () => ({ ...state }),
    abort: () => {
      finish(opsTaskStatus.aborted, 'aborted')
    }
  }
}

function cleanupTemp (tempPath) {
  try {
    window.fs?.rm?.(tempPath).catch?.(() => {})
    window.pre?.runGlobalAsync?.('rmrf', tempPath).catch?.(() => {})
  } catch (e) {
    // ignore cleanup errors — best effort delete after transfer
  }
}
