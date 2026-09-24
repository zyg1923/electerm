/**
 * Light-code execution engine (remote SSH via execCmd).
 * Languages: shell / python / javascript(node) / lua
 * Skips: Groovy JVM, local sandbox quotas.
 */

import { execCmd } from '../terminal/terminal-apis'

export const CODE_LANGUAGES = [
  { id: 'shell', label: 'Shell', bin: 'bash', remote: true },
  { id: 'python', label: 'Python', bin: 'python3', remote: true },
  { id: 'javascript', label: 'JavaScript (Node)', bin: 'node', remote: true },
  { id: 'lua', label: 'Lua', bin: 'lua', remote: true }
]

const DANGEROUS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+\/\s|-[a-zA-Z]*rf\b.*\/\s*$)/i,
  /\brm\s+-rf\s+\/\b/i,
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=\s*\/dev\//i,
  /\bdrop\s+(database|table|schema)\b/i,
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwipefs\b|\bshred\b.*\/dev\//i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\b>\s*\/dev\/sd[a-z]/i,
  /\bmkfs\.|fdisk\s+\/dev\//i
]

export function detectDangerousCode (code) {
  const text = String(code || '')
  const hits = []
  for (const re of DANGEROUS) {
    if (re.test(text)) {
      hits.push(re.source.slice(0, 40))
    }
  }
  return hits
}

function shQuote (s) {
  return `'${String(s == null ? '' : s).replace(/'/g, `'\\''`)}'`
}

function toBase64Utf8 (str) {
  try {
    return btoa(unescape(encodeURIComponent(str)))
  } catch (e) {
    // fallback for large / odd strings
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    bytes.forEach(b => { bin += String.fromCharCode(b) })
    return btoa(bin)
  }
}

/**
 * Build ctx object injected into scripts.
 */
export function buildCodeCtx ({ tab, params = {}, stepOutput = {}, steps = {}, workDir } = {}) {
  const host = tab?.host || ''
  const tabs = (window.store?.tabs || []).filter(t => t.host)
  return {
    work_dir: workDir || tab?.startDirectory || (host ? '~' : '.'),
    host,
    hosts: tabs.map(t => ({
      ip: t.host,
      port: Number(t.port) || 22,
      title: t.title || t.host,
      tabId: t.id
    })),
    env: {},
    params: params || {},
    step_output: stepOutput || {},
    steps: steps || {},
    connection: {
      type: host ? 'ssh' : 'local',
      user: tab?.username || tab?.user || '',
      key_path: tab?.privateKeyPath || ''
    }
  }
}

function wrapPython (userCode) {
  return `import json, os, sys
_ctx_path = os.environ.get('ET_CTX_FILE', '')
with open(_ctx_path, 'r', encoding='utf-8') as _f:
    ctx = json.load(_f)
os.chdir(ctx.get('work_dir') or '.')
${userCode}
`
}

function wrapJavascript (userCode) {
  return `const fs = require('fs');
const ctx = JSON.parse(fs.readFileSync(process.env.ET_CTX_FILE, 'utf8'));
try { process.chdir(ctx.work_dir || '.'); } catch (e) {}
${userCode}
`
}

function wrapLua (userCode, ctx) {
  // Serialize ctx as a Lua literal (no external JSON lib required)
  const luaVal = (v, depth = 0) => {
    if (v === null || v === undefined) return 'nil'
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (typeof v === 'string') {
      return `[[${String(v).replace(/\]\]/g, ']].."]]"..[[')}]]`
    }
    if (Array.isArray(v)) {
      return '{' + v.map(x => luaVal(x, depth + 1)).join(',') + '}'
    }
    if (typeof v === 'object') {
      return '{' + Object.keys(v).map(k =>
        `["${String(k).replace(/"/g, '\\"')}"]=${luaVal(v[k], depth + 1)}`
      ).join(',') + '}'
    }
    return 'nil'
  }
  return `ctx = ${luaVal(ctx)}
if ctx.work_dir and ctx.work_dir ~= '' then
  pcall(function() os.execute('cd ' .. tostring(ctx.work_dir)) end)
end
${userCode}
`
}

