/**
 * Ops Center shared constants
 */

export const opsTaskType = {
  distribute: 'distribute',
  rolling: 'rolling',
  relay: 'relay',
  configDiff: 'configDiff',
  approval: 'approval'
}

export const opsTaskStatus = {
  created: 'created',
  running: 'running',
  paused: 'paused',
  waitingConfirm: 'waiting_confirm',
  completed: 'completed',
  stopped: 'stopped',
  aborted: 'aborted',
  failed: 'failed'
}

export const opsItemStatus = {
  pending: 'pending',
  queued: 'queued',
  running: 'running',
  success: 'success',
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled'
}

export const opsStrategy = {
  parallel: 'parallel',
  rolling: 'rolling'
}

export const opsFailPolicy = {
  stop: 'stop',
  skip: 'skip',
  ask: 'ask'
}

export const opsApprovalStatus = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  timeout: 'timeout',
  cancelled: 'cancelled',
  executed: 'executed',
  execFailed: 'exec_failed'
}

export const opsChecksum = {
  none: 'none',
  md5: 'md5',
  sha1: 'sha1'
}

/** default dangerous command patterns (approval) */
export const defaultDangerPatterns = [
  { name: 'rm -rf', pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)`, severity: 'critical' },
  { name: 'reboot', pattern: String.raw`\breboot\b`, severity: 'danger' },
  { name: 'shutdown', pattern: String.raw`\bshutdown\b`, severity: 'danger' },
  { name: 'mkfs', pattern: String.raw`\bmkfs(\.\w+)?\b`, severity: 'critical' },
  { name: 'dd', pattern: String.raw`\bdd\s+`, severity: 'critical' },
  { name: 'mkfs.ext', pattern: String.raw`\bmkfs\.ext`, severity: 'critical' },
  { name: 'wipefs', pattern: String.raw`\bwipefs\b`, severity: 'critical' },
  { name: 'drop database', pattern: String.raw`\bdrop\s+database\b`, severity: 'danger' },
  { name: 'iptables -F', pattern: String.raw`\biptables\s+-F\b`, severity: 'danger' },
  { name: 'chmod 777', pattern: String.raw`\bchmod\s+(-R\s+)?777\b`, severity: 'warn' }
]

/** clear mark color palette (hex) */
export const clearMarkColors = [
  '#e74c3c',
  '#e67e22',
  '#f1c40f',
  '#2ecc71',
  '#1abc9c',
  '#3498db',
  '#9b59b6',
  '#e91e63'
]

export const opsDbTables = [
  'opsTasks',
  'opsAuditLogs',
  'opsApprovalRequests',
  'opsApprovalRules',
  'opsApprovalWhitelist'
]

export const opsCenterTabs = [
  'distribute',
  'rolling',
  'relay',
  'configDiff',
  'approval',
  'history'
]
