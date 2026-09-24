/**
 * Transfer queue and history. Same drawer as settings, without the settings tabs.
 */

import { useState } from 'react'
import { Button, Dropdown, Modal, Progress, Space, Table, Tooltip } from 'antd'
import copy from 'json-deep-copy'
import uid from '../../common/uid'
import newTerm from '../../common/new-terminal'
import { refs, refsStatic } from '../common/ref'
import message from '../common/message'
import time from '../../common/time'
import { formatBytes, formatBytesPair } from '../../common/byte-format'
import { statusMap, fileActions, paneMap } from '../../common/constants'
import { getFolderFromFilePath } from '../sftp/file-read'
import './transfer-history.styl'

const e = window.translate

function formatSize (n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) {
    return '-'
  }
  return formatBytes(v)
}

function formatProgress (row) {
  const total = rowSize(row)
  const done = Number(row.transferred) || 0
  if (!total) {
    return done > 0 ? formatBytes(done) : '-'
  }
  return formatBytesPair(done, total)
}

function formatEta (row) {
  if (queueStatus(row) !== '进行中') {
    return '-'
  }
  const eta = Number(row.etaTime)
  if (Number.isFinite(eta) && eta > 0) {
    return time(eta)
  }
  const left = Number(row.leftTimeInt)
  const start = Number(row.startTime)
  if (Number.isFinite(left) && left > 0 && Number.isFinite(start) && start > 0) {
    return time(Date.now() + left)
  }
  return '-'
}

function queueStatus (item) {
  if (item.error) {
    return '错误'
  }
  if (item.waitingConfirm) {
    return '等待确认'
  }
  if (item.pausing && item.inited) {
    return '暂停'
  }
  if (item.inited && item.typeFrom !== item.typeTo) {
    return '进行中'
  }
  return '就绪'
}

function historyStatus (item) {
  if (item.error) {
    return '错误'
  }
  return item.statusText || '完成'
}

function isArchiveHistory (item) {
  return !!(item?.archiveOp || item?.operation === 'compress' || item?.operation === 'extract')
}

function isHistoryRunning (item) {
  const s = item?.statusText || ''
  return s === '进行中' || s === '压缩中' || s === '解压中'
}

function archiveOpLabel (item) {
  if (item?.operation === 'compress') {
    return '压缩'
  }
  if (item?.operation === 'extract') {
    return '解压'
  }
  return ''
}

function pathBasename (p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  if (!s) {
    return ''
  }
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || s
}

/** Display source file name: explicit field → fromFile.name → path basename */
function resolveFromName (row) {
  if (row.fromName) {
    return row.fromName
  }
  if (row.fromFile?.name) {
    return row.fromFile.name
  }
  const base = pathBasename(row.fromPathReal || row.fromPath)
  if (base && row.fromPathNote) {
    return `${base} ${row.fromPathNote}`
  }
  return base || '-'
}

/** Display target file name: explicit field → toFile.name → path basename */
function resolveToName (row) {
  if (row.toName) {
    return row.toName
  }
  if (row.toFile?.name) {
    return row.toFile.name
  }
  return pathBasename(row.toPathReal || row.toPath) || '-'
}

function queueUpdate (id, update) {
  refsStatic.get('transfer-queue')?.addToQueue('update', id, update)
}

function queueDelete (id) {
  refsStatic.get('transfer-queue')?.addToQueue('delete', id)
}

function queueTop (id) {
  refsStatic.get('transfer-queue')?.addToQueue('moveTop', id)
}

function sameHost (a, b) {
  const x = String(a || '').trim().toLowerCase()
  const y = String(b || '').trim().toLowerCase()
  return !!x && !!y && x === y
}

function sessionAlive (item) {
  if (item.typeFrom !== 'remote' && item.typeTo !== 'remote') {
    return true
  }
  const sftp = refs.get('sftp-' + item.tabId)
  return !!(sftp && sftp.sftp)
}

function findLiveTabForTransfer (item) {
  if (item.typeFrom !== 'remote' && item.typeTo !== 'remote') {
    return item.tabId
  }
  if (sessionAlive(item)) {
    return item.tabId
  }
  const tabs = window.store.tabs || []
  const candidates = tabs.filter(tab => {
    if (tab.status && tab.status !== statusMap.success) {
      return false
    }
    if (!refs.get('sftp-' + tab.id)?.sftp) {
      return false
    }
    if (item.host && sameHost(item.host, tab.host)) {
      return true
    }
    if (item.title && (tab.title === item.title || createTitleMatch(tab, item.title))) {
      return true
    }
    return false
  })
  if (candidates.length === 1) {
    return candidates[0].id
  }
  if (item.host) {
    const byHost = candidates.find(tab => sameHost(item.host, tab.host))
    if (byHost) {
      return byHost.id
    }
  }
  return candidates[0]?.id || null
}

