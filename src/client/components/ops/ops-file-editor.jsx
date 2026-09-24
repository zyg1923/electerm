/**
 * Remote file editor. Opened from the file list or by typing vi/vim.
 */

import { useEffect, useRef, useState } from 'react'
import { Modal, Button, Input, Space, Radio, Checkbox, message } from 'antd'
import { auto } from 'manate/react'
import { refsStatic } from '../common/ref'
import { execCmd } from '../terminal/terminal-apis'
import { parseViCommand } from './ops-vi'
import PathField from './path-field'
import { findMatchIndexes, clampHit, renderHighlighted, matchLabel } from './ops-find'

export { parseViCommand }

function shellQuote (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

function isLocalTab (tabId) {
  const tab = (window.store.tabs || []).find(t => t.id === tabId)
  if (!tab) {
    return false
  }
  return !(tab.host || tab.type === 'ssh' || tab.type === 'telnet' || tab.type === 'ftp')
}

function asText (raw) {
  if (raw == null) {
    return ''
  }
  if (typeof raw === 'string') {
    return raw
  }
  if (typeof TextDecoder !== 'undefined' && (raw instanceof Uint8Array || ArrayBuffer.isView(raw))) {
    return new TextDecoder().decode(raw)
  }
  return String(raw)
}

function remoteExpr (p) {
  const path = String(p || '')
  if (path === '~') {
    return '$HOME'
  }
  if (path.startsWith('~/')) {
    return `$HOME/${shellQuote(path.slice(2))}`
  }
  return shellQuote(path)
}

function escapeReg (s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function openOpsFileEditor (opts) {
  const inst = refsStatic.get('ops-file-editor')
  if (inst?.open) {
    inst.open(opts)
    return
  }
  window.store.opsFileEditorPending = opts
  window.store.opsFileEditorVisible = true
}

export default auto(function OpsFileEditorModal () {
  const [visible, setVisible] = useState(false)
  const [tabId, setTabId] = useState('')
  const [container, setContainer] = useState('')
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [orig, setOrig] = useState('')
  const [loading, setLoading] = useState(false)
  const [readonly, setReadonly] = useState(false)
  const [findOn, setFindOn] = useState(false)
  const [replaceOn, setReplaceOn] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [hit, setHit] = useState(0)
  const [closeAsk, setCloseAsk] = useState(false)
  const areaRef = useRef(null)
  const findRef = useRef(null)
  const hlRef = useRef(null)
  const dirty = text !== orig
  const undoRef = useRef([])
  const redoRef = useRef([])
  const textRef = useRef(text)
  textRef.current = text
  const [backup, setBackup] = useState(() => window.localStorage.getItem('electerm-ops-file-backup') !== '0')

  function remember (next) {
    const prev = textRef.current
    if (prev === next) {
      return
    }
    undoRef.current.push(prev)
    if (undoRef.current.length > 200) {
      undoRef.current.shift()
    }
    redoRef.current = []
    textRef.current = next
    setText(next)
  }

  function loadText (next) {
    undoRef.current = []
    redoRef.current = []
    textRef.current = next
    setText(next)
    setOrig(next)
  }

  function undoEdit () {
    if (!undoRef.current.length) {
      return
    }
    const prev = undoRef.current.pop()
    redoRef.current.push(textRef.current)
    textRef.current = prev
    setText(prev)
  }

  function redoEdit () {
    if (!redoRef.current.length) {
      return
    }
    const next = redoRef.current.pop()
    undoRef.current.push(textRef.current)
    textRef.current = next
    setText(next)
  }

  function setBackupPersist (value) {
    setBackup(value)
    window.localStorage.setItem('electerm-ops-file-backup', value ? '1' : '0')
  }

  useEffect(() => {
    refsStatic.add('ops-file-editor', {
      open: (opts) => open(opts)
    })
    if (window.store.opsFileEditorPending) {
      open(window.store.opsFileEditorPending)
      window.store.opsFileEditorPending = null
    }
  }, [])

  function textareaEl () {
    const ref = areaRef.current
    return ref?.resizableTextArea?.textArea || ref?.nativeElement || ref
  }

  async function open (opts) {
    setTabId(opts.tabId || '')
    setContainer(opts.container || '')
    setPath(opts.path || '')
    setCloseAsk(false)
    setVisible(true)
    if (!opts.path) {
      loadText('')
      setLoading(false)
      return
    }
    await loadFile(opts.tabId, opts.path, opts.container || '')
  }

  async function loadFile (nextTabId, nextPath, nextContainer) {
    setLoading(true)
    try {
      if (!nextContainer && isLocalTab(nextTabId)) {
        const raw = await window.fs.readFile(nextPath)
        const content = asText(raw)
        if (content.length > 5 * 1024 * 1024) {
          message.error('文件超过 5MB，拒绝编辑')
          setVisible(false)
          return
        }
        if (content.includes('\0')) {
          message.error('检测到二进制文件')
          setVisible(false)
          return
        }
        loadText(content)
        return
      }
      const expr = remoteExpr(nextPath)
      const readCmd = nextContainer
        ? `docker exec '${String(nextContainer).replace(/'/g, `'\\''`)}' sh -c 'wc -c < ${expr}; head -c 5242880 ${expr}'`
        : `wc -c < ${expr}; head -c 5242880 ${expr}`
      const r = await execCmd(nextTabId, readCmd, 60000)
      const out = r?.stdout || r?.out || ''
      const lines = out.split('\n')
      const size = parseInt(lines[0], 10)
      if (Number.isFinite(size) && size > 5 * 1024 * 1024) {
        message.error('文件超过 5MB，拒绝编辑')
        setVisible(false)
        return
      }
      const content = Number.isFinite(size) ? lines.slice(1).join('\n') : out
      if (content.includes('\0')) {
        message.error('检测到二进制文件')
        setVisible(false)
        return
      }
      loadText(content)
    } catch (e) {
      message.error(e.message)
      setVisible(false)
    } finally {
      setLoading(false)
    }
  }

  async function save () {
    if (!path.trim()) {
      message.warning('请先填写文件路径')
      return false
    }
    setLoading(true)
    try {
      if (!container && isLocalTab(tabId)) {
        await window.fs.writeFile(path.trim(), text)
        setOrig(text)
        message.success('已保存')
        window.store.addOpsAuditLog({
          action: 'file-edit-save',
          detail: { path, tabId, local: true }
        })
        return true
      }
      const expr = remoteExpr(path.trim())
      const bak = `${path}.bak.${Date.now()}`
      const tmp = `/tmp/electerm-edit-${Date.now()}.tmp`
      const b64 = window.btoa(unescape(encodeURIComponent(text)))
      let cmd
      if (container) {
        const c = String(container).replace(/'/g, `'\\''`)
        cmd = [
          `echo '${b64}' | base64 -d > ${shellQuote(tmp)}`,
          `docker cp ${shellQuote(tmp)} '${c}':${expr}`,
          `rm -f ${shellQuote(tmp)}`,
          'echo OK'
        ].join(' && ')
      } else {
        cmd = [
          backup ? `cp -a ${expr} ${shellQuote(bak)} 2>/dev/null || true` : '',
          `echo '${b64}' | base64 -d > ${shellQuote(tmp)}`,
          `cat ${shellQuote(tmp)} > ${expr}`,
          `rm -f ${shellQuote(tmp)}`,
          'echo OK'
        ].filter(Boolean).join(' && ')
      }
      const r = await execCmd(tabId, cmd, 120000)
      if ((r?.code ?? 0) !== 0 && !(r?.stdout || r?.out || '').includes('OK')) {
        throw new Error(r?.stderr || 'save failed')
      }
      setOrig(text)
      message.success(container ? '已写入容器' : (backup ? ('已保存（已备份 ' + bak + '）') : '已保存'))
      window.store.addOpsAuditLog({
        action: 'file-edit-save',
        detail: { path, tabId, bak, container }
      })
      return true
    } catch (e) {
      message.error(e.message || String(e))
      return false
    } finally {
      setLoading(false)
    }
  }

  function requestClose () {
    if (dirty) {
      setCloseAsk(true)
      return
    }
    setVisible(false)
  }

  function selectAt (index, len) {
    const el = textareaEl()
    const width = len == null ? findText.length : len
    if (!el || index < 0 || !width) {
      return
    }
    const end = index + width
    el.focus()
    el.setSelectionRange(index, end)
    const before = text.slice(0, index)
    const line = before.split('\n').length - 1
    const lineHeight = 20
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3)
    if (hlRef.current) {
      hlRef.current.scrollTop = el.scrollTop
      hlRef.current.scrollLeft = el.scrollLeft
    }
  }

  function jumpFind (backward) {
    const list = findMatchIndexes(text, findText)
    if (!list.length) {
      message.info('没有匹配')
      return
    }
    const cur = clampHit(hit, list.length)
    const next = backward
      ? (cur - 1 + list.length) % list.length
      : (cur + 1) % list.length
    setHit(next)
    selectAt(list[next])
  }

  function findNext (backward) {
    jumpFind(backward)
  }

  function replaceOne () {
    const el = textareaEl()
    if (!el || !findText) {
      return
    }
    const sel = text.slice(el.selectionStart, el.selectionEnd)
    if (sel.toLowerCase() !== findText.toLowerCase()) {
      findNext(false)
      return
    }
    const start = el.selectionStart
    const next = text.slice(0, start) + replaceText + text.slice(el.selectionEnd)
    remember(next)
    const pos = start + replaceText.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function replaceAll () {
    if (!findText) {
      return
    }
    const re = new RegExp(escapeReg(findText), 'gi')
    const count = (text.match(re) || []).length
    if (!count) {
      message.info('没有匹配')
      return
    }
    remember(text.replace(re, replaceText))
    message.success(`已替换 ${count} 处`)
  }

  function selectionRange () {
    const el = textareaEl()
    if (!el) {
      return [0, 0]
    }
    let start = el.selectionStart
    let end = el.selectionEnd
    if (start === end) {
      const before = text.slice(0, start)
      const after = text.slice(start)
      const head = (before.match(/[^\s]*$/) || [''])[0].length
      const tail = (after.match(/^[^\s]*/) || [''])[0].length
      start -= head
      end += tail
    }
    return [start, end, el]
  }

  function transformCase (mode) {
    const [start, end, el] = selectionRange()
    if (start === end) {
      return
    }
    const chunk = text.slice(start, end)
    let nextChunk = chunk
    if (mode === 'lower') {
      nextChunk = chunk.toLowerCase()
    } else {
      const letters = Array.from(chunk).filter(ch => ch.toLowerCase() !== ch.toUpperCase())
      const hasLower = letters.some(ch => ch !== ch.toUpperCase())
      const hasUpper = letters.some(ch => ch !== ch.toLowerCase())
      nextChunk = hasUpper && !hasLower ? chunk.toLowerCase() : chunk.toUpperCase()
    }
    remember(text.slice(0, start) + nextChunk + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start, start + nextChunk.length)
    })
  }

  function lineBounds (index) {
    const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
    const endBreak = text.indexOf('\n', index)
    const end = endBreak < 0 ? text.length : endBreak
    return [start, end]
  }

  function duplicateLine () {
    const el = textareaEl()
    if (!el) {
      return
    }
    const [start, end] = lineBounds(el.selectionStart)
    const line = text.slice(start, end)
    const insertAt = end
    const addition = '\n' + line
    remember(text.slice(0, insertAt) + addition + text.slice(insertAt))
  }

  function deleteLine () {
    const el = textareaEl()
    if (!el) {
      return
    }
    const [start, end] = lineBounds(el.selectionStart)
    const cutEnd = text[end] === '\n' ? end + 1 : end
    const cutStart = cutEnd === end && start > 0 ? start - 1 : start
    remember(text.slice(0, cutStart) + text.slice(cutEnd))
  }

  function onEditorKey (e) {
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (ctrl && !e.shiftKey && !e.altKey && key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      setFindOn(true)
      setReplaceOn(false)
      setHit(0)
      const opened = findMatchIndexes(text, findText)
      if (opened.length) {
        requestAnimationFrame(() => selectAt(opened[0], findText.length))
      }
      requestAnimationFrame(() => findRef.current?.focus?.())
      return
    }
    if (ctrl && !e.shiftKey && !e.altKey && key === 'r') {
      e.preventDefault()
      e.stopPropagation()
      if (findOn && replaceOn) {
        setFindOn(false)
        setReplaceOn(false)
        return
      }
      setFindOn(true)
      setReplaceOn(true)
      requestAnimationFrame(() => findRef.current?.focus?.())
      return
    }
    if (ctrl && !e.altKey && key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) {
        redoEdit()
      } else {
        undoEdit()
      }
      return
    }
    if (e.key === 'F3') {
      e.preventDefault()
      e.stopPropagation()
      findNext(e.shiftKey)
      return
    }
    if (readonly) {
      return
    }
    if (ctrl && e.shiftKey && !e.altKey && (key === 'n' || key === 'u')) {
      e.preventDefault()
      e.stopPropagation()
      transformCase('toggle')
      return
    }
    if (ctrl && e.shiftKey && !e.altKey && key === 'l') {
      e.preventDefault()
      e.stopPropagation()
      transformCase('lower')
    }
    if (ctrl && !e.shiftKey && !e.altKey && key === 'd') {
      e.preventDefault()
      e.stopPropagation()
      duplicateLine()
    }
    if (ctrl && e.shiftKey && !e.altKey && key === 'k') {
      e.preventDefault()
      e.stopPropagation()
      deleteLine()
    }
  }

  if (!visible && !window.store.opsFileEditorVisible) {
    return null
  }

  return (
    <Modal
      className='ops-file-editor'
      open={visible}
      title={container ? `编辑容器[${container}]: ${path || '未选择文件'}` : `编辑: ${path || '未选择文件'}`}
      width={900}
      onCancel={requestClose}
      zIndex={1100}
      footer={[
        <Checkbox key='bak' checked={backup} onChange={e => setBackupPersist(e.target.checked)}>保存时备份</Checkbox>,
        <Button key='save' type='primary' disabled={readonly || !dirty} loading={loading} onClick={save}>保存</Button>,
        <Button key='close' onClick={requestClose}>关闭</Button>
      ]}
    >
      <div className='ops-file-editor' onKeyDown={onEditorKey}>
        <Space className='mg1b' wrap>
          <PathField
            style={{ width: 480 }}
            tabId={tabId}
            value={path}
            placeholder='/data/test/file.txt'
            onChange={setPath}
            onPressEnter={() => path.trim() && tabId && loadFile(tabId, path.trim(), container)}
          />
          <Button disabled={!path.trim() || !tabId} onClick={() => loadFile(tabId, path.trim(), container)}>打开</Button>
          <Radio.Group
            size='small'
            optionType='button'
            value={readonly ? 'ro' : 'edit'}
            onChange={e => setReadonly(e.target.value === 'ro')}
          >
            <Radio.Button value='edit'>编辑</Radio.Button>
            <Radio.Button value='ro'>只读</Radio.Button>
          </Radio.Group>
          <span>{dirty ? '● 未保存' : '已保存'}</span>
        </Space>
        {
          findOn
            ? (
              <Space className='mg1b' wrap>
                <Input
                  ref={findRef}
                  style={{ width: 180 }}
                  placeholder='搜索'
                  value={findText}
                  onChange={e => {
                    const value = e.target.value
                    setFindText(value)
                    setHit(0)
                    const list = findMatchIndexes(text, value)
                    if (list.length) {
                      requestAnimationFrame(() => selectAt(list[0], value.length))
                    }
                  }}
                  onPressEnter={() => findNext(false)}
                />
                <Button size='small' onClick={() => findNext(true)}>上一个</Button>
                <Button size='small' onClick={() => findNext(false)}>下一个</Button>
                <span>{findText ? matchLabel(hit, findMatchIndexes(text, findText).length) : ''}</span>
                {
                  replaceOn
                    ? (
                      <>
                        <Input
                          style={{ width: 180 }}
                          placeholder='替换为'
                          value={replaceText}
                          disabled={readonly}
                          onChange={e => setReplaceText(e.target.value)}
                        />
                        <Button size='small' disabled={readonly} onClick={replaceOne}>替换</Button>
                        <Button size='small' disabled={readonly} onClick={replaceAll}>全部替换</Button>
                      </>
                      )
                    : null
                }
              </Space>
              )
            : null
        }
        <div className='font12 mg1b' style={{ opacity: 0.75 }}>
          Ctrl+F 搜索，Ctrl+R 打开或关闭替换，F3 / Shift+F3 上一个下一个，Ctrl+Shift+U 大小写切换（有大写又有小写时先全部变成大写），Ctrl+Shift+L 小写，Ctrl+D 复制当前行，Ctrl+Shift+K 删除当前行，Ctrl+Z 撤回，Ctrl+Shift+Z 恢复
        </div>
        <div className='ops-editor-box'>
          {
            findOn && findText
              ? (
                <pre ref={hlRef} className='ops-editor-hl' aria-hidden='true'>
                  {renderHighlighted(text, findText, hit)}
                  {'\n'}
                </pre>
                )
              : null
          }
          <Input.TextArea
            ref={areaRef}
            className={findOn && findText ? 'ops-editor-input' : ''}
            value={text}
            onChange={e => !readonly && remember(e.target.value)}
            onScroll={e => {
              if (hlRef.current) {
                hlRef.current.scrollTop = e.target.scrollTop
                hlRef.current.scrollLeft = e.target.scrollLeft
              }
            }}
            autoSize={{ minRows: 18, maxRows: 28 }}
            disabled={loading}
            readOnly={readonly}
            style={{ fontFamily: 'Maple Mono, monospace', fontSize: 13 }}
          />
        </div>
      </div>
      <Modal
        open={closeAsk}
        title='是否保存更改？'
        zIndex={1200}
        onCancel={() => setCloseAsk(false)}
        footer={[
          <Button key='cancel' onClick={() => setCloseAsk(false)}>取消</Button>,
          <Button key='drop' onClick={() => { setCloseAsk(false); setVisible(false) }}>不保存</Button>,
          <Button
            key='save'
            type='primary'
            loading={loading}
            onClick={async () => {
              const ok = await save()
              if (ok) {
                setCloseAsk(false)
                setVisible(false)
              }
            }}
          >
            保存
          </Button>
        ]}
      >
        文件有未保存的修改，要写入远程文件吗？
      </Modal>
    </Modal>
  )
})
