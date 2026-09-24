/**
 * Docker ops panel
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Input,
  Space,
  Table,
  Tag,
  Select,
  Tabs,
  message
} from 'antd'
import Modal from '../common/modal'
import { notification } from '../common/notification'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import {
  listContainersMany,
  dockerAction,
  dockerLogs,
  lastLogTimestamp,
  restartContainer,
  dockerInspect,
  dockerStats,
  listImages,
  dockerPull,
  dockerPublish,
  dockerRollback,
  listCompose,
  composeAction,
  dockerDiagnose
} from './docker-engine'
import { openOpsFileEditor } from './ops-file-editor'
import { findMatchIndexes, clampHit, renderHighlighted, matchLabel } from './ops-find'

export default function DockerPanel () {
  const { tabs, selectedTabIds, listProps } = useOpsTabSelect()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState([])
  const [logTabs, setLogTabs] = useState([])
  const [activeLog, setActiveLog] = useState('')
  const [batchResults, setBatchResults] = useState([])
  const [detail, setDetail] = useState(null)
  const [rolling, setRolling] = useState(false)
  const [images, setImages] = useState([])
  const [compose, setCompose] = useState([])
  const [diag, setDiag] = useState([])
  const [pubName, setPubName] = useState('')
  const [pubImage, setPubImage] = useState('')
  const [pubPort, setPubPort] = useState('')
  const [lastPrev, setLastPrev] = useState({})
  const [composeDir, setComposeDir] = useState('.')
  const [editPath, setEditPath] = useState('/etc/nginx/nginx.conf')

  const timers = useRef({})
  const busy = useRef({})
  const logsRef = useRef([])

  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(id => clearInterval(id))
    }
  }, [])

  useEffect(() => {
    if (selectedTabIds.length || tabs.length) {
      refresh()
    }
    // first paint: auto-list containers on currently selected SSH tabs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function notify (ok, title, desc) {
    const fn = ok ? notification.success : notification.error
    fn({ message: title, description: desc || '', duration: ok ? 6 : 12 })
  }

  function patchLogs (next) {
    logsRef.current = next
    setLogTabs(next)
  }

  function patchLog (key, patch) {
    const next = logsRef.current.map(t => t.key === key ? { ...t, ...patch } : t)
    patchLogs(next)
  }

  function stopFollow (key) {
    if (timers.current[key]) {
      clearInterval(timers.current[key])
      delete timers.current[key]
    }
    if (logsRef.current.some(t => t.key === key)) {
      patchLog(key, { following: false })
    }
  }
  const flat = useMemo(() => {
    const list = []
    for (const host of rows) {
      for (const c of host.containers || []) {
        list.push({
          ...c,
          tabId: host.tabId,
          hostTitle: host.title,
          host: host.host,
          rowKey: `${host.tabId}::${c.id || c.name}`
        })
      }
    }
    list.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9) || String(a.name).localeCompare(String(b.name)))
    return list.filter(c => {
      if (statusFilter === 'abnormal' && !c.abnormal) return false
      if (statusFilter === 'restarting' && c.level !== 'restarting') return false
      if (statusFilter === 'up' && c.level !== 'running') return false
      if (statusFilter === 'exited' && c.level !== 'exited' && c.level !== 'exited-bad') return false
      if (filter) {
        const q = filter.toLowerCase()
        return [c.name, c.image, c.status, c.hostTitle, c.host].join(' ').toLowerCase().includes(q)
      }
      return true
    })
  }, [rows, filter, statusFilter])

  async function refresh () {
    const targets = selectedTabIds.length
      ? tabs.filter(t => selectedTabIds.includes(t.id))
      : tabs
    if (!targets.length) return message.warning(ot('tabsRequired'))
    setLoading(true)
    try {
      const conc = window.store.config.opsCollectConcurrency || 3
      const out = await listContainersMany(targets, conc)
      setRows(out)
      const bad = out.filter(h => h.error)
      if (bad.length) {
        message.warning(bad.map(h => `${h.title || h.host}: ${h.error}`).join('；'))
      }
      window.store.addOpsAuditLog({ action: 'docker-ps', detail: { hosts: targets.length, errors: bad.length } })
    } finally {
      setLoading(false)
    }
  }

  function pickedRows () {
    return selected.map(key => flat.find(r => r.rowKey === key)).filter(Boolean)
  }

  async function applyOne (row, action) {
    if (action === 'restart') return restartContainer(row.tabId, row.name || row.id)
    const r = await dockerAction(row.tabId, action, row.name || row.id)
    return { ok: r.ok, err: r.err || r.out }
  }

  function confirmBatch (action) {
    const picked = pickedRows()
    if (!picked.length) return message.warning('请先勾选容器')
    const lines = picked.map(r => `${r.host || r.hostTitle} / ${r.name}（${r.status || r.level}）`).join('\n')
    const mode = rolling && action === 'restart' ? '滚动（失败即停）' : '并行'
    Modal.confirm({
      title: action === 'restart' ? '确定批量重启？' : `确认批量 ${action}？`,
      content: (
        <div>
          <div className='mg1b'>策略：{mode}，共 {picked.length} 个容器</div>
          <pre className='ops-live-out'>{lines}</pre>
        </div>
      ),
      onOk: async () => {
        const results = []
        const conc = window.store.config.opsCollectConcurrency || 3
        if (rolling && action === 'restart') {
          for (const row of picked) {
            const r = await applyOne(row, action)
            results.push({ key: row.rowKey, host: row.hostTitle, name: row.name, ok: r.ok, err: r.err })
            if (!r.ok) break
          }
        } else {
          let i = 0
          async function worker () {
            while (i < picked.length) {
              const row = picked[i]
              i += 1
              const r = await applyOne(row, action)
              results.push({ key: row.rowKey, host: row.hostTitle, name: row.name, ok: r.ok, err: r.err })
            }
          }
          await Promise.all(Array.from({ length: Math.min(conc, picked.length) }, worker))
        }
        setBatchResults(results)
        const failed = results.filter(r => !r.ok).length
        window.store.addOpsAuditLog({
          action: 'docker-' + action,
          detail: { count: results.length, failed, rolling: !!(rolling && action === 'restart') }
        })
        notify(failed === 0, action === 'restart' ? '重启完成' : '操作完成', `成功 ${results.length - failed}，失败 ${failed}`)
        refresh()
      }
    })
  }

  function confirmOne (row, action) {
    const title = action === 'restart'
      ? `确定重启容器 ${row.name}？`
      : `确定${action === 'stop' ? '停止' : '启动'}容器 ${row.name}？`
    Modal.confirm({
      title,
      content: `机器 ${row.host || row.hostTitle || '-'}，当前状态：${row.status || row.level || '-'}`,
      onOk: async () => {
        const r = await applyOne(row, action)
        window.store.addOpsAuditLog({
          action: 'docker-' + action,
          detail: { host: row.hostTitle, name: row.name, ok: r.ok, err: r.err || '' }
        })
        if (action === 'restart' && r.after) {
          const health = r.after.health ? `，健康 ${r.after.health}` : ''
          notify(r.ok, r.ok ? '重启完成' : '重启失败', `${row.name} 现状态 ${r.after.status || '-'}${health}${r.err ? '：' + r.err : ''}`)
        } else {
          notify(r.ok, r.ok ? '操作完成' : '操作失败', r.ok ? row.name : (r.err || row.name))
        }
        refresh()
      }
    })
  }

  async function openLogs (row, range = 'tail') {
    const name = row.name || row.id
    const key = `${row.tabId}::${name}`
    const sinceMap = { '5m': '5m', '1h': '1h', '24h': '24h' }
    const since = sinceMap[range] || ''
    stopFollow(key)
    const base = {
      key,
      tabId: row.tabId,
      name,
      hostTitle: row.hostTitle || row.host || '',
      text: '加载中…',
      keyword: (logsRef.current.find(t => t.key === key) || {}).keyword || '',
      following: false,
      range,
      sinceCursor: ''
    }
    const exists = logsRef.current.some(t => t.key === key)
    patchLogs(exists ? logsRef.current.map(t => t.key === key ? { ...t, ...base, keyword: t.keyword } : t) : [...logsRef.current, base])
    setActiveLog(key)
    const r = await dockerLogs(row.tabId, name, since ? { since, withTail: false, lines: 500 } : { lines: 200 })
    const text = r.out || r.err || '(空)'
    patchLog(key, { text, sinceCursor: lastLogTimestamp(text) })
    window.store.addOpsAuditLog({ action: 'docker-logs', detail: { host: row.hostTitle, name, range } })
  }

  function startFollow (key) {
    stopFollow(key)
    patchLog(key, { following: true })
    const tick = async () => {
      if (busy.current[key]) return
      const tab = logsRef.current.find(t => t.key === key)
      if (!tab || !tab.following) return
      busy.current[key] = true
      try {
        const since = tab.sinceCursor || '2s'
        const r = await dockerLogs(tab.tabId, tab.name, { since, withTail: false })
        const chunk = (r.out || '').trim()
        if (!chunk) return
        const prevText = tab.text === '加载中…' ? '' : (tab.text || '')
        const lines = chunk.split('\n')
        const last = prevText.split('\n').filter(Boolean).pop()
        const fresh = lines[0] === last ? lines.slice(1).join('\n') : chunk
        if (!fresh.trim()) return
        const text = prevText ? `${prevText}\n${fresh}` : fresh
        patchLog(key, { text, sinceCursor: lastLogTimestamp(text) || tab.sinceCursor })
      } finally {
        busy.current[key] = false
      }
    }
    timers.current[key] = setInterval(tick, 1500)
    tick()
  }

  function closeLog (key) {
    stopFollow(key)
    const next = logsRef.current.filter(t => t.key !== key)
    patchLogs(next)
    if (activeLog === key) setActiveLog(next[0]?.key || '')
  }

  async function openDetail (row) {
    setDetail({ loading: true, row, showEnv: false })
    const name = row.name || row.id
    const [info, stats] = await Promise.all([
      dockerInspect(row.tabId, name),
      dockerStats(row.tabId, name)
    ])
    setDetail({ loading: false, row, info, stats, showEnv: false })
    window.store.addOpsAuditLog({ action: 'docker-inspect', detail: { host: row.hostTitle, name } })
  }

  function statusTag (row) {
    if (row.level === 'running') {
      return <Tag color='green' title={row.status}>运行中</Tag>
    }
    if (row.level === 'restarting') {
      return <Tag color='gold' title={row.status}>重启中 · 反复重启</Tag>
    }
    if (row.level === 'exited-bad') {
      return <Tag color='red' title={row.status}>已退出({row.exitCode ?? '非0'})</Tag>
    }
    if (row.level === 'exited') {
      return <Tag title={row.status}>已退出(0)</Tag>
    }
    return <Tag title={row.status}>{row.status || row.level || '-'}</Tag>
  }

  function renderLogText (text, keyword, hit) {
    if (!keyword) return text || ''
    return renderHighlighted(text || '', keyword, hit)
  }

  function stepLog (delta) {
    if (!active) return
    const list = findMatchIndexes(active.text || '', active.keyword || '')
    if (!list.length) {
      message.info('没有匹配')
      return
    }
    const cur = clampHit(active.hit, list.length)
    const next = (cur + delta + list.length) % list.length
    patchLog(active.key, { hit: next })
    requestAnimationFrame(() => {
      document.querySelector('.ops-log-view mark.ops-hit-current')?.scrollIntoView({ block: 'center' })
    })
  }

  const columns = [
    {
      title: '机器',
      key: 'host',
      width: 140,
      ellipsis: true,
      render: (_, r) => r.host || r.hostTitle
    },
    {
      title: '容器',
      dataIndex: 'name',
      ellipsis: true,
      render: (name, r) => <a onClick={() => openDetail(r)}>{name}</a>
    },
    { title: '镜像', dataIndex: 'image', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 160,
      render: (_, r) => statusTag(r)
    },
    { title: '端口', dataIndex: 'ports', ellipsis: true },
    { title: '创建时间', dataIndex: 'created', width: 170, ellipsis: true },
    {
      title: '操作',
      key: 'act',
      width: 250,
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size='small' onClick={() => openLogs(r, 'tail')}>日志</Button>
          <Button size='small' onClick={() => confirmOne(r, 'restart')}>重启</Button>
          <Button size='small' onClick={() => confirmOne(r, 'stop')}>停止</Button>
          <Button size='small' onClick={() => confirmOne(r, 'start')}>启动</Button>
        </Space>
      )
    }
  ]

  const active = logTabs.find(t => t.key === activeLog) || logTabs[0]

  async function refreshImages () {
    const targets = selectedTabIds.length ? tabs.filter(t => selectedTabIds.includes(t.id)) : tabs
    const out = []
    for (const tab of targets) {
      out.push(await listImages(tab))
    }
    setImages(out.flatMap(h => (h.images || []).map(i => ({ ...i, hostTitle: h.title, tabId: h.tabId, rowKey: h.tabId + i.id }))))
  }

  async function refreshCompose () {
    const targets = selectedTabIds.length ? tabs.filter(t => selectedTabIds.includes(t.id)) : tabs
    const out = []
    for (const tab of targets) {
      out.push(await listCompose(tab))
    }
    setCompose(out)
  }

  async function runDiagnose () {
    const targets = selectedTabIds.length ? tabs.filter(t => selectedTabIds.includes(t.id)) : tabs
    const out = []
    for (const tab of targets) {
      out.push(await dockerDiagnose(tab))
    }
    setDiag(out)
  }

  async function doPublish () {
    if (!selectedTabIds[0] || !pubName || !pubImage) return message.warning('填写容器名与新镜像')
    Modal.confirm({
      title: '确认发布？',
      content: `${pubName}: → ${pubImage}`,
      onOk: async () => {
        const r = await dockerPublish({
          tabId: selectedTabIds[0],
          container: pubName,
          newImage: pubImage,
          healthPort: pubPort
        })
        if (r.prevImage) setLastPrev({ ...lastPrev, [pubName]: r.prevImage })
        window.store.addOpsAuditLog({ action: 'docker-publish', detail: r })
        message[r.ok ? 'success' : 'error'](r.ok ? '发布完成' : (r.error || '失败'))
        refresh()
      }
    })
  }

  const sshCount = tabs.filter(t => t.host || t.authType || t.type === 'ssh').length
  const containersPane = (
    <>
      {!sshCount && (
        <div className='mg1b' style={{ opacity: 0.75 }}>
          请先打开 SSH 连接，勾选机器后点「刷新容器」。命令通过已有 SSH 标签一次性执行，实时日志用轮询，不会占用 `docker logs -f`。
        </div>
      )}
      <Space wrap className='mg1b'>
        <Button type='primary' loading={loading} onClick={refresh}>刷新容器</Button>
        <Input.Search placeholder='过滤名称/镜像/主机' allowClear onChange={e => setFilter(e.target.value)} style={{ width: 200 }} />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部' },
            { value: 'up', label: '运行中' },
            { value: 'restarting', label: '重启中' },
            { value: 'exited', label: '已退出' },
            { value: 'abnormal', label: '异常' }
          ]}
        />
        <label>
          <input type='checkbox' checked={rolling} onChange={e => setRolling(e.target.checked)} /> 滚动重启
        </label>
        <Button onClick={() => confirmBatch('restart')}>批量重启</Button>
        <Button onClick={() => confirmBatch('start')}>启动</Button>
        <Button onClick={() => confirmBatch('stop')}>停止</Button>
      </Space>
      <Table
        size='small'
        rowKey='rowKey'
        loading={loading}
        columns={columns}
        dataSource={flat}
        pagination={{ pageSize: 12 }}
        locale={{ emptyText: loading ? '加载中…' : '暂无容器，请勾选 SSH 机器后刷新' }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: setSelected
        }}
        scroll={{ x: 980, y: 280 }}
      />
      {batchResults.length > 0 && (
        <div className='mg1t'>
          {batchResults.map(r => (
            <div key={r.key}>
              <Tag color={r.ok ? 'green' : 'red'}>{r.ok ? '成功' : '失败'}</Tag>
              {r.host} / {r.name} {r.ok ? '' : r.err}
            </div>
          ))}
        </div>
      )}
      {logTabs.length > 0 && (
        <div className='mg1t'>
          <Tabs
            size='small'
            activeKey={active?.key}
            onChange={setActiveLog}
            items={logTabs.map(t => ({
              key: t.key,
              label: `${t.name} @ ${t.hostTitle || ''}`
            }))}
          />
          {active && (
            <div>
              <Space wrap className='mg1b'>
                <Select
                  value={active.range || 'tail'}
                  style={{ width: 140 }}
                  onChange={v => {
                    const row = flat.find(r => `${r.tabId}::${r.name}` === active.key) || active
                    openLogs(row, v)
                  }}
                  options={[
                    { value: 'tail', label: '最近 200 行' },
                    { value: '5m', label: '最近 5 分钟' },
                    { value: '1h', label: '最近 1 小时' },
                    { value: '24h', label: '最近 24 小时' }
                  ]}
                />
                <Button size='small' type={active.following ? 'primary' : 'default'} onClick={() => startFollow(active.key)}>实时追踪</Button>
                <Button size='small' disabled={!active.following} onClick={() => stopFollow(active.key)}>暂停</Button>
                <Button size='small' disabled={active.following} onClick={() => startFollow(active.key)}>继续</Button>
                <Button size='small' onClick={() => patchLog(active.key, { text: '' })}>清空</Button>
                <Input
                  style={{ width: 160 }}
                  placeholder='关键词高亮'
                  value={active.keyword || ''}
                  onChange={e => patchLog(active.key, { keyword: e.target.value, hit: 0 })}
                />
                <Button size='small' disabled={!active.keyword} onClick={() => stepLog(-1)}>上一个</Button>
                <Button size='small' disabled={!active.keyword} onClick={() => stepLog(1)}>下一个</Button>
                <span>{active.keyword ? matchLabel(active.hit, findMatchIndexes(active.text || '', active.keyword).length) : ''}</span>
                <Input
                  style={{ width: 180 }}
                  placeholder='容器内文件路径'
                  value={editPath}
                  onChange={e => setEditPath(e.target.value)}
                />
                <Button
                  size='small'
                  onClick={() => openOpsFileEditor({
                    tabId: active.tabId,
                    container: active.name,
                    path: editPath || '/etc/hosts'
                  })}
                >
                  编辑文件
                </Button>
                <Button size='small' onClick={() => closeLog(active.key)}>关闭</Button>
              </Space>
              <div className='ops-log-view'>
                {renderLogText(active.text, active.keyword, active.hit)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className='ops-panel'>
      <OpsTabSelect listProps={listProps} />
      <Modal
        open={!!detail}
        title={detail?.row ? `${detail.row.name} @ ${detail.row.host || detail.row.hostTitle || ''}` : '容器详情'}
        width={640}
        onCancel={() => setDetail(null)}
      >
        {detail?.loading && <div>加载中…</div>}
        {detail && !detail.loading && (
          <div className='ops-docker-detail'>
            {!detail.info?.ok && <div>详情失败：{detail.info?.error}</div>}
            {detail.info?.ok && (
              <>
                <div>ID：{detail.info.id}</div>
                <div>镜像：{detail.info.image}</div>
                <div>状态：{detail.info.status}{detail.info.health ? ` / ${detail.info.health}` : ''}</div>
                <div>启动时间：{detail.info.startedAt}</div>
                <div>重启次数：{detail.info.restartCount}</div>
                <div>退出码：{detail.info.exitCode ?? '-'} {detail.info.error || ''}</div>
                <div>端口：{(detail.info.ports || []).join('，') || detail.row.ports || '-'}</div>
                <div>挂载：{(detail.info.mounts || []).join('；') || '-'}</div>
                <div>
                  资源：{detail.stats?.ok ? `CPU ${detail.stats.cpu}，内存 ${detail.stats.mem}（${detail.stats.memPerc}）` : (detail.stats?.error || '-')}
                </div>
                <Button size='small' className='mg1t' onClick={() => setDetail({ ...detail, showEnv: !detail.showEnv })}>
                  {detail.showEnv ? '隐藏环境变量' : '显示环境变量'}
                </Button>
                {detail.showEnv && (
                  <pre className='ops-live-out'>{(detail.info.env || []).join('\n') || '(无)'}</pre>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
      <Tabs
        items={[
          { key: 'ps', label: '容器', children: containersPane },
          {
            key: 'img',
            label: '镜像',
            children: (
              <div>
                <Space className='mg1b'>
                  <Button onClick={refreshImages}>刷新镜像</Button>
                  <Input style={{ width: 220 }} placeholder='拉取镜像' id='pull-img' />
                  <Button onClick={async () => {
                    const v = document.getElementById('pull-img')?.value
                    if (!v || !selectedTabIds[0]) return
                    const r = await dockerPull(selectedTabIds[0], v)
                    message[r.ok ? 'success' : 'error'](r.ok ? 'pull ok' : r.err)
                    refreshImages()
                  }}
                  >Pull
                  </Button>
                </Space>
                <Table
                  size='small'
                  rowKey='rowKey'
                  dataSource={images}
                  columns={[
                    { title: '机器', dataIndex: 'hostTitle', width: 100 },
                    { title: '仓库', dataIndex: 'repository' },
                    { title: '标签', dataIndex: 'tag', width: 100 },
                    { title: '大小', dataIndex: 'size', width: 90 },
                    { title: '悬空', dataIndex: 'dangling', width: 70, render: v => v ? <Tag color='orange'>是</Tag> : '' }
                  ]}
                />
              </div>
            )
          },
          {
            key: 'pub',
            label: '发布',
            children: (
              <div>
                <Space wrap className='mg1b'>
                  <Input placeholder='容器名' value={pubName} onChange={e => setPubName(e.target.value)} />
                  <Input placeholder='新镜像' value={pubImage} onChange={e => setPubImage(e.target.value)} />
                  <Input placeholder='健康检查端口' value={pubPort} onChange={e => setPubPort(e.target.value)} style={{ width: 120 }} />
                  <Button type='primary' onClick={doPublish}>发布</Button>
                  <Button onClick={async () => {
                    if (!lastPrev[pubName]) return message.warning('无回滚镜像')
                    await dockerRollback(selectedTabIds[0], pubName, lastPrev[pubName])
                    message.success('已回滚')
                  }}
                  >回滚
                  </Button>
                </Space>
              </div>
            )
          },
          {
            key: 'compose',
            label: '编排',
            children: (
              <div>
                <Space className='mg1b'>
                  <Button onClick={refreshCompose}>刷新项目</Button>
                  <Input style={{ width: 240 }} value={composeDir} onChange={e => setComposeDir(e.target.value)} placeholder='项目目录' />
                  {['up', 'down', 'restart', 'ps'].map(a => (
                    <Button
                      key={a}
                      onClick={() => Modal.confirm({
                        title: `compose ${a}?`,
                        onOk: async () => {
                          const r = await composeAction(selectedTabIds[0], composeDir, a)
                          message[r.ok ? 'success' : 'error'](r.out || r.err || a)
                        }
                      })}
                    >{a}
                    </Button>
                  ))}
                </Space>
                <pre className='ops-live-out'>{JSON.stringify(compose, null, 2)}</pre>
              </div>
            )
          },
          {
            key: 'diag',
            label: '体检',
            children: (
              <div>
                <Button type='primary' className='mg1b' onClick={runDiagnose}>一键体检</Button>
                {(diag || []).map(d => (
                  <div key={d.tabId} className='mg1b'>
                    <b>{d.title}</b> disk {d.diskUse}% dangling {d.danglingCount}
                    <ul>
                      {(d.tips || []).map((t, i) => (
                        <li key={i}><Tag color={t.level === 'danger' ? 'red' : 'orange'}>{t.level}</Tag> {t.msg} — {t.action}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          }
        ]}
      />
    </div>
  )
}