/** Prefer live SFTP; else any same-host connected tab (file manager can start). */
function findTabForOpenPath (item) {
  const live = findLiveTabForTransfer(item)
  if (live) {
    return live
  }
  if (item.typeFrom !== 'remote' && item.typeTo !== 'remote') {
    return item.tabId || window.store.activeTabId
  }
  const tabs = window.store.tabs || []
  const candidates = tabs.filter(tab => {
    if (tab.status && tab.status !== statusMap.success) {
      return false
    }
    if (!tab.host) {
      return false
    }
    if (item.host && sameHost(item.host, tab.host)) {
      return true
    }
    if (item.title && (tab.title === item.title || createTitleMatch(tab, item.title))) {
      return true
    }
    return false
  })
  if (item.host) {
    const byHost = candidates.find(tab => sameHost(item.host, tab.host))
    if (byHost) {
      return byHost.id
    }
  }
  return candidates[0]?.id || null
}

function createTitleMatch (tab, title) {
  try {
    const t = window.store?.getTabTitle?.(tab) || tab.title
    return t === title
  } catch (e) {
    return false
  }
}

function resolveTransferSide (item, side) {
  const full = side === 'from'
    ? (item.fromPathReal || item.fromPath)
    : (item.toPathReal || item.toPath)
  const type = side === 'from' ? item.typeFrom : item.typeTo
  if (!full || !type) {
    return null
  }
  const isRemote = type === 'remote'
  const isDir = !!(side === 'from' && item.fromFile?.isDirectory)
  let dir = full
  if (!isDir) {
    const folder = getFolderFromFilePath(full, isRemote)
    dir = folder.path || (isRemote ? '/' : full)
  }
  if (!dir && isRemote) {
    dir = '/'
  }
  return { full, dir, type, isRemote }
}

function findBookmarkForTransfer (item) {
  const bookmarks = window.store.bookmarks || []
  if (!bookmarks.length) {
    return null
  }
  const byHost = item.host
    ? bookmarks.filter(b => sameHost(b.host, item.host))
    : []
  if (byHost.length === 1) {
    return byHost[0]
  }
  if (item.title && byHost.length) {
    const hit = byHost.find(b => b.title === item.title)
    if (hit) {
      return hit
    }
  }
  if (byHost[0]) {
    return byHost[0]
  }
  if (item.title) {
    return bookmarks.find(b => b.title === item.title) || null
  }
  return null
}

function jumpSftpPath (tabId, type, dir) {
  const tryJump = (left = 25) => {
    const sftp = refs.get('sftp-' + tabId)
    if (sftp?.goToPath) {
      sftp.goToPath(type, dir)
      return
    }
    if (left > 0) {
      setTimeout(() => tryJump(left - 1), 200)
    } else {
      message.warning('文件管理器尚未就绪，请稍后再试')
    }
  }
  tryJump()
}

function activateFileManager (tabId) {
  const store = window.store
  const tab = (store.tabs || []).find(t => t.id === tabId)
  if (!tab) {
    return false
  }
  store.activeTabId = tabId
  if (typeof tab.batch === 'number') {
    store.currentLayoutBatch = tab.batch
    store[`activeTabId${tab.batch}`] = tabId
  }
  tab.pane = paneMap.fileManager
  tab.enableSftp = true
  return true
}

/**
 * Open transfer path: local → OS folder; remote → SSH file manager + cd.
 */
