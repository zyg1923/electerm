/**
 * curl ↔ form ↔ OkHttp (Java) converters.
 * OkHttp reverse-parse is best-effort for common Request.Builder patterns only.
 */

export const CURL_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']

function shellSingle (s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function unquote (s) {
  const t = String(s ?? '').trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"')
  }
  return t
}

/**
 * Split curl command into argv-like tokens (handles quotes).
 */
export function tokenizeCurl (input) {
  const s = String(input || '').replace(/\\\r?\n/g, ' ').trim()
  const tokens = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === '\\' && i + 1 < s.length) {
        cur += s[++i]
        continue
      }
      if (ch === quote) {
        quote = ''
        continue
      }
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

function emptyForm () {
  return {
    url: '',
    method: 'GET',
    headers: [],
    body: '',
    bodyType: 'raw',
    timeout: 30,
    followRedirect: true
  }
}

/**
 * Parse curl command → form fields.
 */
export function parseCurlCommand (input) {
  const form = emptyForm()
  const tokens = tokenizeCurl(input)
  if (!tokens.length) {
    throw new Error('空命令')
  }
  let i = 0
  if (/^curl(\.exe)?$/i.test(tokens[0])) {
    i = 1
  }
  const dataParts = []
  let dataIsForm = false
  while (i < tokens.length) {
    const t = tokens[i]
    const next = () => {
      i++
      if (i >= tokens.length) throw new Error('参数不完整: ' + t)
      return tokens[i]
    }
    if (t === '-X' || t === '--request') {
      form.method = String(next()).toUpperCase()
    } else if (t === '-H' || t === '--header') {
      const hv = next()
      const idx = hv.indexOf(':')
      if (idx > 0) {
        form.headers.push({
          key: hv.slice(0, idx).trim(),
          value: hv.slice(idx + 1).trim()
        })
      }
    } else if (t === '-L' || t === '--location') {
      form.followRedirect = true
    } else if (t === '--max-time' || t === '-m') {
      form.timeout = Number(next()) || 30
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
      dataParts.push(next())
      if (form.method === 'GET') form.method = 'POST'
    } else if (t === '--data-urlencode') {
      dataParts.push(next())
      dataIsForm = true
      if (form.method === 'GET') form.method = 'POST'
    } else if (t === '-A' || t === '--user-agent') {
      form.headers.push({ key: 'User-Agent', value: next() })
    } else if (t === '-u' || t === '--user') {
      form.headers.push({ key: 'Authorization', value: 'Basic ' + next() })
    } else if (t === '-e' || t === '--referer') {
      form.headers.push({ key: 'Referer', value: next() })
    } else if (t.startsWith('-') && t.includes('L')) {
      // combined short flags like -sL
      if (t.includes('L')) form.followRedirect = true
    } else if (t.startsWith('-')) {
      // skip unknown flags; consume value if looks like --long=val already handled
      if (/^--[^=]+=/.test(t)) {
        // ignore
      } else if (/^--/.test(t) || /^-[A-Za-z]$/.test(t)) {
        // may have value — peek
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-') && !/^https?:/i.test(tokens[i + 1])) {
          // don't consume URL-looking; for unknown flag with value skip one
          const knownNoVal = ['-I', '-i', '-v', '-s', '-S', '-k', '-f', '-g', '-G', '-N']
          if (!knownNoVal.includes(t) && !t.startsWith('--no-') && t !== '--compressed') {
            i++
          }
        }
      }
    } else if (/^https?:\/\//i.test(t) || (!form.url && t.includes('/'))) {
      form.url = unquote(t)
    }
    i++
  }
  if (dataParts.length) {
    form.body = dataParts.join('\n')
    form.bodyType = dataIsForm ? 'form' : 'raw'
  }
  if (!form.url) {
    throw new Error('未能解析出 URL，请检查 curl 命令')
  }
  return form
}

export function buildCurlCommand ({
  url = '',
  method = 'GET',
  headers = [],
  body = '',
  bodyType = 'raw',
  timeout = 30,
  followRedirect = true
} = {}) {
  const u = String(url || '').trim()
  if (!u) {
    throw new Error('请填写 URL')
  }
  const parts = ['curl']
  const m = String(method || 'GET').toUpperCase()
  if (m !== 'GET') {
    parts.push('-X', m)
  }
  if (followRedirect) {
    parts.push('-L')
  }
  if (timeout) {
    parts.push('--max-time', String(Number(timeout) || 30))
  }
  for (const h of headers || []) {
    const k = String(h.key || '').trim()
    if (!k) continue
    const v = String(h.value ?? '')
    parts.push('-H', shellSingle(`${k}: ${v}`))
  }
  if (body && m !== 'GET' && m !== 'HEAD') {
    if (bodyType === 'form') {
      String(body).split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
        parts.push('--data-urlencode', shellSingle(line))
      })
    } else {
      parts.push('--data-binary', shellSingle(body))
    }
  }
  parts.push(shellSingle(u))
  return parts.join(' ')
}

function javaString (s) {
  return JSON.stringify(String(s ?? ''))
}

/**
 * Form → OkHttp Java snippet (common style).
 */
