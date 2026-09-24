/**
 * Path box with a browser that uses the same list layout as the remote file panel.
 */

import { useState } from 'react'
import { Button, Input, Modal, Space, message } from 'antd'
import { ApartmentOutlined, CaretDownOutlined, CaretRightOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { refs } from '../common/ref'
import { fileTypeMap } from '../../common/constants'
import resolve from '../../common/resolve'
import { mode2permission, permission2mode } from '../../common/mode2permission'
import time from '../../common/time'
import { formatBytes } from '../../common/byte-format'
import ExtIcon from '../sftp/file-icon'
import { listLocalDirectory } from '../sftp/file-read'
import { execCmd } from '../terminal/terminal-apis'
import '../sftp/sftp.styl'

const e = window.translate

const columns = [
  { id: 'name', size: 46, label: '名称' },
  { id: 'size', size: 14, label: '大小' },
  { id: 'modifyTime', size: 24, label: '修改时间' },
  { id: 'mode', size: 16, label: '权限' }
]

function shellQuote (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

function tabOf (tabId) {
  return (window.store.tabs || []).find(t => t.id === tabId) || null
}

function isRemoteTab (tab) {
  return !!(tab && (tab.host || tab.type === 'ssh' || tab.type === 'telnet' || tab.type === 'ftp'))
}

function showMode (mode) {
  if (mode == null || mode === '') {
    return ''
  }
  if (typeof mode === 'string' && /^[rwx-]{9}$/.test(mode)) {
    const chunk = (part) => (part[0] === 'r' ? 4 : 0) + (part[1] === 'w' ? 2 : 0) + (part[2] !== '-' ? 1 : 0)
    return '' + chunk(mode.slice(0, 3)) + chunk(mode.slice(3, 6)) + chunk(mode.slice(6, 9))
  }
  try {
    return permission2mode(mode2permission(mode))
  } catch (err) {
    return ''
  }
}

function showSize (item) {
  if (!item || item.isDirectory || item.isParent) {
    return ''
  }
  return formatBytes(Number(item.size) || 0)
}

function showTime (item) {
  if (!item?.modifyTime || item.isParent) {
    return ''
  }
  const raw = Number(item.modifyTime)
  const ms = raw > 0 && raw < 1e12 ? raw * 1000 : item.modifyTime
  return time(ms)
}

function mapSftpItem (item) {
  return {
    name: item.name,
    isDirectory: item.type === fileTypeMap.directory || !!item.isDirectory,
    isSymbol: item.type === fileTypeMap.link || !!item.isSymbolicLink,
    size: item.size,
    modifyTime: item.modifyTime,
    mode: item.mode
  }
}

function parseLs (out, cwd) {
  const lines = String(out || '').replace(/\r/g, '').split('\n').map(line => line.trimEnd()).filter(Boolean)
  let path = cwd || '/'
  let start = 0
  if (lines[0] && !/^[dlcbps-]/.test(lines[0]) && !lines[0].startsWith('total')) {
    path = lines[0].trim()
    start = 1
  }
  const entries = []
  for (const line of lines.slice(start)) {
    if (line.startsWith('total ')) {
      continue
    }
    const matched = line.match(/^([\w-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/)
    if (!matched) {
      continue
    }
    let name = matched[4]
    const kind = matched[1][0]
    if (kind === 'l') {
      const arrow = name.indexOf(' -> ')
      if (arrow >= 0) {
        name = name.slice(0, arrow)
      }
    }
    if (!name || name === '.' || name === '..') {
      continue
    }
    entries.push({
      name,
      isDirectory: kind === 'd',
      isSymbol: kind === 'l',
      size: Number(matched[2]) || 0,
      modifyTime: Number(matched[3]) || 0,
      mode: matched[1].slice(1)
    })
  }
  return { path, entries }
}

async function listRemote (tabId, dir) {
  const target = dir || ''
  const sftp = refs.get('sftp-' + tabId)?.sftp
  if (sftp?.list && target && !target.startsWith('~')) {
    const arr = await sftp.list(target)
    return {
      path: target,
      entries: (arr || [])
        .filter(item => item.name && item.name !== '.' && item.name !== '..')
        .map(mapSftpItem)
    }
  }
  const cmd = target
    ? `cd ${shellQuote(target)} && pwd && ls -lA --time-style=+%s`
    : 'pwd && ls -lA --time-style=+%s'
  const r = await execCmd(tabId, cmd, 20000)
  const out = String(r?.stdout || r?.out || '')
  if ((r?.code ?? 0) !== 0 && !out.trim()) {
    throw new Error(r?.stderr || '无法列出目录')
  }
  const listed = parseLs(out, target)
  if (!listed.entries.length && /invalid option|unrecognized option/i.test(String(r?.stderr || ''))) {
    const plain = await execCmd(tabId, target ? `cd ${shellQuote(target)} && pwd && ls -1pA` : 'pwd && ls -1pA', 20000)
    const text = String(plain?.stdout || plain?.out || '').replace(/\r/g, '')
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
    return {
      path: lines[0] || target || '/',
      entries: lines.slice(1).map(line => {
        const isDirectory = line.endsWith('/')
        return {
          name: isDirectory ? line.slice(0, -1) : line,
          isDirectory,
          size: 0,
          modifyTime: 0,
          mode: ''
        }
      }).filter(item => item.name && item.name !== '.' && item.name !== '..')
    }
  }
  return listed
}

async function listLocal (dir) {
  const path = dir || window.pre?.homeOrTmp || '/'
  const arr = await listLocalDirectory(path)
  return {
    path,
    entries: (arr || [])
      .filter(item => item.name && item.name !== '.' && item.name !== '..')
      .map(mapSftpItem)
  }
}

async function listAt (tabId, dir) {
  const tab = tabOf(tabId)
  if (!tab) {
    throw new Error('请先选择终端')
  }
  const run = (next) => isRemoteTab(tab) ? listRemote(tabId, next) : listLocal(next)
  try {
    return await run(dir)
  } catch (err) {
    if (dir && dir !== '/' && dir !== '\\') {
      const parent = resolve(dir, '..')
      if (parent && parent !== dir) {
        return run(parent)
      }
    }
    throw err
  }
}

function crumbsOf (fullPath) {
  if (!fullPath) {
    return []
  }
  if (fullPath.includes('\\') || /^[a-zA-Z]:/.test(fullPath)) {
    const sep = fullPath.includes('\\') ? '\\' : '/'
    const drive = /^[a-zA-Z]:/.test(fullPath) ? fullPath.slice(0, 2) : ''
    const root = drive ? drive + sep : sep
    const crumbs = [{ label: drive || sep, path: root }]
    const rest = fullPath.slice(root.length).split(/[\\/]/).filter(Boolean)
    let acc = root.replace(/[\\/]$/, '')
    for (const part of rest) {
      acc += sep + part
      crumbs.push({ label: part, path: acc })
    }
    return crumbs
  }
  const crumbs = [{ label: '', path: '/' }]
  const parts = String(fullPath).split('/').filter(Boolean)
  let acc = ''
  for (const part of parts) {
    acc += '/' + part
    crumbs.push({ label: part, path: acc })
  }
  return fullPath === '/' ? [{ label: '/', path: '/' }] : crumbs
}

function sortEntries (entries, sortKey, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    const av = sortKey === 'name' ? a.name : (a[sortKey] || 0)
    const bv = sortKey === 'name' ? b.name : (b[sortKey] || 0)
    if (typeof av === 'string' || typeof bv === 'string') {
      return dir * String(av).localeCompare(String(bv))
    }
    return dir * ((Number(av) || 0) - (Number(bv) || 0))
  })
}

function PathBrowser ({ open, tabId, initial, onClose, onPick, multiple = false }) {
  const [cwd, setCwd] = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState('')
  const [selectedSet, setSelectedSet] = useState(() => new Set())
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [view, setView] = useState(() => window.localStorage.getItem('electerm-path-picker-view') || 'list')
  const [expanded, setExpanded] = useState({})
  const [cache, setCache] = useState({})
  const [treeLoading, setTreeLoading] = useState({})

  async function load (dir) {
    setLoading(true)
    setSelected('')
    if (!multiple) {
      setSelectedSet(new Set())
    }
    setExpanded({})
    setCache({})
    try {
      const listed = await listAt(tabId, dir)
      setCwd(listed.path)
      setPathDraft(listed.path)
      setEntries(listed.entries)
    } catch (err) {
      message.error(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  function changeView (next) {
    setView(next)
    window.localStorage.setItem('electerm-path-picker-view', next)
  }

  async function toggleExpand (dir) {
    let opening = false
    setExpanded(prev => {
      opening = !prev[dir]
      return { ...prev, [dir]: opening }
    })
    if (!opening || cache[dir]) {
      return
    }
    setTreeLoading(prev => ({ ...prev, [dir]: true }))
    try {
      const listed = await listAt(tabId, dir)
      setCache(prev => ({ ...prev, [dir]: listed.entries }))
    } catch (err) {
      message.error(err.message || String(err))
    } finally {
      setTreeLoading(prev => ({ ...prev, [dir]: false }))
    }
  }

  function afterOpen (visible) {
    if (visible) {
      load(initial || '')
    }
  }

  const atRoot = !cwd || cwd === '/' || /^[a-zA-Z]:\\?$/.test(cwd)
  const rows = sortEntries(entries, sortKey, sortDir)

  function entryByPath (full) {
    const rootHit = rows.find(item => resolve(cwd, item.name) === full)
    if (rootHit) {
      return rootHit
    }
    for (const dir of Object.keys(cache)) {
      const hit = (cache[dir] || []).find(item => resolve(dir, item.name) === full)
      if (hit) {
        return hit
      }
    }
    return null
  }

  function toggleSelect (full, isParent) {
    if (isParent || full === '..') {
      setSelected(full)
      return
    }
    if (!multiple) {
      setSelected(full)
      return
    }
    setSelected(full)
    setSelectedSet(prev => {
      const next = new Set(prev)
      if (next.has(full)) {
        next.delete(full)
      } else {
        next.add(full)
      }
      return next
    })
  }

  function isSelectedPath (full) {
    if (multiple) {
      return selectedSet.has(full) || selected === full
    }
    return selected === full
  }

  function useSelected () {
    if (multiple) {
      const list = [...selectedSet]
      if (!list.length) {
        if (cwd) {
          onPick([cwd])
        }
        return
      }
      onPick(list)
      return
    }
    if (!selected || selected === '..') {
      if (cwd) {
        onPick(cwd)
      }
      return
    }
    const item = entryByPath(selected)
    if (!item) {
      onPick(selected)
      return
    }
    if (item.isDirectory) {
      if (view === 'tree') {
        toggleExpand(selected)
      } else {
        load(selected)
      }
      return
    }
    onPick(selected)
  }

  function toggleSort (id) {
    if (sortKey === id) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(id)
    setSortDir('asc')
  }

  function renderCells (item) {
    return columns.map(col => {
      let value = ''
      if (col.id === 'name') {
        value = item.name
      } else if (col.id === 'size') {
        value = showSize(item)
      } else if (col.id === 'modifyTime') {
        value = showTime(item)
      } else if (col.id === 'mode') {
        value = item.isParent ? '' : showMode(item.mode)
      }
      return (
        <div
          key={col.id}
          className={`sftp-file-prop shi-${col.id}`}
          style={{ width: col.size + '%', flexBasis: col.size + '%' }}
          title={value}
        >
          {col.id === 'name' ? <ExtIcon file={item} className='mg1r' /> : null}
          {item.isSymbol && col.id === 'name' ? <sup className='color-blue symbolic-link-icon'>*</sup> : null}
          {value}
        </div>
      )
    })
  }

  function renderTreeNodes (list, parentPath, level) {
    return sortEntries(list, sortKey, sortDir).map(item => {
      const full = resolve(parentPath, item.name)
      const openNode = !!expanded[full]
      return (
        <div key={full}>
          <div
            className={'sftp-item real-file-item' + (isSelectedPath(full) ? ' selected' : '') + (item.isDirectory ? ' directory' : '')}
            onClick={() => toggleSelect(full)}
            onDoubleClick={() => {
              if (item.isDirectory) {
                toggleExpand(full)
                return
              }
              if (multiple) {
                toggleSelect(full)
                return
              }
              onPick(full)
            }}
          >
            <div className='file-bg' />
            <div className='sftp-tree-row' style={{ paddingLeft: 6 + level * 14 }}>
              {
                item.isDirectory
                  ? (
                    <span
                      className='sftp-tree-toggle'
                      onClick={(ev) => {
                        ev.stopPropagation()
                        toggleExpand(full)
                      }}
                    >
                      {treeLoading[full] ? '…' : (openNode ? <CaretDownOutlined /> : <CaretRightOutlined />)}
                    </span>
                    )
                  : <span className='sftp-tree-toggle sftp-tree-leaf' />
              }
              <ExtIcon file={item} className='mg1r' />
              <span className='sftp-tree-name elli'>{item.name}</span>
            </div>
          </div>
          {openNode && cache[full] ? renderTreeNodes(cache[full], full, level + 1) : null}
        </div>
      )
    })
  }

  function renderRow (item, onOpen) {
    const key = item.isParent ? '..' : resolve(cwd, item.name)
    return (
      <div
        key={key}
        className={'sftp-item ' + (item.isParent ? 'parent-file-item' : 'real-file-item') + (isSelectedPath(key) ? ' selected' : '') + (item.isDirectory ? ' directory' : '')}
        onClick={() => toggleSelect(key, item.isParent)}
        onDoubleClick={onOpen}
      >
        <div className='file-bg' />
        <div className='file-props-div'>
          {renderCells(item)}
        </div>
      </div>
    )
  }

  const multiHint = multiple
    ? `已选 ${selectedSet.size} 项（点击切换勾选，可多选后点选用）`
    : ''

  return (
    <Modal
      className='ops-file-editor'
      open={open}
      title={multiple ? '选择路径（可多选）' : '选择路径'}
      width={860}
      zIndex={1300}
      afterOpenChange={afterOpen}
      onCancel={onClose}
      footer={[
        <Button key='cancel' onClick={onClose}>取消</Button>,
        <Button
          key='dir'
          disabled={!cwd}
          onClick={() => onPick(multiple ? [cwd] : cwd)}
        >
          选择当前目录
        </Button>,
        <Button
          key='use'
          type='primary'
          disabled={!cwd && !(multiple && selectedSet.size)}
          onClick={useSelected}
        >
          选用{multiple && selectedSet.size ? ` (${selectedSet.size})` : ''}
        </Button>
      ]}
    >
      <div className='ops-file-editor'>
        {multiHint ? <div className='pd1b font12'>{multiHint}</div> : null}
        <Space className='mg1b' style={{ width: '100%' }}>
          <Input
            style={{ width: 520 }}
            value={pathDraft}
            placeholder='输入路径后回车'
            onChange={e => setPathDraft(e.target.value)}
            onPressEnter={() => pathDraft.trim() && load(pathDraft.trim())}
          />
          <Button onClick={() => pathDraft.trim() && load(pathDraft.trim())}>转到</Button>
          <span
            className={'sftp-panel-toggle' + (view !== 'tree' ? ' open' : '')}
            onClick={() => changeView('list')}
          >
            <UnorderedListOutlined /> 列表
          </span>
          <span
            className={'sftp-panel-toggle' + (view === 'tree' ? ' open' : '')}
            onClick={() => changeView('tree')}
          >
            <ApartmentOutlined /> 树形
          </span>
        </Space>
        <div className='sftp-title-wrap pd1y'>
          <div className='sftp-path-bar'>
            <div className='sftp-path-crumbs'>
              {crumbsOf(cwd).map((crumb, i) => (
                <span key={crumb.path + i} className='sftp-path-crumb-wrap'>
                  {i > 0 ? <span className='sftp-path-sep'>/</span> : null}
                  <span className='sftp-path-crumb' onClick={() => load(crumb.path)}>{crumb.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className='sftp-table relative'>
          {
            view === 'list'
              ? (
                <div className='sftp-file-table-header relative' style={{ display: 'flex' }}>
                  {columns.map(col => (
                    <div
                      key={col.id}
                      className={'sftp-header-item sftp-header-box shi-' + col.id + (sortKey === col.id ? ' is-sorting' : '')}
                      style={{ width: col.size + '%', cursor: 'pointer' }}
                      onClick={() => toggleSort(col.id)}
                    >
                      {col.label || e(col.id)}
                    </div>
                  ))}
                </div>
                )
              : null
          }
          <div className={'sftp-table-content overscroll-y relative' + (view === 'tree' ? ' sftp-tree-content' : '')} style={{ height: 360 }}>
            {loading ? <div className='pd1'>正在读取…</div> : null}
            {
              !atRoot
                ? renderRow({ name: '..', isDirectory: true, isParent: true }, () => load(resolve(cwd, '..')))
                : null
            }
            {
              view === 'tree'
                ? renderTreeNodes(entries, cwd, 0)
                : rows.map(item => renderRow(item, () => {
                  const full = resolve(cwd, item.name)
                  if (item.isDirectory) {
                    load(full)
                    return
                  }
                  if (multiple) {
                    toggleSelect(full)
                    return
                  }
                  onPick(full)
                }))
            }
            {!loading && !rows.length ? <div className='pd1'>这个目录是空的</div> : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function PathField ({
  tabId,
  value,
  onChange,
  placeholder,
  style,
  className,
  onPressEnter,
  multiple = false,
  rows = 3
}) {
  const [open, setOpen] = useState(false)

  function openBrowser () {
    if (!tabId) {
      message.warning('请先选择终端')
      return
    }
    setOpen(true)
  }

  function handlePick (next) {
    if (multiple) {
      const picked = Array.isArray(next) ? next : [next]
      const prev = String(value || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
      const merged = [...new Set([...prev, ...picked.filter(Boolean)])]
      onChange(merged.join('\n'))
    } else {
      onChange(Array.isArray(next) ? (next[0] || '') : next)
    }
    setOpen(false)
  }

  return (
    <>
      {
        multiple
          ? (
            <div className={className} style={{ width: '100%', ...style }}>
              <Input.TextArea
                value={value}
                placeholder={placeholder || '每行一个路径，可多选'}
                rows={rows}
                onChange={e => onChange(e.target.value)}
                onPressEnter={onPressEnter}
              />
              <div className='pd1t'>
                <Button size='small' onClick={openBrowser}>多选文件…</Button>
              </div>
            </div>
            )
          : (
            <Space.Compact className={className} style={{ width: '100%', ...style }}>
              <Input
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.target.value)}
                onPressEnter={onPressEnter}
              />
              <Button onClick={openBrowser}>选择</Button>
            </Space.Compact>
            )
      }
      <PathBrowser
        open={open}
        tabId={tabId}
        initial={multiple
          ? String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0]
          : value}
        multiple={multiple}
        onClose={() => setOpen(false)}
        onPick={handlePick}
      />
    </>
  )
}
