/**
 * confirm modal for transfer conflict
 *
 */

import { Component } from 'react'
import { Button, Checkbox } from 'antd'
import Modal from '../common/modal'
import { isString } from 'lodash-es'
import AnimateText from '../common/animate-text'
import formatTime from '../../common/time'
import { FolderOutlined, FileOutlined } from '@ant-design/icons'
import {
  fileActions
} from '../../common/constants'
import { refsStatic, refsTransfers } from '../common/ref'

const e = window.translate

function formatTimeAuto (strOrDigit) {
  if (isString(strOrDigit)) {
    return formatTime(strOrDigit)
  }
  if (strOrDigit > 9999999999) {
    return formatTime(strOrDigit)
  }
  return formatTime(strOrDigit * 1000)
}

export default class ConfirmModalStore extends Component {
  constructor (props) {
    super(props)
    this.state = {
      transferToConfirm: null,
      applyRest: false
    }
    this.queue = []
    this.queuedTransferIds = new Set()
    this.activeTransferId = null
    this.id = 'transfer-conflict'
    refsStatic.add(this.id, this)
  }

  dismiss = (id) => {
    if (!id) {
      return
    }
    this.queue = this.queue.filter(item => item.id !== id)
    this.queuedTransferIds.delete(id)
    if (this.activeTransferId !== id) {
      return
    }
    this.activeTransferId = null
    this.setState({
      transferToConfirm: null
    }, this.showNext)
  }

  addConflict = (transfer) => {
    const transferId = transfer?.id
    if (!transferId) {
      return
    }
    if (this.activeTransferId === transferId || this.queuedTransferIds.has(transferId)) {
      return
    }
    const globalPolicy = window._transferConflictPolicy
    if (globalPolicy && Object.values(fileActions).includes(globalPolicy)) {
      const { id, transferBatch } = transfer
      const trid = `tr-${transferBatch}-${id}`
      const currentTransfer = refsTransfers.get(trid)
      currentTransfer?.onDecision(globalPolicy)
      return
    }
    this.queue.push(transfer)
    this.queuedTransferIds.add(transferId)
    if (!this.activeTransferId) {
      this.showNext()
    }
  }

  showNext = () => {
    const next = this.queue.shift()
    if (next?.id) {
      this.queuedTransferIds.delete(next.id)
    }
    this.activeTransferId = next?.id || null
    this.setState({
      transferToConfirm: next,
      applyRest: false
    })
  }

  decide = (action) => {
    const { applyRest } = this.state
    if (applyRest && action === fileActions.cancel) {
      return this.act(fileActions.skipAll)
    }
    if (applyRest && !String(action).includes('All')) {
      return this.act(action + 'All')
    }
    return this.act(action)
  }

  act = (action) => {
    if (!this.state.transferToConfirm) {
      return
    }
    const { id, transferBatch } = this.state.transferToConfirm
    const toAll = action.includes('All')
    const policy = toAll ? action.replace('All', '') : action
    const trid = `tr-${transferBatch}-${id}`
    const doFilter = toAll && transferBatch

    // For "All" actions, update all existing transfers in the same batch
    if (doFilter) {
      // Update all existing transfers with same batch ID in DOM
      const prefix = `tr-${transferBatch}-`
      const pendingConflictIds = new Set([
        id,
        ...this.queue
          .filter(d => d.transferBatch === transferBatch)
          .map(d => d.id)
      ])
      for (const [key, r] of window.refsTransfers.entries()) {
        if (key.startsWith(prefix)) {
          r.resolvePolicy = policy
          const transferId = r.props.transfer?.id
          if (key !== trid && pendingConflictIds.has(transferId)) {
            r.onDecision(policy)
          }
        }
      }
      this.queue = this.queue.filter(d => d.transferBatch !== transferBatch)
    }

    // Resolve current conflict
    const currentTransfer = refsTransfers.get(trid)
    currentTransfer?.onDecision(policy)

    // Move to the next item
    this.activeTransferId = null
    this.setState({
      transferToConfirm: null
    }, this.showNext)
  }

