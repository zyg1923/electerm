/**
 * Extra ops tools: logs, firewall, packages, disk clean, diagnose, backup
 */

import { useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Space,
  Tabs,
  Table,
  Tag,
  message
} from 'antd'
import Modal from '../common/modal'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import { execCmd } from '../terminal/terminal-apis'
import { ot } from './ops-i18n'
import { openOpsFileEditor } from './ops-file-editor'

async function run (tabId, cmd, timeoutMs = 60000) {
  try {
    const r = await execCmd(tabId, cmd, timeoutMs)
    return { ok: (r?.code ?? 0) === 0, out: r?.stdout || r?.out || '', err: r?.stderr || '' }
  } catch (e) {
    return { ok: false, out: '', err: e.message }
  }
}

function q (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

function LogTool ({ tabId }) {
  const [path, setPath] = useState('/var/log/syslog')
  const [kw, setKw] = useState('')
  const [text, setText] = useState('')
  const [follow, setFollow] = useState(false)

  async function load () {
    if (!tabId) return message.warning('选一台机器')
    const cmd = kw
      ? `grep -n -E ${q(kw)} ${q(path)} 2>/dev/null | tail -200`
      : `tail -n 200 ${q(path)} 2>/dev/null`
    const r = await run(tabId, cmd)
    setText(r.out || r.err)
  }

  async function startFollow () {
    setFollow(true)
    const r = await run(tabId, `timeout 8 tail -n 50 -f ${q(path)} 2>/dev/null || tail -n 50 ${q(path)}`, 15000)
    setText(prev => (prev ? prev + '\n' : '') + (r.out || ''))
    setFollow(false)
  }

  return (
    <div>
      <Space wrap className='mg1b'>
        <Input style={{ width: 280 }} value={path} onChange={e => setPath(e.target.value)} placeholder='日志路径' />
        <Input style={{ width: 160 }} value={kw} onChange={e => setKw(e.target.value)} placeholder='关键词' />
        <Button type='primary' onClick={load}>查看</Button>
        <Button loading={follow} onClick={startFollow}>跟踪(~8s)</Button>
      </Space>
      <pre className='ops-live-out' style={{ maxHeight: 320, overflow: 'auto' }}>{text}</pre>
    </div>
  )
}

function FirewallTool ({ tabId }) {
  const [text, setText] = useState('')
  const [port, setPort] = useState('80')
  async function list () {
    const r = await run(tabId, 'ufw status numbered 2>/dev/null || iptables -L -n 2>/dev/null | head -80')
    setText(r.out || r.err)
  }
  async function allow () {
    const cmd = `ufw allow ${parseInt(port, 10)}/tcp || iptables -I INPUT -p tcp --dport ${parseInt(port, 10)} -j ACCEPT`
    Modal.confirm({
      title: '确认开放端口？',
      content: <pre>{cmd}</pre>,
      onOk: async () => {
        const r = await run(tabId, cmd)
        window.store.addOpsAuditLog({ action: 'firewall-allow', detail: { port, tabId } })
        setText(r.out || r.err)
        list()
      }
    })
  }
  return (
    <div>
      <Space className='mg1b'>
        <Button onClick={list}>列出规则</Button>
        <Input style={{ width: 100 }} value={port} onChange={e => setPort(e.target.value)} />
        <Button type='primary' onClick={allow}>放行端口</Button>
      </Space>
      <pre className='ops-live-out'>{text}</pre>
    </div>
  )
}

function PackageTool ({ tabId }) {
  const [qstr, setQ] = useState('')
  const [text, setText] = useState('')
  async function search () {
    const r = await run(tabId, `(apt-cache search ${q(qstr)} 2>/dev/null || yum search ${q(qstr)} 2>/dev/null) | head -40`)
    setText(r.out || r.err)
  }
  async function install () {
    const cmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y ${qstr} 2>/dev/null || yum install -y ${qstr}`
    Modal.confirm({
      title: '确认安装？',
      content: <pre>{cmd}</pre>,
      onOk: async () => {
        const r = await run(tabId, cmd, 300000)
        window.store.addOpsAuditLog({ action: 'pkg-install', detail: { qstr, tabId } })
        setText(r.out || r.err)
      }
    })
  }
  return (
    <div>
      <Space className='mg1b'>
        <Input style={{ width: 200 }} value={qstr} onChange={e => setQ(e.target.value)} placeholder='包名' />
        <Button onClick={search}>搜索</Button>
        <Button type='primary' onClick={install}>安装</Button>
      </Space>
      <pre className='ops-live-out'>{text}</pre>
    </div>
  )
}

function DiskCleanTool ({ tabId }) {
  const [text, setText] = useState('')
  async function analyze () {
    const r = await run(tabId, 'du -xh /var/log /tmp /var/cache 2>/dev/null | sort -hr | head -30')
    setText(r.out || r.err)
  }
  async function clean () {
    const cmd = 'journalctl --vacuum-size=200M 2>/dev/null; apt-get clean 2>/dev/null; yum clean all 2>/dev/null; rm -rf /tmp/* 2>/dev/null; echo DONE'
    Modal.confirm({
      title: '确认安全清理？',
      content: <pre>{cmd}</pre>,
      onOk: async () => {
        const r = await run(tabId, cmd, 180000)
        window.store.addOpsAuditLog({ action: 'disk-clean', detail: { tabId } })
        setText(r.out || r.err)
      }
    })
  }
  return (
    <div>
      <Space className='mg1b'>
        <Button onClick={analyze}>分析占用</Button>
        <Button danger onClick={clean}>安全清理</Button>
      </Space>
      <pre className='ops-live-out'>{text}</pre>
    </div>
  )
}

function DiagnoseTool ({ tabId }) {
  const [rows, setRows] = useState([])
  async function go () {
    const cmds = [
      { name: 'load', cmd: 'uptime' },
      { name: 'mem', cmd: 'free -h' },
      { name: 'cpu-top', cmd: 'ps aux --sort=-%cpu | head -6' },
      { name: 'disk', cmd: 'df -h | head -10' },
      { name: 'iowait', cmd: "top -bn1 | grep -E '%Cpu|Cpu' | head -1" },
      { name: 'conn', cmd: 'ss -s 2>/dev/null | head -10' }
    ]
    const out = []
    for (const c of cmds) {
      const r = await run(tabId, c.cmd)
      out.push({ name: c.name, ok: r.ok, out: (r.out || r.err).slice(0, 500) })
    }
    setRows(out)
    window.store.addOpsAuditLog({ action: 'resource-diagnose', detail: { tabId } })
  }
  return (
    <div>
      <Button type='primary' className='mg1b' onClick={go}>一键诊断</Button>
      <Table
        size='small'
        rowKey='name'
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '项', dataIndex: 'name', width: 100 },
          { title: 'OK', dataIndex: 'ok', width: 60, render: v => v ? <Tag color='green'>Y</Tag> : <Tag color='red'>N</Tag> },
          { title: '输出', dataIndex: 'out', render: t => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{t}</pre> }
        ]}
      />
    </div>
  )
}

function BackupTool ({ tabId }) {
  const [src, setSrc] = useState('/etc')
  const [dst, setDst] = useState('/tmp/backup')
  const [hist, setHist] = useState([])
  async function backup () {
    const stamp = Date.now()
    const out = `${dst}/bak-${stamp}.tar.gz`
    const cmd = `mkdir -p ${q(dst)} && tar -czf ${q(out)} ${q(src)} && ls -lh ${q(out)}`
    Modal.confirm({
      title: '确认备份？',
      content: <pre>{cmd}</pre>,
      onOk: async () => {
        const r = await run(tabId, cmd, 300000)
        const row = { id: stamp, src, out, at: stamp, ok: r.ok, detail: r.out || r.err }
        setHist([row, ...hist])
        window.store.addOpsAuditLog({ action: 'backup', detail: row })
        message.success(r.ok ? '备份完成' : '失败')
      }
    })
  }
  return (
    <div>
      <Space wrap className='mg1b'>
        <Input style={{ width: 200 }} value={src} onChange={e => setSrc(e.target.value)} addonBefore='源' />
        <Input style={{ width: 200 }} value={dst} onChange={e => setDst(e.target.value)} addonBefore='目标目录' />
        <Button type='primary' onClick={backup}>创建备份</Button>
      </Space>
      <Table
        size='small'
        rowKey='id'
        dataSource={hist}
        columns={[
          { title: '时间', dataIndex: 'at', render: t => new Date(t).toLocaleString() },
          { title: '源', dataIndex: 'src' },
          { title: '输出', dataIndex: 'out', ellipsis: true },
          { title: 'OK', dataIndex: 'ok', render: v => v ? 'Y' : 'N' }
        ]}
      />
    </div>
  )
}

function ConfigRollbackTool ({ tabId }) {
  const [path, setPath] = useState('/etc/nginx/nginx.conf')
  const [baks, setBaks] = useState([])
  const [diff, setDiff] = useState('')
  async function listBak () {
    const r = await run(tabId, `ls -1t ${q(path)}.bak.* 2>/dev/null | head -20`)
    setBaks((r.out || '').split('\n').filter(Boolean).map((p, i) => ({ id: i, path: p })))
  }
  async function restore (bak) {
    Modal.confirm({
      title: '确认回滚？',
      content: `${bak} → ${path}`,
      onOk: async () => {
        const r = await run(tabId, `cp -a ${q(bak)} ${q(path)} && echo OK`)
        window.store.addOpsAuditLog({ action: 'config-rollback', detail: { path, bak, tabId } })
        message.success(r.ok ? '已回滚' : '失败')
      }
    })
  }
  async function showDiff (bak) {
    const r = await run(tabId, `diff -u ${q(bak)} ${q(path)} | head -100`)
    setDiff(r.out || r.err || '(identical)')
  }
  return (
    <div>
      <Space className='mg1b'>
        <Input style={{ width: 360 }} value={path} onChange={e => setPath(e.target.value)} />
        <Button onClick={listBak}>列出备份</Button>
        <Button onClick={() => {
          openOpsFileEditor({ tabId, path })
        }}
        >
          编辑
        </Button>
      </Space>
      <Table
        size='small'
        rowKey='id'
        dataSource={baks}
        columns={[
          { title: '备份', dataIndex: 'path', ellipsis: true },
          {
            title: '',
            width: 160,
            render: (_, r) => (
              <Space>
                <Button size='small' onClick={() => showDiff(r.path)}>diff</Button>
                <Button size='small' type='primary' onClick={() => restore(r.path)}>恢复</Button>
              </Space>
            )
          }
        ]}
      />
      <pre className='ops-live-out'>{diff}</pre>
    </div>
  )
}

export default function ToolsPanel () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const tabId = selectedTabIds[0]
  return (
    <div className='ops-panel'>
      <OpsTabSelect listProps={listProps} />
      <p className='font12'>工具默认作用于第一台选中机器</p>
      <Tabs
        items={[
          { key: 'log', label: '日志分析', children: <LogTool tabId={tabId} /> },
          { key: 'fw', label: '防火墙', children: <FirewallTool tabId={tabId} /> },
          { key: 'pkg', label: '软件包', children: <PackageTool tabId={tabId} /> },
          { key: 'disk', label: '磁盘清理', children: <DiskCleanTool tabId={tabId} /> },
          { key: 'diag', label: '异常诊断', children: <DiagnoseTool tabId={tabId} /> },
          { key: 'bak', label: '备份恢复', children: <BackupTool tabId={tabId} /> },
          { key: 'cfg', label: '配置回滚', children: <ConfigRollbackTool tabId={tabId} /> }
        ]}
      />
    </div>
  )
}
