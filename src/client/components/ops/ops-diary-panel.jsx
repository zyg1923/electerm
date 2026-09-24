/**
 * Ops diary / work log: calendar, CRUD, range+text search, import/export.
 */

import { useMemo, useRef, useState } from 'react'
import {
  Button,
  Calendar,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message
} from 'antd'
import dayjs from 'dayjs'
import { auto } from 'manate/react'
import {
  enrichDateMeta,
  formatDateTime,
  getRestInfo,
  toDateKey
} from './ops-diary-calendar'
import {
  applyDiaryImport,
  createDiaryEntry,
  entriesForDate,
  filterDiaryEntries,
  listDiaryEntries,
  removeDiaryEntry,
  saveDiaryEntry,
  withMeta
} from './ops-diary'
import {
  buildImportPlan,
  downloadBlob,
  exportDiaryBlob,
  parseDiaryFile
} from './ops-diary-io'

const { RangePicker } = DatePicker
const { TextArea } = Input

function RestTag ({ dateKey }) {
  const info = getRestInfo(dateKey)
  if (info.kind === 'holiday') return <Tag color='red'>休</Tag>
  if (info.kind === 'weekend') return <Tag color='orange'>休</Tag>
  if (info.kind === 'makeup') return <Tag color='blue'>班</Tag>
  return <Tag>班</Tag>
}

