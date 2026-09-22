/**
 * Rolling / batch exec panel
 */

import { useRef, useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Radio,
  Space,
  Table,
  Progress,
  message
} from 'antd'
import Modal from '../common/modal'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import RollingEngine from './rolling-engine'
import {
  opsFailPolicy,
  opsStrategy
} from '../../common/ops-constants'

const { TextArea } = Input

export default function RollingPanel () {
  const { selectedTabIds, listProps } = useOpsTabSelect(
    window.store.batchInputSelectedTabIds || []
  )
  const [command, setCommand] = useState('')
  const [strategy, setStrategy] = useState(opsStrategy.rolling)
  const [maxConcurrency, setMaxConcurrency] = useState(1)
  const [failPolicy, setFailPolicy] = useState(opsFailPolicy.stop)
  const [snapshot, setSnapshot] = useState(null)
  const [liveOut, setLiveOut] = useState('')
  const engineRef = useRef(null)

  async function maybeApprove (cmd, targets) {
    const check = window.store.checkOpsApproval(cmd, { hostIds: targets })
    if (!check.needsApproval) return true

    const req = await window.store.createApprovalRequest({
      command: cmd,
      targets,
      riskMatchedRules: check.matchedRules.map(r => r.id),
      approvalMode: 'modal',
      payload: { type: 'rolling' }
    })

    return new Promise((resolve) => {
      Modal.confirm({
        title: ot('needsApproval'),
        content: (
          <div>
            <p>{cmd}</p>
            <p>{ot('selectTabs')}: {targets.length}</p>
            <p>{check.matchedRules.map(r => r.name).join(', ')}</p>
          </div>
        ),
        okText: ot('approve'),
        cancelText: ot('reject'),
        onOk: async () => {
          await window.store.decideApproval(req.id, 'approve')
          message.success(ot('approvalPassed'))
          resolve(true)
        },
        onCancel: async () => {
          await window.store.decideApproval(req.id, 'reject', 'user reject')
          message.warning(ot('approvalRejected'))
          resolve(false)
        }
      })
    })
  }

  async function handleStart () {
    const cmd = command.trim()
    if (!cmd) return message.warning(ot('cmdRequired'))
    if (!selectedTabIds.length) return message.warning(ot('tabsRequired'))

    Modal.confirm({
      title: ot('confirmDanger'),
      content: ot('confirmRolling'),
      okText: ot('start'),
      cancelText: ot('cancel'),
      onOk: async () => {
        const ok = await maybeApprove(cmd, selectedTabIds)
        if (!ok) return

        const engine = new RollingEngine({
          command: cmd,
          tabIds: selectedTabIds,
          strategy,
          maxConcurrency: strategy === opsStrategy.parallel ? maxConcurrency : Math.min(maxConcurrency, maxConcurrency),
          failPolicy,
          onUpdate: setSnapshot,
          onItemOutput: (item) => {
            setLiveOut(
              `[${item.title || item.tabId}] code=${item.exitCode}\n${item.stdout || ''}${item.stderr || ''}${item.error || ''}`
            )
          },
          onAskConfirm: (item) => new Promise((resolve) => {
            Modal.confirm({
              title: ot('waitingConfirm'),
              content: `${item.tabId} failed: ${item.error || item.exitCode}`,
              okText: ot('continueNext'),
              cancelText: ot('stopAll'),
              onOk: () => resolve('continue'),
              onCancel: () => resolve('stop')
            })
          })
        })
        engineRef.current = engine
        await window.store.createOpsTask({
          id: engine.id,
          type: 'rolling',
          status: 'running',
          meta: { command: cmd, tabIds: selectedTabIds, strategy, failPolicy }
        })
        await engine.start()
        await window.store.addOpsAuditLog({
          action: 'rolling-start',
          taskId: engine.id,
          detail: { command: cmd, count: selectedTabIds.length }
        })
      }
    })
  }

  const prog = snapshot?.progress
  const columns = [
    { title: 'Tab', dataIndex: 'tabId', key: 'tabId', ellipsis: true },
    { title: ot('status'), dataIndex: 'status', key: 'status', width: 100 },
    { title: 'exit', dataIndex: 'exitCode', key: 'code', width: 70 },
    { title: 'error', dataIndex: 'error', key: 'error', ellipsis: true }
  ]

  return (
    <div className='ops-panel ops-rolling'>
      <div className='pd1b'>{ot('command')}</div>
      <TextArea
        rows={3}
        value={command}
        onChange={e => setCommand(e.target.value)}
        className='mg1b'
      />
      <OpsTabSelect listProps={listProps} />
      <Space wrap className='mg1b'>
        <span>{ot('strategy')}</span>
        <Radio.Group value={strategy} onChange={e => setStrategy(e.target.value)}>
          <Radio.Button value={opsStrategy.parallel}>{ot('parallel')}</Radio.Button>
          <Radio.Button value={opsStrategy.rolling}>{ot('rolling')}</Radio.Button>
        </Radio.Group>
        <span>{ot('maxConcurrency')}</span>
        <InputNumber min={1} max={32} value={maxConcurrency} onChange={v => setMaxConcurrency(v || 1)} />
        <span>{ot('failPolicy')}</span>
        <SelectFail value={failPolicy} onChange={setFailPolicy} />
      </Space>
      <Space className='mg1b'>
        <Button type='primary' onClick={handleStart}>{ot('start')}</Button>
        <Button onClick={() => engineRef.current?.pause()}>{ot('pause')}</Button>
        <Button onClick={() => engineRef.current?.resume()}>{ot('resume')}</Button>
        <Button danger onClick={() => engineRef.current?.abort()}>{ot('abort')}</Button>
      </Space>
      {prog && (
        <div className='mg1b'>
          <div>
            {prog.done}/{prog.total} · {ot('successCount')} {prog.success} · {ot('failCount')} {prog.failed}
          </div>
          <Progress percent={prog.total ? Math.round((prog.done / prog.total) * 100) : 0} />
        </div>
      )}
      {snapshot?.items?.length > 0 && (
        <Table
          size='small'
          rowKey='tabId'
          pagination={false}
          columns={columns}
          dataSource={snapshot.items}
          scroll={{ y: 200 }}
        />
      )}
      {liveOut && (
        <div className='ops-live-out mg1t'>
          <div className='pd1b'>{ot('output')}</div>
          <pre>{liveOut}</pre>
        </div>
      )}
    </div>
  )
}

function SelectFail ({ value, onChange }) {
  return (
    <Radio.Group value={value} onChange={e => onChange(e.target.value)} size='small'>
      <Radio.Button value={opsFailPolicy.stop}>{ot('failStop')}</Radio.Button>
      <Radio.Button value={opsFailPolicy.skip}>{ot('failSkip')}</Radio.Button>
      <Radio.Button value={opsFailPolicy.ask}>{ot('failAsk')}</Radio.Button>
    </Radio.Group>
  )
}
