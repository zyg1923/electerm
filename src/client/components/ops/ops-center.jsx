/**
 * Ops Center main modal — full module hub
 */

import { lazy, Suspense, useEffect } from 'react'
import { Modal, Tabs, Spin } from 'antd'
import { auto } from 'manate/react'
import { ot } from './ops-i18n'
import { refsStatic } from '../common/ref'
import './ops-center.styl'

const DistributePanel = lazy(() => import('./distribute-panel'))
const RollingPanel = lazy(() => import('./rolling-panel'))
const RelayPanel = lazy(() => import('./relay-panel'))
const ConfigDiffPanel = lazy(() => import('./config-diff-panel'))
const ApprovalPanel = lazy(() => import('./approval-panel'))
const HistoryPanel = lazy(() => import('./history-panel'))
const CommandCenterPanel = lazy(() => import('./command-center-panel'))
const MachineStatusPanel = lazy(() => import('./machine-status-panel'))
const DockerPanel = lazy(() => import('./docker-panel'))
const WizardsPanel = lazy(() => import('./wizards-panel'))
const CronPanel = lazy(() => import('./cron-panel'))
const ToolsPanel = lazy(() => import('./tools-panel'))

export default auto(function OpsCenter () {
  const store = window.store
  const visible = store.opsCenterVisible

  useEffect(() => {
    refsStatic.add('ops-center', {
      open: (tab) => store.openOpsCenter(tab),
      close: () => store.closeOpsCenter()
    })
    store.loadOpsData?.().catch(err => console.error('loadOpsData', err))
  }, [])

  if (!visible) {
    return null
  }

  const items = [
    { key: 'commands', label: '快捷命令', children: <CommandCenterPanel /> },
    { key: 'status', label: '机器状态', children: <MachineStatusPanel /> },
    { key: 'docker', label: 'Docker', children: <DockerPanel /> },
    { key: 'distribute', label: ot('distribute'), children: <DistributePanel /> },
    { key: 'rolling', label: ot('rollingExec'), children: <RollingPanel /> },
    { key: 'relay', label: ot('relayTransfer'), children: <RelayPanel /> },
    { key: 'configDiff', label: ot('configDiff'), children: <ConfigDiffPanel /> },
    { key: 'wizards', label: '小白向导', children: <WizardsPanel /> },
    { key: 'tools', label: '运维工具', children: <ToolsPanel /> },
    { key: 'cron', label: 'Cron', children: <CronPanel /> },
    { key: 'approval', label: ot('approval'), children: <ApprovalPanel /> },
    { key: 'cache', label: '缓存', children: <CachePanel /> },
    { key: 'history', label: ot('history'), children: <HistoryPanel /> }
  ]

  return (
    <Modal
      open={visible}
      title={ot('opsCenter')}
      onCancel={() => store.closeOpsCenter()}
      footer={null}
      width={1100}
      destroyOnHidden
      className='ops-center-modal'
      zIndex={1002}
    >
      <Suspense fallback={<div className='aligncenter pd3'><Spin /></div>}>
        <Tabs
          activeKey={store.opsCenterTab || 'commands'}
          onChange={key => store.setOpsCenterTab(key)}
          items={items}
          tabPosition='top'
          size='small'
        />
      </Suspense>
    </Modal>
  )
})