  renderContent () {
    const {
      transferToConfirm
    } = this.state
    const {
      fromPath,
      toPath,
      fromFile: {
        isDirectory,
        name,
        modifyTime: modifyTimeFrom,
        size: sizeFrom,
        type: typeFrom
      },
      toFile: {
        modifyTime: modifyTimeTo,
        size: sizeTo,
        type: typeTo
      }
    } = transferToConfirm
    const typeTxt = isDirectory ? e('folder') : e('file')
    const Icon = isDirectory ? FolderOutlined : FileOutlined
    const card = (title, fileName, size, mtime, filePath) => (
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className='bold font13'>{title}</p>
        <p className='bold font14'>
          <Icon className='mg1r' />{fileName}
        </p>
        <p className='font13'>
          {typeTxt} · {e('size')}: {size ?? '-'}
        </p>
        <p className='font13'>
          {e('modifyTime')}: {mtime ? formatTimeAuto(mtime) : '-'}
        </p>
        <p className='font12 elli' title={filePath}>{filePath}</p>
      </div>
    )
    return (
      <div className='confirms-content-wrap'>
        <AnimateText>
          <p className='pd1b'>
            目标位置已经有同名{typeTxt}。选择替换、跳过，或保留两者（新文件会命名为「{name} (2)」）。
            {
              !isDirectory && sizeTo > 0 && sizeFrom > 0 && sizeTo < sizeFrom
                ? ' 目标文件更小，也可以断点续传（半截会写在 .electerm.part，传完再改名并清掉临时文件）。'
                : ''
            }
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            {card('正在复制', name, sizeFrom, modifyTimeFrom, fromPath)}
            {card('目标已有', name, sizeTo, modifyTimeTo, toPath)}
          </div>
          <p className='font12 pd1t'>
            {e(typeFrom)} → {e(typeTo)}
          </p>
        </AnimateText>
      </div>
    )
  }

  renderFooter () {
    const {
      transferToConfirm
    } = this.state
    if (!transferToConfirm) {
      return null
    }
    const {
      fromFile,
      toFile
    } = transferToConfirm
    const isDirectory = !!fromFile?.isDirectory
    const sizeFrom = Number(fromFile?.size) || 0
    const sizeTo = Number(toFile?.size) || 0
    const canResume = !isDirectory && sizeTo > 0 && sizeFrom > 0 && sizeTo < sizeFrom
    const rest = this.queue.length
    return (
      <div className='pd1y'>
        <div className='pd1b'>
          <Checkbox
            checked={this.state.applyRest}
            onChange={ev => this.setState({ applyRest: ev.target.checked })}
          >
            对后续冲突都这样处理{rest ? `（还有 ${rest} 个）` : ''}
          </Checkbox>
        </div>
        <div className='alignright'>
          <Button
            className='mg1l'
            onClick={() => this.decide(fileActions.skip)}
          >
            跳过
          </Button>
          <Button
            className='mg1l'
            onClick={() => this.decide(fileActions.rename)}
          >
            保留两者
          </Button>
          {
            canResume
              ? (
                <Button
                  type='primary'
                  className='mg1l'
                  onClick={() => this.decide(fileActions.resume)}
                >
                  断点续传
                </Button>
                )
              : null
          }
          <Button
            type='primary'
            danger
            className='mg1l'
            onClick={() => this.decide(fileActions.mergeOrOverwrite)}
          >
            {isDirectory ? '合并' : '替换'}
          </Button>
        </div>
      </div>
    )
  }

  render () {
    const {
      transferToConfirm
    } = this.state
    if (!transferToConfirm?.id) {
      return null
    }
    const modalProps = {
      open: true,
      width: 560,
      zIndex: 1300,
      title: '替换或跳过文件',
      footer: this.renderFooter(),
      onCancel: () => this.decide(fileActions.cancel)
    }
    return (
      <Modal
        {...modalProps}
      >
        {this.renderContent()}
      </Modal>
    )
  }
}
