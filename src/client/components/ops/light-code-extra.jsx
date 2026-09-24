/**
 * Extra light-code tabs: rsync / JSON / multi-download / quick actions
 */

import { useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Radio,
  Space,
  Table,
  Tag,
  message
} from 'antd'
import Modal from '../common/modal'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import PathField from './path-field'
import { buildRsyncCommand } from './rsync-builder'
import {
  DOWNLOAD_RENAME_POLICIES,
  applyDownloadRename,
  findDuplicateNames,
  getRenamePolicySession,
  setRenamePolicySession
} from './download-rename'
import {
  compressJson,
  diffJson,
  formatJson,
  jsonPathGet,
  jsonToCsv,
  jsonToYaml,
  validateJson
} from './json-tools'
import JsonTree from './json-tree'
import {
  CODE_PRESETS,
  runCodeOnTab
} from './code-node-engine'
import { listPlaybooks, runPlaybook } from './playbook-engine'
import { execCmd } from '../terminal/terminal-apis'
import uid from '../../common/uid'
import { auto } from 'manate/react'

export function RsyncTab () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [srcHost, setSrcHost] = useState('')
  const [srcPath, setSrcPath] = useState('/opt/app/')
  const [destHost, setDestHost] = useState('')
  const [destPath, setDestPath] = useState('/opt/app/')
  const [excludes, setExcludes] = useState('node_modules\n.git')
  const [bwlimit, setBwlimit] = useState('')
  const [compress, setCompress] = useState(true)
  const [incremental, setIncremental] = useState(true)
  const [deleteExtra, setDeleteExtra] = useState(false)
  const [sshPort, setSshPort] = useState(22)
  const [cmd, setCmd] = useState('')
  const [out, setOut] = useState('')
  const [running, setRunning] = useState(false)

  function build (dryRun) {
    return buildRsyncCommand({
      srcHost,
      srcPath,
      destHost,
      destPath,
      excludes,
      bwlimit,
      compress,
      incremental,
      dryRun,
      deleteExtra,
      sshPort
    })
  }

  function preview () {
    try {
      const c = build(false)
      setCmd(c)
    } catch (e) {
      message.warning(e.message)
    }
  }

  async function run (dryRun) {
    let c
    try {
      c = build(dryRun)
      setCmd(c)
    } catch (e) {
      return message.warning(e.message)
    }
    if (!selectedTabIds[0]) return message.warning('请选择一台执行机（跑 rsync 的机器）')
    setRunning(true)
    try {
      const r = await execCmd(selectedTabIds[0], c, 10 * 60 * 1000, { silent: true })
      setOut(String(r?.stdout || r?.out || '') + (r?.stderr ? '\n' + r.stderr : ''))
      window.store.addOpsAuditLog?.({
        action: dryRun ? 'rsync-dry-run' : 'rsync-run',
        detail: { cmd: c }
      })
      message.success(dryRun ? 'dry-run 完成' : 'rsync 执行完成')
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <div className='pd1b font12'>在选中的机器上执行 rsync（需该机已装 rsync，且能 SSH 到源/目标）</div>
      <OpsTabSelect listProps={listProps} />
      <Space wrap className='mg1b'>
        <Input style={{ width: 160 }} addonBefore='源主机' placeholder='可空=本机路径' value={srcHost} onChange={e => setSrcHost(e.target.value)} />
        <Input style={{ width: 260 }} addonBefore='源路径' value={srcPath} onChange={e => setSrcPath(e.target.value)} />
      </Space>
      <Space wrap className='mg1b'>
        <Input style={{ width: 160 }} addonBefore='目标主机' placeholder='可空' value={destHost} onChange={e => setDestHost(e.target.value)} />
        <Input style={{ width: 260 }} addonBefore='目标路径' value={destPath} onChange={e => setDestPath(e.target.value)} />
        <InputNumber min={1} max={65535} value={sshPort} onChange={v => setSshPort(v || 22)} addonBefore='SSH端口' />
        <Input style={{ width: 140 }} addonBefore='限速KB' placeholder='可选' value={bwlimit} onChange={e => setBwlimit(e.target.value)} />
      </Space>
      <Input.TextArea className='mg1b' rows={2} value={excludes} onChange={e => setExcludes(e.target.value)} placeholder='排除规则每行一个' />
      <Space wrap className='mg1b'>
        <Checkbox checked={compress} onChange={e => setCompress(e.target.checked)}>压缩</Checkbox>
        <Checkbox checked={incremental} onChange={e => setIncremental(e.target.checked)}>增量/进度</Checkbox>
        <Checkbox checked={deleteExtra} onChange={e => setDeleteExtra(e.target.checked)}>删除多余(--delete)</Checkbox>
      </Space>
      <Space className='mg1b'>
        <Button onClick={preview}>生成命令</Button>
        <Button loading={running} onClick={() => run(true)}>dry-run 预览</Button>
        <Button type='primary' loading={running} onClick={() => run(false)}>执行</Button>
        <Button onClick={() => { preview(); cmd && navigator.clipboard?.writeText(cmd); message.success('已复制') }}>复制</Button>
      </Space>
      <Input.TextArea rows={2} className='mg1b' value={cmd} readOnly style={{ fontFamily: 'monospace' }} />
      {out ? <pre className='ops-live-out' style={{ maxHeight: 220 }}>{out}</pre> : null}
    </div>
  )
}