function openTransferSide (item, side) {
  const info = resolveTransferSide(item, side)
  if (!info) {
    message.warning('没有可用路径')
    return
  }
  const { full, dir, isRemote } = info
  const store = window.store
  store.hideSettingModal?.()

  if (!isRemote) {
    const target = full || dir
    if (window.pre?.showItemInFolder) {
      window.pre.showItemInFolder(target)
      message.info('已在资源管理器中打开本地目录')
      return
    }
    // Fallback: jump local pane of related or current tab
    let tabId = findTabForOpenPath(item) || store.activeTabId
    if (tabId && activateFileManager(tabId)) {
      jumpSftpPath(tabId, 'local', dir)
      return
    }
    message.error('无法打开本地目录')
    return
  }

  let tabId = findTabForOpenPath(item)
  if (tabId) {
    const tab = (store.tabs || []).find(t => t.id === tabId)
    // Ensure new SFTP mounts at target dir if not yet created
    if (tab && !refs.get('sftp-' + tabId)?.sftp) {
      tab.startDirectory = dir
      tab.startDirectoryRemote = dir
    }
    activateFileManager(tabId)
    jumpSftpPath(tabId, 'remote', dir)
    message.info('已跳转到远程目录')
    return
  }

  const bm = findBookmarkForTransfer(item)
  if (!bm) {
    message.error('没有可用的同主机连接，请先打开该 SSH 后再定位')
    return
  }
  store.addTab({
    ...copy(bm),
    from: 'bookmarks',
    srcId: bm.id,
    startDirectory: dir,
    startDirectoryRemote: dir,
    pane: paneMap.fileManager,
    enableSftp: true,
    ...newTerm(true)
  })
  message.info('正在连接并跳转到远程目录')
}

function rebindAndContinue (item) {
  const tabId = findLiveTabForTransfer(item)
  if (!tabId) {
    message.error('没有可用的同主机连接，请先重新打开连接后再继续')
    return false
  }
  const tab = (window.store.tabs || []).find(t => t.id === tabId)
  const transferred = Number(item.transferred) || 0
  queueUpdate(item.id, {
    tabId,
    host: tab?.host || item.host,
    title: tab?.title || item.title,
    tabType: tab?.type || item.tabType,
    error: '',
    statusText: '',
    pausing: false,
    inited: false,
    waitingConfirm: false,
    // Always resume from partial .part / local bytes — never force full re-download
    transferred,
    resolvePolicy: fileActions.resume,
    startFrom: transferred
  })
  message.info(transferred > 0 ? '已绑定新连接，将断点续传' : '已绑定新连接，开始传输')
  return true
}

function retryItem (item) {
  const tabId = findLiveTabForTransfer(item)
  if (!tabId) {
    message.error('没有可用的同主机连接，请先重新打开连接后再续传')
    return
  }
  const tab = (window.store.tabs || []).find(t => t.id === tabId)
  const transferred = Number(item.transferred) || 0
  window.store.addTransferList([{
    id: uid(),
    typeFrom: item.typeFrom,
    typeTo: item.typeTo,
    fromPath: item.fromPath,
    toPath: item.toPath,
    fromName: item.fromName || item.fromFile?.name || '',
    toName: item.toName || '',
    host: tab?.host || item.host,
    tabId,
    tabType: tab?.type || item.tabType,
    title: tab?.title || item.title,
    fromFile: item.fromFile,
    operation: item.operation || '',
    inited: false,
    pausing: false,
    percent: Number(item.percent) || 0,
    transferred,
    size: item.size || item.fromFile?.size || 0,
    error: '',
    resolvePolicy: fileActions.resume,
    startFrom: transferred
  }])
  message.info(transferred > 0 ? '已重新加入队列，将断点续传' : '已重新加入队列')
}

function showError (item) {
  Modal.info({
    title: '错误信息',
    content: String(item?.error || '没有错误信息')
  })
}

function formatWhen (v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    return '-'
  }
  return time(n)
}

function rowSize (row) {
  return Number(row.size) || Number(row.fromFile?.size) || 0
}

function liveRow (item) {
  return {
    ...item,
    fromName: resolveFromName(item),
    toName: resolveToName(item),
    size: rowSize(item),
    percent: Number(item.percent) || 0,
    speed: item.speed || '',
    transferred: Number(item.transferred) || 0,
    leftTime: item.leftTime || '',
    leftTimeInt: Number(item.leftTimeInt) || 0,
    etaTime: Number(item.etaTime) || 0
  }
}

function machineLabel (row, role) {
  const saved = role === 'from' ? row.sourceMachine : row.targetMachine
  if (saved) {
    return saved
  }
  const remote = row.title || row.host || '远程'
  const side = role === 'from' ? row.typeFrom : row.typeTo
  if (side === 'local') {
    return '本机'
  }
  if (side === 'remote') {
    return remote
  }
  return '-'
}

