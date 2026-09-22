/**
 * Docker ops via SSH
 */

import { execCmd } from '../terminal/terminal-apis'

async function run (tabId, cmd, timeoutMs = 30000) {
  try {
    const r = await execCmd(tabId, cmd, timeoutMs)
    const code = typeof r?.exitCode === 'number'
      ? r.exitCode
      : (typeof r?.code === 'number' ? r.code : 0)
    const out = (r?.stdout || r?.out || '').trim()
    const err = (r?.stderr || '').trim()
    return {
      ok: code === 0 && !r?.timedOut,
      out: out || err,
      err,
      code,
      timedOut: !!r?.timedOut
    }
  } catch (e) {
    return { ok: false, out: '', err: e.message, code: -1 }
  }
}

export function quoteName (name) {
  return String(name || '').replace(/'/g, `'\\''`)
}

export function classifyContainer (state, status) {
  const st = String(state || '').toLowerCase()
  const su = String(status || '')
  const exit = su.match(/Exited \((\d+)\)/i)
  const exitCode = exit ? Number(exit[1]) : null
  if (st === 'restarting' || /restarting/i.test(su)) {
    return { level: 'restarting', rank: 0, abnormal: true, exitCode }
  }
  if (st === 'exited' || st === 'dead' || exit) {
    const bad = exitCode == null || exitCode !== 0 || st === 'dead'
    return {
      level: bad ? 'exited-bad' : 'exited',
      rank: bad ? 1 : 3,
      abnormal: bad,
      exitCode
    }
  }
  if (st === 'running' || /^up\b/i.test(su)) {
    return { level: 'running', rank: 2, abnormal: false, exitCode }
  }
  return { level: 'other', rank: 4, abnormal: false, exitCode }
}

function mapPsItem (item) {
  const id = String(item.ID || item.Id || item.id || '').trim()
  const name = String(item.Names || item.Name || item.name || '').replace(/^\//, '').trim()
  const image = String(item.Image || item.image || '').trim()
  const status = String(item.Status || item.status || '').trim()
  const state = String(item.State || item.state || '').trim()
  const ports = String(item.Ports || item.ports || '').trim()
  const created = String(item.CreatedAt || item.created || '').trim()
  const cls = classifyContainer(state, status)
  return {
    id,
    name,
    image,
    status,
    state,
    ports,
    created,
    ...cls
  }
}

function parseDockerPsTsv (text) {
  const rows = []
  for (const line of (text || '').split('\n')) {
    if (!line.trim() || line.startsWith('CONTAINER')) continue
    const [id, name, image, status, ports, created] = line.split('\t')
    if (!id) continue
    rows.push(mapPsItem({
      ID: id,
      Names: name,
      Image: image,
      Status: status,
      Ports: ports,
      CreatedAt: created
    }))
  }
  return rows
}

export function parseDockerPs (text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  let items = []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      items = Array.isArray(parsed) ? parsed : []
    } catch (e) {
      items = []
    }
  } else if (raw.startsWith('{')) {
    for (const line of raw.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('{')) continue
      try {
        items.push(JSON.parse(s))
      } catch (e) {
        // skip broken line
      }
    }
  }
  if (items.length) {
    return items.map(mapPsItem).filter(c => c.id || c.name)
  }
  return parseDockerPsTsv(raw)
}

export async function listContainers (tab) {
  const tabId = tab.id
  const r = await run(tabId, "docker ps -a --format '{{json .}}'")
  const blob = r.out || r.err
  if (!r.ok && /not found|Cannot connect|permission denied/i.test(blob)) {
    return { tabId, title: tab.title, host: tab.host, containers: [], error: blob || 'docker unavailable' }
  }
  return {
    tabId,
    title: tab.title,
    host: tab.host,
    containers: parseDockerPs(r.ok ? r.out : ''),
    error: r.ok ? '' : (r.err || r.out)
  }
}

export async function listContainersMany (tabs, concurrency = 3) {
  const list = tabs || []
  const results = new Array(list.length)
  let cursor = 0
  const n = Math.max(1, Math.min(concurrency, list.length || 1))
  async function worker () {
    while (cursor < list.length) {
      const idx = cursor
      cursor += 1
      results[idx] = await listContainers(list[idx])
    }
  }
  if (!list.length) return []
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

export async function dockerAction (tabId, action, name) {
  const allowed = ['start', 'stop', 'restart', 'rm']
  if (!allowed.includes(action)) {
    throw new Error('action not allowed')
  }
  const safe = quoteName(name)
  const real = action === 'rm' ? `docker rm -f '${safe}'` : `docker ${action} '${safe}'`
  return run(tabId, real, action === 'restart' ? 120000 : 60000)
}

export function summarizeInspect (obj) {
  const state = obj?.State || {}
  const ports = []
  const bindings = {
    ...(obj?.NetworkSettings?.Ports || {}),
    ...(obj?.HostConfig?.PortBindings || {})
  }
  for (const [key, value] of Object.entries(bindings)) {
    if (!Array.isArray(value)) continue
    for (const bind of value) {
      if (!bind) continue
      const host = [bind.HostIp, bind.HostPort].filter(Boolean).join(':')
      ports.push(host ? `${host}->${key}` : key)
    }
  }
  const mounts = (obj?.Mounts || []).map(m => {
    const from = m.Source || m.Name || ''
    const to = m.Destination || ''
    return from && to ? `${from} -> ${to}` : (to || from)
  }).filter(Boolean)
  return {
    id: obj?.Id || '',
    name: String(obj?.Name || '').replace(/^\//, ''),
    image: obj?.Config?.Image || '',
    status: state.Status || '',
    startedAt: state.StartedAt || '',
    exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : null,
    error: state.Error || '',
    health: state.Health?.Status || '',
    restartCount: obj?.RestartCount ?? state.RestartCount ?? 0,
    ports: [...new Set(ports)],
    mounts,
    env: Array.isArray(obj?.Config?.Env) ? obj.Config.Env : []
  }
}

export async function dockerInspect (tabId, name) {
  const safe = quoteName(name)
  const r = await run(tabId, `docker inspect --format '{{json .}}' '${safe}'`, 20000)
  if (!r.ok) {
    return { ok: false, error: r.err || r.out || 'inspect failed' }
  }
  try {
    return { ok: true, ...summarizeInspect(JSON.parse(r.out)) }
  } catch (e) {
    return { ok: false, error: 'inspect 结果无法解析' }
  }
}

export async function dockerStats (tabId, name) {
  const safe = quoteName(name)
  const r = await run(tabId, `docker stats --no-stream --format '{{json .}}' '${safe}'`, 20000)
  if (!r.ok) return { ok: false, error: r.err || r.out }
  try {
    const o = JSON.parse(r.out)
    return {
      ok: true,
      cpu: o.CPUPerc || '',
      mem: o.MemUsage || '',
      memPerc: o.MemPerc || '',
      net: o.NetIO || '',
      pids: o.PIDs || ''
    }
  } catch (e) {
    return { ok: false, error: r.out || 'stats 无法解析' }
  }
}

export async function restartContainer (tabId, name) {
  const before = await dockerInspect(tabId, name)
  const act = await dockerAction(tabId, 'restart', name)
  const after = await dockerInspect(tabId, name)
  const running = after.ok && after.status === 'running'
  const unhealthy = after.health === 'unhealthy'
  const ok = act.ok && running && !unhealthy
  const err = !act.ok
    ? (act.err || act.out)
    : (!running ? `重启后状态为 ${after.status || 'unknown'}` : (unhealthy ? '健康检查 unhealthy' : (after.error || '')))
  return { ok, before, after, out: act.out, err }
}

export function lastLogTimestamp (text) {
  const lines = String(text || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/)
    if (m) return m[1]
  }
  return ''
}

export async function dockerLogs (tabId, name, linesOrOpts = 200) {
  const opts = typeof linesOrOpts === 'number' ? { lines: linesOrOpts } : (linesOrOpts || {})
  const safe = quoteName(name)
  const since = opts.since ? String(opts.since).replace(/[^0-9A-Za-z:.\-+TZ]/g, '') : ''
  const lines = parseInt(opts.lines, 10) || 200
  const sinceArg = since ? `--since '${since}' ` : ''
  const tailArg = since && !opts.withTail ? '' : `--tail ${lines} `
  return run(tabId, `docker logs --timestamps ${tailArg}${sinceArg}'${safe}' 2>&1`, 60000)
}

export async function listImages (tab) {
  const r = await run(tab.id, "docker images --format '{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}'")
  const images = []
  for (const line of (r.out || '').split('\n')) {
    if (!line.trim()) continue
    const [repository, tag, id, size, created] = line.split('\t')
    images.push({ repository, tag, id, size, created, dangling: repository === '<none>' })
  }
  return { tabId: tab.id, title: tab.title, images, error: r.ok ? '' : r.err }
}

export async function dockerPull (tabId, image) {
  const safe = String(image).replace(/'/g, `'\\''`)
  return run(tabId, `docker pull '${safe}'`, 600000)
}

export async function dockerPublish ({
  tabId,
  container,
  newImage,
  healthUrl = '',
  healthPort = ''
}) {
  const name = String(container).replace(/'/g, `'\\''`)
  const img = String(newImage).replace(/'/g, `'\\''`)
  // record previous image for rollback
  const prev = await run(tabId, `docker inspect -f '{{.Config.Image}}' '${name}'`)
  const prevImage = (prev.out || '').trim()
  const steps = []
  steps.push(await run(tabId, `docker pull '${img}'`, 600000))
  if (!steps[0].ok) return { ok: false, steps, prevImage, error: 'pull failed' }
  steps.push(await run(tabId, `docker rename '${name}' '${name}_old_${Date.now()}' 2>/dev/null || true`))
  // recreate: stop old, run new with same name if possible — simplified: update by recreate
  const create = await run(
    tabId,
    `OLD=$(docker ps -aqf name='^${name}_old'); ` +
    `docker stop '${name}' 2>/dev/null; docker rm '${name}' 2>/dev/null; ` +
    `docker run -d --name '${name}' '${img}'`,
    120000
  )
  steps.push(create)
  if (!create.ok) {
    return { ok: false, steps, prevImage, error: 'run failed' }
  }
  let healthOk = true
  if (healthPort) {
    const h = await run(tabId, `for i in 1 2 3 4 5; do nc -z 127.0.0.1 ${parseInt(healthPort, 10)} && exit 0; sleep 1; done; exit 1`, 30000)
    healthOk = h.ok
  }
  if (healthUrl) {
    const h = await run(tabId, `curl -fsS -o /dev/null -w '%{http_code}' '${healthUrl.replace(/'/g, `'\\''`)}' | grep -E '200|301|302'`, 30000)
    healthOk = healthOk && h.ok
  }
  return { ok: create.ok && healthOk, steps, prevImage, healthOk }
}

export async function dockerRollback (tabId, container, prevImage) {
  const name = String(container).replace(/'/g, `'\\''`)
  const img = String(prevImage).replace(/'/g, `'\\''`)
  await run(tabId, `docker stop '${name}'; docker rm '${name}'`, 60000)
  return run(tabId, `docker run -d --name '${name}' '${img}'`, 120000)
}

export async function listCompose (tab) {
  const r = await run(tab.id, 'docker compose ls --format json 2>/dev/null || docker-compose ls 2>/dev/null || echo []')
  let projects = []
  try {
    projects = JSON.parse(r.out || '[]')
  } catch (e) {
    projects = []
  }
  return { tabId: tab.id, title: tab.title, projects, error: r.ok ? '' : r.err }
}

export async function composeAction (tabId, projectDir, action) {
  const dir = String(projectDir).replace(/'/g, `'\\''`)
  const allowed = ['up', 'down', 'restart', 'ps']
  if (!allowed.includes(action)) throw new Error('bad action')
  const cmd = action === 'up'
    ? `cd '${dir}' && (docker compose up -d || docker-compose up -d)`
    : `cd '${dir}' && (docker compose ${action} || docker-compose ${action})`
  return run(tabId, cmd, 180000)
}

export async function dockerDiagnose (tab) {
  const tabId = tab.id
  const [ps, df, dangling, oom] = await Promise.all([
    listContainers(tab),
    run(tabId, "df -h /var/lib/docker 2>/dev/null | awk 'NR==2{print $5}'"),
    run(tabId, "docker images -f dangling=true -q | wc -l"),
    run(tabId, "docker ps -a --filter 'status=exited' --format '{{.Names}} {{.Status}}' | head -20")
  ])
  const restarting = (ps.containers || []).filter(c => /Restarting/i.test(c.status))
  const abnormal = (ps.containers || []).filter(c => c.abnormal)
  const diskUse = parseInt(String(df.out || '').replace('%', ''), 10) || 0
  const danglingCount = parseInt(dangling.out, 10) || 0
  const tips = []
  if (restarting.length) tips.push({ level: 'danger', msg: `重启循环容器 ${restarting.length} 个`, action: '检查日志并修复配置' })
  if (diskUse > 80) tips.push({ level: 'warn', msg: `/var/lib/docker 占用 ${diskUse}%`, action: '清理无用镜像/卷' })
  if (danglingCount > 0) tips.push({ level: 'info', msg: `悬空镜像 ${danglingCount}`, action: 'docker image prune' })
  if (abnormal.length) tips.push({ level: 'warn', msg: `异常退出容器 ${abnormal.length}`, action: '查看 exit code' })
  return {
    tabId,
    title: tab.title,
    restarting,
    abnormal,
    diskUse,
    danglingCount,
    exited: oom.out,
    tips
  }
}
