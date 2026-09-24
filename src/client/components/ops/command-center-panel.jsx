/**
 * Quick Command Center panel
 */

import { useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  message,
  Collapse
} from 'antd'
import Modal from '../common/modal'
import { ot, otEnum } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import {
  builtinTemplates,
  commandCategories,
  renderTemplate
} from './command-templates'
import RollingEngine from './rolling-engine'
import {
  opsFailPolicy,
  opsStrategy
} from '../../common/ops-constants'

const dangerColor = { safe: 'green', confirm: 'orange', danger: 'red' }

export default function CommandCenterPanel () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [category, setCategory] = useState('all')
  const [tplId, setTplId] = useState(builtinTemplates[0]?.id)
  const [values, setValues] = useState({})
  const [strategy, setStrategy] = useState(opsStrategy.parallel)
  const [snapshot, setSnapshot] = useState(null)
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('ops-cmd-history') || '[]')
    } catch (e) {
      return []
    }
  })

  const templates = useMemo(() => {
    const custom = window.store.opsCommandTemplates || []
    return [...builtinTemplates, ...custom]
  }, [window.store.opsCommandTemplates?.length])

  const filtered = templates.filter(t => category === 'all' || t.category === category)
  const tpl = templates.find(t => t.id === tplId) || filtered[0]

  const preview = tpl ? renderTemplate(tpl.command, { ...Object.fromEntries((tpl.params || []).map(p => [p.key, p.default])), ...values }) : ''

  function setParam (key, v) {
    setValues(prev => ({ ...prev, [key]: v }))
  }

  function saveHistory (entry) {
    const next = [entry, ...history].slice(0, 100)
    setHistory(next)
    window.localStorage.setItem('ops-cmd-history', JSON.stringify(next))
  }

  async function run () {
    if (!tpl) return
    if (!selectedTabIds.length) return message.warning(ot('tabsRequired'))
    for (const p of tpl.params || []) {
      if (p.required && !(values[p.key] ?? p.default)) {
        return message.warning(`缺少参数: ${p.label}`)
      }
    }
    const cmd = preview
    const doRun = async () => {
      const check = window.store.checkOpsApproval?.(cmd, { hostIds: selectedTabIds })
      if (check?.needsApproval || tpl.danger === 'danger') {
        const ok = await new Promise(resolve => {
          Modal.confirm({
            title: ot('confirmDanger'),
            content: <pre>{cmd}</pre>,
            okText: ot('ok'),
            cancelText: ot('cancel'),
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
          })
        })
        if (!ok) return
        if (check?.needsApproval) {
          const req = window.store.createApprovalRequest({
            command: cmd,
            targets: selectedTabIds,
            riskMatchedRules: (check.matchedRules || []).map(r => r.id)
          })
          window.store.decideApproval(req.id, 'approve')
        }
      }

      const engine = new RollingEngine({
        command: cmd,
        tabIds: selectedTabIds,
        strategy,
        maxConcurrency: strategy === opsStrategy.parallel ? 8 : 1,
        failPolicy: opsFailPolicy.skip,
        onUpdate: setSnapshot
      })
      window.store.createOpsTask({ id: engine.id, type: 'command-center', status: 'running', meta: { cmd, tplId: tpl.id } })
      await engine.start()
      saveHistory({
        id: engine.id,
        cmd,
        tplId: tpl.id,
        targets: selectedTabIds,
        at: Date.now(),
        result: engine.snapshot.progress
      })
      window.store.addOpsAuditLog({ action: 'command-center', detail: { cmd, targets: selectedTabIds } })
    }

    if (tpl.danger === 'confirm' || tpl.danger === 'danger') {
      Modal.confirm({
        title: ot('preview'),
        content: <pre>{cmd}</pre>,
        onOk: doRun
      })
    } else {
      await doRun()
    }
  }

  function exportTemplates () {
    const blob = new Blob([JSON.stringify(templates, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ops-command-templates.json'
    a.click()
  }

  const prog = snapshot?.progress

  return (
    <div className='ops-panel'>
      <Space wrap className='mg1b'>
        <Select
          style={{ width: 140 }}
          value={category}
          onChange={setCategory}
          options={[{ value: 'all', label: '全部' }, ...commandCategories.map(c => ({ value: c, label: otEnum(c) }))]}
        />
        <Select
          style={{ width: 280 }}
          value={tpl?.id}
          onChange={(id) => { setTplId(id); setValues({}) }}
          options={filtered.map(t => ({
            value: t.id,
            label: (
              <span>
                <Tag color={dangerColor[t.danger]}>{otEnum(t.danger)}</Tag>
                {t.name}
              </span>
            )
          }))}
        />
        <Button onClick={exportTemplates}>导出模板JSON</Button>
        <Button onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'application/json,.json'
          input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            try {
              const text = await file.text()
              const arr = JSON.parse(text)
              if (!Array.isArray(arr)) throw new Error('需为数组')
              const custom = arr.map((t, i) => ({
                ...t,
                id: t.id || ('custom-' + Date.now() + '-' + i)
              }))
              window.store.opsCommandTemplates = [
                ...(window.store.opsCommandTemplates || []),
                ...custom
              ]
              message.success('已导入 ' + custom.length + ' 条')
            } catch (e) {
              message.error(e.message || '导入失败')
            }
          }
          input.click()
        }}
        >导入JSON
        </Button>
        <Button onClick={() => {
          const name = window.prompt('模板名称')
          if (!name) return
          const command = window.prompt('命令模板，可用 {param}')
          if (!command) return
          const id = 'custom-' + Date.now()
          window.store.opsCommandTemplates = [
            ...(window.store.opsCommandTemplates || []),
            {
              id,
              category: 'system',
              name,
              command,
              danger: 'safe',
              desc: '自定义',
              params: [...command.matchAll(/\{(\w+)\}/g)].map(m => ({
                key: m[1], label: m[1], default: '', required: false
              })),
              examples: [],
              notes: ''
            }
          ]
          setTplId(id)
          message.success('已添加自定义模板')
        }}
        >新建模板
        </Button>
      </Space>
      {tpl && (
        <>
          <div className='mg1b font12'>{tpl.desc}</div>
          <Form layout='inline' className='mg1b'>
            {(tpl.params || []).map(p => (
              <Form.Item key={p.key} label={p.label} required={p.required}>
                <Input
                  placeholder={p.tip || p.default}
                  value={values[p.key] ?? p.default ?? ''}
                  onChange={e => setParam(p.key, e.target.value)}
                  style={{ width: 160 }}
                />
              </Form.Item>
            ))}
          </Form>
          <div className='pd1b'>预览命令</div>
          <pre className='ops-preview-pre mg1b'>{preview}</pre>
          {(tpl.examples || []).length > 0 && (
            <Collapse
              className='mg1b'
              items={[{
                key: 'ex',
                label: '示例',
                children: tpl.examples.map((ex, i) => (
                  <div key={i}><code>{ex.cmd}</code> — {ex.note}</div>
                ))
              }]}
            />
          )}
        </>
      )}
      <OpsTabSelect listProps={listProps} />
      <Space className='mg1b'>
        <Select
          value={strategy}
          onChange={setStrategy}
          style={{ width: 140 }}
          options={[
            { value: opsStrategy.parallel, label: ot('parallel') },
            { value: opsStrategy.rolling, label: ot('rolling') }
          ]}
        />
        <Button type='primary' onClick={run}>{ot('start')}</Button>
      </Space>
      {prog && (
        <div className='mg1b'>
          成功 {prog.success} / 失败 {prog.failed} / 完成 {prog.done}/{prog.total}
        </div>
      )}
      {snapshot?.items?.length > 0 && (
        <Table
          size='small'
          rowKey='tabId'
          pagination={false}
          dataSource={snapshot.items}
          columns={[
            { title: ot('terminal'), dataIndex: 'tabId', ellipsis: true },
            { title: '状态', dataIndex: 'status', width: 90, render: (v) => otEnum(v) },
            { title: ot('exitCode'), dataIndex: 'exitCode', width: 70 },
            {
              title: '输出',
              key: 'out',
              ellipsis: true,
              render: (_, r) => (r.stdout || r.error || '').slice(0, 120)
            }
          ]}
          scroll={{ y: 180 }}
        />
      )}
      <div className='mg1t pd1b'>执行历史</div>
      <Table
        size='small'
        rowKey='id'
        pagination={{ pageSize: 5 }}
        dataSource={history}
        columns={[
          { title: '时间', dataIndex: 'at', width: 160, render: t => new Date(t).toLocaleString() },
          { title: '命令', dataIndex: 'cmd', ellipsis: true },
          { title: '目标数', key: 'n', width: 70, render: (_, r) => (r.targets || []).length }
        ]}
      />
    </div>
  )
}