function renderPathLink (row, side) {
  const info = resolveTransferSide(row, side)
  const text = side === 'from'
    ? (row.fromPathReal || row.fromPath || '-')
    : (row.toPathReal || row.toPath || '-')
  if (!info) {
    return text
  }
  const tip = info.isRemote
    ? '点击定位到远程目录（SSH 文件管理器）'
    : '点击打开本地文件夹'
  return (
    <Tooltip title={tip}>
      <span
        className='transfer-path-link'
        onClick={(e) => {
          e.stopPropagation()
          openTransferSide(row, side)
        }}
      >
        {text}
      </span>
    </Tooltip>
  )
}

function sharedColumns (kind) {
  return [
    { title: '开始', dataIndex: 'startTime', width: 168, render: formatWhen },
    { title: '结束', dataIndex: 'finishTime', width: 168, render: formatWhen },
    { title: '发送机器', width: 140, ellipsis: true, render: (_, row) => machineLabel(row, 'from') },
    { title: '目标机器', width: 140, ellipsis: true, render: (_, row) => machineLabel(row, 'to') },
    {
      title: '文件名',
      width: 160,
      ellipsis: true,
      render: (_, row) => {
        const label = archiveOpLabel(row)
        const name = resolveFromName(row)
        if (!label) {
          return (
            <Tooltip title={name}>
              <span>{name}</span>
            </Tooltip>
          )
        }
        return (
          <Tooltip title={name}>
            <span>
              <span className='transfer-archive-tag'>[{label}] </span>
              {name}
            </span>
          </Tooltip>
        )
      }
    },
    {
      title: '目标文件名',
      width: 160,
      ellipsis: true,
      render: (_, row) => {
        const name = resolveToName(row)
        return (
          <Tooltip title={name}>
            <span>{name}</span>
          </Tooltip>
        )
      }
    },
    {
      title: '源路径',
      dataIndex: 'fromPath',
      ellipsis: true,
      render: (_, row) => renderPathLink(row, 'from')
    },
    {
      title: '目标路径',
      dataIndex: 'toPath',
      ellipsis: true,
      render: (_, row) => renderPathLink(row, 'to')
    },
    {
      title: '大小',
      width: 100,
      render: (_, row) => formatSize(rowSize(row))
    },
    {
      title: '已传/总量',
      width: 130,
      render: (_, row) => (isArchiveHistory(row) ? '-' : formatProgress(row))
    },
    {
      title: '进度',
      width: 120,
      render: (_, row) => {
        let percent = Number(row.percent) || 0
        if (kind === 'history') {
          if (row.error) {
            percent = Number(row.percent) || 0
          } else if (isHistoryRunning(row)) {
            percent = Number(row.percent) || 0
          } else {
            percent = Number(row.percent) || 100
          }
        }
        return (
          <Tooltip title={`${percent}%`}>
            <span style={{ display: 'inline-block', width: '100%' }}>
              <Progress
                percent={percent}
                size='small'
                status={row.error ? 'exception' : (isHistoryRunning(row) ? 'active' : undefined)}
              />
            </span>
          </Tooltip>
        )
      }
    },
    { title: '速度', dataIndex: 'speed', width: 100, render: (v) => v || '-' },
    {
      title: '预估剩余',
      width: 100,
      render: (_, row) => {
        if (kind === 'history') {
          return '-'
        }
        if (queueStatus(row) !== '进行中') {
          return '-'
        }
        return row.leftTime || '-'
      }
    },
    {
      title: '预估结束',
      width: 168,
      render: (_, row) => (kind === 'history' ? (row.finishTime ? formatWhen(row.finishTime) : '-') : formatEta(row))
    },
    {
      title: '状态',
      width: 80,
      render: (_, row) => (kind === 'history' ? historyStatus(row) : queueStatus(row))
    }
  ]
}

function stopItems (items) {
  const conflict = refsStatic.get('transfer-conflict')
  items.forEach(item => {
    conflict?.dismiss?.(item.id)
    window.store.addTransferHistory?.({
      ...item,
      finishTime: Date.now(),
      statusText: '已停止',
      error: item.error || ''
    })
    queueDelete(item.id)
  })
}

function removeQueueItems (items) {
  const conflict = refsStatic.get('transfer-conflict')
  items.forEach(item => {
    conflict?.dismiss?.(item.id)
    queueDelete(item.id)
  })
}