function substituteShell (template, ctx) {
  let s = String(template || '')
  s = s.replace(/\{\{work_dir\}\}/g, ctx.work_dir || '.')
  s = s.replace(/\{\{host\}\}/g, ctx.host || '')
  s = s.replace(/\{\{params\.([a-zA-Z0-9_]+)\}\}/g, (_, k) => {
    const v = ctx.params?.[k]
    return v == null ? '' : String(v)
  })
  s = s.replace(/\{\{step_output\.([a-zA-Z0-9_]+)\}\}/g, (_, k) => {
    const v = ctx.step_output?.[k]
    return v == null ? '' : String(v)
  })
  return s
}

/**
 * Try parse last JSON object from stdout; else wrap as { text }.
 */
export function parseCodeOutput (rawStdout) {
  const text = String(rawStdout || '').trim()
  if (!text) {
    return {}
  }
  // Prefer last JSON object/array line
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if ((line.startsWith('{') && line.endsWith('}')) ||
      (line.startsWith('[') && line.endsWith(']'))) {
      try {
        return JSON.parse(line)
      } catch (_) {}
    }
  }
  // Whole stdout as JSON
  if ((text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return JSON.parse(text)
    } catch (_) {}
  }
  return { text }
}

function languageRunner (language) {
  const id = language === 'js' || language === 'node' ? 'javascript' : language
  return CODE_LANGUAGES.find(l => l.id === id) || CODE_LANGUAGES[0]
}

