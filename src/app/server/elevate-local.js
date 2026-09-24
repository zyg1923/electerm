const { spawn, execFileSync } = require('child_process')
const path = require('path')

const sudoKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo'
const powershell = path.join(process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

function readSudoMode () {
  try {
    const out = execFileSync('reg.exe', ['query', sudoKey, '/v', 'Enabled'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const match = out.match(/0x([0-9a-f]+)/i)
    return match ? parseInt(match[1], 16) : 0
  } catch (e) {
    return 0
  }
}

// Windows sudo is off until Developer Settings enables it. Inline mode (3)
// keeps the elevated shell in the current terminal instead of a new window.
function ensureWindowsSudo () {
  if (readSudoMode() === 3) {
    return Promise.resolve()
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Start-Process -FilePath reg.exe -ArgumentList @('add','${sudoKey}','/v','Enabled','/t','REG_DWORD','/d','3','/f') -Verb RunAs -Wait -WindowStyle Hidden`
  ].join('; ')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-EncodedCommand', encoded], {
      windowsHide: true
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (readSudoMode() === 3) {
        resolve()
        return
      }
      reject(new Error(code
        ? '已取消管理员授权'
        : '没能打开系统的管理员终端功能'))
    })
  })
}

module.exports = {
  ensureWindowsSudo,
  readSudoMode
}
