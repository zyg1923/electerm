/**
 * Cross-link relay transfer panel
 */

import { useState } from 'react'
import {
  Button,
  Select,
  Progress,
  Space,
  Tag,
  message
} from 'antd'
import Modal from '../common/modal'
import { ot } from './ops-i18n'
import { useOpsTabSelect } from './ops-tab-select'
import { startRelayTransfer } from './relay-transfer'
import PathField from './path-field'
import { opsTaskStatus } from '../../common/ops-constants'

export default function RelayPanel () {
  const { tabs } = useOpsTabSelect()
  const [sourceTabId, setSourceTabId] = useState('')
  const [targetTabId, setTargetTabId] = useState('')
  const [fromPath, setFromPath] = useState('')
  const [toPath, setToPath] = useState('')
  const [state, setState] = useState(null)

  const options = tabs.map(t => ({
    value: t.id,
    label: `${t.title || t.id} ${t.host || ''}`
  }))

  function handleStart () {
    if (!sourceTabId || !targetTabId) return message.warning(ot('tabsRequired'))
    if (!fromPath || !toPath) return message.warning(ot('pathRequired'))
    if (sourceTabId === targetTabId) return message.warning('source == target')

    Modal.confirm({
      title: ot('preview'),
      content: ot('confirmRelay'),
      okText: ot('start'),
      cancelText: ot('cancel'),
      onOk: () => {
        const src = tabs.find(t => t.id === sourceTabId)
        const dst = tabs.find(t => t.id === targetTabId)
        startRelayTransfer({
          sourceTabId,
          sourceHost: src?.host,
          sourceTitle: src?.title,
          targetTabId,
          targetHost: dst?.host,
          targetTitle: dst?.title,
          targetUser: dst?.username,
          targetPort: dst?.port,
          fromPath,
          toPath,
          onUpdate: setState,
          onAudit: (detail) => {
            window.store.addOpsAuditLog({
              action: 'relay-transfer',
              detail
            })
            if (detail.mode === 'relay') {
              message.info(ot('relayFallback'))
            } else if (detail.status === opsTaskStatus.completed && detail.mode === 'direct') {
              message.success(ot('directOk'))
            }
          }
        })
        window.store.createOpsTask({
          type: 'relay',
          status: 'running',
          meta: { fromPath, toPath, sourceTabId, targetTabId }
        })
      }
    })
  }

  return (
    <div className='ops-panel ops-relay'>
      <Space direction='vertical' style={{ width: '100%' }} className='mg1b'>
        <div>
          <div className='pd1b'>{ot('sourceRemote')}</div>
          <Select
            style={{ width: '100%' }}
            options={options}
            value={sourceTabId || undefined}
            onChange={setSourceTabId}
          />
        </div>
        <div>
          <div className='pd1b'>{ot('remotePath')}（源）</div>
          <PathField tabId={sourceTabId} value={fromPath} onChange={setFromPath} />
        </div>
        <div>
          <div className='pd1b'>目标机器</div>
          <Select
            style={{ width: '100%' }}
            options={options}
            value={targetTabId || undefined}
            onChange={setTargetTabId}
          />
        </div>
        <div>
          <div className='pd1b'>{ot('remotePath')}（目标）</div>
          <PathField tabId={targetTabId} value={toPath} onChange={setToPath} />
        </div>
      </Space>
      <Button type='primary' onClick={handleStart}>{ot('start')}</Button>
      {state && (
        <div className='mg1t'>
          <Space>
            <Tag color={state.mode === 'direct' ? 'green' : state.mode === 'relay' ? 'orange' : 'blue'}>
              {state.mode}
            </Tag>
            <span>{state.status}</span>
          </Space>
          <Progress percent={Math.round(state.progress || 0)} className='mg1t' />
          {state.error && <pre className='color-red'>{state.error}</pre>}
        </div>
      )}
    </div>
  )
}