function DiaryPanelInner () {
  const all = listDiaryEntries()
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()))
  const [range, setRange] = useState(null)
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState(null)
  const [importPlan, setImportPlan] = useState(null)
  const fileRef = useRef(null)

  const meta = useMemo(() => enrichDateMeta(selectedDate), [selectedDate])
  const dayEntries = useMemo(() => entriesForDate(selectedDate), [all, selectedDate])

  const filtered = useMemo(() => {
    const from = range?.[0] ? range[0].format('YYYY-MM-DD') : ''
    const to = range?.[1] ? range[1].format('YYYY-MM-DD') : ''
    return filterDiaryEntries(all, { from, to, keyword }).map(withMeta)
  }, [all, range, keyword])

  const countByDate = useMemo(() => {
    const m = new Map()
    for (const e of all) {
      m.set(e.date, (m.get(e.date) || 0) + 1)
    }
    return m
  }, [all])

  function openNew () {
    setEditing(createDiaryEntry({ date: selectedDate }))
  }

  function openEdit (row) {
    setEditing({ ...row })
  }

  function onSave () {
    if (!editing) return
    if (!editing.date) return message.warning('请选择日期')
    if (!String(editing.title || '').trim() && !String(editing.content || '').trim()) {
      return message.warning('请填写标题或内容')
    }
    saveDiaryEntry(editing)
    setEditing(null)
    message.success('已保存')
  }

  function onExport (format) {
    const list = filtered.length ? filtered : all
    if (!list.length) return message.warning('没有可导出的日志')
    const { blob, filename } = exportDiaryBlob(list, format)
    downloadBlob(blob, filename)
    message.success(`已导出 ${filename}`)
  }

  async function onImportFile (file) {
    try {
      const { entries } = await parseDiaryFile(file)
      const plan = buildImportPlan(entries, listDiaryEntries())
      setImportPlan(plan)
    } catch (err) {
      message.error(String(err?.message || err))
    }
    return false
  }

  function applyImport () {
    if (!importPlan?.length) return
    const decisions = importPlan.map(p => ({
      incoming: p.incoming,
      existingId: p.existing?.id,
      action: p.action
    }))
    const r = applyDiaryImport(decisions)
    setImportPlan(null)
    message.success(`导入完成：新增 ${r.added}，替换 ${r.replaced}，跳过 ${r.skipped}`)
  }

  function setAllImportAction (action) {
    setImportPlan(prev => (prev || []).map(p => {
      if (!p.existing && action === 'replace') {
        return { ...p, action: 'add' }
      }
      if (!p.existing && action === 'skip') {
        return { ...p, action: 'skip' }
      }
      return { ...p, action }
    }))
  }

  const cellRender = (current, info) => {
    if (info?.type && info.type !== 'date') {
      return info.originNode
    }
    const key = current.format('YYYY-MM-DD')
    const rest = getRestInfo(key)
    const n = countByDate.get(key) || 0
    return (
      <div className='ops-diary-cell'>
        <div className={'ops-diary-cell-rest' + (rest.isRest ? ' is-rest' : '')}>
          {rest.label}
        </div>
        {n > 0 ? <div className='ops-diary-dot' title={`${n} 条日志`}>{n}</div> : null}
      </div>
    )
  }

  return (
    <div className='ops-diary-panel'>
      <Space wrap className='mg1b'>
        <RangePicker
          value={range}
          onChange={setRange}
          allowClear
          placeholder={['开始日期', '结束日期']}
        />
        <Input.Search
          style={{ width: 240 }}
          allowClear
          placeholder='标题/内容关键词'
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <Button type='primary' onClick={openNew}>新建日志</Button>
        <Button onClick={() => fileRef.current?.click()}>导入</Button>
        <input
          ref={fileRef}
          type='file'
          accept='.csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onImportFile(f)
          }}
        />
        <Select
          style={{ width: 130 }}
          placeholder='导出格式'
          options={[
            { value: 'xlsx', label: '导出 xlsx' },
            { value: 'xls', label: '导出 xls' },
            { value: 'csv', label: '导出 csv' }
          ]}
          onChange={v => onExport(v)}
        />
      </Space>

      <div className='ops-diary-layout'>
        <div className='ops-diary-cal'>
          <Calendar
            fullscreen={false}
            value={dayjs(selectedDate)}
            onSelect={(d) => setSelectedDate(d.format('YYYY-MM-DD'))}
            onChange={(d) => setSelectedDate(d.format('YYYY-MM-DD'))}
            cellRender={cellRender}
          />
          <div className='ops-diary-meta mg1t'>
            <div><b>阳历</b>：{meta.solar}</div>
            <div><b>阴历</b>：{meta.lunar}</div>
            <div>
              <b>休息</b>：<RestTag dateKey={selectedDate} />
              {meta.restKind === 'makeup' ? '（调休上班）' : ''}
              {meta.restKind === 'holiday' ? '（节假日）' : ''}
            </div>
          </div>
        </div>

        <div className='ops-diary-side'>
          <div className='pd1b bold'>当日日志（{selectedDate}）</div>
          {!dayEntries.length
            ? <div className='ops-diary-empty'>当天暂无日志，可点「新建日志」</div>
            : dayEntries.map(e => (
              <div key={e.id} className='ops-diary-card'>
                <div className='ops-diary-card-title'>{e.title || '（无标题）'}</div>
                <div className='ops-diary-card-body'>{e.content || ''}</div>
                <div className='ops-diary-card-foot font12'>
                  新建 {formatDateTime(e.createdAt)} · 编辑 {formatDateTime(e.updatedAt)}
                </div>
                <Space size='small' className='mg1t'>
                  <Button size='small' onClick={() => openEdit(e)}>编辑</Button>
                  <Button
                    size='small'
                    danger
                    onClick={() => {
                      Modal.confirm({
                        title: '删除这条日志？',
                        onOk: () => {
                          removeDiaryEntry(e.id)
                          message.success('已删除')
                        }
                      })
                    }}
                  >
                    删除
                  </Button>
                </Space>
              </div>
              ))}
        </div>
      </div>

      <div className='pd1b bold mg1t'>查询结果（{filtered.length}）</div>
      <Table
        size='small'
        rowKey='id'
        pagination={{ pageSize: 8, showSizeChanger: true }}
        dataSource={filtered}
        columns={[
          { title: '日期', dataIndex: 'date', width: 110 },
          {
            title: '阳历',
            width: 150,
            ellipsis: true,
            render: (_, r) => r.solar
          },
          { title: '阴历', dataIndex: 'lunar', width: 100 },
          {
            title: '休息',
            width: 70,
            render: (_, r) => <RestTag dateKey={r.date} />
          },
          { title: '标题', dataIndex: 'title', ellipsis: true },
          {
            title: '内容',
            dataIndex: 'content',
            ellipsis: true,
            render: (v) => (v || '').slice(0, 80)
          },
          {
            title: '新建时间',
            width: 160,
            render: (_, r) => formatDateTime(r.createdAt)
          },
          {
            title: '编辑时间',
            width: 160,
            render: (_, r) => formatDateTime(r.updatedAt)
          },
          {
            title: '操作',
            width: 120,
            render: (_, r) => (
              <Space>
                <Button
                  size='small'
                  onClick={() => {
                    setSelectedDate(r.date)
                    openEdit(r)
                  }}
                >
                  编辑
                </Button>
                <Button
                  size='small'
                  danger
                  onClick={() => {
                    removeDiaryEntry(r.id)
                    message.success('已删除')
                  }}
                >
                  删
                </Button>
              </Space>
            )
          }
        ]}
      />

      <Modal
        open={!!editing}
        title={editing?.id && all.some(x => x.id === editing.id) ? '编辑日志' : '新建日志'}
        onCancel={() => setEditing(null)}
        onOk={onSave}
        okText='保存'
        width={640}
        destroyOnClose
      >
        {editing
          ? (
            <>
              <div className='pd1b font12'>日期</div>
              <DatePicker
                className='mg1b'
                style={{ width: '100%' }}
                value={editing.date ? dayjs(editing.date) : null}
                onChange={(d) => setEditing({
                  ...editing,
                  date: d ? d.format('YYYY-MM-DD') : selectedDate
                })}
              />
              {editing.date
                ? (
                  <div className='mg1b font12'>
                    阳历 {enrichDateMeta(editing.date).solar} · 阴历 {enrichDateMeta(editing.date).lunar} ·
                    <RestTag dateKey={editing.date} />
                  </div>
                  )
                : null}
              <div className='pd1b font12'>标题</div>
              <Input
                className='mg1b'
                value={editing.title}
                onChange={e => setEditing({ ...editing, title: e.target.value })}
                placeholder='标题'
              />
              <div className='pd1b font12'>内容</div>
              <TextArea
                rows={8}
                value={editing.content}
                onChange={e => setEditing({ ...editing, content: e.target.value })}
                placeholder='日志内容'
              />
              {editing.createdAt
                ? (
                  <div className='mg1t font12' style={{ opacity: 0.7 }}>
                    新建时间 {formatDateTime(editing.createdAt)}
                    {editing.updatedAt ? ` · 编辑时间 ${formatDateTime(editing.updatedAt)}` : ''}
                  </div>
                  )
                : null}
            </>
            )
          : null}
      </Modal>

      <Modal
        open={!!importPlan}
        title='导入确认：选择替换 / 跳过 / 新增'
        onCancel={() => setImportPlan(null)}
        onOk={applyImport}
        okText='确认导入'
        width={900}
        destroyOnClose
      >
        <Space className='mg1b' wrap>
          <Button size='small' onClick={() => setAllImportAction('replace')}>冲突全部替换</Button>
          <Button size='small' onClick={() => setAllImportAction('skip')}>冲突全部跳过</Button>
          <Button size='small' onClick={() => setAllImportAction('add')}>全部当作新增</Button>
          <span className='font12' style={{ opacity: 0.7 }}>
            有冲突时可单独勾选「替换」；选「跳过」则不导入该行；无冲突默认「新增」
          </span>
        </Space>
        <Table
          size='small'
          rowKey='key'
          pagination={{ pageSize: 6 }}
          dataSource={importPlan || []}
          columns={[
            { title: '日期', width: 110, render: (_, r) => r.incoming.date },
            { title: '导入标题', ellipsis: true, render: (_, r) => r.incoming.title || '（无）' },
            {
              title: '已有记录',
              ellipsis: true,
              render: (_, r) => (r.existing
                ? `${r.existing.title || '（无）'} [${r.matchType}]`
                : <Tag>无冲突</Tag>)
            },
            {
              title: '动作',
              width: 200,
              render: (_, r) => (
                <Select
                  size='small'
                  style={{ width: 160 }}
                  value={r.action}
                  onChange={v => {
                    setImportPlan(prev => prev.map(p =>
                      p.key === r.key ? { ...p, action: v } : p
                    ))
                  }}
                  options={[
                    ...(r.existing ? [{ value: 'replace', label: '替换已有' }] : []),
                    { value: 'add', label: '新增一条' },
                    { value: 'skip', label: '跳过不导入' }
                  ]}
                />
              )
            },
            {
              title: '替换?',
              width: 70,
              render: (_, r) => (
                <Checkbox
                  disabled={!r.existing}
                  checked={r.action === 'replace'}
                  onChange={e => {
                    const action = e.target.checked ? 'replace' : 'skip'
                    setImportPlan(prev => prev.map(p =>
                      p.key === r.key ? { ...p, action } : p
                    ))
                  }}
                />
              )
            }
          ]}
        />
      </Modal>
    </div>
  )
}

export default auto(DiaryPanelInner)
