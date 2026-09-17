/**
 * on close app
 */

const { dbAction } = require('./db')
const log = require('../common/log')
const globalState = require('./glob-state')
const { destroyTray, hideWindow } = require('./tray')

exports.getExitStatus = async () => {
  const res = await dbAction('data', 'findOne', {
    _id: 'exitStatus'
  })
  return res && res.value ? res.value : ''
}

exports.onClose = async function (e) {
  if (!globalState.get('willQuit')) {
    e.preventDefault()
    hideWindow()
    return
  }
  const config = globalState.get('config')
  if (config.confirmBeforeExit && globalState.get('closeAction')) {
    const win = globalState.get('win')
    win?.webContents.send(
      'confirm-exit',
      globalState.get('closeAction')
    )
    globalState.set('closeAction', '')
    globalState.set('willQuit', false)
    return e.preventDefault()
  }
  log.debug('Closing app')
  const childPid = globalState.get('childPid')
  childPid && process.kill(childPid)
  globalState.set('serverInited', false)
  process.on('uncaughtException', function () {
    const childPid = globalState.get('childPid')
    childPid && process.kill(childPid)
    process.exit(0)
  })
  log.debug('Child process killed')
  destroyTray()
  clearTimeout(globalState.get('timer'))
  globalState.set('win', null)
  const app = globalState.get('app')
  app.quit && app.quit()
}