export function buildOkHttpJava ({
  url = '',
  method = 'GET',
  headers = [],
  body = '',
  bodyType = 'raw',
  timeout = 30
} = {}) {
  const u = String(url || '').trim()
  if (!u) {
    throw new Error('请填写 URL')
  }
  const m = String(method || 'GET').toUpperCase()
  const lines = []
  lines.push('OkHttpClient client = new OkHttpClient.Builder()')
  lines.push(`    .connectTimeout(${Number(timeout) || 30}, TimeUnit.SECONDS)`)
  lines.push(`    .readTimeout(${Number(timeout) || 30}, TimeUnit.SECONDS)`)
  lines.push('    .build();')
  lines.push('')

  let mediaType = 'text/plain; charset=utf-8'
  const ct = (headers || []).find(h => /^content-type$/i.test(h.key))
  if (ct?.value) mediaType = ct.value
  else if (bodyType === 'form') mediaType = 'application/x-www-form-urlencoded'

  const hasBody = body && m !== 'GET' && m !== 'HEAD'
  if (hasBody) {
    const payload = bodyType === 'form'
      ? String(body).split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('&')
      : body
    lines.push(`MediaType mediaType = MediaType.parse(${javaString(mediaType)});`)
    lines.push(`RequestBody body = RequestBody.create(mediaType, ${javaString(payload)});`)
    lines.push('')
  }

  lines.push('Request.Builder rb = new Request.Builder()')
  lines.push(`    .url(${javaString(u)});`)
  for (const h of headers || []) {
    const k = String(h.key || '').trim()
    if (!k) continue
    if (/^content-type$/i.test(k) && hasBody) continue
    lines.push(`rb.addHeader(${javaString(k)}, ${javaString(h.value ?? '')});`)
  }

  if (hasBody) {
    if (m === 'POST') lines.push('rb.post(body);')
    else if (m === 'PUT') lines.push('rb.put(body);')
    else if (m === 'PATCH') lines.push('rb.patch(body);')
    else if (m === 'DELETE') lines.push('rb.delete(body);')
    else lines.push(`rb.method(${javaString(m)}, body);`)
  } else if (m === 'DELETE') {
    lines.push('rb.delete();')
  } else if (m !== 'GET' && m !== 'HEAD') {
    lines.push(`rb.method(${javaString(m)}, null);`)
  } else if (m === 'HEAD') {
    lines.push('rb.head();')
  }

  lines.push('Request request = rb.build();')
  lines.push('')
  lines.push('try (Response response = client.newCall(request).execute()) {')
  lines.push('    if (!response.isSuccessful()) throw new IOException("Unexpected code " + response);')
  lines.push('    System.out.println(response.body() != null ? response.body().string() : "");')
  lines.push('}')
  return lines.join('\n')
}

/**
 * Best-effort OkHttp Java → form.
 * Supports common patterns:
 *   .url("...") / .url('...')
 *   .addHeader("k", "v") / .header(...)
 *   .get() .post(body) .put .patch .delete .head .method("POST", body)
 *   RequestBody.create(..., "payload") / create("payload", mediaType)
 */
export function parseOkHttpJava (input) {
  const src = String(input || '')
  if (!/Request\.Builder|OkHttpClient|\.url\s*\(/i.test(src)) {
    throw new Error('未识别为 OkHttp 代码（需含 Request.Builder / .url(...)）')
  }
  const form = emptyForm()

  const urlM = src.match(/\.url\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/)
  if (urlM) {
    form.url = unquote(urlM[1])
  }

  const headerRe = /\.(?:addHeader|header)\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/g
  let hm
  while ((hm = headerRe.exec(src))) {
    form.headers.push({ key: unquote(hm[1]), value: unquote(hm[2]) })
  }

  if (/\.post\s*\(/i.test(src)) form.method = 'POST'
  else if (/\.put\s*\(/i.test(src)) form.method = 'PUT'
  else if (/\.patch\s*\(/i.test(src)) form.method = 'PATCH'
  else if (/\.delete\s*\(/i.test(src)) form.method = 'DELETE'
  else if (/\.head\s*\(/i.test(src)) form.method = 'HEAD'
  else if (/\.get\s*\(/i.test(src)) form.method = 'GET'

  const methodM = src.match(/\.method\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/)
  if (methodM) {
    form.method = unquote(methodM[1]).toUpperCase()
  }

  // RequestBody.create(mediaType, "body") or create("body", mediaType)
  const bodyM = src.match(/RequestBody\.create\s*\(\s*[^,]+,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/) ||
    src.match(/RequestBody\.create\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,/)
  if (bodyM) {
    form.body = unquote(bodyM[1])
    if (/x-www-form-urlencoded/i.test(src)) {
      form.bodyType = 'form'
      form.body = form.body.split('&').join('\n')
    }
  }

  const timeoutM = src.match(/(?:connectTimeout|readTimeout|callTimeout)\s*\(\s*(\d+)/)
  if (timeoutM) {
    form.timeout = Number(timeoutM[1]) || 30
  }

  if (!form.url) {
    throw new Error('未能从 OkHttp 代码解析出 URL（请使用 .url("https://...")）')
  }
  return form
}

/**
 * OkHttp Java → curl string (via form).
 */
export function okHttpToCurl (input) {
  const form = parseOkHttpJava(input)
  return {
    form,
    curl: buildCurlCommand(form)
  }
}

/**
 * curl → OkHttp Java (via form).
 */
export function curlToOkHttp (input) {
  const form = parseCurlCommand(input)
  return {
    form,
    okhttp: buildOkHttpJava(form)
  }
}
