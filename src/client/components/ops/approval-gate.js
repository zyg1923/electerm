/**
 * Approval gate: match danger patterns + whitelist
 */

import {
  defaultDangerPatterns
} from '../../common/ops-constants'

export function buildDefaultRules () {
  return defaultDangerPatterns.map((r, i) => ({
    id: 'rule-default-' + i,
    name: r.name,
    pattern: r.pattern,
    severity: r.severity,
    requireApproval: true,
    enabled: true
  }))
}

/**
 * @param {string} command
 * @param {{ rules?: array, whitelist?: array, hostIds?: string[], userId?: string, templateId?: string }} ctx
 */
export function checkCommandNeedsApproval (command, ctx = {}) {
  const cmd = (command || '').trim()
  if (!cmd) {
    return { needsApproval: false, matchedRules: [] }
  }

  const whitelist = ctx.whitelist || []
  const hostIds = ctx.hostIds || []

  for (const w of whitelist) {
    if (!w) continue
    if (w.type === 'host' && hostIds.includes(w.refId)) {
      return { needsApproval: false, matchedRules: [], skippedBy: 'whitelist-host' }
    }
    if (w.type === 'group' && (ctx.groupIds || []).includes(w.refId)) {
      return { needsApproval: false, matchedRules: [], skippedBy: 'whitelist-group' }
    }
    if (w.type === 'commandTemplate' && w.refId && ctx.templateId === w.refId) {
      return { needsApproval: false, matchedRules: [], skippedBy: 'whitelist-template' }
    }
    if (w.type === 'user' && w.refId && ctx.userId === w.refId) {
      return { needsApproval: false, matchedRules: [], skippedBy: 'whitelist-user' }
    }
    if (w.type === 'commandTemplate' && w.pattern) {
      try {
        if (new RegExp(w.pattern, 'i').test(cmd)) {
          return { needsApproval: false, matchedRules: [], skippedBy: 'whitelist-pattern' }
        }
      } catch (e) {
        // ignore bad regex
      }
    }
  }

  const rules = (ctx.rules || []).filter(r => r && r.enabled !== false && r.requireApproval !== false)
  const matchedRules = []
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, 'i')
      if (re.test(cmd)) {
        matchedRules.push(rule)
      }
    } catch (e) {
      // ignore bad regex
    }
  }

  return {
    needsApproval: matchedRules.length > 0,
    matchedRules
  }
}
