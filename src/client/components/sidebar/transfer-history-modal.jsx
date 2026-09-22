/**
 * transfer-history-modal
 */

import { memo, useMemo, useState } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { Pagination, Table } from 'antd'
import time from '../../common/time'
import Tag from '../sftp/transfer-tag'
import './transfer-history.styl'
import { get as _get } from 'lodash-es'
import { filesize } from 'filesize'

const e = window.translate
const timeRender = t => time(t)
const sorterFactory = prop => {
  return (a, b) => {
    return _get(a, prop) > _get(b, prop) ? 1 : -1
  }
}

export default memo(function TransferHistoryModal (props) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)

  const {
    clearTransferHistory
  } = window.store
  const transferHistory = Array.isArray(props.transferHistory)
    ? props.transferHistory
    : []
  const total = transferHistory.length
  const maxPage = Math.max(1, Math.ceil(total / pageSize) || 1)
  const current = Math.min(Math.max(1, page), maxPage)

  // Manual slice — antd controlled pagination alone was unreliable here
  // (parent deepCopy/re-render + float window layout).
  const pageData = useMemo(() => {
    const start = (current - 1) * pageSize
    return transferHistory.slice(start, start + pageSize)
  }, [transferHistory, current, pageSize])

  const columns = [{
    title: e('startTime'),
    dataIndex: 'startTime',
    key: 'startTime',
    sorter: sorterFactory('startTime'),
    render: timeRender
  }, {
    title: e('finishTime'),
    dataIndex: 'finishTime',
    key: 'finishTime',
    sorter: sorterFactory('finishTime'),
    render: timeRender
  }, {
    title: e('type'),
    dataIndex: 'type',
    key: 'typeFrom',
    sorter: sorterFactory('typeFrom'),
    render: (type, inst) => {
      return (
        <Tag transfer={inst} variant='solid' />
      )
    }
  }, {
    title: e('host'),
    dataIndex: 'host',
    key: 'host',
    sorter: sorterFactory('host')
  }, {
    title: e('fromPath'),
    dataIndex: 'fromPath',
    key: 'fromPath',
    render: (txt, inst) => {
      const t = inst.fromPathReal || txt
      return (
        <div className='sftp-file history-file' title={t}>{t}</div>
      )
    },
    sorter: sorterFactory('fromPath')
  }, {
    title: e('toPath'),
    dataIndex: 'toPath',
    key: 'toPath',
    render: (txt, inst) => {
      const t = inst.toPathReal || txt
      return (
        <div className='sftp-file history-file' title={t}>{t}</div>
      )
    },
    sorter: sorterFactory('toPath')
  }, {
    title: e('size'),
    dataIndex: 'size',
    key: 'size',
    sorter: sorterFactory('size'),
    render: (v) => filesize(v || 0)
  }, {
    title: e('speed'),
    dataIndex: 'speed',
    key: 'speed',
    sorter: sorterFactory('speed')
  }]

  const onPageChange = (nextPage, nextSize) => {
    if (nextSize && nextSize !== pageSize) {
      setPageSize(nextSize)
      setPage(1)
      return
    }
    setPage(nextPage || 1)
  }

  return (
    <div className='pd2 transfer-history-body'>
      <div className='transfer-history-toolbar'>
        <span
          className='iblock pointer'
          onClick={() => {
            clearTransferHistory()
            setPage(1)
          }}
        >
          <CloseOutlined className='mg1r' />
          {e('clear')}
        </span>
        <span className='transfer-history-total'>
          {total}
        </span>
      </div>
      <div className='table-scroll-wrap'>
        <Table
          dataSource={pageData}
          columns={columns}
          bordered
          pagination={false}
          size='small'
          rowKey={(r, i) => r.id || r.originalId || `th-${r.startTime}-${i}`}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: e('noData') === 'noData' ? '暂无记录' : e('noData') }}
        />
      </div>
      <div className='transfer-history-pager'>
        <Pagination
          current={current}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          showQuickJumper
          hideOnSinglePage={false}
          pageSizeOptions={[5, 10, 20, 50, 100]}
          showTotal={(t, range) => `${range[0]}-${range[1]} / ${t}`}
          onChange={onPageChange}
          onShowSizeChange={(p, size) => {
            setPageSize(size)
            setPage(1)
          }}
          size='small'
        />
      </div>
    </div>
  )
})
