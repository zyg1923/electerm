/**
 * pass transfer list from props
 * when list changes, do transfer and other op
 */

import { Component } from 'react'
import Transports from './transports-ui-store'
import { maxTransport, statusMap } from '../../common/constants'
import { refs, refsStatic, refsTransfers } from '../common/ref'

export default class TransportsActionStore extends Component {
  constructor (props) {
    super(props)
    this.pendingInitIds = new Set()
  }

  componentDidMount () {
    this.control()
    this._sessionWatch = setInterval(() => {
      this.failDeadSessionTransfers()
    }, 1500)
  }

  componentWillUnmount () {
    clearInterval(this._sessionWatch)
    this._sessionWatch = null
  }

  componentDidUpdate (prevProps) {
    if (
      prevProps.fileTransferChanged !== this.props.fileTransferChanged
    ) {
      this.control()
    }
  }

  failDeadSessionTransfers = () => {
    const { store } = window
    const list = store.fileTransfers || []
    for (const t of list) {
      if (t.error || t.pausing || !t.inited) {
        continue
      }
      if (t.typeFrom !== 'remote' && t.typeTo !== 'remote') {
        continue
      }
      const tab = (store.tabs || []).find(row => row.id === t.tabId)
      const sftp = refs.get('sftp-' + t.tabId)
      const sftpDead = !sftp || !sftp.sftp
      const tabDead = !tab || tab.status === statusMap.error
      if (!sftpDead && !tabDead) {
        continue
      }
      const trid = `tr-${t.transferBatch || ''}-${t.id}`
      const inst = refsTransfers.get(trid)
      if (inst && typeof inst.onError === 'function') {
        inst.onError(new Error('连接已断开'))
      } else {
        refsStatic.get('transfer-queue')?.addToQueue('update', t.id, {
          error: '连接已断开',
          statusText: '错误',
          pausing: true,
          inited: false,
          waitingConfirm: false,
          speed: ''
        })
      }
    }
  }

  control = async () => {
    const { store } = window
    const {
      fileTransfers
    } = store
    this.pendingInitIds = new Set(
      Array.from(this.pendingInitIds).filter(id => {
        const transfer = fileTransfers.find(t => t.id === id)
        return transfer && transfer.inited !== true
      })
    )

    // First loop: Handle same type transfers
    for (const t of fileTransfers) {
      const {
        typeTo,
        typeFrom,
        inited,
        id
      } = t
      if (typeTo === typeFrom && !inited) {
        refsStatic.get('transfer-queue')?.addToQueue(
          'update',
          id,
          {
            inited: true
          }
        )
      }
    }

    // Count active transfers
    let count = fileTransfers.filter(t => {
      const {
        typeTo,
        typeFrom,
        inited,
        pausing,
        error
      } = t
      return typeTo !== typeFrom &&
        !error &&
        (inited || this.pendingInitIds.has(t.id)) &&
        pausing !== true
    }).length

    if (count >= maxTransport) {
      return
    }

    // Second loop: Process pending transfers
    const len = fileTransfers.length

    for (let i = 0; i < len; i++) {
      const tr = fileTransfers[i]
      const {
        typeTo,
        typeFrom,
        inited,
        id
      } = tr

      const isTransfer = typeTo !== typeFrom

      if (
        inited ||
        this.pendingInitIds.has(id) ||
        !isTransfer ||
        tr.pausing === true ||
        tr.error
      ) {
        continue
      }

      if (count < maxTransport) {
        count++
        this.pendingInitIds.add(id)
        refsStatic.get('transfer-queue')?.addToQueue(
          'update',
          id,
          {
            inited: true
          }
        )
      }

      if (count >= maxTransport) {
        break
      }
    }
  }

  render () {
    return (
      <Transports {...this.props} />
    )
  }
}
