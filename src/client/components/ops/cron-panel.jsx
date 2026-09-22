/**
 * Visual crontab editor (single host focus, multi-host push later)
 */

import { useState } from 'react'
import {
  Button,
  Input,
  Space,
  Table,
  Switch,
  message
} from 'antd'
import Modal from '../common/modal'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import { execCmd } from '../terminal/terminal-apis'
import { ot } from './ops-i18n'

function parseCrontab (text) {
  const rows = []
  for (const raw of (text || '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const disabled = /^\s*#/.test(line)
    const body = disabled ? line.replace(/^\s*#\s?/, '') : line
    if (/^\s*[A-Z_]+=/.test(body)) {
      rows.push({ type: 'env', raw: line, disabled, command: body })
      continue
    }
    const m = body.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/)
    if (!m) {
      rows.push({ type: 'other', raw: line, disabled, command: body })
      continue
    }
    rows.push({
      type: 'job',
      raw: line,
      disabled,
      min: m[1],
      hour: m[2],
      dom: m[3],
      mon: m[4],
      dow: m[5],
      command: m[6]
    })
  }
  return rows
}

function rowsToCrontab (rows) {
  return rows.map(r => {
    if (r.type !== 'job') return r.disabled ? `# ${r.command}` : r.command
    const body = `${r.min} ${r.hour} ${r.dom} ${r.mon} ${r.dow} ${r.command}`
    return r.disabled ? `# ${body}` : body
  }).join('\n') + '\n'
}

export default function CronPanel () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [rows, setRows] = useState([])
  const tabId = selectedTabIds[0]

  async function load () {
    if (!tabId) return message.warning('请选择一台机器')
    const r = await execCmd(tabId, 'crontab -l 2>/dev/null || true', 15000)
    const text = r?.stdout || r?.out || ''
    setRows(parseCrontab(text))
  }

  async function save () {
    if (!tabId) return
    const content = rowsToCrontab(rows)
    const b64 = window.btoa(unescape(encodeURIComponent(content)))
    const cmd = `echo '${b64}' | base64 -d | crontab -`
    Modal.confirm({
      title: '确认写入 crontab？',
      content: <pre className='ops-preview-pre'>{content}</pre>,
      onOk: async () => {
        const r = await execCmd(tabId, cmd, 15000)
        if ((r?.code ?? 0) === 0) {
          message.success('已写入')
          window.store.addOpsAuditLog({ action: 'cron-save', detail: { tabId } })
          load()
        } else {
          message.error(r?.stderr || '失败')
        }
      }
    })
  }

  function addJob () {
    setRows([...rows, {
      type: 'job',
      disabled: false,
      min: '0',
      hour: '2',
      dom: '*',
      mon: '*',
      dow: '*',
      command: 'echo hello'
    }])
  }

  const columns = [
    {
      title: '启用',
      width: 70,
      render: (_, r, i) => (
        <Switch
          size='small'
          checked={!r.disabled}
          onChange={v => {
            const next = [...rows]
            next[i] = { ...r, disabled: !v }
            setRows(next)
          }}
        />
      )
    },
    {
      title: '分',
      width: 60,
      render: (_, r, i) => r.type === 'job'
        ? <Input size='small' value={r.min} onChange={e => {
          const next = [...rows]; next[i] = { ...r, min: e.target.value }; setRows(next)
        }}
          />
        : '-'
    },
    {
      title: '时',
      width: 60,
      render: (_, r, i) => r.type === 'job'
        ? <Input size='small' value={r.hour} onChange={e => {
          const next = [...rows]; next[i] = { ...r, hour: e.target.value }; setRows(next)
        }}
          />
        : '-'
    },
    {
      title: '命令',
      render: (_, r, i) => (
        <Input
          size='small'
          value={r.command}
          onChange={e => {
            const next = [...rows]; next[i] = { ...r, command: e.target.value }; setRows(next)
          }}
        />
      )
    },
    {
      title: '',
      width: 70,
      render: (_, r, i) => (
        <Button size='small' danger onClick={() => setRows(rows.filter((_, j) => j !== i))}>{ot('abort') === '中止' ? '删' : 'Del'}</Button>
      )
    }
  ]

  return (
    <div className='ops-panel'>
      <OpsTabSelect listProps={listProps} />
      <p className='font12'>当前编辑第一台选中机器的 crontab（用户级）</p>
      <Space className='mg1b'>
        <Button type='primary' onClick={load}>读取</Button>
        <Button onClick={addJob}>新增任务</Button>
        <Button type='primary' onClick={save}>预览写入</Button>
      </Space>
      <Table size='small' rowKey={(_, i) => i} pagination={false} columns={columns} dataSource={rows} />
    </div>
  )
}
