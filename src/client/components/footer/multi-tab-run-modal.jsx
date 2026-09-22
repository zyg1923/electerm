/**
 * Run one command in several terminals — parallel or rolling.
 */

import { useState } from 'react'
import { auto } from 'manate/react'
import {
  Button,
  Modal,
  Radio,
  InputNumber,
  Space
} from 'antd'
import { TabSelectList } from './tab-select'
import { refs } from '../common/ref'
import {
  terminalWebType,
  terminalRdpType,
  terminalVncType
} from '../../common/constants'
import RollingEngine from '../ops/rolling-engine'
import {
  opsFailPolicy,
  opsStrategy
} from '../../common/ops-constants'
import { ot } from '../ops/ops-i18n'
import ModalConfirm from '../common/modal'

const e = window.translate

export default auto(function MultiTabRunModal (props) {
  const { store, cmd, onClose } = props
  const [strategy, setStrategy] = useState(opsStrategy.parallel)
  const [maxConcurrency, setMaxConcurrency] = useState(1)
  const [failPolicy, setFailPolicy] = useState(opsFailPolicy.stop)
  const selectedTabIds = store.batchInputSelectedTabIds
  const tabs = store.tabs.filter(tab => {
    return tab.type !== terminalWebType &&
      tab.type !== terminalRdpType &&
      tab.type !== terminalVncType
  }).sort((a, b) => {
    if (a.id === store.activeTabId) return -1
    if (b.id === store.activeTabId) return 1
    return 0
  })
  const listProps = {
    tabs,
    activeTabId: store.activeTabId,
    selectedTabIds,
    onSelect: store.onSelectBatchInputSelectedTabId,
    onSelectAll: store.selectAllBatchInputTabs,
    onSelectNone: store.selectNoneBatchInputTabs
  }

  async function handleRun () {
    const check = store.checkOpsApproval?.(cmd, { hostIds: selectedTabIds })
    if (check?.needsApproval) {
      const req = store.createApprovalRequest({
        command: cmd,
        targets: selectedTabIds,
        riskMatchedRules: check.matchedRules.map(r => r.id),
        approvalMode: 'modal'
      })
      const ok = await new Promise((resolve) => {
        ModalConfirm.confirm({
          title: ot('needsApproval'),
          content: cmd,
          okText: ot('approve'),
          cancelText: ot('reject'),
          onOk: async () => {
            store.decideApproval(req.id, 'approve')
            resolve(true)
          },
          onCancel: async () => {
            store.decideApproval(req.id, 'reject', 'user reject')
            resolve(false)
          }
        })
      })
      if (!ok) return
    }

    if (strategy === opsStrategy.parallel && maxConcurrency >= selectedTabIds.length) {
      selectedTabIds.map(id => refs.get('term-' + id)).forEach(term => {
        term?.batchInput(cmd)
      })
      store.addCmdHistory(cmd)
      onClose()
      return
    }

    const engine = new RollingEngine({
      command: cmd,
      tabIds: selectedTabIds,
      strategy,
      maxConcurrency,
      failPolicy,
      useExec: false,
      onAskConfirm: () => new Promise((resolve) => {
        ModalConfirm.confirm({
          title: ot('waitingConfirm'),
          okText: ot('continueNext'),
          cancelText: ot('stopAll'),
          onOk: () => resolve('continue'),
          onCancel: () => resolve('stop')
        })
      })
    })
    store.createOpsTask?.({
      id: engine.id,
      type: 'rolling',
      status: 'running',
      meta: { command: cmd, tabIds: selectedTabIds }
    })
    store.addCmdHistory(cmd)
    onClose()
    engine.start()
  }

  return (
    <Modal
      open
      title={e('runInAllTerminals')}
      onCancel={onClose}
      destroyOnHidden
      width={520}
      footer={[
        <Button
          key='cancel'
          onClick={onClose}
        >
          {e('cancel')}
        </Button>,
        <Button
          key='run'
          type='primary'
          disabled={!selectedTabIds.length}
          onClick={handleRun}
        >
          {e('ok')}
        </Button>
      ]}
    >
      <div className='multi-tab-run-cmd'>{cmd}</div>
      <Space wrap className='mg1b'>
        <Radio.Group
          size='small'
          value={strategy}
          onChange={ev => setStrategy(ev.target.value)}
        >
          <Radio.Button value={opsStrategy.parallel}>{ot('parallel')}</Radio.Button>
          <Radio.Button value={opsStrategy.rolling}>{ot('rolling')}</Radio.Button>
        </Radio.Group>
        <span>{ot('maxConcurrency')}</span>
        <InputNumber
          size='small'
          min={1}
          max={32}
          value={maxConcurrency}
          onChange={v => setMaxConcurrency(v || 1)}
        />
        {strategy === opsStrategy.rolling && (
          <Radio.Group
            size='small'
            value={failPolicy}
            onChange={ev => setFailPolicy(ev.target.value)}
          >
            <Radio.Button value={opsFailPolicy.stop}>{ot('failStop')}</Radio.Button>
            <Radio.Button value={opsFailPolicy.skip}>{ot('failSkip')}</Radio.Button>
            <Radio.Button value={opsFailPolicy.ask}>{ot('failAsk')}</Radio.Button>
          </Radio.Group>
        )}
      </Space>
      <TabSelectList {...listProps} />
    </Modal>
  )
})
