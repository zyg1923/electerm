/**
 * Simple AES-GCM helpers for relay temp files (Web Crypto).
 * Key is session-random, never persisted.
 */

function bufToB64 (buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64ToBuf (b64) {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes.buffer
}

export async function generateRelayKey () {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function encryptBytes (key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = data instanceof ArrayBuffer ? data : await data.arrayBuffer?.() || data
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  return {
    iv: bufToB64(iv.buffer),
    data: bufToB64(cipher)
  }
}

export async function decryptBytes (key, payload) {
  const iv = new Uint8Array(b64ToBuf(payload.iv))
  const data = b64ToBuf(payload.data)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
}

/**
 * Encrypt a local file in-place to .enc sidecar using Node fs via window.fs if available,
 * else mark metadata only (Electron path preferred).
 */
export async function encryptLocalFile (filePath, key) {
  const fs = window.fs
  if (!fs?.readFile || !fs?.writeFile) {
    return { encrypted: false, path: filePath, reason: 'no fs' }
  }
  const raw = await fs.readFile(filePath)
  const buf = raw?.buffer || raw
  const enc = await encryptBytes(key, buf)
  const encPath = filePath + '.enc.json'
  await fs.writeFile(encPath, JSON.stringify(enc))
  try {
    await fs.unlink?.(filePath)
  } catch (e) {}
  return { encrypted: true, path: encPath, plainPath: filePath }
}

export async function decryptLocalFileTo (encPath, outPath, key) {
  const fs = window.fs
  const txt = await fs.readFile(encPath, 'utf8')
  const payload = typeof txt === 'string' ? JSON.parse(txt) : JSON.parse(String(txt))
  const plain = await decryptBytes(key, payload)
  await fs.writeFile(outPath, Buffer.from(plain))
  return outPath
}