export function JsonToolsTab () {
  const demo = `{
  "theme": {
    "primary": "#1677ff",
    "danger": "rgb(255, 77, 79)",
    "ok": true
  },
  "docs": "https://example.com/api",
  "contact": "ops@example.com",
  "updatedAt": "2026-09-24T10:30:49.078Z",
  "tags": ["ssh", "json", "tree"]
}`
  const [text, setText] = useState(demo)
  const [right, setRight] = useState('{\n  "theme": { "primary": "#000000" }\n}')
  const [path, setPath] = useState('$.theme.primary')
  const [out, setOut] = useState('')
  const [err, setErr] = useState('')
  const [showMore, setShowMore] = useState(false)

  const treeData = useMemo(() => {
    try {
      const v = validateJson(text)
      if (!v.ok) return { error: `第 ${v.line} 行附近: ${v.error}` }
      return { data: JSON.parse(text) }
    } catch (e) {
      return { error: String(e.message || e) }
    }
  }, [text])

  function doFormat () {
    try {
      setText(formatJson(text))
      setErr('')
    } catch (e) {
      const v = validateJson(text)
      setErr(`第 ${v.line} 行附近: ${v.error}`)
    }
  }

  function doValidate () {
    const v = validateJson(text)
    if (v.ok) {
      setErr('')
      message.success('JSON 合法')
    } else {
      setErr(`第 ${v.line} 行附近: ${v.error}`)
    }
  }

  function doPath () {
    try {
      const obj = JSON.parse(text)
      setOut(JSON.stringify(jsonPathGet(obj, path), null, 2))
      setErr('')
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  function doDiff () {
    const d = diffJson(text, right)
    if (!d.ok) {
      setErr(d.error)
      return
    }
    setOut(d.changes.length
      ? d.changes.map(c => `${c.path}\n  - ${JSON.stringify(c.left)}\n  + ${JSON.stringify(c.right)}`).join('\n\n')
      : '(无差异)')
    setErr('')
  }

  return (
    <div>
      <Space wrap className='mg1b'>
        <Button onClick={doValidate}>校验</Button>
        <Button type='primary' onClick={doFormat}>格式化</Button>
        <Button onClick={() => { try { setText(compressJson(text)); setErr('') } catch (e) { setErr(e.message) } }}>压缩</Button>
        <Button onClick={() => setShowMore(v => !v)}>{showMore ? '收起工具' : '更多工具'}</Button>
      </Space>
      {err ? <div className='mg1b' style={{ color: '#ff4d4f' }}>{err}</div> : null}
      <div className='pd1b font12'>源 JSON（编辑后下方树自动更新）</div>
      <Input.TextArea
        rows={7}
        className='mg1b'
        value={text}
        onChange={e => setText(e.target.value)}
        style={{ fontFamily: 'monospace' }}
      />
      <div className='pd1b font12'>树形展示</div>
      {treeData.error
        ? <div className='mg1b' style={{ color: '#ff4d4f' }}>{treeData.error}</div>
        : <JsonTree data={treeData.data} defaultExpandDepth={2} />}
      {showMore
        ? (
          <div className='mg1t'>
            <Space wrap className='mg1b'>
              <Button onClick={doDiff}>Diff</Button>
              <Input style={{ width: 180 }} value={path} onChange={e => setPath(e.target.value)} placeholder='JSONPath' />
              <Button onClick={doPath}>提取</Button>
              <Button onClick={() => { try { setOut(jsonToYaml(JSON.parse(text))); setErr('') } catch (e) { setErr(e.message) } }}>→YAML</Button>
              <Button onClick={() => { try { setOut(jsonToCsv(JSON.parse(text))); setErr('') } catch (e) { setErr(e.message) } }}>→CSV</Button>
            </Space>
            <div className='pd1b font12'>Diff 右侧</div>
            <Input.TextArea rows={4} className='mg1b' value={right} onChange={e => setRight(e.target.value)} style={{ fontFamily: 'monospace' }} />
            <div className='pd1b font12'>工具输出</div>
            <pre className='ops-live-out' style={{ maxHeight: 200 }}>{out}</pre>
          </div>
          )
        : null}
    </div>
  )
}

export function MultiDownloadTab () {
  const { selectedTabIds, listProps, tabs } = useOpsTabSelect()
  const [remotePath, setRemotePath] = useState('/var/log/app.log')
  const [localDir, setLocalDir] = useState(window.pre?.homeOrTmp || '')
  const [policy, setPolicy] = useState(getRenamePolicySession())
  const [preview, setPreview] = useState([])

  const selected = useMemo(
    () => (tabs || []).filter(t => selectedTabIds.includes(t.id) && t.host),
    [tabs, selectedTabIds]
  )

  function buildItems () {
    return selected.map(t => ({
      host: t.host,
      title: t.title || t.host,
      tabId: t.id,
      fromPath: remotePath,
      toDir: localDir,
      fromFile: { name: remotePath.split(/[\\/]/).pop(), isDirectory: false }
    }))
  }

  function doPreview () {
    const items = buildItems()
    if (!items.length) return message.warning('请选择至少一台远程机器')
    if (!remotePath.trim() || !localDir.trim()) return message.warning('请填写远程路径和本地目录')
    const dups = findDuplicateNames(items)
    const applied = applyDownloadRename(items, policy)
    setPreview(applied.map(x => ({
      host: x.host,
      fromPath: x.fromPath,
      toPath: x.toPath,
      toName: x.toName
    })))
    if (dups.length) {
      message.info(`检测到 ${dups.length} 组重名，已按「${DOWNLOAD_RENAME_POLICIES.find(p => p.value === policy)?.label}」处理`)
    }
  }

  function enqueue () {
    const items = buildItems()
    if (!items.length) return message.warning('请选择机器')
    const dups = findDuplicateNames(items)
    const run = (pol) => {
      setRenamePolicySession(pol)
      setPolicy(pol)
      const applied = applyDownloadRename(items, pol)
      setPreview(applied.map(x => ({
        host: x.host,
        fromPath: x.fromPath,
        toPath: x.toPath,
        toName: x.toName
      })))
      window.store.addTransferList(applied.map(x => ({
        id: uid(),
        typeFrom: 'remote',
        typeTo: 'local',
        fromPath: x.fromPath,
        toPath: x.toPath,
        fromName: x.fromFile?.name || remotePath.split(/[\\/]/).pop(),
        toName: x.toName,
        host: x.host,
        title: x.title,
        tabId: x.tabId,
        fromFile: x.fromFile,
        size: 0,
        inited: false,
        percent: 0
      })))
      window.store.addOpsAuditLog?.({
        action: 'multi-download',
        detail: { count: applied.length, policy: pol, remotePath }
      })
      message.success(`已加入传输队列 ${applied.length} 个`)
    }

    if (dups.length) {
      Modal.confirm({
        title: '检测到文件重名',
        width: 520,
        content: (
          <div>
            <div className='pd1b'>以下文件名在多台机器重复：</div>
            {dups.map(d => (
              <div key={d.name} className='mg1b'>
                <b>{d.name}</b>
                {d.items.map((it, i) => (
                  <div key={i} className='font12'>来自 {it.host}</div>
                ))}
              </div>
            ))}
            <div className='pd1b'>请选择处理方式：</div>
            <Radio.Group
              defaultValue={policy}
              onChange={e => setPolicy(e.target.value)}
            >
              <Space direction='vertical'>
                {DOWNLOAD_RENAME_POLICIES.map(p => (
                  <Radio key={p.value} value={p.value}>{p.label} — {p.tip}</Radio>
                ))}
              </Space>
            </Radio.Group>
          </div>
        ),
        okText: '应用到全部并下载',
        onOk: () => run(policy)
      })
    } else {
      run(policy)
    }
  }

  return (
    <div>
      <div className='pd1b font12'>从多台机器下载同一路径文件到本机；重名时可加主机后缀/序号/时间戳/目录结构</div>
      <OpsTabSelect listProps={listProps} />
      <PathField className='mg1b' tabId={selectedTabIds[0]} value={remotePath} onChange={setRemotePath} placeholder='远程文件路径' />
      <Input className='mg1b' value={localDir} onChange={e => setLocalDir(e.target.value)} addonBefore='本地目录' />
      <Radio.Group className='mg1b' value={policy} onChange={e => { setPolicy(e.target.value); setRenamePolicySession(e.target.value) }}>
        <Space wrap>
          {DOWNLOAD_RENAME_POLICIES.map(p => (
            <Radio key={p.value} value={p.value}>{p.label}</Radio>
          ))}
        </Space>
      </Radio.Group>
      <Space className='mg1b'>
        <Button onClick={doPreview}>预览目标名</Button>
        <Button type='primary' onClick={enqueue}>加入下载队列</Button>
      </Space>
      {preview.length
        ? (
          <Table
            size='small'
            pagination={false}
            rowKey={(_, i) => i}
            dataSource={preview}
            columns={[
              { title: '主机', dataIndex: 'host', width: 140 },
              { title: '远程', dataIndex: 'fromPath', ellipsis: true },
              { title: '本地目标', dataIndex: 'toPath', ellipsis: true }
            ]}
          />
          )
        : null}
    </div>
  )
}

function QuickActionsInner () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const quick = Array.isArray(window.store.opsQuickActions) ? window.store.opsQuickActions : []
  const playbooks = listPlaybooks()
  const [running, setRunning] = useState('')

  function addPreset (id) {
    const p = CODE_PRESETS.find(x => x.id === id)
    if (!p) return
    const list = quick.slice()
    if (list.some(x => x.type === 'preset' && x.refId === id)) {
      return message.info('已在快捷中')
    }
    list.push({ id: uid(), type: 'preset', refId: id, name: p.name })
    window.store.opsQuickActions = list
    message.success('已加入快捷操作')
  }

  function addPlaybook (id) {
    const pb = playbooks.find(x => x.id === id)
    if (!pb) return
    const list = quick.slice()
    if (list.some(x => x.type === 'playbook' && x.refId === id)) {
      return message.info('已在快捷中')
    }
    list.push({ id: uid(), type: 'playbook', refId: id, name: pb.name })
    window.store.opsQuickActions = list
    message.success('已加入快捷操作')
  }

  async function runQuick (item) {
    if (!selectedTabIds[0] && item.type !== 'playbook') {
      return message.warning('请选择机器')
    }
    setRunning(item.id)
    try {
      if (item.type === 'preset') {
        const p = CODE_PRESETS.find(x => x.id === item.refId)
        if (!p) throw new Error('预设不存在')
        const params = {}
        for (const x of p.params || []) params[x.key] = x.default
        const r = await runCodeOnTab({
          tabId: selectedTabIds[0],
          language: p.language,
          code: p.code,
          params
        })
        message[r.success ? 'success' : 'error'](r.success ? `${item.name} 完成` : (r.raw_stderr || '失败'))
      } else {
        const pb = playbooks.find(x => x.id === item.refId)
        if (!pb) throw new Error('剧本不存在')
        const r = await runPlaybook(pb, {
          tabIds: selectedTabIds,
          defaultTabId: selectedTabIds[0]
        })
        message[r.success ? 'success' : 'warning'](r.success ? '剧本完成' : '剧本未全部成功')
      }
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning('')
    }
  }

  return (
    <div>
      <div className='pd1b font12'>常用预设/剧本一键触发（会话内保存在本地）</div>
      <OpsTabSelect listProps={listProps} />
      <Space wrap className='mg1b'>
        <span>加预设：</span>
        {CODE_PRESETS.map(p => (
          <Button key={p.id} size='small' onClick={() => addPreset(p.id)}>{p.name}</Button>
        ))}
      </Space>
      <Space wrap className='mg1b'>
        <span>加剧本：</span>
        {playbooks.length
          ? playbooks.map(p => (
            <Button key={p.id} size='small' onClick={() => addPlaybook(p.id)}>{p.name}</Button>
            ))
          : <Tag>暂无剧本</Tag>}
      </Space>
      <Table
        size='small'
        pagination={false}
        rowKey='id'
        dataSource={quick}
        locale={{ emptyText: '还没有快捷操作，点上面按钮添加' }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            width: 90,
            render: (_, r) => r.type === 'preset' ? '预设' : '剧本'
          },
          {
            title: '操作',
            width: 160,
            render: (_, r) => (
              <Space>
                <Button type='primary' size='small' loading={running === r.id} onClick={() => runQuick(r)}>执行</Button>
                <Button
                  size='small'
                  danger
                  onClick={() => {
                    window.store.opsQuickActions = quick.filter(x => x.id !== r.id)
                  }}
                >
                  移除
                </Button>
              </Space>
            )
          }
        ]}
      />
    </div>
  )
}

export const QuickActionsTab = auto(QuickActionsInner)
