/**
 * Ops Center main modal — full module hub
 */

import { lazy, Suspense, useEffect } from 'react'
import { Tabs, Spin } from 'antd'
import { auto } from 'manate/react'
import { ot } from './ops-i18n'
import { refsStatic } from '../common/ref'
import FloatWindow from '../common/float-window'
import './ops-center.styl'

const LightCodePanel = lazy(() => import('./light-code-panel'))
const DiaryPanel = lazy(() => import('./ops-diary-panel'))
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
const FileEditorPanel = lazy(() => import('./file-editor-panel'))
const CachePanel = lazy(() => import('./cache-panel'))

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
    { key: 'lightCode', label: '轻代码/编排', children: <LightCodePanel /> },
    { key: 'diary', label: '运维日志', children: <DiaryPanel /> },
    { key: 'editor', label: '文件编辑', children: <FileEditorPanel request={store.opsFileEditRequest} /> },
    { key: 'status', label: '机器状态', children: <MachineStatusPanel /> },
    { key: 'docker', label: ot('docker'), children: <DockerPanel /> },
    { key: 'distribute', label: ot('distribute'), children: <DistributePanel /> },
    { key: 'rolling', label: ot('rollingExec'), children: <RollingPanel /> },
    { key: 'relay', label: ot('relayTransfer'), children: <RelayPanel /> },
    { key: 'configDiff', label: ot('configDiff'), children: <ConfigDiffPanel /> },
    { key: 'wizards', label: '小白向导', children: <WizardsPanel /> },
    { key: 'tools', label: '运维工具', children: <ToolsPanel /> },
    { key: 'cron', label: ot('cron'), children: <CronPanel /> },
    { key: 'approval', label: ot('approval'), children: <ApprovalPanel /> },
    { key: 'cache', label: '缓存', children: <CachePanel /> },
    { key: 'history', label: ot('history'), children: <HistoryPanel /> }
  ]

  const viewH = Math.max(420, Math.min(760, window.innerHeight - 96))
  return (
    <FloatWindow
      open={visible}
      title={ot('opsCenter')}
      onClose={() => store.closeOpsCenter()}
      width={Math.min(1100, window.innerWidth - 48)}
      height={viewH}
      zIndex={960}
      revealKey={store.opsCenterReveal}
      className='ops-center-modal'
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
    </FloatWindow>
  )
})
