/**
 * rsync command builder + dry-run helper (remote via SSH exec).
 */

export function buildRsyncCommand ({
  srcHost = '',
  srcPath = '',
  destHost = '',
  destPath = '',
  excludes = '',
  bwlimit = '',
  compress = true,
  incremental = true,
  dryRun = false,
  deleteExtra = false,
  sshPort = 22
} = {}) {
  const src = String(srcPath || '').trim()
  const dest = String(destPath || '').trim()
  if (!src || !dest) {
    throw new Error('请填写源路径和目标路径')
  }
  const flags = ['-a']
  if (incremental) flags.push('--partial', '--progress')
  if (compress) flags.push('-z')
  if (dryRun) flags.push('-n')
  if (deleteExtra) flags.push('--delete')
  if (bwlimit) flags.push(`--bwlimit=${parseInt(bwlimit, 10) || 0}`)

  const excludeArgs = String(excludes || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(x => `--exclude=${shellSingle(x)}`)

  const srcSpec = srcHost
    ? `${srcHost}:${src}`
    : src
  const destSpec = destHost
    ? `${destHost}:${dest}`
    : dest

  const ssh = Number(sshPort) && Number(sshPort) !== 22
    ? `-e ${shellSingle(`ssh -p ${parseInt(sshPort, 10)}`)}`
    : ''

  return ['rsync', ...flags, ...excludeArgs, ssh, shellSingle(srcSpec), shellSingle(destSpec)]
    .filter(Boolean)
    .join(' ')
}

function shellSingle (s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}
