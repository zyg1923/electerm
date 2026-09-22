/**
 * Machine health collector via SSH readonly commands
 */

import { execCmd } from '../terminal/terminal-apis'

async function run (tabId, cmd, timeoutMs = 20000) {
  try {
    const r = await execCmd(tabId, cmd, timeoutMs, { silent: true })
    const code = typeof r?.code === 'number' ? r.code : 0
    return {
      ok: code === 0,
      out: (r?.stdout || r?.out || '').trim(),
      err: r?.stderr || ''
    }
  } catch (e) {
    return { ok: false, out: '', err: e.message || String(e) }
  }
}

function parseLoad (uptimeOut) {
  const m = uptimeOut.match(/load average[s]?:?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (!m) return { load1: 0, load5: 0, load15: 0 }
  return { load1: +m[1], load5: +m[2], load15: +m[3] }
}

function parseMem (freeOut) {
  const lines = freeOut.split('\n')
  const mem = lines.find(l => /^Mem:/.test(l))
  const swap = lines.find(l => /^Swap:/.test(l))
  const parse = (line) => {
    if (!line) return {}
    const p = line.trim().split(/\s+/)
    return {
      total: p[1],
      used: p[2],
      free: p[3],
      shared: p[4],
      buffCache: p[5],
      available: p[6] || p[3]
    }
  }
  return { mem: parse(mem), swap: parse(swap) }
}

function parseDf (dfOut) {
  const rows = []
  for (const line of dfOut.split('\n').slice(1)) {
    const p = line.trim().split(/\s+/)
    if (p.length < 6) continue
    const use = parseInt(p[p.length - 2], 10)
    rows.push({
      filesystem: p[0],
      size: p[1],
      used: p[2],
      avail: p[3],
      usePercent: Number.isFinite(use) ? use : 0,
      mount: p[p.length - 1]
    })
  }
  return rows
}

function parseCpuCores (nprocOut) {
  const n = parseInt(nprocOut, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * Health score 0-100 with deductions from spec
 */
export function calcHealthScore (data) {
  let score = 100
  const reasons = []
  const maxDisk = Math.max(0, ...(data.disks || []).map(d => d.usePercent || 0))
  if (maxDisk > 90) {
    score -= 40
    reasons.push('disk>90%')
  } else if (maxDisk > 80) {
    score -= 20
    reasons.push('disk>80%')
  }

  const cores = data.cores || 1
  const load1 = data.load?.load1 || 0
  if (load1 > cores * 2) {
    score -= 40
    reasons.push('load>2*cores')
  } else if (load1 > cores) {
    score -= 25
    reasons.push('load>cores')
  }

  if (data.failedUnits > 0) {
    score -= 15
    reasons.push('systemd-failed')
  }
  if (data.closeWait > 100) {
    score -= 10
    reasons.push('CLOSE_WAIT')
  }
  if (data.hasOom) {
    score -= 20
    reasons.push('OOM')
  }
  if (data.criticalDown) {
    score -= 30
    reasons.push('service-down')
  }
  if (data.swapActive) {
    score -= 15
    reasons.push('swap-active')
  }

  // available mem rough: if Mem available field looks like small percent
  const avail = data.memAvailablePercent
  if (typeof avail === 'number' && avail < 10) {
    score -= 20
    reasons.push('mem-available<10%')
  }

  score = Math.max(0, Math.min(100, score))
  const level = score >= 90 ? 'green' : score >= 70 ? 'yellow' : 'red'
  return { score, level, reasons, maxDisk }
}

export async function collectMachineStatus (tab, options = {}) {
  const tabId = tab.id || tab.tabId
  const [
    hostname,
    uptime,
    nproc,
    free,
    df,
    uname,
    failed,
    closeWait,
    oom,
    sshd
  ] = await Promise.all([
    run(tabId, 'hostname'),
    run(tabId, 'uptime'),
    run(tabId, 'nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo'),
    run(tabId, 'free -h'),
    run(tabId, 'df -h -x tmpfs -x devtmpfs 2>/dev/null || df -h'),
    run(tabId, 'cat /etc/os-release 2>/dev/null | head -5; uname -r'),
    run(tabId, 'systemctl --failed --no-legend 2>/dev/null | wc -l'),
    run(tabId, "ss -ant 2>/dev/null | awk '/CLOSE-WAIT/{c++} END{print c+0}'"),
    run(tabId, "dmesg -T 2>/dev/null | grep -i 'out of memory\\|killed process' | tail -1"),
    run(tabId, 'systemctl is-active sshd 2>/dev/null || systemctl is-active ssh 2>/dev/null || echo unknown')
  ])

  const cores = parseCpuCores(nproc.out)
  const load = parseLoad(uptime.out)
  const mem = parseMem(free.out)
  const disks = parseDf(df.out)
  const failedUnits = parseInt(failed.out, 10) || 0
  const cw = parseInt(closeWait.out, 10) || 0
  const hasOom = !!(oom.out && oom.out.length > 2)
  const criticalDown = sshd.out && !/active|unknown/.test(sshd.out)
  const swapActive = !!(mem.swap?.used && mem.swap.used !== '0' && mem.swap.used !== '0B')

  // rough available percent from free -m if needed
  let memAvailablePercent
  const freeM = await run(tabId, 'free -m | awk \'/Mem:/{printf "%.1f", $7/$2*100}\'')
  if (freeM.ok) memAvailablePercent = parseFloat(freeM.out)

  const cpu = await run(tabId, "top -bn1 | grep -E '^%Cpu|^CPU' | head -1")
  let cpuPercent = 0
  const idleM = (cpu.out || '').match(/(\d+[.,]\d+)\s*id/)
  if (idleM) cpuPercent = Math.max(0, 100 - parseFloat(idleM[1].replace(',', '.')))

  const data = {
    tabId,
    title: tab.title || hostname.out || tabId,
    host: tab.host || '',
    hostname: hostname.out || '',
    os: uname.out || '',
    uptime: uptime.out || '',
    cores,
    load,
    mem,
    disks,
    failedUnits,
    closeWait: cw,
    hasOom,
    criticalDown,
    swapActive,
    memAvailablePercent,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    collectedAt: Date.now(),
    error: [hostname, uptime, free, df].every(x => !x.ok) ? 'collect failed' : ''
  }
  const health = calcHealthScore(data)
  return { ...data, ...health }
}

export async function collectMany (tabs, { concurrency = 3, onOne } = {}) {
  const list = [...tabs]
  const results = []
  let i = 0
  async function worker () {
    while (i < list.length) {
      const idx = i++
      const tab = list[idx]
      try {
        const r = await collectMachineStatus(tab)
        results[idx] = r
        onOne?.(r)
      } catch (e) {
        results[idx] = {
          tabId: tab.id,
          title: tab.title,
          host: tab.host,
          score: 0,
          level: 'red',
          error: e.message,
          collectedAt: Date.now()
        }
        onOne?.(results[idx])
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()))
  return results.filter(Boolean)
}
