/**
 * Ops task / audit history
 */

import { Table, Tag } from 'antd'
import { auto } from 'manate/react'
import { ot, otEnum } from './ops-i18n'

export default auto(function HistoryPanel () {
  const store = window.store
  const taskCols = [
    { title: ot('taskId'), dataIndex: 'id', key: 'id', width: 100, ellipsis: true },
    { title: ot('type'), dataIndex: 'type', key: 'type', width: 120, render: (v) => otEnum(v) },
    {
      title: ot('status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: s => <Tag>{otEnum(s)}</Tag>
    },
    {
      title: ot('createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: t => t ? new Date(t).toLocaleString() : ''
    }
  ]
  const auditCols = [
    {
      title: ot('at'),
      dataIndex: 'at',
      key: 'at',
      width: 160,
      render: t => t ? new Date(t).toLocaleString() : ''
    },
    { title: ot('action'), dataIndex: 'action', key: 'action', width: 140 },
    {
      title: ot('detail'),
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
