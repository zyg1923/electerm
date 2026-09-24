/**
 * Playbook (macro) runner — sequential steps with retry / continue / stop.
 * Step types: code | command
 */

import uid from '../../common/uid'
import { execCmd } from '../terminal/terminal-apis'
import { runCodeOnTab } from './code-node-engine'

export const STEP_ON_FAIL = [
  { value: 'stop', label: '失败则停止' },
  { value: 'continue', label: '忽略错误继续' },
  { value: 'retry', label: '失败重试' }
]

export function createEmptyPlaybook () {
  return {
    id: uid(),
    name: '未命名剧本',
    description: '',
    steps: [
      createEmptyStep(1)
    ],
    updatedAt: Date.now()
  }
}

export function createEmptyStep (index = 1) {
  return {
    id: uid(),
    name: `步骤 ${index}`,
    type: 'code',
    language: 'shell',
    code: 'echo "{\\"ok\\": true}"',
    command: '',
    params: {},
    tabId: '', // empty = use runner's selected tab for this step
    onFail: 'stop',
    retries: 1,
    timeoutMs: 60000
  }
}

function resolveTabId (step, defaultTabId, tabIds) {
  if (step.tabId && (window.store?.tabs || []).some(t => t.id === step.tabId)) {
    return step.tabId
  }
  if (defaultTabId) {
    return defaultTabId
  }
  return (tabIds && tabIds[0]) || ''
}

async function runCommandStep (tabId, command, timeoutMs) {
  const started = Date.now()
  const tab = (window.store?.tabs || []).find(t => t.id === tabId) || {}
  let rawStdout = ''
  let rawStderr = ''
  let exitCode = 0
  try {
    const r = await execCmd(tabId, command, timeoutMs || 60000, { silent: true })
    rawStdout = String(r?.stdout || r?.out || '')
    rawStderr = String(r?.stderr || r?.err || '')
    exitCode = Number(r?.code ?? 0)
  } catch (err) {
    rawStderr = String(err?.message || err || '')
    exitCode = 1
  }
  return {
    success: exitCode === 0,
    exit_code: exitCode,
    language: 'command',
    execution_time_ms: Date.now() - started,
    output: { text: rawStdout.trim() },
    raw_stdout: rawStdout,
    raw_stderr: rawStderr,
    host: tab.host || '',
    work_dir: '',
    executed_at: new Date().toISOString(),
    tabId
  }
}

/**
 * Run a playbook.
 * @param {object} playbook
 * @param {{ tabIds?: string[], defaultTabId?: string, onStep?: Function }} opts
 */
export async function runPlaybook (playbook, opts = {}) {
  const {
    tabIds = [],
    defaultTabId = '',
    onStep
  } = opts
  const steps = playbook?.steps || []
  const runId = `pb_${Date.now()}`
  const stepResults = {}
  let stepOutput = {}
  const timeline = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const tabId = resolveTabId(step, defaultTabId, tabIds)
    if (!tabId) {
      const fail = {
        stepId: step.id,
        name: step.name,
        success: false,
        error: '未选择执行机器',
        result: null
      }
      timeline.push(fail)
      onStep?.(fail, i)
      if (step.onFail !== 'continue') {
        break
      }
      continue
    }

    const maxTry = step.onFail === 'retry'
      ? Math.max(1, Number(step.retries) || 1) + 1
      : 1
    let last = null
    let ok = false

    for (let attempt = 1; attempt <= maxTry; attempt++) {
      onStep?.({
        stepId: step.id,
        name: step.name,
        status: 'running',
        attempt,
        index: i
      }, i)

      if (step.type === 'command') {
        last = await runCommandStep(tabId, step.command, step.timeoutMs)
      } else {
        last = await runCodeOnTab({
          tabId,
          language: step.language || 'shell',
          code: step.code || '',
          params: step.params || {},
          stepOutput,
          steps: stepResults,
          timeoutMs: step.timeoutMs || 60000
        })
      }

      ok = !!last.success
      if (ok) break
    }

    const key = `step_${i + 1}`
    stepResults[key] = { output: last?.output || {}, success: ok, host: last?.host }
    if (ok && last?.output && typeof last.output === 'object') {
      stepOutput = { ...stepOutput, ...last.output }
    }

    const entry = {
      stepId: step.id,
      name: step.name,
      index: i,
      success: ok,
      result: last,
      status: ok ? 'done' : 'error'
    }
    timeline.push(entry)
    onStep?.(entry, i)

    if (!ok && step.onFail !== 'continue') {
      break
    }
  }

  const success = timeline.length === steps.length && timeline.every(t => t.success)
  window.store?.addOpsAuditLog?.({
    action: 'playbook-run',
    detail: {
      playbookId: playbook.id,
      name: playbook.name,
      success,
      steps: timeline.length
    }
  })

  return {
    runId,
    playbookId: playbook.id,
    success,
    timeline,
    step_output: stepOutput,
    steps: stepResults,
    executed_at: new Date().toISOString()
  }
}

export function listPlaybooks () {
  return Array.isArray(window.store?.opsPlaybooks) ? window.store.opsPlaybooks : []
}

export function savePlaybook (pb) {
  const store = window.store
  if (!store) return pb
  const list = Array.isArray(store.opsPlaybooks) ? store.opsPlaybooks.slice() : []
  const idx = list.findIndex(x => x.id === pb.id)
  const next = { ...pb, updatedAt: Date.now() }
  if (idx >= 0) list[idx] = next
  else list.unshift(next)
  store.opsPlaybooks = list
  return next
}

export function removePlaybook (id) {
  const store = window.store
  if (!store) return
  store.opsPlaybooks = (store.opsPlaybooks || []).filter(x => x.id !== id)
}
