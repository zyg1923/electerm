/**
 * Machine status overview panel
 */

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Progress,
  Tabs,
  message
} from 'antd'
import { ot } from './ops-i18n'
import { useOpsTabSelect, OpsTabSelect } from './ops-tab-select'
import { collectMany } from './machine-status-engine'
import { withCache, invalidate } from './ops-cache'

const levelColor = { green: 'green', yellow: 'orange', red: 'red' }

export default function MachineStatusPanel () {
  const { tabs, selectedTabIds, listProps, setSelectedTabIds } = useOpsTabSelect()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [autoOn, setAutoOn] = useState(() => window.store.config.opsStatusRefreshEnabled === true)
  const [every, setEvery] = useState(() => window.store.config.opsStatusRefreshMs || 10000)
  const refreshRef = useRef(null)

  async function refresh (force = false, quiet = false) {
    const targets = (selectedTabIds.length ? tabs.filter(t => selectedTabIds.includes(t.id)) : tabs)
    if (!targets.length) {
      if (!quiet) message.warning(ot('tabsRequired'))
      return
    }
    if (!quiet) setLoading(true)
    try {
      const list = await collectMany(targets, {
        concurrency: window.store.config.opsCollectConcurrency || 3
      })
      for (const r of list) {
        const key = r.host || r.tabId
        if (force) invalidate(key, 'machineStatus')
        await withCache(key, 'machineStatus', async () => r, { force })
      }
      list.sort((a, b) => {
        const order = { red: 0, yellow: 1, green: 2 }
        return (order[a.level] ?? 3) - (order[b.level] ?? 3) || (a.score - b.score)
      })
      setRows(list)
      setDetail(prev => {
        if (!prev) return prev
        return list.find(r => r.tabId === prev.tabId) || prev
      })
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  refreshRef.current = refresh

  useEffect(() => {
    if (!autoOn) return undefined
    const id = setInterval(() => {
      refreshRef.current?.(false, true)
    }, every)
    return () => clearInterval(id)
  }, [autoOn, every])

  const columns = [
    {
      title: '主机',
      dataIndex: 'hostname',
      render: (v, r) => (
        <a onClick={() => setDetail(r)}>{v || r.title}</a>
      )
    },
    { title: 'IP', dataIndex: 'host', width: 120 },
    {
      title: '健康分',
      dataIndex: 'score',
      width: 100,
      sorter: (a, b) => a.score - b.score,
      render: (s, r) => <Tag color={levelColor[r.level]}>{s}</Tag>
    },
    {
      title: 'CPU%',
      dataIndex: 'cpuPercent',
      width: 80,
      render: v => (v == null ? '-' : v)
    },
    {
      title: '磁盘max%',
      key: 'disk',
      width: 90,
      render: (_, r) => r.maxDisk ?? Math.max(0, ...(r.disks || []).map(d => d.usePercent))
    },
    {
      title: '负载',
      key: 'load',
      width: 120,
      render: (_, r) => r.load ? `${r.load.load1}/${r.cores}` : '-'
    },
    {
      title: '更新',
      dataIndex: 'collectedAt',
      width: 160,
      render: t => t ? new Date(t).toLocaleTimeString() : ''
    },
    {
      title: '异常',
      dataIndex: 'error',
      ellipsis: true
    }
  ]

  return (
    <div className='ops-panel'>
      <OpsTabSelect listProps={listProps} />
      <Space className='mg1b'>
        <span>自动刷新</span>
        <Switch
          checked={autoOn}
          onChange={v => {
            setAutoOn(v)
            window.store.setConfig({ opsStatusRefreshEnabled: v })
          }}
        />
        <Select
          disabled={!autoOn}
          value={every}
          onChange={v => {
            setEvery(v)
            window.store.setConfig({ opsStatusRefreshMs: v })
          }}
          popupMatchSelectWidth={false}
          options={[
            { value: 5000, label: '5秒' },
            { value: 10000, label: '10秒' },
            { value: 30000, label: '30秒' },
            { value: 60000, label: '60秒' }
          ]}
        />
        <Button type='primary' loading={loading} onClick={() => refresh(false)}>刷新（可走缓存）</Button>
        <Button disabled={loading} onClick={() => refresh(true)}>强制刷新</Button>
        <Button onClick={() => setSelectedTabIds(tabs.map(t => t.id))}>全选机器</Button>
        {loading ? <span>后台更新中，列表仍可操作</span> : null}
      </Space>
      <Table
        size='small'
        rowKey='tabId'
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ y: 280 }}
      />
      {detail && (
        <div className='mg1t'>
          <Space className='mg1b'>
            <Tag color={levelColor[detail.level]}>{detail.score}</Tag>
            <b>{detail.hostname}</b>
            <Button size='small' onClick={() => setDetail(null)}>关闭</Button>
          </Space>
          <Tabs
            size='small'
            items={[
              {
                key: 'ov',
                label: '概览',
                children: (
                  <div className='ops-preview-pre'>
                    <div>OS: {detail.os}</div>
                    <div>Uptime: {detail.uptime}</div>
                    <div>扣分: {(detail.reasons || []).join(', ') || '无'}</div>
                    <div>CPU%: {detail.cpuPercent}</div>
                    <div>Mem available%: {detail.memAvailablePercent}</div>
                  </div>
                )
              },
              {
                key: 'disk',
                label: '磁盘',
                children: (detail.disks || []).map(d => (
                  <div key={d.mount}>
                    {d.mount} {d.usePercent}% ({d.used}/{d.size})
                    <Progress percent={d.usePercent} size='small' status={d.usePercent > 90 ? 'exception' : undefined} />
                  </div>
                ))
              },
              {
                key: 'mem',
                label: '内存',
                children: (
                  <pre className='ops-preview-pre'>
                    {JSON.stringify({ mem: detail.mem, swap: detail.swap || detail.mem?.swap }, null, 2)}
                  </pre>
                )
              },
              {
                key: 'load',
                label: '负载/服务',
                children: (
                  <div>
                    <div>load {detail.load?.load1} / {detail.load?.load5} / {detail.load?.load15} · cores {detail.cores}</div>
                    <div>failed units: {detail.failedUnits}</div>
                    <div>CLOSE_WAIT: {detail.closeWait}</div>
                    <div>OOM: {detail.hasOom ? 'yes' : 'no'}</div>
                    <div>criticalDown: {detail.criticalDown ? 'yes' : 'no'}</div>
                  </div>
                )
              }
            ]}
          />
        </div>
      )}
    </div>
  )
}
