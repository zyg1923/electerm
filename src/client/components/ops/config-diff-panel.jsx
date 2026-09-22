/**
 * Multi-host config diff panel
 */

import { useState } from 'react'
import {
  Button,
  Input,
  Select,
  Space,
  Tag,
  Table,
  message
} from 'antd'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import Modal from '../common/modal'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import {
  compareConfigAcrossHosts,
  compareDirectories
} from './config-diff-engine'
import DistributeEngine from './distribute-engine'
import isColorDark from '../../common/is-color-dark'

export default function ConfigDiffPanel () {
  const { tabs, selectedTabIds, listProps } = useOpsTabSelect()
  const [remotePath, setRemotePath] = useState('/etc/nginx/nginx.conf')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [diffPair, setDiffPair] = useState(null)
  const [dirResult, setDirResult] = useState(null)
  const [leftTab, setLeftTab] = useState('')
  const [rightTab, setRightTab] = useState('')
  const [leftPath, setLeftPath] = useState('/etc')
  const [rightPath, setRightPath] = useState('/etc')

  async function handleFetch () {
    if (!selectedTabIds.length) return message.warning(ot('tabsRequired'))
    if (!remotePath) return message.warning(ot('pathRequired'))
    setLoading(true)
    try {
      const selected = tabs.filter(t => selectedTabIds.includes(t.id))
      const r = await compareConfigAcrossHosts({
        tabs: selected,
        remotePath,
        fetchContent: true
      })
      setResult(r)
      await window.store.addOpsAuditLog({
        action: 'config-diff',
        detail: { path: remotePath, hosts: selectedTabIds.length, allIdentical: r.allIdentical }
      })
    } catch (e) {
      message.error(e.message || ot('loadError'))
    } finally {
      setLoading(false)
    }
  }

  function openDiff (hostA, hostB) {
    setDiffPair({
      left: { title: hostA.title, content: hostA.content || '' },
      right: { title: hostB.title, content: hostB.content || '' }
    })
  }

  function handleSync (fromHost) {
    const others = (result?.hosts || []).filter(h => h.tabId !== fromHost.tabId && h.ok)
    if (!others.length) return
    Modal.confirm({
      title: ot('confirmSyncConfig'),
      content: `${fromHost.title} → ${others.map(o => o.title).join(', ')}`,
      okText: ot('ok'),
      cancelText: ot('cancel'),
      onOk: async () => {
        // write baseline content to temp then distribute — use remote source from baseline tab
        const engine = new DistributeEngine({
          sourceType: 'remote',
          sourceTabId: fromHost.tabId,
          sourceHost: fromHost.host,
          files: [remotePath],
          targets: others.map(o => ({
            tabId: o.tabId,
            host: o.host,
            title: o.title,
            path: remotePath.includes('/') ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/' : '/'
          })),
          targetPath: remotePath.includes('/') ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/' : '/',
          onUpdate: () => {}
        })
        await engine.start()
        message.success(ot('start'))
      }
    })
  }

  async function handleDirCompare () {
    if (!leftTab || !rightTab) return message.warning(ot('tabsRequired'))
    setLoading(true)
    try {
      const r = await compareDirectories({
        leftTabId: leftTab,
        rightTabId: rightTab,
        leftPath,
        rightPath
      })
      setDirResult(r)
    } finally {
      setLoading(false)
    }
  }

  const hostColumns = [
    { title: ot('host'), dataIndex: 'title', key: 'title' },
    {
      title: 'hash',
      dataIndex: 'hash',
      key: 'hash',
      ellipsis: true,
      render: (h, row) => row.ok ? (h || '').slice(0, 12) : <Tag color='red'>err</Tag>
    },
    {
      title: ot('identical'),
      key: 'same',
      render: (_, row) => {
        const m = result?.matrix?.[row.tabId]
        return m?.sameAsBaseline
          ? <Tag color='green'>{ot('identical')}</Tag>
          : <Tag color='orange'>{ot('different')}</Tag>
      }
    },
    {
      title: '',
      key: 'act',
      render: (_, row) => (
        <Space>
          <Button
            size='small'
            disabled={!result?.baselineId || row.tabId === result.baselineId}
            onClick={() => {
              const base = result.hosts.find(h => h.tabId === result.baselineId)
              if (base) openDiff(base, row)
            }}
          >
            Diff
          </Button>
          <Button size='small' onClick={() => handleSync(row)}>{ot('syncToOthers')}</Button>
        </Space>
      )
    }
  ]

  return (
    <div className='ops-panel ops-config-diff'>
      <OpsTabSelect listProps={listProps} />
      <div className='pd1b'>{ot('remotePath')}</div>
      <Space.Compact style={{ width: '100%' }} className='mg1b'>
        <Input value={remotePath} onChange={e => setRemotePath(e.target.value)} />
        <Button type='primary' loading={loading} onClick={handleFetch}>{ot('fetch')}</Button>
      </Space.Compact>
      {result && (
        <div className='mg1b'>
          {result.allIdentical
            ? <Tag color='green'>{ot('identical')}</Tag>
            : <Tag color='orange'>{ot('different')}</Tag>}
          <span className='mg1l'>{ot('baseline')}: {result.baselineId}</span>
          <Table
            className='mg1t'
            size='small'
            rowKey='tabId'
            pagination={false}
            columns={hostColumns}
            dataSource={result.hosts}
          />
        </div>
      )}
      {diffPair && (
        <div className='ops-diff-view mg1t' style={{ maxHeight: 360, overflow: 'auto' }}>
          <ReactDiffViewer
            oldValue={diffPair.left.content}
            newValue={diffPair.right.content}
            splitView
            compareMethod={DiffMethod.WORDS}
            leftTitle={diffPair.left.title}
            rightTitle={diffPair.right.title}
            useDarkTheme={isColorDark(window.store.getThemeConfig?.()?.background || '#000')}
          />
        </div>
      )}
      <div className='mg2t pd1b'>{ot('dirCompare')}</div>
      <Space wrap className='mg1b'>
        <Select
          style={{ width: 180 }}
          placeholder='left'
          options={tabs.map(t => ({ value: t.id, label: t.title || t.id }))}
          value={leftTab || undefined}
          onChange={setLeftTab}
        />
        <Input style={{ width: 160 }} value={leftPath} onChange={e => setLeftPath(e.target.value)} />
        <Select
          style={{ width: 180 }}
          placeholder='right'
          options={tabs.map(t => ({ value: t.id, label: t.title || t.id }))}
          value={rightTab || undefined}
          onChange={setRightTab}
        />
        <Input style={{ width: 160 }} value={rightPath} onChange={e => setRightPath(e.target.value)} />
        <Button loading={loading} onClick={handleDirCompare}>{ot('dirCompare')}</Button>
      </Space>
      {dirResult && (
        <div className='font12'>
          <div>only left: {dirResult.onlyLeft.length}</div>
          <div>only right: {dirResult.onlyRight.length}</div>
          <div>size diff: {dirResult.sizeDiff.length}</div>
          <div>same: {dirResult.same.length}</div>
        </div>
      )}
    </div>
  )
}
