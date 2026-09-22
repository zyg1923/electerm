/**
 * Enhance distribute: per-host path map support in UI
 */


import { useRef, useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Progress,
  Table,
  message
} from 'antd'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import DistributeEngine from './distribute-engine'
import {
  opsChecksum,
  opsStrategy
} from '../../common/ops-constants'
import ModalConfirm from '../common/modal'

const { TextArea } = Input

export default function DistributePanel () {
  const { tabs, selectedTabIds, listProps } = useOpsTabSelect()
  const [sourceType, setSourceType] = useState('local')
  const [sourceTabId, setSourceTabId] = useState('')
  const [filesText, setFilesText] = useState('')
  const [targetPath, setTargetPath] = useState('/tmp')
  const [perHostPath, setPerHostPath] = useState(false)
  const [hostPaths, setHostPaths] = useState({})
  const [strategy, setStrategy] = useState(opsStrategy.parallel)
  const [maxConcurrency, setMaxConcurrency] = useState(4)
  const [checksum, setChecksum] = useState(opsChecksum.none)
  const [hostBandwidth, setHostBandwidth] = useState(0)
  const [totalBandwidth, setTotalBandwidth] = useState(0)
  const [snapshot, setSnapshot] = useState(null)
  const engineRef = useRef(null)

  const files = filesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)

  function buildPreview () {
    return {
      sourceType,
      sourceTabId,
      files,
      targets: selectedTabIds.map(id => {
        const tab = tabs.find(t => t.id === id)
        return {
          tabId: id,
          host: tab?.host || '',
          title: tab?.title || id,
          path: (perHostPath && hostPaths[id]) ? hostPaths[id] : targetPath
        }
      }),
      targetPath,
      strategy,
      maxConcurrency,
      checksum,
      hostBandwidth,
      totalBandwidth
    }
  }

  function handlePreview () {
    if (!files.length) {
      return message.warning(ot('pathRequired'))
    }
    if (!selectedTabIds.length) {
      return message.warning(ot('tabsRequired'))
    }
    const preview = buildPreview()
    const lines = preview.targets.map(t =>
      `${t.title} (${t.host || t.tabId}) → ${t.path}`
    )
    ModalConfirm.confirm({
      title: ot('preview'),
      content: (
        <div>
          <p>{ot('confirmDistribute')}</p>
          <pre className='ops-preview-pre'>
            {`源: ${sourceType}\n文件:\n${files.join('\n')}\n\n目标:\n${lines.join('\n')}\n策略: ${strategy}`}
          </pre>
        </div>
      ),
      okText: ot('start'),
      cancelText: ot('cancel'),
      onOk: () => start(preview)
    })
  }

  async function start (opts) {
    const engine = new DistributeEngine({
      ...opts,
      sourceHost: tabs.find(t => t.id === opts.sourceTabId)?.host || '',
      onUpdate: (s) => {
        setSnapshot(s)
        window.store.updateOpsTask?.(s.id, s).catch?.(() => {})
      }
    })
    engineRef.current = engine
    const task = await window.store.createOpsTask({
      id: engine.id,
      type: 'distribute',
      status: 'running',
      meta: opts
    })
    engine.id = task.id
    await engine.start()
    await window.store.addOpsAuditLog({
      action: 'distribute-start',
      taskId: engine.id,
      detail: { files: opts.files.length, targets: opts.targets.length }
    })
  }

  const columns = [
    { title: ot('host'), dataIndex: 'title', key: 'title' },
    { title: 'src', dataIndex: 'srcPath', key: 'src', ellipsis: true },
    { title: 'dst', dataIndex: 'dstPath', key: 'dst', ellipsis: true },
    { title: ot('status'), dataIndex: 'status', key: 'status', width: 100 },
    {
      title: '',
      key: 'act',
      width: 80,
      render: (_, row) => row.status === 'failed'
        ? (
          <Button
            size='small'
            onClick={() => engineRef.current?.retryOne(row.id)}
          >
            {ot('retryOne')}
          </Button>
          )
        : null
    }
  ]

  const prog = snapshot?.progress

  return (
    <div className='ops-panel ops-distribute'>
      <div className='pd1b'>{ot('source')}</div>
      <Radio.Group
        value={sourceType}
        onChange={e => setSourceType(e.target.value)}
        className='mg1b'
      >
        <Radio value='local'>{ot('sourceLocal')}</Radio>
        <Radio value='remote'>{ot('sourceRemote')}</Radio>
      </Radio.Group>
      {sourceType === 'remote' && (
        <Select
          className='mg1b'
          style={{ width: '100%' }}
          placeholder={ot('sourceRemote')}
          value={sourceTabId || undefined}
          onChange={setSourceTabId}
          options={tabs.map(t => ({
            value: t.id,
            label: `${t.title || t.id} ${t.host || ''}`
          }))}
        />
      )}
      <div className='pd1b'>{ot('files')}</div>
      <TextArea
        rows={4}
        value={filesText}
        onChange={e => setFilesText(e.target.value)}
        className='mg1b'
      />
      <OpsTabSelect listProps={listProps} />
      <div className='pd1b'>{ot('targetPath')}</div>
      <Radio.Group
        className='mg1b'
        value={perHostPath ? 'per' : 'uni'}
        onChange={e => setPerHostPath(e.target.value === 'per')}
      >
        <Radio value='uni'>{ot('unifiedPath')}</Radio>
        <Radio value='per'>{ot('perHostPath')}</Radio>
      </Radio.Group>
      {!perHostPath
        ? (
          <Input
            value={targetPath}
            onChange={e => setTargetPath(e.target.value)}
            className='mg1b'
          />
          )
        : (
          <div className='mg1b'>
            {selectedTabIds.map(id => {
              const tab = tabs.find(t => t.id === id)
              return (
                <Input
                  key={id}
                  className='mg1b'
                  addonBefore={tab?.title || id}
                  value={hostPaths[id] || targetPath}
                  onChange={e => setHostPaths({ ...hostPaths, [id]: e.target.value })}
                />
              )
            })}
          </div>
          )}
      <Space wrap className='mg1b'>
        <span>{ot('strategy')}</span>
        <Radio.Group
          value={strategy}
          onChange={e => setStrategy(e.target.value)}
        >
          <Radio.Button value={opsStrategy.parallel}>{ot('parallel')}</Radio.Button>
          <Radio.Button value={opsStrategy.rolling}>{ot('rolling')}</Radio.Button>
        </Radio.Group>
        <span>{ot('maxConcurrency')}</span>
        <InputNumber
          min={1}
          max={32}
          value={maxConcurrency}
          onChange={v => setMaxConcurrency(v || 1)}
        />
        <span>{ot('checksum')}</span>
        <Select
          style={{ width: 120 }}
          value={checksum}
          onChange={setChecksum}
          options={[
            { value: opsChecksum.none, label: ot('none') },
            { value: opsChecksum.md5, label: 'MD5' },
            { value: opsChecksum.sha1, label: 'SHA1' }
          ]}
        />
        <span>{ot('hostBandwidth')}</span>
        <InputNumber
          min={0}
          value={hostBandwidth}
          onChange={v => setHostBandwidth(v || 0)}
        />
        <span>{ot('totalBandwidth')}</span>
        <InputNumber
          min={0}
          value={totalBandwidth}
          onChange={v => setTotalBandwidth(v || 0)}
        />
      </Space>
      <Space className='mg1b'>
        <Button type='primary' onClick={handlePreview}>{ot('preview')}</Button>
        <Button disabled={!engineRef.current} onClick={() => engineRef.current?.pause()}>{ot('pause')}</Button>
        <Button disabled={!engineRef.current} onClick={() => engineRef.current?.resume()}>{ot('resume')}</Button>
        <Button danger disabled={!engineRef.current} onClick={() => engineRef.current?.abort()}>{ot('abort')}</Button>
        <Button disabled={!engineRef.current} onClick={() => engineRef.current?.retryFailed()}>{ot('retryFailed')}</Button>
      </Space>
      {prog && (
        <div className='mg1b'>
          <div>
            {ot('successCount')}: {prog.success} / {ot('failCount')}: {prog.failed} / {ot('runningCount')}: {prog.running} / total: {prog.total}
          </div>
          <Progress
            percent={prog.total ? Math.round(((prog.success + prog.failed) / prog.total) * 100) : 0}
            status={snapshot?.status === 'failed' ? 'exception' : undefined}
          />
        </div>
      )}
      {snapshot?.items?.length > 0 && (
        <Table
          size='small'
          rowKey='id'
          pagination={false}
          columns={columns}
          dataSource={snapshot.items}
          scroll={{ y: 240 }}
        />
      )}
    </div>
  )
}
