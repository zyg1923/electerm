/**
 * Light-code hub: code node + playbook + curl generator + presets.
 */

import { useMemo, useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message
} from 'antd'
import Modal from '../common/modal'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import {
  CODE_LANGUAGES,
  CODE_PRESETS,
  detectDangerousCode,
  downloadTextFile,
  exportBatchCsv,
  retryFailedBatch,
  runCodeBatch,
  runCodeOnTab
} from './code-node-engine'
import { buildCurlCommand, buildOkHttpJava, CURL_METHODS, parseCurlCommand, parseOkHttpJava } from './curl-builder'
import {
  createEmptyPlaybook,
  createEmptyStep,
  listPlaybooks,
  removePlaybook,
  runPlaybook,
  savePlaybook,
  STEP_ON_FAIL
} from './playbook-engine'
import {
  JsonToolsTab,
  MultiDownloadTab,
  QuickActionsTab,
  RsyncTab
} from './light-code-extra'
import { execCmd } from '../terminal/terminal-apis'
import { auto } from 'manate/react'

function paramsFromPreset (preset, values) {
  const out = {}
  for (const p of preset.params || []) {
    out[p.key] = values[p.key] ?? p.default ?? ''
  }
  return out
}

function CodeRunTab () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [language, setLanguage] = useState('shell')
  const [code, setCode] = useState('echo "{\\"ok\\": true, \\"host\\": \\"{{host}}\\"}"')
  const [paramsJson, setParamsJson] = useState('{\n  "url": "http://127.0.0.1:8080/health",\n  "timeout": 5\n}')
  const [workDir, setWorkDir] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(60)
  const [concurrency, setConcurrency] = useState(3)
  const [execTarget, setExecTarget] = useState('remote')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [batch, setBatch] = useState(null)

  function parseParams () {
    try {
      return JSON.parse(paramsJson || '{}')
    } catch (e) {
      throw new Error('params JSON 无效')
    }
  }

  async function runOne () {
    if (execTarget === 'remote' && !selectedTabIds.length) {
      return message.warning('请选择机器')
    }
    let params
    try {
      params = parseParams()
    } catch (e) {
      return message.warning(e.message)
    }
    const dangers = detectDangerousCode(code)
    if (dangers.length) {
      Modal.confirm({
        title: '检测到可能危险的命令',
        content: dangers.join('\n'),
        okText: '仍要执行',
        onOk: () => doRun(params, true)
      })
      return
    }
    await doRun(params, false)
  }

  async function doRun (params, skipDanger) {
    setRunning(true)
    setBatch(null)
    try {
      if (execTarget === 'local' || selectedTabIds.length <= 1) {
        const r = await runCodeOnTab({
          tabId: execTarget === 'local' ? 'local' : selectedTabIds[0],
          language,
          code,
          params,
          workDir: workDir || undefined,
          timeoutMs: timeoutMs * 1000,
          skipDangerCheck: skipDanger,
          execTarget
        })
        setResult(r)
        message[r.success ? 'success' : 'error'](r.success ? '执行完成' : (r.raw_stderr || '执行失败'))
      } else {
        const b = await runCodeBatch({
          tabIds: selectedTabIds,
          language,
          code,
          params,
          workDir: workDir || undefined,
          timeoutMs: timeoutMs * 1000,
          concurrency,
          skipDangerCheck: skipDanger,
          execTarget: 'remote',
          onProgress: () => {}
        })
        setBatch(b)
        setResult(b.results?.[0] || null)
        message.info(`批量完成：成功 ${b.success} / 失败 ${b.failed}`)
      }
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning(false)
    }
  }

  function loadPreset (id) {
    const p = CODE_PRESETS.find(x => x.id === id)
    if (!p) return
    setLanguage(p.language)
    setCode(p.code)
    const obj = {}
    for (const x of p.params || []) {
      obj[x.key] = x.default
    }
    setParamsJson(JSON.stringify(obj, null, 2))
    message.success('已加载预设: ' + p.name)
  }

  async function onRetryFailed () {
    if (!batch) return
    setRunning(true)
    try {
      const params = parseParams()
      const next = await retryFailedBatch(batch, {
        language,
        code,
        params,
        workDir: workDir || undefined,
        timeoutMs: timeoutMs * 1000,
        concurrency,
        execTarget: 'remote'
      })
      setBatch(next)
      message.info(`重试完成：成功 ${next.success} / 失败 ${next.failed}`)
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <OpsTabSelect listProps={listProps} />
      <Space wrap className='mg1b'>
        <Radio.Group value={execTarget} onChange={e => setExecTarget(e.target.value)}>
          <Radio.Button value='remote'>远程 SSH</Radio.Button>
          <Radio.Button value='local'>本机</Radio.Button>
        </Radio.Group>
        <Select
          style={{ width: 180 }}
          value={language}
          onChange={setLanguage}
          options={CODE_LANGUAGES.map(l => ({ value: l.id, label: l.label }))}
        />
        <Select
          style={{ width: 200 }}
          placeholder='加载预设脚本'
          allowClear
          onChange={v => v && loadPreset(v)}
          options={CODE_PRESETS.map(p => ({ value: p.id, label: p.name }))}
        />
        <Input
          style={{ width: 200 }}
          placeholder='工作目录 work_dir'
          value={workDir}
          onChange={e => setWorkDir(e.target.value)}
        />
        <span>超时(秒)</span>
        <InputNumber min={5} max={600} value={timeoutMs} onChange={v => setTimeoutMs(v || 60)} />
        <span>并发</span>
        <InputNumber min={1} max={10} value={concurrency} onChange={v => setConcurrency(v || 3)} />
        <Button type='primary' loading={running} onClick={runOne}>
          {execTarget === 'local'
            ? '本机执行'
            : (selectedTabIds.length > 1 ? `批量执行 (${selectedTabIds.length})` : '执行')}
        </Button>
      </Space>
      <div className='pd1b font12'>代码（Python/JS 用 ctx；Shell 可用 {'{{work_dir}}'} {'{{params.xxx}}'}）</div>
      <Input.TextArea
        rows={12}
        value={code}
        onChange={e => setCode(e.target.value)}
        className='mg1b'
        style={{ fontFamily: 'monospace' }}
      />
      <div className='pd1b font12'>params（JSON）</div>
      <Input.TextArea
        rows={4}
        value={paramsJson}
        onChange={e => setParamsJson(e.target.value)}
        className='mg1b'
        style={{ fontFamily: 'monospace' }}
      />
      {batch
        ? (
          <div className='mg1b'>
            <Space className='mg1b'>
              <Tag color='blue'>批量 {batch.success}/{batch.total}</Tag>
              <Button size='small' disabled={!batch.failed} loading={running} onClick={onRetryFailed}>
                失败重试 ({batch.failed || 0})
              </Button>
              <Button
                size='small'
                onClick={() => {
                  downloadTextFile(`batch-${batch.batch_id || Date.now()}.csv`, exportBatchCsv(batch))
                  message.success('已导出 CSV')
                }}
              >
                导出 CSV
              </Button>
            </Space>
            <Table
              size='small'
              pagination={false}
              rowKey={(r, i) => r.tabId || i}
              dataSource={batch.results || []}
              columns={[
                { title: '主机', dataIndex: 'host', width: 140 },
                {
                  title: '结果',
                  width: 80,
                  render: (_, r) => r.success ? <Tag color='green'>成功</Tag> : <Tag color='red'>失败</Tag>
                },
                {
                  title: '输出',
                  ellipsis: true,
                  render: (_, r) => JSON.stringify(r.output || {})
                },
                { title: '错误', dataIndex: 'raw_stderr', ellipsis: true }
              ]}
            />
          </div>
          )
        : null}
      {result
        ? (
          <pre className='ops-live-out' style={{ maxHeight: 240, overflow: 'auto' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
          )
        : null}
    </div>
  )
}

function PlaybookTabInner () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const playbooks = listPlaybooks()
  const [currentId, setCurrentId] = useState(playbooks[0]?.id || '')
  const current = useMemo(
    () => playbooks.find(p => p.id === currentId) || playbooks[0] || null,
    [playbooks, currentId]
  )
  const [draft, setDraft] = useState(null)
  const editing = draft || current
  const [running, setRunning] = useState(false)
  const [timeline, setTimeline] = useState([])

  function ensureDraft () {
    if (draft) return draft
    const base = current ? JSON.parse(JSON.stringify(current)) : createEmptyPlaybook()
    setDraft(base)
    setCurrentId(base.id)
    return base
  }

  function patchDraft (fn) {
    const d = ensureDraft()
    const next = fn(JSON.parse(JSON.stringify(d)))
    setDraft(next)
  }

  function onSave () {
    const d = draft || current
    if (!d) return
    const saved = savePlaybook(d)
    setDraft(null)
    setCurrentId(saved.id)
    message.success('剧本已保存')
  }

  function onNew () {
    const pb = createEmptyPlaybook()
    savePlaybook(pb)
    setDraft(null)
    setCurrentId(pb.id)
  }

  async function onRun () {
    const pb = draft || current
    if (!pb) return message.warning('没有剧本')
    if (!selectedTabIds.length) return message.warning('请选择机器')
    setRunning(true)
    setTimeline([])
    try {
      const r = await runPlaybook(pb, {
        tabIds: selectedTabIds,
        defaultTabId: selectedTabIds[0],
        onStep: (entry) => {
          setTimeline(prev => {
            const next = prev.slice()
            const idx = next.findIndex(x => x.stepId === entry.stepId)
            if (idx >= 0) next[idx] = { ...next[idx], ...entry }
            else next.push(entry)
            return next
          })
        }
      })
      message[r.success ? 'success' : 'warning'](r.success ? '剧本执行完成' : '剧本未全部成功')
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning(false)
    }
  }

  if (!editing) {
    return (
      <div>
        <Button type='primary' onClick={onNew}>新建剧本</Button>
      </div>
    )
  }

  return (
    <div>
      <OpsTabSelect listProps={listProps} />
      <Space wrap className='mg1b'>
        <Select
          style={{ width: 220 }}
          value={editing.id}
          onChange={id => {
            setDraft(null)
            setCurrentId(id)
          }}
          options={playbooks.map(p => ({ value: p.id, label: p.name }))}
        />
        <Button onClick={onNew}>新建</Button>
        <Button type='primary' onClick={onSave}>保存</Button>
        <Button
          danger
          onClick={() => {
            removePlaybook(editing.id)
            setDraft(null)
            setCurrentId(listPlaybooks()[0]?.id || '')
            message.success('已删除')
          }}
        >
          删除
        </Button>
        <Button type='primary' loading={running} onClick={onRun}>执行剧本</Button>
      </Space>
      <Input
        className='mg1b'
        value={editing.name}
        onChange={e => patchDraft(d => { d.name = e.target.value; return d })}
        placeholder='剧本名称'
      />
      <Input
        className='mg1b'
        value={editing.description || ''}
        onChange={e => patchDraft(d => { d.description = e.target.value; return d })}
        placeholder='描述'
      />
      {(editing.steps || []).map((step, i) => (
        <div key={step.id} className='mg1b' style={{ border: '1px solid rgba(127,127,127,.25)', padding: 8, borderRadius: 4 }}>
          <Space wrap className='mg1b'>
            <Input
              style={{ width: 160 }}
              value={step.name}
              onChange={e => patchDraft(d => { d.steps[i].name = e.target.value; return d })}
            />
            <Select
              style={{ width: 110 }}
              value={step.type}
              onChange={v => patchDraft(d => { d.steps[i].type = v; return d })}
              options={[
                { value: 'code', label: '代码节点' },
                { value: 'command', label: '命令' }
              ]}
            />
            {step.type === 'code'
              ? (
                <Select
                  style={{ width: 150 }}
                  value={step.language}
                  onChange={v => patchDraft(d => { d.steps[i].language = v; return d })}
                  options={CODE_LANGUAGES.map(l => ({ value: l.id, label: l.label }))}
                />
                )
              : null}
            <Select
              style={{ width: 140 }}
              value={step.onFail || 'stop'}
              onChange={v => patchDraft(d => { d.steps[i].onFail = v; return d })}
              options={STEP_ON_FAIL}
            />
            {step.onFail === 'retry'
              ? (
                <InputNumber
                  min={0}
                  max={5}
                  value={step.retries ?? 1}
                  onChange={v => patchDraft(d => { d.steps[i].retries = v; return d })}
                  addonBefore='重试'
                />
                )
              : null}
            <Select
              style={{ width: 180 }}
              allowClear
              placeholder='指定机器(默认所选)'
              value={step.tabId || undefined}
              onChange={v => patchDraft(d => { d.steps[i].tabId = v || ''; return d })}
              options={(window.store.tabs || [])
                .filter(t => t.host)
                .map(t => ({ value: t.id, label: t.title || t.host }))}
            />
            <Button
              size='small'
              danger
              onClick={() => patchDraft(d => {
                d.steps = d.steps.filter((_, j) => j !== i)
                return d
              })}
            >
              删步骤
            </Button>
          </Space>
          <Input.TextArea
            rows={4}
            value={step.type === 'command' ? step.command : step.code}
            onChange={e => patchDraft(d => {
              if (d.steps[i].type === 'command') d.steps[i].command = e.target.value
              else d.steps[i].code = e.target.value
              return d
            })}
            style={{ fontFamily: 'monospace' }}
            placeholder={step.type === 'command' ? '远程命令' : '代码'}
          />
        </div>
      ))}
      <Button
        className='mg1b'
        onClick={() => patchDraft(d => {
          d.steps.push(createEmptyStep(d.steps.length + 1))
          return d
        })}
      >
        添加步骤
      </Button>
      {timeline.length
        ? (
          <Table
            size='small'
            pagination={false}
            rowKey='stepId'
            dataSource={timeline}
            columns={[
              { title: '步骤', dataIndex: 'name', width: 140 },
              {
                title: '状态',
                width: 90,
                render: (_, r) => {
                  if (r.status === 'running') return <Tag color='processing'>执行中</Tag>
                  if (r.success) return <Tag color='green'>成功</Tag>
                  if (r.status === 'error' || r.success === false) return <Tag color='red'>失败</Tag>
                  return <Tag>{r.status || '-'}</Tag>
                }
              },
              {
                title: '输出',
                ellipsis: true,
                render: (_, r) => r.result ? JSON.stringify(r.result.output || {}) : (r.error || '')
              }
            ]}
          />
          )
        : null}
    </div>
  )
}

const PlaybookTab = auto(PlaybookTabInner)

function CurlTab () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [url, setUrl] = useState('http://127.0.0.1:8080/health')
  const [method, setMethod] = useState('GET')
  const [headers, setHeaders] = useState([{ key: 'Accept', value: 'application/json' }])
  const [body, setBody] = useState('')
  const [bodyType, setBodyType] = useState('raw')
  const [timeout, setTimeoutSec] = useState(30)
  const [follow, setFollow] = useState(true)
  const [cmd, setCmd] = useState('')
  const [okhttp, setOkhttp] = useState('')
  const [pasteBox, setPasteBox] = useState('')
  const [out, setOut] = useState('')
  const [running, setRunning] = useState(false)

  function formState () {
    return { url, method, headers, body, bodyType, timeout, followRedirect: follow }
  }

  function applyForm (f) {
    setUrl(f.url || '')
    setMethod(f.method || 'GET')
    setHeaders(f.headers?.length ? f.headers : [])
    setBody(f.body || '')
    setBodyType(f.bodyType || 'raw')
    setTimeoutSec(f.timeout || 30)
    setFollow(f.followRedirect !== false)
  }

  function refresh () {
    try {
      const c = buildCurlCommand(formState())
      setCmd(c)
      return c
    } catch (e) {
      setCmd('')
      message.warning(e.message)
      return ''
    }
  }

  function genOkHttp () {
    try {
      const code = buildOkHttpJava(formState())
      setOkhttp(code)
      message.success('已生成 OkHttp')
      return code
    } catch (e) {
      message.warning(e.message)
      return ''
    }
  }

  function parsePasteAsCurl () {
    try {
      const f = parseCurlCommand(pasteBox || cmd)
      applyForm(f)
      const c = buildCurlCommand({ ...f, followRedirect: f.followRedirect !== false })
      setCmd(c)
      message.success('已从 curl 解析到表单')
    } catch (e) {
      message.error(e.message)
    }
  }

  function parsePasteAsOkHttp () {
    try {
      const f = parseOkHttpJava(pasteBox || okhttp)
      applyForm(f)
      setCmd(buildCurlCommand({ ...f, followRedirect: true }))
      setOkhttp(buildOkHttpJava(f))
      message.success('已从 OkHttp 解析到表单 / curl')
    } catch (e) {
      message.error(e.message)
    }
  }

  async function runRemote () {
    let c = cmd
    try {
      c = buildCurlCommand(formState())
      setCmd(c)
    } catch (e) {
      return message.warning(e.message)
    }
    if (!selectedTabIds[0]) return message.warning('请选择机器')
    setRunning(true)
    try {
      const r = await execCmd(selectedTabIds[0], c, (timeout + 5) * 1000, { silent: true })
      setOut(String(r?.stdout || r?.out || r?.stderr || ''))
      window.store.addOpsAuditLog?.({ action: 'curl-run', detail: { cmd: c } })
      message.success('已在远程执行')
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <OpsTabSelect listProps={listProps} />
      <Space wrap className='mg1b'>
        <Select
          style={{ width: 110 }}
          value={method}
          onChange={setMethod}
          options={CURL_METHODS.map(m => ({ value: m, label: m }))}
        />
        <Input style={{ width: 360 }} value={url} onChange={e => setUrl(e.target.value)} placeholder='URL' />
        <InputNumber min={1} max={300} value={timeout} onChange={v => setTimeoutSec(v || 30)} addonBefore='超时' />
        <Radio.Group value={follow} onChange={e => setFollow(e.target.value)}>
          <Radio value>跟随重定向</Radio>
          <Radio value={false}>不跟随</Radio>
        </Radio.Group>
      </Space>
      <div className='pd1b font12'>Headers</div>
      {(headers || []).map((h, i) => (
        <Space key={i} className='mg1b'>
          <Input
            style={{ width: 160 }}
            value={h.key}
            placeholder='Key'
            onChange={e => {
              const next = headers.slice()
              next[i] = { ...next[i], key: e.target.value }
              setHeaders(next)
            }}
          />
          <Input
            style={{ width: 240 }}
            value={h.value}
            placeholder='Value'
            onChange={e => {
              const next = headers.slice()
              next[i] = { ...next[i], value: e.target.value }
              setHeaders(next)
            }}
          />
          <Button size='small' onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>删</Button>
        </Space>
      ))}
      <Button size='small' className='mg1b' onClick={() => setHeaders([...headers, { key: '', value: '' }])}>加 Header</Button>
      <div className='pd1b font12'>Body</div>
      <Radio.Group className='mg1b' value={bodyType} onChange={e => setBodyType(e.target.value)}>
        <Radio value='raw'>raw</Radio>
        <Radio value='form'>form (每行 key=value)</Radio>
      </Radio.Group>
      <Input.TextArea rows={4} className='mg1b' value={body} onChange={e => setBody(e.target.value)} />
      <Space wrap className='mg1b'>
        <Button onClick={refresh}>生成 curl</Button>
        <Button
          onClick={() => {
            const c = refresh()
            if (c) {
              navigator.clipboard?.writeText(c)
              message.success('curl 已复制')
            }
          }}
        >
          复制 curl
        </Button>
        <Button onClick={genOkHttp}>生成 OkHttp</Button>
        <Button
          onClick={() => {
            const code = genOkHttp()
            if (code) {
              navigator.clipboard?.writeText(code)
              message.success('OkHttp 已复制')
            }
          }}
        >
          复制 OkHttp
        </Button>
        <Button type='primary' loading={running} onClick={runRemote}>远程执行</Button>
      </Space>
      <div className='pd1b font12'>curl 命令</div>
      <Input.TextArea rows={3} className='mg1b' value={cmd} onChange={e => setCmd(e.target.value)} style={{ fontFamily: 'monospace' }} />
      <div className='pd1b font12'>OkHttp (Java)</div>
      <Input.TextArea rows={8} className='mg1b' value={okhttp} onChange={e => setOkhttp(e.target.value)} style={{ fontFamily: 'monospace' }} />
      <div className='pd1b font12'>粘贴 curl 或 OkHttp 代码 → 反解析到表单</div>
      <Input.TextArea
        rows={4}
        className='mg1b'
        value={pasteBox}
        onChange={e => setPasteBox(e.target.value)}
        placeholder={'粘贴例如：\ncurl -X POST -H \'Content-Type: application/json\' -d \'{"a":1}\' http://...\n或 OkHttp Request.Builder().url("http://...")...'}
        style={{ fontFamily: 'monospace' }}
      />
      <Space className='mg1b'>
        <Button onClick={parsePasteAsCurl}>curl → 表单</Button>
        <Button onClick={parsePasteAsOkHttp}>OkHttp → 表单/curl</Button>
        <Button
          onClick={() => {
            try {
              const f = parseCurlCommand(pasteBox || cmd)
              const code = buildOkHttpJava(f)
              applyForm(f)
              setOkhttp(code)
              setCmd(buildCurlCommand({ ...f, followRedirect: f.followRedirect !== false }))
              message.success('curl → OkHttp 完成')
            } catch (e) {
              message.error(e.message)
            }
          }}
        >
          curl → OkHttp
        </Button>
      </Space>
      {out ? <pre className='ops-live-out' style={{ maxHeight: 200 }}>{out}</pre> : null}
    </div>
  )
}

function PresetTab () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [paramMap, setParamMap] = useState({})
  const [running, setRunning] = useState('')
  const [last, setLast] = useState(null)

  async function runPreset (preset) {
    if (!selectedTabIds[0]) return message.warning('请选择机器')
    const values = paramMap[preset.id] || {}
    const params = paramsFromPreset(preset, values)
    setRunning(preset.id)
    try {
      const r = await runCodeOnTab({
        tabId: selectedTabIds[0],
        language: preset.language,
        code: preset.code,
        params,
        timeoutMs: 60000
      })
      setLast(r)
      message[r.success ? 'success' : 'error'](r.success ? '完成' : (r.raw_stderr || '失败'))
    } catch (err) {
      message.error(String(err?.message || err))
    } finally {
      setRunning('')
    }
  }

  return (
    <div>
      <OpsTabSelect listProps={listProps} />
      {CODE_PRESETS.map(p => (
        <div key={p.id} className='mg1b' style={{ border: '1px solid rgba(127,127,127,.25)', padding: 8, borderRadius: 4 }}>
          <div className='bold'>{p.name}</div>
          <div className='font12 pd1b'>{p.desc} · {p.language}</div>
          <Space wrap className='mg1b'>
            {(p.params || []).map(param => (
              <Input
                key={param.key}
                style={{ width: 200 }}
                addonBefore={param.label}
                value={(paramMap[p.id] || {})[param.key] ?? param.default}
                onChange={e => setParamMap(prev => ({
                  ...prev,
                  [p.id]: { ...(prev[p.id] || {}), [param.key]: e.target.value }
                }))}
              />
            ))}
            <Button type='primary' loading={running === p.id} onClick={() => runPreset(p)}>执行</Button>
          </Space>
        </div>
      ))}
      {last
        ? <pre className='ops-live-out' style={{ maxHeight: 200 }}>{JSON.stringify(last, null, 2)}</pre>
        : null}
    </div>
  )
}

export default auto(function LightCodePanel () {
  return (
    <Tabs
      size='small'
      items={[
        { key: 'quick', label: '快捷操作', children: <QuickActionsTab /> },
        { key: 'code', label: '代码执行', children: <CodeRunTab /> },
        { key: 'playbook', label: '编排剧本', children: <PlaybookTab /> },
        { key: 'preset', label: '预设脚本', children: <PresetTab /> },
        { key: 'curl', label: 'curl 生成器', children: <CurlTab /> },
        { key: 'rsync', label: 'rsync 生成器', children: <RsyncTab /> },
        { key: 'download', label: '多机下载', children: <MultiDownloadTab /> },
        { key: 'json', label: 'JSON 工具', children: <JsonToolsTab /> }
      ]}
    />
  )
})