export default function TransferCenter (props) {
  const queue = Array.isArray(props.fileTransfers) ? props.fileTransfers : []
  const history = Array.isArray(props.transferHistory) ? props.transferHistory : []
  const [menu, setMenu] = useState(null)
  const [queueKeys, setQueueKeys] = useState([])
  const [historyKeys, setHistoryKeys] = useState([])
  const active = queue.filter(item => queueStatus(item) === '进行中')
  const waiting = queue.filter(item => queueStatus(item) !== '进行中')

  const applyQueue = (key, items) => {
    if (!items.length) {
      return
    }
    if (key === 'pause') {
      items.forEach(item => queueUpdate(item.id, { pausing: true }))
    } else if (key === 'resume') {
      items.forEach(item => {
        if (item.error || !sessionAlive(item)) {
          rebindAndContinue(item)
        } else {
          queueUpdate(item.id, { pausing: false, error: '', statusText: '' })
        }
      })
    } else if (key === 'stop') {
      stopItems(items)
      setQueueKeys([])
    } else if (key === 'remove') {
      removeQueueItems(items)
      setQueueKeys([])
    } else if (key === 'top' && items[0]) {
      queueTop(items[0].id)
    } else if (key === 'retry') {
      items.forEach(retryItem)
    } else if (key === 'error' && items[0]) {
      showError(items[0])
    } else if (key === 'openFrom' && items[0]) {
      openTransferSide(items[0], 'from')
    } else if (key === 'openTo' && items[0]) {
      openTransferSide(items[0], 'to')
    }
  }

  const applyHistory = (key, items) => {
    if (!items.length) {
      return
    }
    if (key === 'retry') {
      items.filter(item => !isArchiveHistory(item)).forEach(retryItem)
    } else if (key === 'error' && items[0]) {
      showError(items[0])
    } else if (key === 'openFrom' && items[0]) {
      openTransferSide(items[0], 'from')
    } else if (key === 'openTo' && items[0]) {
      openTransferSide(items[0], 'to')
    } else if (key === 'deleteHistory') {
      const ids = new Set(items.map(item => item.id).filter(Boolean))
      window.store.transferHistory = (window.store.transferHistory || []).filter(row => {
        return !ids.has(row.id) && !items.includes(row)
      })
      setHistoryKeys([])
    }
  }

  const onMenu = ({ key }) => {
    const records = menu?.records || []
    const kind = menu?.kind
    setMenu(null)
    if (!records.length) {
      return
    }
    if (kind === 'history') {
      applyHistory(key, records)
    } else {
      applyQueue(key, records)
    }
  }

  const pathMenuItems = (item) => {
    const items = []
    if (resolveTransferSide(item, 'from')) {
      const fromRemote = item.typeFrom === 'remote'
      items.push({
        key: 'openFrom',
        label: fromRemote ? '打开源目录（SSH）' : '打开源目录（本地）'
      })
    }
    if (resolveTransferSide(item, 'to')) {
      const toRemote = item.typeTo === 'remote'
      items.push({
        key: 'openTo',
        label: toRemote ? '打开目标目录（SSH）' : '打开目标目录（本地）'
      })
    }
    return items
  }

  const queueItems = (records) => {
    const many = records.length > 1
    const item = records[0] || {}
    const status = queueStatus(item)
    const items = []
    if (!many) {
      items.push(...pathMenuItems(item))
    }
    if (many || status === '进行中') {
      items.push({ key: 'pause', label: many ? `暂停 (${records.length})` : '暂停' })
    }
    if (many || status === '暂停' || status === '就绪' || status === '等待确认' || status === '错误') {
      items.push({ key: 'resume', label: many ? `断点续传 (${records.length})` : '断点续传' })
    }
    if (!many && (status === '暂停' || status === '就绪')) {
      items.push({ key: 'top', label: '移到队首' })
    }
    items.push({ key: 'stop', label: many ? `停止 (${records.length})` : '停止' })
    items.push({ key: 'remove', label: many ? `删除 (${records.length})` : '删除' })
    if (!many && item.error) {
      items.push({ key: 'error', label: '查看错误' })
    }
    return items
  }

  const historyItems = (records) => {
    const many = records.length > 1
    const item = records[0] || {}
    const items = []
    if (!many) {
      items.push(...pathMenuItems(item))
    }
    if (!many && item.error) {
      items.push({ key: 'error', label: '查看错误' })
    }
    const canRetry = many
      ? records.some(r => !isArchiveHistory(r))
      : !isArchiveHistory(item)
    if (canRetry) {
      items.push({ key: 'retry', label: many ? `断点续传 (${records.length})` : '断点续传' })
    }
    items.push({ key: 'deleteHistory', label: many ? `删除记录 (${records.length})` : '删除记录' })
    return items
  }

  const openMenu = (event, record, kind, rows) => {
    event.preventDefault()
    const keys = kind === 'history' ? historyKeys : queueKeys
    const picked = keys.includes(record.id) && keys.length > 1
      ? rows.filter(row => keys.includes(row.id))
      : [record]
    setMenu({
      x: event.clientX,
      y: event.clientY,
      record,
      records: picked,
      kind
    })
  }

  const pager = {
    pageSize: 10,
    showSizeChanger: true,
    pageSizeOptions: ['10', '20', '50', '100', '200']
  }
  const queueRows = queue.map(liveRow)
  const historyRows = history.map(liveRow)
  void props.tick

  const menuItems = menu?.kind === 'history'
    ? historyItems(menu.records || [])
    : queueItems(menu?.records || [])
  const queueSelected = queueRows.filter(row => queueKeys.includes(row.id))
  const historySelected = historyRows.filter(row => historyKeys.includes(row.id))

  return (
    <div className='pd2 transfer-history-body'>
      <div className='pd1b bold'>
        传输队列（同时最多 5 个进行中，其余在等待队列）
      </div>
      <div className='pd1b'>进行中 {active.length} · 等待 {waiting.length}</div>
      <Space className='pd1b' wrap>
        <Button size='small' disabled={!queueSelected.length} onClick={() => applyQueue('pause', queueSelected)}>暂停</Button>
        <Button size='small' disabled={!queueSelected.length} onClick={() => applyQueue('resume', queueSelected)}>断点续传</Button>
        <Button size='small' disabled={!queueSelected.length} onClick={() => applyQueue('stop', queueSelected)}>停止</Button>
        <Button size='small' disabled={!queueSelected.length} onClick={() => applyQueue('remove', queueSelected)}>删除</Button>
        <span>{queueSelected.length ? `已选 ${queueSelected.length}` : '勾选后可批量操作'}</span>
      </Space>
      <Table
        size='small'
        pagination={pager}
        rowKey={(row) => row.id}
        dataSource={queueRows}
        columns={sharedColumns('queue')}
        locale={{ emptyText: '队列是空的' }}
        rowSelection={{
          selectedRowKeys: queueKeys,
          onChange: setQueueKeys
        }}
        onRow={(record) => ({
          onContextMenu: (event) => openMenu(event, record, 'queue', queueRows)
        })}
      />
      <div className='pd1y bold'>传输历史</div>
      <div className='transfer-history-toolbar'>
        <span
          className='iblock pointer'
          onClick={() => window.store.clearTransferHistory?.()}
        >
          {e('clear')}
        </span>
        <span className='transfer-history-total'>{history.length}</span>
      </div>
      <Space className='pd1b' wrap>
        <Button size='small' disabled={!historySelected.length} onClick={() => applyHistory('retry', historySelected)}>断点续传</Button>
        <Button size='small' disabled={!historySelected.length} onClick={() => applyHistory('deleteHistory', historySelected)}>删除记录</Button>
        <span>{historySelected.length ? `已选 ${historySelected.length}` : '勾选后可批量操作'}</span>
      </Space>
      <Table
        size='small'
        pagination={pager}
        rowKey={(row, index) => row.id || `h-${row.finishTime}-${index}`}
        dataSource={historyRows}
        columns={sharedColumns('history')}
        locale={{ emptyText: '暂无记录' }}
        rowSelection={{
          selectedRowKeys: historyKeys,
          onChange: setHistoryKeys
        }}
        onRow={(record) => ({
          onContextMenu: (event) => openMenu(event, record, 'history', historyRows)
        })}
      />
      {
        menu
          ? (
            <Dropdown
              open
              menu={{ items: menuItems, onClick: onMenu }}
              onOpenChange={(open) => {
                if (!open) {
                  setMenu(null)
                }
              }}
            >
              <span
                style={{
                  position: 'fixed',
                  left: menu.x,
                  top: menu.y,
                  width: 1,
                  height: 1
                }}
              />
            </Dropdown>
            )
          : null
      }
    </div>
  )
}
