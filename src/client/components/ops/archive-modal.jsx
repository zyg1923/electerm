/**
 * Compress / extract dialog. Driven by window.store.archiveDialog.
 */

import { useEffect, useState } from 'react'
import { Button, Input, Progress, Radio, Space, message } from 'antd'
import { auto } from 'manate/react'
import Modal from '../common/modal'
import PathField from './path-field'
import { execCmd } from '../terminal/terminal-apis'
import {
  ARCHIVE_FORMATS,
  beginArchiveHistory,
  buildCompressCmd,
  buildExtractCmd,
  defaultArchiveName,
  detectFormatFromName,
  dirnameOf,
  EXTRACT_CONFLICT_OPTIONS,
  finishArchiveHistory,
  joinPathList,
  passwordHint,
  patchArchiveHistory,
  probeArchiveFormats,
  runArchiveWithProgress
} from './ops-archive'

export function openArchiveDialog ({ mode = 'compress', tabId, paths = [], archive = '' }) {
  window.store.archiveDialog = {
    open: true,
    mode,
    tabId,
    paths: Array.isArray(paths) ? paths : [paths].filter(Boolean),
    archive: archive || ''
  }
}

export function closeArchiveDialog () {
  window.store.archiveDialog = {
    ...(window.store.archiveDialog || {}),
    open: false
  }
}

export default auto(function ArchiveDialogHost () {
  const dialog = window.store.archiveDialog || {}
  if (!dialog.open) {
    return null
  }
  return (
    <ArchiveDialogBody
      key={`${dialog.mode}-${(dialog.paths || []).join('|')}-${dialog.archive || ''}`}
      dialog={dialog}
    />
  )
})

