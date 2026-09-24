/**
 * transfer through ws
 */

import generate from './uid'
import initWs from './ws'

const keys = window.pre.transferKeys

class Transfer {
  async init ({
    onData,
    onEnd,
    onError,
    ...rest
  }) {
    const id = generate()
    this.id = id
    this._done = false
    const th = this
    const {
      sftpId,
      isFtp,
      port
    } = rest
    const ws = await initWs('transfer', id, sftpId, undefined, port)
    this.ws = ws
    ws.s({
      action: 'transfer-new',
      ...rest,
      id
    })
    keys.forEach(func => {
      th[func] = (...args) => {
        ws.s({
          action: 'transfer-func',
          id: th.id,
          isFtp,
          func,
          sftpId,
          args
        })
        if (func === 'destroy') {
          th.onDestroy(ws)
        }
      }
    })

    const finishOk = (arg) => {
      if (th._done) {
        return
      }
      th._done = true
      onEnd(arg)
      th.onDestroy(ws)
    }
    const finishErr = (err) => {
      if (th._done) {
        return
      }
      th._done = true
      onError(err instanceof Error ? err : new Error(String(err?.message || err || '连接已断开')))
      th.onDestroy(ws)
    }

    const did = 'transfer:data:' + id
    this.onData = (evt) => {
      const arg = JSON.parse(evt.data)
      if (did === arg.id) {
        onData(arg.data)
      }
    }
    ws.addEventListener('message', this.onData)
    ws.once((arg) => {
      finishOk(arg)
    }, 'transfer:end:' + id)
    ws.once((arg) => {
      console.debug('sftp transfer error')
      console.debug(arg.error?.stack)
      finishErr(new Error(arg.error?.message || '传输失败'))
    }, 'transfer:err:' + id)
    // Session/SFTP teardown often closes the socket without transfer:err
    const prevClose = ws.onclose
    ws.onclose = () => {
      try {
        prevClose && prevClose.call(ws)
      } catch (e) {}
      finishErr(new Error('连接已断开'))
    }
  }

  onDestroy (ws) {
    if (this._destroyed) {
      return
    }
    this._destroyed = true
    this._done = true
    if (ws) {
      ws.onclose = () => {}
      ws.removeEventListener('message', this.onData)
      ws.close()
    }
  }
}

export default async (props) => {
  const transfer = new Transfer()
  await transfer.init(props)
  return transfer
}
