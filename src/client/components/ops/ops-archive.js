/**
 * Shared archive (compress / extract) command builders for Ops + SFTP.
 * Formats assume a Unix-like remote (SSH). 7z is optional when binary exists.
 *
 * Password:
 * - zip / 7z: native password
 * - tar.*: openssl AES-256-CBC wrap (output *.enc)
 */

export const ARCHIVE_FORMATS = [
  {
    id: 'tar.gz',
    label: 'tar.gz',
    ext: '.tar.gz',
    compressFlag: '-czf',
    extractFlag: '-xzf',
    bin: 'tar',
    passwordMode: 'openssl'
  },
  {
    id: 'tar.bz2',
    label: 'tar.bz2',
    ext: '.tar.bz2',
    compressFlag: '-cjf',
    extractFlag: '-xjf',
    bin: 'tar',
    passwordMode: 'openssl'
  },
  {
    id: 'tar.xz',
    label: 'tar.xz',
    ext: '.tar.xz',
    compressFlag: '-cJf',
    extractFlag: '-xJf',
    bin: 'tar',
    passwordMode: 'openssl'
  },
  {
    id: 'zip',
    label: 'zip',
    ext: '.zip',
    bin: 'zip',
    passwordMode: 'native'
  },
  {
    id: '7z',
    label: '7z',
    ext: '.7z',
    bin: '7z',
    optional: true,
    passwordMode: 'native'
  }
]

export function shQuote (s) {
  return `'${String(s == null ? '' : s).replace(/'/g, `'\\''`)}'`
}

/** Escape for use inside double-quoted shell / env assignment. */
export function shDoubleQuote (s) {
  return `"${String(s == null ? '' : s).replace(/([\\"`$])/g, '\\$1').replace(/\n/g, ' ')}"`
}

export function parsePathList (value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean)
  }
  return String(value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function joinPathList (paths) {
  return (paths || []).filter(Boolean).join('\n')
}

export function basenameOf (p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || 'archive'
}

export function dirnameOf (p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i <= 0) {
    return s.startsWith('/') ? '/' : '.'
  }
  return s.slice(0, i) || '/'
}

export function detectFormatFromName (name) {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.tar.gz.enc') || n.endsWith('.tgz.enc')) return 'tar.gz'
  if (n.endsWith('.tar.bz2.enc') || n.endsWith('.tbz2.enc')) return 'tar.bz2'
  if (n.endsWith('.tar.xz.enc') || n.endsWith('.txz.enc')) return 'tar.xz'
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return 'tar.gz'
  if (n.endsWith('.tar.bz2') || n.endsWith('.tbz2')) return 'tar.bz2'
  if (n.endsWith('.tar.xz') || n.endsWith('.txz')) return 'tar.xz'
  if (n.endsWith('.zip')) return 'zip'
  if (n.endsWith('.7z')) return '7z'
  return ''
}

export function formatSupportsPassword (fmt) {
  const f = ARCHIVE_FORMATS.find(x => x.id === fmt)
  return !!(f && f.passwordMode)
}

export function passwordHint (fmt) {
  const f = ARCHIVE_FORMATS.find(x => x.id === fmt)
  if (!f) return ''
  if (f.passwordMode === 'native') {
    return fmt === '7z'
      ? '7z 原生加密（含文件名加密）'
      : 'zip 传统密码（兼容性好，安全性一般）'
  }
  if (f.passwordMode === 'openssl') {
    return 'tar 无原生密码：将用 openssl AES-256 加密，生成 .enc 文件'
  }
  return ''
}

export function defaultArchiveName (sources, fmt, password) {
  const format = ARCHIVE_FORMATS.find(f => f.id === fmt) || ARCHIVE_FORMATS[0]
  const paths = parsePathList(sources)
  const base = paths.length === 1
    ? basenameOf(paths[0])
    : `archive-${Date.now()}`
  const clean = base.replace(/\.(tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|txz|zip|7z)(\.enc)?$/i, '')
  let name = clean + format.ext
  if (password && format.passwordMode === 'openssl' && !name.endsWith('.enc')) {
    name += '.enc'
  }
  return name
}

