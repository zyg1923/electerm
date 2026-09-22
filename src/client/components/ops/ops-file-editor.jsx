/**
 * Lightweight remote file editor via SSH cat/tee (no vim)
 */

import { useEffect, useState } from 'react'
import { Modal, Button, Input, Space, Switch, message } from 'antd'
import { auto } from 'manate/react'
import { refsStatic } from '../common/ref'
import { execCmd } from '../terminal/terminal-apis'

function shellQuote (p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
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
  const dirty = text !== orig

  useEffect(() => {
    refsStatic.add('ops-file-editor', {
      open: (opts) => open(opts)
    })
    if (window.store.opsFileEditorPending) {
      open(window.store.opsFileEditorPending)
      window.store.opsFileEditorPending = null
    }
  }, [])

  async function open (opts) {
    setTabId(opts.tabId)
    setContainer(opts.container || '')
    setPath(opts.path)
    setVisible(true)
    setLoading(true)
    try {
      const readCmd = opts.container
        ? `docker exec '${String(opts.container).replace(/'/g, `'\\''`)}' sh -c 'wc -c < ${shellQuote(opts.path)}; head -c 5242880 ${shellQuote(opts.path)}'`
        : `wc -c < ${shellQuote(opts.path)}; head -c 5242880 ${shellQuote(opts.path)}`
      const r = await execCmd(opts.tabId, readCmd, 60000)
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
      setText(content)
      setOrig(content)
    } catch (e) {
      message.error(e.message)
      setVisible(false)
    } finally {
      setLoading(false)
    }
  }

  async function save () {
    setLoading(true)
    try {
      const bak = `${path}.bak.${Date.now()}`
      const tmp = `/tmp/electerm-edit-${Date.now()}.tmp`
      const b64 = window.btoa(unescape(encodeURIComponent(text)))
      let cmd
      if (container) {
        const c = String(container).replace(/'/g, `'\\''`)
        // host temp -> docker cp
        cmd = [
          `echo '${b64}' | base64 -d > ${shellQuote(tmp)}`,
          `docker cp ${shellQuote(tmp)} '${c}':${shellQuote(path)}`,
          `rm -f ${shellQuote(tmp)}`,
          'echo OK'
        ].join(' && ')
      } else {
        cmd = [
          `cp -a ${shellQuote(path)} ${shellQuote(bak)} 2>/dev/null || true`,
          `echo '${b64}' | base64 -d > ${shellQuote(tmp)}`,
          `cat ${shellQuote(tmp)} > ${shellQuote(path)}`,
          `rm -f ${shellQuote(tmp)}`,
          'echo OK'
        ].join(' && ')
      }
      const r = await execCmd(tabId, cmd, 120000)
      if ((r?.code ?? 0) !== 0 && !(r?.stdout || r?.out || '').includes('OK')) {
        throw new Error(r?.stderr || 'save failed')
      }
      setOrig(text)
      message.success(container ? '已写入容器' : ('已保存（已备份 ' + bak + '）'))
      window.store.addOpsAuditLog({
        action: 'file-edit-save',
        detail: { path, tabId, bak, container }
      })
    } catch (e) {
      message.error(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  function close () {
    if (dirty) {
      Modal.confirm({
        title: '有未保存更改',
        okText: '放弃并关闭',
        cancelText: '取消',
        onOk: () => setVisible(false)
      })
    } else {
      setVisible(false)
    }
  }

  if (!visible && !window.store.opsFileEditorVisible) {
    return null
  }

  return (
    <Modal
      open={visible}
      title={container ? `编辑容器[${container}]: ${path}` : `编辑: ${path}`}
      width={900}
      onCancel={close}
      zIndex={1100}
      footer={[
        <Switch key='ro' checkedChildren='只读' unCheckedChildren='编辑' checked={readonly} onChange={setReadonly} />,
        <Button key='save' type='primary' disabled={readonly || !dirty} loading={loading} onClick={save}>保存</Button>,
        <Button key='close' onClick={close}>关闭</Button>
      ]}
    >
      <Space className='mg1b'>
        <span>{dirty ? '● 未保存' : '已保存'}</span>
      </Space>
      <Input.TextArea
        value={text}
        onChange={e => !readonly && setText(e.target.value)}
        autoSize={{ minRows: 18, maxRows: 28 }}
        disabled={loading}
        style={{ fontFamily: 'Maple Mono, monospace', fontSize: 13 }}
      />
    </Modal>
  )
})

export function parseViCommand (cmd) {
  const s = String(cmd || '').trim()
  if (!s) return null
  if (/\s--raw\b/.test(s)) return null
  const m = s.match(/^(?:sudo\s+)?(vi|vim|edit)\s+(\S+)/)
  if (!m) return null
  return { editor: m[1], path: m[2] }
}
