/**
 * terminal/sftp/serial class
 */

const { existsSync } = require('fs')
const { resolve: pathResolve, delimiter } = require('path')
const { spawn } = require('child_process')
const { TerminalBase } = require('./session-base')
const globalState = require('./global-state')
const { ensureWindowsSudo } = require('./elevate-local')
// const { MockBinding } = require('@serialport/binding-mock')
// MockBinding.createPort('/dev/ROBOT', { echo: true, record: true })

function findWindowsBash () {
  const candidates = [
    process.env.PROGRAMFILES && pathResolve(process.env.PROGRAMFILES, 'Git/bin/bash.exe'),
    process.env['PROGRAMFILES(X86)'] && pathResolve(process.env['PROGRAMFILES(X86)'], 'Git/bin/bash.exe'),
    process.env.LOCALAPPDATA && pathResolve(process.env.LOCALAPPDATA, 'Programs/Git/bin/bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p)) {
      return p
    }
  }
  // PATH lookup
  const pathDirs = String(process.env.PATH || '').split(delimiter)
  for (const dir of pathDirs) {
    const p = pathResolve(dir, 'bash.exe')
    if (existsSync(p)) {
      return p
    }
  }
  return ''
}

function runLocalShellCommand (cmd, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 0 } = options || {}
    const isWin = process.platform === 'win32'
    const env = Object.assign({}, process.env)
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    delete env.NODE_EXTRA_CA_CERTS

    let bin
    let args
    if (isWin) {
      const bash = findWindowsBash()
      if (bash) {
        bin = bash
        args = ['-lc', cmd]
      } else {
        bin = pathResolve(process.env.windir || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
        args = ['-NoProfile', '-NonInteractive', '-Command', cmd]
      }
    } else {
      bin = process.platform === 'darwin' ? '/bin/bash' : '/bin/bash'
      args = ['-lc', cmd]
    }

    const child = spawn(bin, args, {
      env,
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null
    const finish = (exitCode, timedOut) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        timedOut: !!timedOut,
        // compat for callers that read .out / .code
        out: stdout,
        code: typeof exitCode === 'number' ? exitCode : null
      })
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill() } catch (_) {}
        finish(null, true)
      }, timeoutMs)
    }
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => finish(code, false))
  })
}

class TerminalLocal extends TerminalBase {
  async init () {
    const {
      cols,
      rows,
      execWindows,
      execMac,
      execLinux,
      execWindowsArgs,
      execMacArgs,
      execLinuxArgs,
      localAdmin,
      termType,
      term
    } = this.initOptions
    this.isLocal = true
    const { platform } = process
    const isWin = platform.startsWith('win')
    const winExec = execWindows || 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const exec = isWin
      ? pathResolve(
        process.env.windir,
        winExec
      )
      : platform === 'darwin' ? (execMac || 'bash') : (execLinux || 'bash')
    if ((exec || '').includes('..')) {
      return Promise.reject(new Error('execWindows should not contain ".."'))
    }
    const arg = isWin
      ? (execWindowsArgs || [])
      : platform === 'darwin' ? (execMacArgs || []) : (execLinuxArgs || [])
    const cwd = process.env[platform === 'win32' ? 'USERPROFILE' : 'HOME']
    let spawnExec = exec
    let spawnArgv = platform.startsWith('darwin') ? ['--login', ...arg] : arg
    if (isWin && localAdmin) {
      const sudo = pathResolve(process.env.windir, 'System32/sudo.exe')
      if (!existsSync(sudo)) {
        throw new Error('未找到 sudo.exe，无法以管理员身份打开。')
      }
      await ensureWindowsSudo()
      spawnExec = sudo
      spawnArgv = [exec, ...arg]
    }
    const pty = require('node-pty')
    const env = Object.assign({}, process.env)
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    // temp PEM of system CAs for the server process (WebDAV sync, #4347) —
    // not meant for user shells, and a bad keychain cert makes any Node/bun
    // tool in the terminal print "ignoring extra certs ... load failed"
    delete env.NODE_EXTRA_CA_CERTS
    const spawnOpts = {
      name: term,
      encoding: null,
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env
    }
    try {
      // Prefer OpenConsole conpty.dll (avoids legacy console-host stalls).
      this.term = pty.spawn(spawnExec, spawnArgv, {
        ...spawnOpts,
        useConptyDll: true
      })
    } catch (err) {
      // Older Windows / missing conpty.dll: fall back to default conpty.
      this.term = pty.spawn(spawnExec, spawnArgv, spawnOpts)
    }
    this.term.termType = termType
    globalState.setSession(this.pid, this)
    return Promise.resolve(this)
  }

  resize (cols, rows) {
    this.term.resize(cols, rows)
  }

  on (event, cb) {
    this.term.on(event, cb)
  }

  off (event, cb) {
    try {
      if (!this.term) {
        return
      }
      if (typeof this.term.removeListener === 'function') {
        this.term.removeListener(event, cb)
      } else if (typeof this.term.off === 'function') {
        this.term.off(event, cb)
      }
    } catch (_) {
      // ignore removal errors during teardown
    }
  }

  write (data) {
    this.term.write(data)
  }

  kill () {
    if (this.sessionLogger) {
      this.sessionLogger.destroy()
    }
    this.term && this.term.kill()
    this.onEndConn()
  }

  // Ops / archive / monitors call execCommand on the session pid.
  // Local tabs have no SSH exec channel — run via OS shell instead.
  runCmd (cmd) {
    return runLocalShellCommand(cmd).then(r => r.stdout || r.stderr || '')
  }

  execCommand (cmd, options = {}) {
    return runLocalShellCommand(cmd, options)
  }
}

exports.session = function (initOptions, ws) {
  return (new TerminalLocal(initOptions, ws)).init()
}

/**
 * test ssh connection
 * @param {object} options
 */
exports.test = (initOptions) => {
  return Promise.resolve(true)
}
