/**
 * Beginner wizards: chmod, compress, extract, trash, port, user preview
 */

import { useEffect, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  Progress,
  Radio,
  Space,
  Tabs,
  message
} from 'antd'
import Modal from '../common/modal'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import { execCmd } from '../terminal/terminal-apis'
import PathField from './path-field'
import {
  ARCHIVE_FORMATS,
  beginArchiveHistory,
  buildChmodCmd,
  buildCompressCmd,
  buildExtractCmd,
  buildTrashCmd,
  defaultArchiveName,
  detectFormatFromName,
  EXTRACT_CONFLICT_OPTIONS,
  finishArchiveHistory,
  passwordHint,
  patchArchiveHistory,
  probeArchiveFormats,
  runArchiveWithProgress
} from './ops-archive'

const defaultBits = {
  ur: true, uw: true, ux: true,
  gr: true, gw: false, gx: true,
  or: true, ow: false, ox: true
}

function readWizardState () {
  const s = window.store?.opsWizardState
  if (s && typeof s === 'object') {
    return s
  }
  return { activeTool: 'chmod', forms: {} }
}

function writeWizardState (patch) {
  const prev = readWizardState()
  const forms = {
    ...(prev.forms || {}),
    ...(patch.forms || {})
  }
  // Never persist archive passwords
  if (forms.compress) {
    forms.compress = { ...forms.compress, password: '' }
  }
  if (forms.extract) {
    forms.extract = { ...forms.extract, password: '' }
  }
  const next = {
    ...prev,
    ...patch,
    forms
  }
  window.store.opsWizardState = next
}

function useWizardForm (key, defaults) {
  const saved = readWizardState().forms?.[key] || {}
  const [form, setForm] = useState(() => ({ ...defaults, ...saved }))
  useEffect(() => {
    writeWizardState({
      forms: {
        [key]: form
      }
    })
  }, [key, form])
  function patch (partial) {
    setForm(prev => ({ ...prev, ...partial }))
  }
  return [form, patch, setForm]
}

async function runOnTabs (tabIds, cmd) {
  const results = []
  for (const id of tabIds) {
    try {
      const r = await execCmd(id, cmd, 120000)
      results.push({ tabId: id, ok: (r?.code ?? 0) === 0, out: r?.stdout || r?.out || '', err: r?.stderr || '' })
    } catch (e) {
      results.push({ tabId: id, ok: false, out: '', err: e.message })
    }
  }
  return results
}

function confirmRun (title, cmd, onOk) {
  Modal.confirm({
    title,
    content: <pre className='ops-preview-pre'>{cmd}</pre>,
    okText: ot('ok'),
    cancelText: ot('cancel'),
    onOk
  })
}

function modeFromBits (bits) {
  const modeNum = (
    ((bits.ur ? 4 : 0) + (bits.uw ? 2 : 0) + (bits.ux ? 1 : 0)) * 64 +
    ((bits.gr ? 4 : 0) + (bits.gw ? 2 : 0) + (bits.gx ? 1 : 0)) * 8 +
    ((bits.or ? 4 : 0) + (bits.ow ? 2 : 0) + (bits.ox ? 1 : 0))
  )
  return modeNum.toString(8).padStart(3, '0')
}

function ChmodWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('chmod', {
    paths: '',
    recursive: false,
    bits: { ...defaultBits }
  })
  const bits = form.bits || defaultBits
  const modeStr = modeFromBits(bits)
  let cmd = ''
  try {
    cmd = buildChmodCmd(form.paths, modeStr, form.recursive)
  } catch (_) {}

  return (
    <div>
      <PathField
        className='mg1b'
        tabId={tabIds[0]}
        multiple
        placeholder={'文件/目录路径（每行一个，可多选）'}
        value={form.paths}
        onChange={v => patch({ paths: v })}
      />
      <div className='mg1b'>模式: <b>{modeStr}</b></div>
      <Space wrap className='mg1b'>
        {['ur', 'uw', 'ux', 'gr', 'gw', 'gx', 'or', 'ow', 'ox'].map(k => (
          <Checkbox
            key={k}
            checked={!!bits[k]}
            onChange={e => patch({ bits: { ...bits, [k]: e.target.checked } })}
          >
            {k}
          </Checkbox>
        ))}
      </Space>
      <Checkbox
        checked={!!form.recursive}
        onChange={e => patch({ recursive: e.target.checked })}
      >
        递归
      </Checkbox>
      <div className='mg1t'>
        <Button
          type='primary'
          onClick={() => {
            if (!form.paths?.trim() || !tabIds.length) {
              return message.warning('请填路径并选机器')
            }
            confirmRun('确认 chmod', cmd, async () => {
              const rs = await runOnTabs(tabIds, cmd)
              window.store.addOpsAuditLog({ action: 'wizard-chmod', detail: { cmd, rs } })
              message.success(`完成 ${rs.filter(r => r.ok).length}/${rs.length}`)
            })
          }}
        >
          预览并执行
        </Button>
      </div>
    </div>
  )
}

function CompressWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('compress', {
    paths: '',
    destDir: '',
    archiveName: '',
    fmt: 'tar.gz',
    excludes: '',
    password: ''
  })
  const [password2, setPassword2] = useState('')
  const [formats, setFormats] = useState(ARCHIVE_FORMATS.filter(f => !f.optional))
  const [running, setRunning] = useState(false)
  const [percent, setPercent] = useState(0)
  const [log, setLog] = useState('')

  useEffect(() => {
    const id = tabIds[0]
    if (!id) return
    probeArchiveFormats(cmd => execCmd(id, cmd, 8000, { silent: true }))
      .then(setFormats)
      .catch(() => {})
  }, [tabIds[0]])

  useEffect(() => {
    if (!form.archiveName && form.paths?.trim()) {
      patch({ archiveName: defaultArchiveName(form.paths, form.fmt, form.password) })
    }
  }, [form.fmt])

  let built = null
  try {
    built = buildCompressCmd({
      sources: form.paths,
      destDir: form.destDir,
      archiveName: form.archiveName,
      fmt: form.fmt,
      excludes: form.excludes,
      password: form.password
    })
  } catch (_) {}

  return (
    <div>
      <PathField
        className='mg1b'
        tabId={tabIds[0]}
        multiple
        placeholder='要压缩的路径（每行一个，可多选）'
        value={form.paths}
        onChange={v => patch({ paths: v })}
      />
      <PathField
        className='mg1b'
        tabId={tabIds[0]}
        placeholder='输出目录（留空=源文件所在目录）'
        value={form.destDir}
        onChange={v => patch({ destDir: v })}
      />
      <Input
        className='mg1b'
        placeholder='压缩包名称（可含扩展名）'
        value={form.archiveName}
        onChange={e => patch({ archiveName: e.target.value })}
      />
      <Input.TextArea
        className='mg1b'
        rows={2}
        placeholder={'排除规则（每行一个，如 node_modules 或 *.log）'}
        value={form.excludes}
        onChange={e => patch({ excludes: e.target.value })}
      />
      <div className='mg1b font12'>格式：远程 Linux 默认 tar.gz / zip；探测到 7z 时额外显示</div>
      <Radio.Group
        value={form.fmt}
        onChange={e => patch({ fmt: e.target.value })}
        className='mg1b'
        disabled={running}
      >
        {formats.map(f => (
          <Radio.Button key={f.id} value={f.id}>{f.label}</Radio.Button>
        ))}
      </Radio.Group>
      <div className='mg1b font12'>密码（可选）· {passwordHint(form.fmt)}</div>
      <Input.Password
        className='mg1b'
        value={form.password || ''}
        onChange={e => patch({ password: e.target.value })}
        placeholder='留空=不加密'
        disabled={running}
      />
      {
        form.password
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
        running
          ? (
            <div className='mg1b'>
              <Progress percent={percent} size='small' status='active' />
              {log ? <pre className='ops-live-out mg1t' style={{ maxHeight: 100, fontSize: 11 }}>{log}</pre> : null}
            </div>
            )
          : null
      }
      <div>
        <Button
          type='primary'
          loading={running}
          onClick={() => {
            if (!form.paths?.trim() || !tabIds.length) {
              return message.warning('请选择源路径和机器')
            }
            if (form.password && form.password !== password2) {
              return message.warning('两次输入的密码不一致')
            }
            let next
            try {
              next = buildCompressCmd({
                sources: form.paths,
                destDir: form.destDir,
                archiveName: form.archiveName || defaultArchiveName(form.paths, form.fmt, form.password),
                fmt: form.fmt,
                excludes: form.excludes,
                password: form.password
              })
            } catch (err) {
              return message.warning(err.message)
            }
            confirmRun('确认压缩', next.preview || next.cmd, async () => {
              setRunning(true)
              setPercent(1)
              setLog('')
              try {
                for (const id of tabIds) {
                  const histId = beginArchiveHistory({
                    mode: 'compress',
                    tabId: id,
                    built: next
                  })
                  try {
                    await runArchiveWithProgress(
                      id,
                      next,
                      (info) => {
                        setPercent(info.percent || 0)
                        setLog(info.log || '')
                        patchArchiveHistory(histId, {
                          percent: info.percent || 0,
                          statusText: '压缩中'
                        })
                      },
                      (cmd, timeoutMs) => execCmd(id, cmd, timeoutMs || 15000, { silent: true })
                    )
                    finishArchiveHistory(histId, { ok: true })
                  } catch (err) {
                    finishArchiveHistory(histId, {
                      ok: false,
                      error: String(err?.message || err || ''),
                      percent
                    })
                    throw err
                  }
                }
                window.store.addOpsAuditLog({ action: 'wizard-compress', detail: { preview: next.preview } })
                message.success('压缩完成')
              } catch (err) {
                const msg = String(err?.message || err || '')
                message.error(
                  /Exec channel not supported/i.test(msg)
                    ? '当前标签不支持执行命令，请改用已连接的 SSH 标签（本地 Windows 需 Git Bash）'
                    : msg
                )
              } finally {
                setRunning(false)
              }
            })
          }}
        >
          {running ? `压缩中 ${percent}%` : '预览并执行'}
        </Button>
      </div>
    </div>
  )
}

function ExtractWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('extract', {
    archive: '',
    destDir: '',
    fmt: '',
    password: '',
    conflict: 'overwrite'
  })
  const [running, setRunning] = useState(false)
  const [percent, setPercent] = useState(0)
  const [log, setLog] = useState('')
  const fmt = form.fmt || detectFormatFromName(form.archive) || 'tar.gz'
  const conflict = form.conflict || 'overwrite'

  return (
    <div>
      <PathField
        className='mg1b'
        tabId={tabIds[0]}
        placeholder='压缩包路径'
        value={form.archive}
        onChange={v => patch({
          archive: v,
          fmt: detectFormatFromName(v) || form.fmt
        })}
      />
      <PathField
        className='mg1b'
        tabId={tabIds[0]}
        placeholder='解压到目录（留空=压缩包所在目录）'
        value={form.destDir}
        onChange={v => patch({ destDir: v })}
      />
      <Radio.Group
        value={fmt}
        onChange={e => patch({ fmt: e.target.value })}
        className='mg1b'
        disabled={running}
      >
        {ARCHIVE_FORMATS.map(f => (
          <Radio.Button key={f.id} value={f.id}>{f.label}</Radio.Button>
        ))}
      </Radio.Group>
      <div className='mg1b font12'>遇到已有文件时</div>
      <Radio.Group
        value={conflict}
        onChange={e => patch({ conflict: e.target.value })}
        className='mg1b'
        disabled={running}
      >
        {EXTRACT_CONFLICT_OPTIONS.map(o => (
          <Radio key={o.value} value={o.value}>
            {o.label}
            {o.value === 'rename' && fmt !== '7z' ? '（zip/tar 将按跳过）' : ''}
          </Radio>
        ))}
      </Radio.Group>
      <div className='mg1b font12'>密码（可选）· {passwordHint(fmt)}</div>
      <Input.Password
        className='mg1b'
        value={form.password || ''}
        onChange={e => patch({ password: e.target.value })}
        placeholder='加密包请填写密码'
        disabled={running}
      />
      {
        running
          ? (
            <div className='mg1b'>
              <Progress percent={percent} size='small' status='active' />
              {log ? <pre className='ops-live-out mg1t' style={{ maxHeight: 100, fontSize: 11 }}>{log}</pre> : null}
            </div>
            )
          : null
      }
      <Button
        type='primary'
        loading={running}
        onClick={() => {
          if (!form.archive?.trim() || !tabIds.length) {
            return message.warning('请选择压缩包和机器')
          }
          let next
          try {
            next = buildExtractCmd({
              archive: form.archive,
              destDir: form.destDir,
              fmt,
              password: form.password,
              conflict
            })
          } catch (err) {
            return message.warning(err.message)
          }
          confirmRun('确认解压', next.preview || next.cmd, async () => {
            setRunning(true)
            setPercent(1)
            setLog('')
            try {
              for (const id of tabIds) {
                const histId = beginArchiveHistory({
                  mode: 'extract',
                  tabId: id,
                  built: next
                })
                try {
                  await runArchiveWithProgress(
                    id,
                    next,
                    (info) => {
                      setPercent(info.percent || 0)
                      setLog(info.log || '')
                      patchArchiveHistory(histId, {
                        percent: info.percent || 0,
                        statusText: '解压中'
                      })
                    },
                    (cmd, timeoutMs) => execCmd(id, cmd, timeoutMs || 15000, { silent: true })
                  )
                  finishArchiveHistory(histId, { ok: true })
                } catch (err) {
                  finishArchiveHistory(histId, {
                    ok: false,
                    error: String(err?.message || err || ''),
                    percent
                  })
                  throw err
                }
              }
              window.store.addOpsAuditLog({ action: 'wizard-extract', detail: { preview: next.preview } })
              message.success('解压完成')
            } catch (err) {
              const msg = String(err?.message || err || '')
              message.error(
                /Exec channel not supported/i.test(msg)
                  ? '当前标签不支持执行命令，请改用已连接的 SSH 标签（本地 Windows 需 Git Bash）'
                  : msg
              )
            } finally {
              setRunning(false)
            }
          })
        }}
      >
        {running ? `解压中 ${percent}%` : '预览并执行'}
      </Button>
    </div>
  )
}

function TrashWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('trash', { paths: '' })
  let cmd = ''
  try {
    cmd = buildTrashCmd(form.paths)
  } catch (_) {}
  return (
    <div>
      <p>安全删除：移动到 /tmp/trash/ 而非 rm（支持多选）</p>
      <PathField
        className='mg1b'
        tabId={tabIds[0]}
        multiple
        placeholder='要删除的路径（每行一个，可多选）'
        value={form.paths}
        onChange={v => patch({ paths: v })}
      />
      <Button
        danger
        type='primary'
        onClick={() => {
          if (!form.paths?.trim() || !tabIds.length) {
            return message.warning('请填路径并选机器')
          }
          let nextCmd = cmd
          try {
            nextCmd = buildTrashCmd(form.paths)
          } catch (err) {
            return message.warning(err.message)
          }
          confirmRun('确认安全删除', nextCmd, async () => {
            const rs = await runOnTabs(tabIds, nextCmd)
            window.store.addOpsAuditLog({ action: 'wizard-trash', detail: { paths: form.paths } })
            message.success(rs[0]?.out || `完成 ${rs.filter(r => r.ok).length}/${rs.length}`)
          })
        }}
      >
        移到回收站
      </Button>
    </div>
  )
}

function PortWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('port', { port: '80' })
  const [out, setOut] = useState('')
  const cmd = `ss -lntp | grep :${form.port} || netstat -lntp 2>/dev/null | grep :${form.port}`
  return (
    <div>
      <Space>
        <Input style={{ width: 100 }} value={form.port} onChange={e => patch({ port: e.target.value })} />
        <Button
          type='primary'
          onClick={async () => {
            const rs = await runOnTabs(tabIds.slice(0, 1), cmd)
            setOut(rs[0]?.out || rs[0]?.err || '')
          }}
        >
          查询
        </Button>
      </Space>
      <pre className='ops-live-out mg1t'>{out}</pre>
    </div>
  )
}

function ServiceWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('service', { unit: 'nginx' })
  const [list, setList] = useState('')
  return (
    <div>
      <Space className='mg1b'>
        <Button onClick={async () => {
          const rs = await runOnTabs(tabIds.slice(0, 1), 'systemctl list-units --type=service --no-pager | head -40')
          setList(rs[0]?.out || '')
        }}
        >
          列出服务
        </Button>
        <Input style={{ width: 160 }} value={form.unit} onChange={e => patch({ unit: e.target.value })} />
        {['start', 'stop', 'restart', 'status'].map(act => (
          <Button
            key={act}
            danger={act === 'stop' || act === 'restart'}
            onClick={() => {
              const cmd = `systemctl ${act} ${form.unit}`
              confirmRun(`确认 systemctl ${act}`, cmd, async () => {
                const rs = await runOnTabs(tabIds, cmd)
                setList(rs.map(r => `## ${r.tabId}\n${r.out || r.err}`).join('\n'))
                window.store.addOpsAuditLog({ action: 'wizard-systemctl', detail: { cmd } })
              })
            }}
          >
            {act}
          </Button>
        ))}
      </Space>
      <pre className='ops-live-out'>{list}</pre>
    </div>
  )
}

function NetworkWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('net', { host: '8.8.8.8', port: '53' })
  const [out, setOut] = useState('')
  async function diagnose () {
    const id = tabIds[0]
    if (!id) return message.warning('选机器')
    const steps = [
      `ping -c 3 ${form.host}`,
      `nc -zv ${form.host} ${form.port} 2>&1 || timeout 3 bash -c 'echo >/dev/tcp/${form.host}/${form.port}' 2>&1`,
      `traceroute -m 8 ${form.host} 2>/dev/null | head -12 || tracepath ${form.host} 2>/dev/null | head -12`,
      `nslookup ${form.host} 2>/dev/null || dig +short ${form.host} 2>/dev/null`
    ]
    const buf = []
    for (const cmd of steps) {
      const rs = await runOnTabs([id], cmd)
      buf.push(`## ${cmd}\n${rs[0]?.out || rs[0]?.err}`)
    }
    setOut(buf.join('\n\n'))
  }
  return (
    <div>
      <Space className='mg1b'>
        <Input value={form.host} onChange={e => patch({ host: e.target.value })} placeholder='IP/域名' />
        <Input style={{ width: 80 }} value={form.port} onChange={e => patch({ port: e.target.value })} />
        <Button type='primary' onClick={diagnose}>一键诊断</Button>
      </Space>
      <pre className='ops-live-out'>{out}</pre>
    </div>
  )
}

function LinkWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('link', { src: '', dst: '' })
  const cmd = `ln -s '${String(form.src || '').replace(/'/g, `'\\''`)}' '${String(form.dst || '').replace(/'/g, `'\\''`)}' && ls -la '${String(form.dst || '').replace(/'/g, `'\\''`)}'`
  return (
    <div>
      <PathField className='mg1b' tabId={tabIds[0]} placeholder='源' value={form.src} onChange={v => patch({ src: v })} />
      <PathField className='mg1b' tabId={tabIds[0]} placeholder='链接路径' value={form.dst} onChange={v => patch({ dst: v })} />
      <Button type='primary' onClick={() => confirmRun('创建软链接', cmd, async () => {
        const rs = await runOnTabs(tabIds, cmd)
        message.success(rs[0]?.out || 'done')
      })}
      >创建
      </Button>
    </div>
  )
}

function TimeWizard ({ tabIds }) {
  const [out, setOut] = useState('')
  return (
    <div>
      <Space className='mg1b'>
        <Button onClick={async () => {
          const rs = await runOnTabs(tabIds.slice(0, 1), 'date; timedatectl 2>/dev/null | head -15')
          setOut(rs[0]?.out || '')
        }}
        >查看时间
        </Button>
        <Button onClick={() => confirmRun('同步 NTP', 'chronyc makestep 2>/dev/null || ntpdate -u pool.ntp.org 2>/dev/null || timedatectl set-ntp true', async () => {
          const rs = await runOnTabs(tabIds, 'chronyc makestep 2>/dev/null || ntpdate -u pool.ntp.org 2>/dev/null || timedatectl set-ntp true; date')
          setOut(rs.map(r => r.out || r.err).join('\n'))
        })}
        >同步NTP
        </Button>
      </Space>
      <pre className='ops-live-out'>{out}</pre>
    </div>
  )
}

function UserWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('user', { user: '' })
  const [out, setOut] = useState('')
  return (
    <div>
      <Space className='mg1b'>
        <Button onClick={async () => {
          const rs = await runOnTabs(tabIds.slice(0, 1), 'getent passwd | awk -F: \'$3>=1000{print $1,$3,$6,$7}\' | head -40')
          setOut(rs[0]?.out || '')
        }}
        >用户列表
        </Button>
        <Input style={{ width: 120 }} value={form.user} onChange={e => patch({ user: e.target.value })} placeholder='用户名' />
        <Button onClick={() => confirmRun('创建用户', `useradd -m ${form.user}`, async () => {
          const u = String(form.user || '').replace(/'/g, `'\\''`)
          const rs = await runOnTabs(tabIds, `useradd -m '${u}' && id '${u}'`)
          setOut(rs.map(r => r.out || r.err).join('\n'))
        })}
        >新增
        </Button>
      </Space>
      <pre className='ops-live-out'>{out}</pre>
    </div>
  )
}

function EnvWizard ({ tabIds }) {
  const [form, patch] = useWizardForm('env', { key: 'MY_VAR', val: '1' })
  const [out, setOut] = useState('')
  return (
    <div>
      <Space className='mg1b'>
        <Button onClick={async () => {
          const rs = await runOnTabs(tabIds.slice(0, 1), 'env | sort | head -50')
          setOut(rs[0]?.out || '')
        }}
        >当前环境变量
        </Button>
        <Input style={{ width: 120 }} value={form.key} onChange={e => patch({ key: e.target.value })} />
        <Input style={{ width: 120 }} value={form.val} onChange={e => patch({ val: e.target.value })} />
        <Button onClick={() => {
          const cmd = `echo 'export ${form.key}=${form.val}' >> ~/.bashrc && export ${form.key}=${form.val} && echo ${form.key}=$${form.key}`
          confirmRun('写入用户 bashrc', cmd, async () => {
            const rs = await runOnTabs(tabIds, cmd)
            setOut(rs.map(r => r.out || r.err).join('\n'))
          })
        }}
        >添加(用户)
        </Button>
      </Space>
      <pre className='ops-live-out'>{out}</pre>
    </div>
  )
}

function MountWizard ({ tabIds }) {
  const [out, setOut] = useState('')
  return (
    <div>
      <Button className='mg1b' onClick={async () => {
        const rs = await runOnTabs(tabIds.slice(0, 1), 'lsblk -f; echo ----; df -hT | head -20')
        setOut(rs[0]?.out || '')
      }}
      >磁盘/挂载列表
      </Button>
      <pre className='ops-live-out'>{out}</pre>
      <p className='font12'>完整初始化(fdisk/mkfs/fstab)请人工确认后在滚动执行中操作，避免误伤。</p>
    </div>
  )
}

export default function WizardsPanel () {
  const { selectedTabIds, listProps } = useOpsTabSelect()
  const [activeTool, setActiveTool] = useState(() => readWizardState().activeTool || 'chmod')

  return (
    <div className='ops-panel'>
      <OpsTabSelect listProps={listProps} />
      <Tabs
        activeKey={activeTool}
        onChange={(key) => {
          setActiveTool(key)
          writeWizardState({ activeTool: key })
        }}
        items={[
          { key: 'chmod', label: '权限 chmod', children: <ChmodWizard tabIds={selectedTabIds} /> },
          { key: 'compress', label: '压缩', children: <CompressWizard tabIds={selectedTabIds} /> },
          { key: 'extract', label: '解压', children: <ExtractWizard tabIds={selectedTabIds} /> },
          { key: 'trash', label: '回收站', children: <TrashWizard tabIds={selectedTabIds} /> },
          { key: 'port', label: '端口查询', children: <PortWizard tabIds={selectedTabIds} /> },
          { key: 'service', label: '服务 systemctl', children: <ServiceWizard tabIds={selectedTabIds} /> },
          { key: 'user', label: '用户', children: <UserWizard tabIds={selectedTabIds} /> },
          { key: 'env', label: '环境变量', children: <EnvWizard tabIds={selectedTabIds} /> },
          { key: 'link', label: '软链接', children: <LinkWizard tabIds={selectedTabIds} /> },
          { key: 'time', label: '时间', children: <TimeWizard tabIds={selectedTabIds} /> },
          { key: 'net', label: '网络诊断', children: <NetworkWizard tabIds={selectedTabIds} /> },
          { key: 'mount', label: '磁盘挂载', children: <MountWizard tabIds={selectedTabIds} /> }
        ]}
      />
    </div>
  )
}
