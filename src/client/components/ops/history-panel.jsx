/**
 * Ops task / audit history
 */

import { Table, Tag } from 'antd'
import { auto } from 'manate/react'
import { ot } from './ops-i18n'

export default auto(function HistoryPanel () {
  const store = window.store
  const taskCols = [
    { title: 'id', dataIndex: 'id', key: 'id', width: 100, ellipsis: true },
    { title: ot('type'), dataIndex: 'type', key: 'type', width: 100 },
    {
      title: ot('status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: s => <Tag>{s}</Tag>
    },
    {
      title: 'created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: t => t ? new Date(t).toLocaleString() : ''
    }
  ]
  const auditCols = [
    {
      title: 'at',
      dataIndex: 'at',
      key: 'at',
      width: 160,
      render: t => t ? new Date(t).toLocaleString() : ''
    },
    { title: 'action', dataIndex: 'action', key: 'action', width: 140 },
    {
      title: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (_, r) => JSON.stringify(r.detail || r).slice(0, 120)
    }
  ]

  return (
    <div className='ops-panel ops-history'>
      <div className='pd1b'>{ot('history')}</div>
      <Table
        size='small'
        rowKey='id'
        pagination={{ pageSize: 8 }}
        columns={taskCols}
        dataSource={store.opsTasks || []}
        locale={{ emptyText: ot('empty') }}
      />
      <div className='pd1b mg1t'>{ot('audit')}</div>
      <Table
        size='small'
        rowKey='id'
        pagination={{ pageSize: 8 }}
        columns={auditCols}
        dataSource={store.opsAuditLogs || []}
        locale={{ emptyText: ot('empty') }}
      />
    </div>
  )
})