export function resolveArchiveOutPath ({ sources, destDir, archiveName, fmt, password }) {
  const paths = parsePathList(sources)
  const name = (archiveName || defaultArchiveName(paths, fmt, password)).trim()
  const format = ARCHIVE_FORMATS.find(f => f.id === fmt) || ARCHIVE_FORMATS[0]
  let withExt = name
  if (!withExt.endsWith(format.ext) && !withExt.endsWith(format.ext + '.enc')) {
    withExt = withExt + format.ext
  }
  if (password && format.passwordMode === 'openssl' && !withExt.endsWith('.enc')) {
    withExt += '.enc'
  }
  if (/^[\\/]/.test(withExt) || /^[a-zA-Z]:[\\/]/.test(withExt)) {
    return withExt
  }
  const dir = (destDir || (paths[0] ? dirnameOf(paths[0]) : '.')).replace(/[\\/]+$/, '') || '.'
  return `${dir}/${withExt}`
}

function excludeArgs (excludes, fmt) {
  const list = parsePathList(excludes)
  if (!list.length) {
    return ''
  }
  if (fmt === 'zip') {
    return ' ' + list.map(x => `-x ${shQuote(x)}`).join(' ')
  }
  if (fmt === '7z') {
    return ' ' + list.map(x => `-xr!${x.replace(/'/g, '')}`).join(' ')
  }
  return ' ' + list.map(x => `--exclude=${shQuote(x)}`).join(' ')
}