function ArchiveDialogBody ({ dialog }) {
  const isCompress = dialog.mode !== 'extract'
  const tabId = dialog.tabId
  const paths = dialog.paths || []
  const archive = dialog.archive || ''
  const [fmt, setFmt] = useState(
    isCompress
      ? 'tar.gz'
      : (detectFormatFromName(archive) || 'tar.gz')
  )
  const [formats, setFormats] = useState(ARCHIVE_FORMATS.filter(f => !f.optional))
  const [srcPaths, setSrcPaths] = useState(joinPathList(paths))
  const [destDir, setDestDir] = useState(
    isCompress
      ? (paths[0] ? dirnameOf(paths[0]) : '')
      : (archive ? dirnameOf(archive) : '')
  )
  const [archiveName, setArchiveName] = useState(
    isCompress ? defaultArchiveName(paths, 'tar.gz') : ''
  )
  const [archivePath, setArchivePath] = useState(archive || '')
  const [excludes, setExcludes] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [conflict, setConflict] = useState('overwrite')
  const [running, setRunning] = useState(false)
  const [percent, setPercent] = useState(0)
  const [log, setLog] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!tabId) return
    probeArchiveFormats(cmd => execCmd(tabId, cmd, 8000, { silent: true }))
      .then(setFormats)
      .catch(() => {})
  }, [tabId])

  async function run () {
    if (password && isCompress && password !== password2) {
      message.warning('两次输入的密码不一致')
      return
    }
    let built
    try {
      if (isCompress) {
        built = buildCompressCmd({
          sources: srcPaths,
          destDir,
          archiveName,
          fmt,
          excludes,
          password
        })
      } else {
        built = buildExtractCmd({
          archive: archivePath,
          destDir,
          fmt,
          password,
          conflict
        })
      }
    } catch (err) {
      message.warning(err.message)
      return
    }
    Modal.confirm({
      title: isCompress ? '确认压缩' : '确认解压',
      content: (
        <div>
          {password ? <div className='pd1b'>已设置密码（预览中已隐藏）</div> : null}
          <pre className='ops-preview-pre'>{built.preview || built.cmd}</pre>
        </div>
      ),
      okText: '执行',
      cancelText: '取消',
      onOk: async () => {
        setRunning(true)
        setPercent(1)
        setStatus('running')
        setLog('')
        const histId = beginArchiveHistory({
          mode: isCompress ? 'compress' : 'extract',
          tabId,
          built
        })
        try {
          await runArchiveWithProgress(
            tabId,
            built,
            (info) => {
              setPercent(info.percent || 0)
              setLog(info.log || '')
              setStatus(info.status || '')
              patchArchiveHistory(histId, {
                percent: info.percent || 0,
                statusText: info.status === 'error'
                  ? '错误'
                  : (isCompress ? '压缩中' : '解压中')
              })
            },
            (cmd, timeoutMs) => execCmd(tabId, cmd, timeoutMs || 15000, { silent: true })
          )
          finishArchiveHistory(histId, { ok: true })
          message.success(isCompress ? '压缩完成' : '解压完成')
          window.store.addOpsAuditLog?.({
            action: isCompress ? 'sftp-compress' : 'sftp-extract',
            detail: { preview: built.preview }
          })
          const { refs } = await import('../common/ref')
          const sftp = refs.get('sftp-' + tabId)
          sftp?.remoteList?.()
          sftp?.localList?.()
          setTimeout(() => closeArchiveDialog(), 400)
        } catch (err) {
          const msg = String(err?.message || err || '')
          finishArchiveHistory(histId, { ok: false, error: msg, percent })
          message.error(
            /Exec channel not supported/i.test(msg)
              ? '当前标签不支持执行命令，请改用已连接的 SSH 标签（本地 Windows 需 Git Bash）'
              : msg
          )
        } finally {
          setRunning(false)
        }
      }
    })
  }

  return (
    <Modal
      open
      title={isCompress ? '压缩为…' : '解压到…'}
      onCancel={running ? undefined : closeArchiveDialog}
      footer={[
        <Button key='cancel' disabled={running} onClick={closeArchiveDialog}>取消</Button>,
        <Button key='ok' type='primary' loading={running} onClick={run}>
          {running ? `进行中 ${percent}%` : '预览并执行'}
        </Button>
      ]}
      width={640}
      zIndex={1400}
      destroyOnClose
      maskClosable={!running}
    >
      {
        isCompress
          ? (
            <>
              <div className='pd1b font12'>源路径（可多选，每行一个）</div>
              <PathField
                className='mg1b'
                tabId={tabId}
                multiple
                value={srcPaths}
                onChange={setSrcPaths}
              />
              <div className='pd1b font12'>输出目录</div>
              <PathField
                className='mg1b'
                tabId={tabId}
                value={destDir}
                onChange={setDestDir}
                placeholder='留空则放到源目录'
              />
              <div className='pd1b font12'>压缩包名称</div>
              <Input
                className='mg1b'
                value={archiveName}
                onChange={e => setArchiveName(e.target.value)}
              />
              <div className='pd1b font12'>排除（每行一个）</div>
              <Input.TextArea
                className='mg1b'
                rows={2}
                value={excludes}
                onChange={e => setExcludes(e.target.value)}
                placeholder={'node_modules\n*.log'}
              />
            </>
            )
          : (
            <>
              <div className='pd1b font12'>压缩包</div>
              <PathField
                className='mg1b'
                tabId={tabId}
                value={archivePath}
                onChange={v => {
                  setArchivePath(v)
                  const d = detectFormatFromName(v)
                  if (d) setFmt(d)
                }}
              />
              <div className='pd1b font12'>解压到目录</div>
              <PathField
                className='mg1b'
                tabId={tabId}
                value={destDir}
                onChange={setDestDir}
              />
              <div className='pd1b font12'>遇到已有文件时</div>
              <Radio.Group
                className='mg1b'
                value={conflict}
                onChange={e => setConflict(e.target.value)}
                disabled={running}
              >
                <Space direction='vertical'>
                  {EXTRACT_CONFLICT_OPTIONS.map(o => (
                    <Radio key={o.value} value={o.value}>
                      {o.label}
                      {o.value === 'rename' && fmt !== '7z' ? '（zip/tar 将按跳过）' : ''}
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </>
            )
      }
      <div className='pd1b font12'>格式（远程 Linux：tar.gz / zip；探测到 7z 时显示）</div>
      <Radio.Group
        className='mg1b'
        value={fmt}
        onChange={e => {
          setFmt(e.target.value)
          if (isCompress && !archiveName) {
            setArchiveName(defaultArchiveName(srcPaths, e.target.value, password))
          }
        }}
        disabled={running}
      >
        <Space wrap>
          {formats.map(f => (
            <Radio.Button key={f.id} value={f.id}>{f.label}</Radio.Button>
          ))}
        </Space>
      </Radio.Group>
      <div className='pd1b font12'>密码（可选）· {passwordHint(fmt)}</div>
      <Input.Password
        className='mg1b'
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder={isCompress ? '留空=不加密' : '加密包请填写密码'}
        disabled={running}
      />
      {
        isCompress && password
          ? (
            <Input.Password
              className='mg1b'
              value={password2}
              onChange={e => setPassword2(e.target.value)}
              placeholder='再输入一次密码'
              disabled={running}
            />
            )
          : null
      }
      {
        running || status
          ? (
            <div className='mg1t'>
              <Progress
                percent={percent}
                status={status === 'error' ? 'exception' : (status === 'done' ? 'success' : 'active')}
                size='small'
              />
              {log
                ? <pre className='ops-live-out mg1t' style={{ maxHeight: 120, fontSize: 11 }}>{log}</pre>
                : null}
            </div>
            )
          : null
      }
    </Modal>
  )
}
