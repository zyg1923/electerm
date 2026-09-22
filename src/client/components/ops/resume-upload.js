/**
 * Byte-level append upload with rate limit (local -> remote via SSH)
 */

import { BandwidthGate } from './bandwidth-gate'
import { execCmd } from '../terminal/terminal-apis'

function q (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

function openAsync (path) {
  return new Promise((resolve, reject) => {
    window.fs.open(path, 'r', (err, fd) => err ? reject(err) : resolve(fd))
  })
}

function readAsync (fd, length, position) {
  return new Promise((resolve, reject) => {
    const arr = new Uint8Array(length)
    window.fs.read(fd, arr, 0, length, position, (err, n, buf) => {
      if (err) reject(err)
      else resolve({ n, buf })
    })
  })
}

function closeAsync (fd) {
  return new Promise((resolve) => {
    try {
      window.fs.close?.(fd, () => resolve())
      resolve()
    } catch (e) {
      resolve()
    }
  })
}

function statSize (path) {
  return window.fs.statCustom?.(path).then(s => s.size || 0).catch(() => 0)
}

export async function remotePartSize (tabId, partPath) {
  const r = await execCmd(tabId, `stat -c%s ${q(partPath)} 2>/dev/null || echo 0`, 15000)
  return parseInt((r?.stdout || r?.out || '0').trim(), 10) || 0
}

/**
 * Upload local file to remote .part with resume + bandwidth gate.
 * @returns {{ ok, transferred, total, error }}
 */
export async function resumeUploadLocalToRemote ({
  tabId,
  localPath,
  remotePartPath,
  hostBandwidth = 0,
  totalBandwidth = 0,
  onProgress,
  shouldAbort
}) {
  const total = await statSize(localPath)
  if (!total) {
    return { ok: false, transferred: 0, total: 0, error: 'local file empty/missing' }
  }
  let offset = await remotePartSize(tabId, remotePartPath)
  if (offset > total) {
    // corrupt part — restart
    await execCmd(tabId, `rm -f ${q(remotePartPath)}`, 10000)
    offset = 0
  }
  if (offset === total) {
    onProgress?.({ transferred: total, total })
    return { ok: true, transferred: total, total }
  }

  // ensure parent dir
  const parent = remotePartPath.replace(/\/[^/]+$/, '')
  if (parent) await execCmd(tabId, `mkdir -p ${q(parent)}`, 10000)

  const gate = new BandwidthGate({ hostLimit: hostBandwidth, totalLimit: totalBandwidth })
  const CHUNK = 256 * 1024
  let fd
  try {
    fd = await openAsync(localPath)
    while (offset < total) {
      if (shouldAbort?.()) {
        return { ok: false, transferred: offset, total, error: 'aborted' }
      }
      const len = Math.min(CHUNK, total - offset)
      await gate.take(tabId, len)
      const { n, buf } = await readAsync(fd, len, offset)
      if (!n) break
      const slice = buf.slice(0, n)
      const b64 = window.fs.encodeUint8Array(slice)
      const r = await execCmd(
        tabId,
        `echo '${b64}' | base64 -d >> ${q(remotePartPath)}`,
        60000
      )
      if ((r?.code ?? 0) !== 0) {
        return { ok: false, transferred: offset, total, error: r?.stderr || 'append failed' }
      }
      offset += n
      onProgress?.({ transferred: offset, total })
    }
    return { ok: offset >= total, transferred: offset, total }
  } catch (e) {
    return { ok: false, transferred: offset, total, error: e.message || String(e) }
  } finally {
    if (fd != null) await closeAsync(fd)
  }
}

export async function finalizePart (tabId, partPath, finalPath) {
  const r = await execCmd(
    tabId,
    `mv -f ${q(partPath)} ${q(finalPath)} && echo OK`,
    30000
  )
  return (r?.stdout || r?.out || '').includes('OK')
}
