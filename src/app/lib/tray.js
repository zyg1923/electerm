/**
 * system tray: hide to tray on close, quit only from tray menu
 */

const { Tray, Menu, nativeImage, app } = require('electron')
const { existsSync } = require('fs')
const { trayIconPath, iconPath, packInfo } = require('../common/runtime-constants')
const globalState = require('./glob-state')
const { releaseInstanceLock } = require('./single-instance')

let tray = null

function getTrayIcon () {
  const src = existsSync(trayIconPath) ? trayIconPath : iconPath
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) {
    return nativeImage.createEmpty()
  }
  return img.resize({ width: 16, height: 16 })
}

function showWindow () {
  const win = globalState.get('win')
  if (!win || win.isDestroyed()) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.setSkipTaskbar(false)
  win.show()
  win.focus()
}

function restartApp () {
  // Schedule the new process before this one exits. Closing the window
  // first quits the app (willQuit) and the new process never starts.
  // Releasing the single-instance lock lets the new process become primary,
  // including when this window was started from the dev script.
  globalState.set('closeAction', '')
  globalState.set('willQuit', true)
  releaseInstanceLock()
  app.relaunch()
  app.exit(0)
}

function quitApp () {
  globalState.set('willQuit', true)
  const win = globalState.get('win')
  if (win && !win.isDestroyed()) {
    win.close()
    return
  }
  const inst = globalState.get('app') || app
  inst.quit && inst.quit()
}

function hideWindow () {
  const win = globalState.get('win')
  if (!win || win.isDestroyed()) {
    return
  }
  win.setSkipTaskbar(true)
  win.hide()
}

function initTray () {
  if (tray && !tray.isDestroyed()) {
    return tray
  }
  tray = new Tray(getTrayIcon())
  tray.setToolTip(packInfo.name)
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示',
      click: showWindow
    },
    {
      label: '重启',
      click: restartApp
    },
    { type: 'separator' },
    {
      label: '退出',
      click: quitApp
    }
  ]))
  tray.on('click', showWindow)
  return tray
}

function destroyTray () {
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
  }
  tray = null
}

module.exports = {
  initTray,
  destroyTray,
  showWindow,
  hideWindow,
  quitApp,
  restartApp
}