async function runLocalProcess (cmd) {
  const fs = window.fs
  if (!fs) {
    throw new Error('本地 fs 不可用')
  }
  try {
    if (window.pre?.isWin && fs.runWinCmd) {
      const r = await fs.runWinCmd(cmd.replace(/"/g, '`"'))
      const stdout = String(r?.stdout || r || '')
      const stderr = String(r?.stderr || '')
      return { stdout, stderr, code: stderr && !stdout ? 1 : 0 }
    }
    const out = await fs.run(cmd)
    return { stdout: String(out || ''), stderr: '', code: 0 }
  } catch (e) {
    return { stdout: '', stderr: String(e?.message || e || ''), code: 1 }
  }
}

/**
 * Local execution (本机 Shell/Python/Node). Uses window.fs.run / Git Bash.
 */
async function runCodeLocal ({ language, code, ctx, timeoutMs }) {
  void timeoutMs
  const ctxJson = JSON.stringify(ctx)
  if (language === 'shell') {
    const body = substituteShell(code, ctx)
    // Write via bash heredoc-ish using echo base64
    const b64 = toBase64Utf8(body)
    const cmd = `export ET_CTX='${ctxJson.replace(/'/g, `'\\''`)}'; echo ${shQuote(b64)} | base64 -d | bash`
    const r = await runLocalProcess(cmd)
    return {
      success: r.code === 0 && !r.stderr.trim(),
      exit_code: r.code,
      output: parseCodeOutput(r.stdout),
      raw_stdout: r.stdout,
      raw_stderr: r.stderr
    }
  }
  if (language === 'python') {
    const wrapped = wrapPython(code)
    const b64 = toBase64Utf8(wrapped)
    const ctxB64 = toBase64Utf8(ctxJson)
    const cmd = `
TMPDIR=$(mktemp -d 2>/dev/null || mktemp -d -t etcode)
echo ${shQuote(ctxB64)} | base64 -d > "$TMPDIR/ctx.json"
echo ${shQuote(b64)} | base64 -d > "$TMPDIR/run.py"
export ET_CTX_FILE="$TMPDIR/ctx.json"
(python3 "$TMPDIR/run.py" || python "$TMPDIR/run.py")
ec=$?
rm -rf "$TMPDIR"
exit $ec
`.trim()
    const r = await runLocalProcess(cmd)
    return {
      success: r.code === 0,
      exit_code: r.code,
      output: parseCodeOutput(r.stdout),
      raw_stdout: r.stdout,
      raw_stderr: r.stderr
    }
  }
  if (language === 'javascript') {
    const wrapped = wrapJavascript(code)
    const b64 = toBase64Utf8(wrapped)
    const ctxB64 = toBase64Utf8(ctxJson)
    const cmd = `
TMPDIR=$(mktemp -d 2>/dev/null || mktemp -d -t etcode)
echo ${shQuote(ctxB64)} | base64 -d > "$TMPDIR/ctx.json"
echo ${shQuote(b64)} | base64 -d > "$TMPDIR/run.js"
export ET_CTX_FILE="$TMPDIR/ctx.json"
node "$TMPDIR/run.js"
ec=$?
rm -rf "$TMPDIR"
exit $ec
`.trim()
    const r = await runLocalProcess(cmd)
    return {
      success: r.code === 0,
      exit_code: r.code,
      output: parseCodeOutput(r.stdout),
      raw_stdout: r.stdout,
      raw_stderr: r.stderr
    }
  }
  return {
    success: false,
    exit_code: -1,
    output: {},
    raw_stdout: '',
    raw_stderr: '本地暂不支持该语言，请改用远程执行: ' + language
  }
}

/**
 * Execute code on one tab (remote) or on local machine.
 * @returns unified result JSON
 */
export async function runCodeOnTab ({
  tabId,
  language = 'shell',
  code = '',
  params = {},
  stepOutput = {},
  steps = {},
  workDir,
  timeoutMs = 60000,
  skipDangerCheck = false,
  execTarget = 'remote'
} = {}) {
  const started = Date.now()
  const lang = languageRunner(language)
  const tab = (window.store?.tabs || []).find(t => t.id === tabId) || { id: tabId }
  const ctx = buildCodeCtx({ tab, params, stepOutput, steps, workDir })
  const dangers = skipDangerCheck ? [] : detectDangerousCode(code)
  if (dangers.length) {
    return {
      success: false,
      exit_code: -1,
      language: lang.id,
      execution_time_ms: Date.now() - started,
      output: {},
      raw_stdout: '',
      raw_stderr: '危险命令被拦截: ' + dangers.join(', '),
      host: ctx.host,
      work_dir: ctx.work_dir,
      executed_at: new Date().toISOString(),
      blocked: true
    }
  }

  if (execTarget === 'local') {
    const localResult = await runCodeLocal({
      language: lang.id,
      code,
      ctx,
      timeoutMs
    })
    const result = {
      ...localResult,
      language: lang.id,
      execution_time_ms: Date.now() - started,
      host: 'local',
      work_dir: ctx.work_dir,
      executed_at: new Date().toISOString(),
      tabId: tabId || 'local',
      exec_target: 'local'
    }
    try {
      const { setCache } = await import('./ops-cache')
      setCache(result.tabId || 'local', 'codeNodeResult', result)
    } catch (_) {}
    window.store?.addOpsAuditLog?.({
      action: 'code-node-run',
      detail: { language: lang.id, host: 'local', success: result.success }
    })
    return result
  }

  if (!tabId) {
    return {
      success: false,
      exit_code: -1,
      language: lang.id,
      execution_time_ms: Date.now() - started,
      output: {},
      raw_stdout: '',
      raw_stderr: '未选择远程标签',
      host: '',
      work_dir: ctx.work_dir,
      executed_at: new Date().toISOString()
    }
  }

  const job = `etcode_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ctxFile = `/tmp/${job}.ctx.json`
  const scriptFile = `/tmp/${job}.script`
  const ctxJson = JSON.stringify(ctx)
  const ctxB64 = toBase64Utf8(ctxJson)

  let remoteCmd = ''
  if (lang.id === 'shell') {
    const body = substituteShell(code, ctx)
    const bodyB64 = toBase64Utf8(body)
    remoteCmd = `
set -e
CTX=${shQuote(ctxFile)}
SCR=${shQuote(scriptFile)}
echo ${shQuote(ctxB64)} | base64 -d > "$CTX"
echo ${shQuote(bodyB64)} | base64 -d > "$SCR"
export ET_CTX_FILE="$CTX"
cd ${shQuote(ctx.work_dir || '.')} 2>/dev/null || true
bash "$SCR"
ec=$?
rm -f "$CTX" "$SCR"
exit $ec
`.trim()
  } else if (lang.id === 'python') {
    const wrapped = wrapPython(code)
    const bodyB64 = toBase64Utf8(wrapped)
    remoteCmd = `
set -e
CTX=${shQuote(ctxFile)}
SCR=${shQuote(scriptFile + '.py')}
echo ${shQuote(ctxB64)} | base64 -d > "$CTX"
echo ${shQuote(bodyB64)} | base64 -d > "$SCR"
export ET_CTX_FILE="$CTX"
BIN=$(command -v python3 || command -v python || true)
if [ -z "$BIN" ]; then echo 'python3 not found' >&2; exit 127; fi
"$BIN" "$SCR"
ec=$?
rm -f "$CTX" "$SCR"
exit $ec
`.trim()
  } else if (lang.id === 'javascript') {
    const wrapped = wrapJavascript(code)
    const bodyB64 = toBase64Utf8(wrapped)
    remoteCmd = `
set -e
CTX=${shQuote(ctxFile)}
SCR=${shQuote(scriptFile + '.js')}
echo ${shQuote(ctxB64)} | base64 -d > "$CTX"
echo ${shQuote(bodyB64)} | base64 -d > "$SCR"
export ET_CTX_FILE="$CTX"
BIN=$(command -v node || true)
if [ -z "$BIN" ]; then echo 'node not found' >&2; exit 127; fi
"$BIN" "$SCR"
ec=$?
rm -f "$CTX" "$SCR"
exit $ec
`.trim()
  } else if (lang.id === 'lua') {
    const wrapped = wrapLua(code, ctx)
    const bodyB64 = toBase64Utf8(wrapped)
    remoteCmd = `
set -e
SCR=${shQuote(scriptFile + '.lua')}
echo ${shQuote(bodyB64)} | base64 -d > "$SCR"
BIN=$(command -v lua || command -v lua5.3 || command -v lua5.4 || true)
if [ -z "$BIN" ]; then echo 'lua not found' >&2; exit 127; fi
"$BIN" "$SCR"
ec=$?
rm -f "$SCR"
exit $ec
`.trim()
  } else {
    return {
      success: false,
      exit_code: -1,
      language: lang.id,
      execution_time_ms: 0,
      output: {},
      raw_stdout: '',
      raw_stderr: '不支持的语言: ' + language,
      host: ctx.host,
      work_dir: ctx.work_dir,
      executed_at: new Date().toISOString()
    }
  }

  let rawStdout = ''
  let rawStderr = ''
  let exitCode = 0
  try {
    const r = await execCmd(tabId, remoteCmd, timeoutMs, { silent: true })
    rawStdout = String(r?.stdout || r?.out || '')
    rawStderr = String(r?.stderr || r?.err || '')
    exitCode = Number(r?.code ?? 0)
  } catch (err) {
    rawStderr = String(err?.message || err || '')
    exitCode = 1
  }

  const output = parseCodeOutput(rawStdout)
  const success = exitCode === 0 && !rawStderr.trim()
  const result = {
    success,
    exit_code: exitCode,
    language: lang.id,
    execution_time_ms: Date.now() - started,
    output,
    raw_stdout: rawStdout,
    raw_stderr: rawStderr,
    host: ctx.host,
    work_dir: ctx.work_dir,
    executed_at: new Date().toISOString(),
    tabId,
    exec_target: 'remote'
  }

  try {
    const { setCache } = await import('./ops-cache')
    setCache(tabId || ctx.host || 'remote', 'codeNodeResult', result)
  } catch (_) {}

  window.store?.addOpsAuditLog?.({
    action: 'code-node-run',
    detail: {
      language: lang.id,
      host: ctx.host,
      success,
      exit_code: exitCode
    }
  })

  return result
}

/**
 * Batch run same code on multiple tabs.
 */
export async function runCodeBatch ({
  tabIds = [],
  concurrency = 3,
  onProgress,
  ...opts
} = {}) {
  const ids = tabIds.filter(Boolean)
  const results = []
  let success = 0
  let failed = 0
  let cursor = 0

  async function worker () {
    while (cursor < ids.length) {
      const i = cursor++
      const tabId = ids[i]
      const r = await runCodeOnTab({ ...opts, tabId })
      results[i] = {
        host: r.host,
        tabId,
        success: r.success,
        exit_code: r.exit_code,
        output: r.output,
        raw_stderr: r.raw_stderr,
        raw_stdout: r.raw_stdout,
        execution_time_ms: r.execution_time_ms
      }
      if (r.success) success++
      else failed++
      onProgress?.({
        done: success + failed,
        total: ids.length,
        current: results[i]
      })
    }
  }

  const n = Math.max(1, Math.min(concurrency, ids.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))

  const batch = {
    batch_id: `batch_${Date.now()}`,
    total: ids.length,
    success,
    failed,
    results,
    executed_at: new Date().toISOString()
  }
  try {
    const { setCache } = await import('./ops-cache')
    setCache(batch.batch_id, 'codeNodeBatch', batch)
  } catch (_) {}
  return batch
}

/** Export batch results as CSV string */
export function exportBatchCsv (batch) {
  const rows = batch?.results || []
  const header = 'host,tabId,success,exit_code,output,error,time_ms'
  const esc = (v) => {
    const s = v == null ? '' : String(v).replace(/"/g, '""')
    return `"${s}"`
  }
  const lines = rows.map(r => [
    esc(r.host),
    esc(r.tabId),
    esc(r.success),
    esc(r.exit_code),
    esc(JSON.stringify(r.output || {})),
    esc(r.raw_stderr),
    esc(r.execution_time_ms)
  ].join(','))
  return [header, ...lines].join('\n')
}

export function downloadTextFile (filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/**
 * Re-run only failed hosts from a previous batch.
 */
export async function retryFailedBatch (batch, opts = {}) {
  const failedIds = (batch?.results || []).filter(r => !r.success).map(r => r.tabId).filter(Boolean)
  if (!failedIds.length) {
    return { ...batch, retried: false, message: '没有失败项' }
  }
  const next = await runCodeBatch({
    ...opts,
    tabIds: failedIds
  })
  const byTab = new Map((batch.results || []).map(r => [r.tabId, r]))
  for (const r of next.results || []) {
    byTab.set(r.tabId, r)
  }
  const merged = [...byTab.values()]
  return {
    batch_id: `batch_retry_${Date.now()}`,
    total: merged.length,
    success: merged.filter(r => r.success).length,
    failed: merged.filter(r => !r.success).length,
    results: merged,
    executed_at: new Date().toISOString(),
    retried: true
  }
}

export const CODE_PRESETS = [
  {
    id: 'preset-http-health',
    name: 'HTTP 健康检查',
    language: 'python',
    desc: '请求 params.url，返回状态码',
    params: [
      { key: 'url', label: 'URL', default: 'http://127.0.0.1:8080/health', required: true },
      { key: 'timeout', label: '超时秒', default: '5', required: false }
    ],
    code: `import json, urllib.request
url = ctx["params"].get("url") or "http://127.0.0.1/"
timeout = float(ctx["params"].get("timeout") or 5)
try:
    r = urllib.request.urlopen(url, timeout=timeout)
    body = r.read(200).decode("utf-8", "ignore")
    print(json.dumps({"status": r.status, "body": body}))
except Exception as e:
    print(json.dumps({"status": "error", "error": str(e)}))
`
  },
  {
    id: 'preset-disk',
    name: '磁盘使用',
    language: 'shell',
    desc: 'df -h 根分区',
    params: [],
    code: `df -h / | tail -1 | awk '{print "{\\"filesystem\\":\\""$1"\\",\\"size\\":\\""$2"\\",\\"used\\":\\""$3"\\",\\"avail\\":\\""$4"\\",\\"use_pct\\":\\""$5"\\"}"}'`
  },
  {
    id: 'preset-port',
    name: '端口连通性',
    language: 'shell',
    desc: '检测本机端口是否监听',
    params: [
      { key: 'port', label: '端口', default: '8080', required: true }
    ],
    code: `PORT="{{params.port}}"
if (command -v ss >/dev/null && ss -lnt | grep -q ":$PORT ") || (command -v netstat >/dev/null && netstat -lnt 2>/dev/null | grep -q ":$PORT "); then
  echo "{\\"port\\": $PORT, \\"listening\\": true}"
else
  echo "{\\"port\\": $PORT, \\"listening\\": false}"
fi`
  },
  {
    id: 'preset-process',
    name: '进程存活',
    language: 'shell',
    desc: '按名称查进程',
    params: [
      { key: 'name', label: '进程名', default: 'nginx', required: true }
    ],
    code: `NAME="{{params.name}}"
N=$(pgrep -af "$NAME" 2>/dev/null | grep -v pgrep | wc -l)
echo "{\\"name\\": \\"$NAME\\", \\"count\\": $N, \\"alive\\": $( [ "$N" -gt 0 ] && echo true || echo false )}"`
  },
  {
    id: 'preset-log-error',
    name: '日志错误统计',
    language: 'shell',
    desc: '统计日志中 error/exception 行数',
    params: [
      { key: 'path', label: '日志路径', default: '/var/log/syslog', required: true },
      { key: 'lines', label: '扫描行数', default: '5000', required: false }
    ],
    code: `P="{{params.path}}"
N="{{params.lines}}"
N=\${N:-5000}
ERR=$(tail -n "$N" "$P" 2>/dev/null | grep -iE 'error|exception|fatal' | wc -l)
echo "{\\"path\\": \\"$P\\", \\"scanned\\": $N, \\"error_lines\\": $ERR}"`
  },
  {
    id: 'preset-disk-clean',
    name: '磁盘检查+清理预览',
    language: 'shell',
    desc: '看磁盘并列出大日志(不删除)',
    params: [
      { key: 'path', label: '扫描目录', default: '/var/log', required: true }
    ],
    code: `P="{{params.path}}"
USE=$(df -h / | tail -1 | awk '{print $5}')
BIG=$(find "$P" -type f -name '*.log' -size +50M 2>/dev/null | head -20 | tr '\\n' ';' )
echo "{\\"root_use\\": \\"$USE\\", \\"big_logs\\": \\"$BIG\\"}"`
  },
  {
    id: 'preset-config-backup',
    name: '配置文件备份',
    language: 'shell',
    desc: '复制文件到 /tmp/backup-时间戳',
    params: [
      { key: 'path', label: '配置路径', default: '/etc/nginx/nginx.conf', required: true }
    ],
    code: `P="{{params.path}}"
TS=$(date +%Y%m%d_%H%M%S)
D="/tmp/backup-$TS"
mkdir -p "$D"
cp -a "$P" "$D/" && echo "{\\"ok\\": true, \\"backup\\": \\"$D\\", \\"src\\": \\"$P\\"}" || echo "{\\"ok\\": false}"`
  },
  {
    id: 'preset-service',
    name: '服务启停',
    language: 'shell',
    desc: 'systemctl start/stop/restart/status',
    params: [
      { key: 'name', label: '服务名', default: 'nginx', required: true },
      { key: 'action', label: '动作', default: 'status', required: true }
    ],
    code: `NAME="{{params.name}}"
ACT="{{params.action}}"
case "$ACT" in start|stop|restart|status|reload) ;; *) ACT=status ;; esac
OUT=$(systemctl "$ACT" "$NAME" 2>&1 | tail -5 | tr '\\n' ' ')
ACTIVE=$(systemctl is-active "$NAME" 2>/dev/null || echo unknown)
echo "{\\"service\\": \\"$NAME\\", \\"action\\": \\"$ACT\\", \\"active\\": \\"$ACTIVE\\", \\"out\\": \\"$OUT\\"}"`
  }
]