function maskPasswordInCmd (cmd, password) {
  if (!password) return cmd
  const esc = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return cmd
    .replace(new RegExp(esc, 'g'), '******')
    .replace(/-P\s*'[^']*'/g, "-P '******'")
    .replace(/-P\s*"[^"]*"/g, '-P "******"')
    .replace(/-p[^\s'"]+/g, '-p******')
    .replace(/pass:[^\s'"]+/g, 'pass:******')
}

/**
 * Build compress command for Unix-like remotes.
 */
export function buildCompressCmd (opts = {}) {
  const sources = parsePathList(opts.sources)
  if (!sources.length) {
    throw new Error('请至少选择一个要压缩的路径')
  }
  const fmt = opts.fmt || 'tar.gz'
  const password = String(opts.password || '')
  const out = resolveArchiveOutPath({
    sources,
    destDir: opts.destDir,
    archiveName: opts.archiveName,
    fmt,
    password
  })
  const srcArgs = sources.map(shQuote).join(' ')
  const ex = excludeArgs(opts.excludes, fmt)
  const progress = opts.withProgress !== false

  if (fmt === 'zip') {
    const pass = password ? ` -P ${shQuote(password)}` : ''
    // -v lists files; runner parses line count for soft progress
    return {
      cmd: `zip -r${pass}${progress ? ' -v' : ''} ${shQuote(out)} ${srcArgs}${ex}`,
      out,
      sources,
      preview: maskPasswordInCmd(
        `zip -r${pass}${progress ? ' -v' : ''} ${shQuote(out)} ${srcArgs}${ex}`,
        password
      ),
      progressKind: 'zip'
    }
  }
  if (fmt === '7z') {
    const pass = password
      ? ` -p${password.replace(/'/g, '')} -mhe=on`
      : ''
    // -bsp1 prints percent to stdout
    return {
      cmd: `7z a -bsp1 -bso0${pass} ${shQuote(out)} ${srcArgs}${ex}`,
      out,
      sources,
      preview: maskPasswordInCmd(
        `7z a -bsp1 -bso0${pass} ${shQuote(out)} ${srcArgs}${ex}`,
        password
      ),
      progressKind: '7z'
    }
  }
  const format = ARCHIVE_FORMATS.find(f => f.id === fmt)
  if (!format || !format.compressFlag) {
    throw new Error('不支持的压缩格式: ' + fmt)
  }
  if (password) {
    // stream tar to openssl encrypted file (.enc)
    const tarFlag = format.compressFlag.replace('f', '') // -cz / -cj / -cJ
    const safe = `ET_ARCH_PASS=${shDoubleQuote(password)} tar ${tarFlag}${ex} -- ${srcArgs} | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:ET_ARCH_PASS -out ${shQuote(out)}; unset ET_ARCH_PASS`
    return {
      cmd: safe,
      out,
      sources,
      preview: maskPasswordInCmd(safe, password),
      progressKind: 'openssl'
    }
  }
  const checkpoint = progress
    ? " --checkpoint=20 --checkpoint-action=ttyout='ARCHIVE_PROGRESS\\n'"
    : ''
  const cmd = `tar ${format.compressFlag} ${shQuote(out)}${ex}${checkpoint} -- ${srcArgs}`
  return {
    cmd,
    out,
    sources,
    preview: cmd,
    progressKind: 'tar'
  }
}

/**
 * Build extract command.
 * conflict: overwrite | skip | rename
 * - overwrite: replace existing files
 * - skip: keep existing files
 * - rename: auto-rename new files (7z); zip/tar fall back to skip
 */
export function buildExtractCmd (opts = {}) {
  const archive = String(opts.archive || '').trim()
  if (!archive) {
    throw new Error('请选择压缩包')
  }
  const fmt = opts.fmt || detectFormatFromName(archive) || 'tar.gz'
  const password = String(opts.password || '')
  const conflict = opts.conflict || 'overwrite'
  const dest = String(opts.destDir || dirnameOf(archive) || '.').trim() || '.'
  const mkdir = `mkdir -p ${shQuote(dest)}`
  const isEnc = /\.enc$/i.test(archive)

  let conflictNote = ''
  if (conflict === 'rename' && fmt !== '7z') {
    conflictNote = '（该格式不支持自动重命名，已按「跳过已有」处理）'
  }

  if (fmt === 'zip') {
    const pass = password ? ` -P ${shQuote(password)}` : ''
    // -o overwrite, -n never overwrite
    const ow = (conflict === 'overwrite') ? ' -o' : ' -n'
    const cmd = `${mkdir} && unzip${ow}${pass} ${shQuote(archive)} -d ${shQuote(dest)}`
    return {
      cmd,
      archive,
      dest,
      out: dest,
      preview: maskPasswordInCmd(cmd, password) + (conflictNote ? `\n# ${conflictNote}` : ''),
      progressKind: 'zip',
      conflict
    }
  }
  if (fmt === '7z') {
    const pass = password ? ` -p${password.replace(/'/g, '')}` : ''
    // -aoa overwrite, -aos skip, -aou auto rename extracting file
    const ao = conflict === 'skip'
      ? ' -aos'
      : (conflict === 'rename' ? ' -aou' : ' -aoa')
    const cmd = `${mkdir} && 7z x -bsp1 -bso0 -y${ao}${pass} ${shQuote(archive)} -o${shQuote(dest)}`
    return {
      cmd,
      archive,
      dest,
      out: dest,
      preview: maskPasswordInCmd(cmd, password),
      progressKind: '7z',
      conflict
    }
  }
  const format = ARCHIVE_FORMATS.find(f => f.id === fmt)
  if (!format || !format.extractFlag) {
    throw new Error('不支持的解压格式: ' + fmt)
  }
  // GNU tar: default overwrites; --keep-old-files refuses to overwrite
  const keep = (conflict === 'overwrite') ? '' : ' --keep-old-files'
  if (password || isEnc) {
    if (!password) {
      throw new Error('该压缩包似乎已加密，请填写密码')
    }
    const tarFlag = format.extractFlag.replace('f', '') // -xz / -xj / -xJ
    const safe = `${mkdir} && ET_ARCH_PASS=${shDoubleQuote(password)} openssl enc -d -aes-256-cbc -pbkdf2 -pass env:ET_ARCH_PASS -in ${shQuote(archive)} | tar ${tarFlag}${keep} - -C ${shQuote(dest)}; unset ET_ARCH_PASS`
    return {
      cmd: safe,
      archive,
      dest,
      out: dest,
      preview: maskPasswordInCmd(safe, password) + (conflictNote ? `\n# ${conflictNote}` : ''),
      progressKind: 'openssl',
      conflict
    }
  }
  const cmd = `${mkdir} && tar ${format.extractFlag}${keep} ${shQuote(archive)} -C ${shQuote(dest)}`
  return {
    cmd,
    archive,
    dest,
    out: dest,
    preview: cmd + (conflictNote ? `\n# ${conflictNote}` : ''),
    progressKind: 'tar',
    conflict
  }
}

export const EXTRACT_CONFLICT_OPTIONS = [
  { value: 'overwrite', label: '覆盖已有文件' },
  { value: 'skip', label: '跳过已有文件' },
  { value: 'rename', label: '自动重命名（仅 7z）' }
]

export function conflictLabel (conflict) {
  return EXTRACT_CONFLICT_OPTIONS.find(o => o.value === conflict)?.label || conflict
}

/**
 * Probe which optional archive tools exist on a host (best-effort).
 */
export async function probeArchiveFormats (execFn) {
  const base = ARCHIVE_FORMATS.filter(f => !f.optional)
  if (typeof execFn !== 'function') {
    return base
  }
  try {
    const r = await execFn('command -v 7z || command -v 7za || true')
    const out = String(r?.stdout || r?.out || '').trim()
    if (out) {
      return ARCHIVE_FORMATS.slice()
    }
  } catch (_) {}
  return base
}

export function buildTrashCmd (paths) {
  const list = parsePathList(paths)
  if (!list.length) {
    throw new Error('请至少选择一个要删除的路径')
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const moves = list.map((p, i) => {
    const base = basenameOf(p)
    const trash = `/tmp/trash/${stamp}_${i}_${base}`
    return `mv ${shQuote(p)} ${shQuote(trash)} && echo MOVED_TO:${trash}`
  })
  return `mkdir -p /tmp/trash && ${moves.join(' && ')}`
}

export function buildChmodCmd (paths, modeStr, recursive) {
  const list = parsePathList(paths)
  if (!list.length) {
    throw new Error('请至少选择一个路径')
  }
  const mode = String(modeStr || '755').replace(/[^0-7]/g, '') || '755'
  const targets = list.map(shQuote).join(' ')
  return `chmod ${recursive ? '-R ' : ''}${mode} ${targets}`
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Run archive command with progress polling (no server streaming required).
 * Writes percent to /tmp/etarch-*.pct and completion to /tmp/etarch-*.done
 *
 * @param {string} tabId
 * @param {{ cmd: string, progressKind?: string }} built
 * @param {(info: { percent: number, log: string, status: string }) => void} onProgress
 * @param {(cmd: string, timeoutMs?: number) => Promise<any>} execFn
 */
export async function runArchiveWithProgress (tabId, built, onProgress, execFn) {
  const exec = execFn
  const job = `etarch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const logFile = `/tmp/${job}.log`
  const doneFile = `/tmp/${job}.done`
  const pctFile = `/tmp/${job}.pct`
  const inner = built.cmd

  const startCmd = `
LOG=${shQuote(logFile)}
DONE=${shQuote(doneFile)}
PCT=${shQuote(pctFile)}
rm -f "$DONE" "$PCT" "$LOG"
(
  set +e
  ${inner} > "$LOG" 2>&1
  ec=$?
  if [ "$ec" = "0" ]; then
    echo 100 > "$PCT"
  else
    last=$(sed -n 's/.*\\([0-9][0-9]*\\)%.*/\\1/p' "$LOG" | tail -1)
    [ -n "$last" ] && echo "$last" > "$PCT"
  fi
  echo "$ec" > "$DONE"
) &
(
  while [ ! -f "$DONE" ]; do
    if [ -f "$LOG" ]; then
      last=$(sed -n 's/.*\\([0-9][0-9]*\\)%.*/\\1/p' "$LOG" | tail -1)
      if [ -n "$last" ]; then
        echo "$last" > "$PCT"
      else
        lines=$(wc -l < "$LOG" 2>/dev/null || echo 0)
        lines=\${lines:-0}
        pct=$(( 5 + (lines * 90) / (lines + 40) ))
        [ "$pct" -gt 95 ] && pct=95
        echo "$pct" > "$PCT"
      fi
    else
      echo 2 > "$PCT"
    fi
    sleep 0.4
  done
) >/dev/null 2>&1 &
echo $!
`.trim()

  const start = await exec(startCmd, 15000)
  const pid = String(start?.stdout || start?.out || '').trim().split(/\n/).pop()
  if (!pid) {
    throw new Error('无法启动压缩/解压任务')
  }

  onProgress?.({ percent: 1, log: '', status: 'running', pid })

  let lastLog = ''
  let percent = 1
  const maxWait = 30 * 60 * 1000
  const began = Date.now()

  while (Date.now() - began < maxWait) {
    await sleep(500)
    const poll = await exec(
      `pct=$(cat ${shQuote(pctFile)} 2>/dev/null || echo 0); done=$(cat ${shQuote(doneFile)} 2>/dev/null || echo ''); log=$(tail -c 4000 ${shQuote(logFile)} 2>/dev/null || true); printf 'PCT:%s\\nDONE:%s\\nLOG:\\n%s' "$pct" "$done" "$log"`,
      10000
    )
    const text = String(poll?.stdout || poll?.out || '')
    const pctMatch = text.match(/PCT:(\d+)/)
    const doneMatch = text.match(/DONE:([^\n]*)/)
    const logIdx = text.indexOf('LOG:\n')
    if (pctMatch) {
      percent = Math.min(99, Math.max(percent, Number(pctMatch[1]) || percent))
    } else if (!doneMatch || doneMatch[1] === '') {
      percent = Math.min(95, percent + 1)
    }
    if (logIdx >= 0) {
      lastLog = text.slice(logIdx + 5)
    }
    const doneVal = doneMatch ? doneMatch[1].trim() : ''
    if (doneVal !== '') {
      const code = Number(doneVal)
      const ok = code === 0
      onProgress?.({
        percent: ok ? 100 : percent,
        log: lastLog,
        status: ok ? 'done' : 'error',
        exitCode: code
      })
      exec(`rm -f ${shQuote(logFile)} ${shQuote(doneFile)} ${shQuote(pctFile)}`, 5000).catch(() => {})
      if (!ok) {
        const errLine = lastLog.trim().split('\n').filter(Boolean).slice(-3).join('\n')
        throw new Error(errLine || `压缩/解压失败 (exit ${code})`)
      }
      return { ok: true, log: lastLog, exitCode: code }
    }
    onProgress?.({ percent, log: lastLog, status: 'running', pid })
  }
  throw new Error('压缩/解压超时')
}

function formatArchiveFromPath (built, mode) {
  if (mode === 'extract') {
    return built.archive || ''
  }
  const sources = built.sources || []
  return sources[0] || ''
}

function formatArchiveFromLabel (built, mode) {
  if (mode === 'extract') {
    return ''
  }
  const sources = built.sources || []
  if (sources.length > 1) {
    return `等${sources.length}个`
  }
  return ''
}

/**
 * Write compress/extract jobs into transferHistory so they show in 传输记录.
 */
export function beginArchiveHistory ({ mode, tabId, built }) {
  const tab = (window.store.tabs || []).find(t => t.id === tabId) || {}
  const isRemote = !!tab.host
  const side = isRemote ? 'remote' : 'local'
  const isCompress = mode === 'compress'
  const fromPath = formatArchiveFromPath(built, mode)
  const fromPathNote = formatArchiveFromLabel(built, mode)
  const toPath = isCompress
    ? (built.out || '')
    : (built.dest || built.out || '')
  const fromName = basenameOf(fromPath) + (fromPathNote ? ` ${fromPathNote}` : '')
  const toName = basenameOf(toPath)
  const machine = isRemote ? (tab.title || tab.host || '远程') : '本机'
  const item = {
    id: `arch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    operation: isCompress ? 'compress' : 'extract',
    archiveOp: true,
    typeFrom: side,
    typeTo: side,
    fromPath,
    fromPathNote,
    fromName,
    toPath,
    toName,
    host: tab.host || '',
    title: tab.title || '',
    tabId,
    tabType: tab.type,
    startTime: Date.now(),
    finishTime: null,
    percent: 1,
    statusText: isCompress ? '压缩中' : '解压中',
    speed: '',
    size: 0,
    transferred: 0,
    error: '',
    sourceMachine: machine,
    targetMachine: machine
  }
  window.store.addTransferHistory?.(item)
  return item.id
}

export function patchArchiveHistory (id, patch) {
  if (!id || !patch) {
    return
  }
  const list = window.store.transferHistory || []
  const idx = list.findIndex(t => t.id === id)
  if (idx < 0) {
    return
  }
  Object.assign(list[idx], patch)
}

export function finishArchiveHistory (id, { ok = true, error = '', percent } = {}) {
  if (!id) {
    return
  }
  patchArchiveHistory(id, {
    finishTime: Date.now(),
    percent: ok ? 100 : (Number(percent) || 0),
    statusText: ok ? '完成' : '错误',
    error: ok ? '' : String(error || '失败')
  })
}