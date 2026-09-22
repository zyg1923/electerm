/**
 * Beginner wizards: chmod, compress, trash, port, user preview
 */

import { useState } from 'react'
import {
  Button,
  Checkbox,
  Form,
  Input,
  Radio,
  Space,
  Tabs,
  message
} from 'antd'
import Modal from '../common/modal'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import { execCmd } from '../terminal/terminal-apis'

async function runOnTabs (tabIds, cmd) {
  const results = []
  for (const id of tabIds) {
    try {
      const r = await execCmd(id, cmd, 60000)
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

function ChmodWizard ({ tabIds }) {
  const [path, setPath] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [bits, setBits] = useState({
    ur: true, uw: true, ux: true,
    gr: true, gw: false, gx: true,
    or: true, ow: false, ox: true
  })
  const mode =
    (bits.ur ? 4 : 0) + (bits.uw ? 2 : 0) + (bits.ux ? 1 : 0) +
    '' +
    ((bits.gr ? 4 : 0) + (bits.gw ? 2 : 0) + (bits.gx ? 1 : 0)) +
    '' +
    ((bits.or ? 4 : 0) + (bits.ow ? 2 : 0) + (bits.ox ? 1 : 0))

  // fix mode calculation - should be octal number
  const modeNum = (
    ((bits.ur ? 4 : 0) + (bits.uw ? 2 : 0) + (bits.ux ? 1 : 0)) * 64 +
    ((bits.gr ? 4 : 0) + (bits.gw ? 2 : 0) + (bits.gx ? 1 : 0)) * 8 +
    ((bits.or ? 4 : 0) + (bits.ow ? 2 : 0) + (bits.ox ? 1 : 0))
  )
  const modeStr = modeNum.toString(8).padStart(3, '0')
  const cmd = `chmod ${recursive ? '-R ' : ''}${modeStr} '${path.replace(/'/g, `'\\''`)}'`

  return (
    <div>
      <Input className='mg1b' placeholder='文件/目录路径' value={path} onChange={e => setPath(e.target.value)} />
      <div className='mg1b'>模式: <b>{modeStr}</b></div>
      <Space wrap className='mg1b'>
        {['ur', 'uw', 'ux', 'gr', 'gw', 'gx', 'or', 'ow', 'ox'].map(k => (
          <Checkbox key={k} checked={bits[k]} onChange={e => setBits({ ...bits, [k]: e.target.checked })}>{k}</Checkbox>
        ))}
      </Space>
      <Checkbox checked={recursive} onChange={e => setRecursive(e.target.checked)}>递归</Checkbox>
      <div className='mg1t'>
        <Button
          type='primary'
          onClick={() => {
            if (!path || !tabIds.length) return message.warning('请填路径并选机器')
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
  const [src, setSrc] = useState('')
  const [out, setOut] = useState('archive.tar.gz')
  const [fmt, setFmt] = useState('tar.gz')
  const cmdMap = {
    'tar.gz': `tar -czf '${out}' '${src}'`,
    'tar.bz2': `tar -cjf '${out}' '${src}'`,
    zip: `zip -r '${out}' '${src}'`,
    'tar.xz': `tar -cJf '${out}' '${src}'`
  }
  const cmd = cmdMap[fmt]
  return (
    <div>
      <Input className='mg1b' placeholder='源路径' value={src} onChange={e => setSrc(e.target.value)} />
      <Input className='mg1b' placeholder='输出文件' value={out} onChange={e => setOut(e.target.value)} />
      <Radio.Group value={fmt} onChange={e => setFmt(e.target.value)} className='mg1b'>
        {Object.keys(cmdMap).map(k => <Radio.Button key={k} value={k}>{k}</Radio.Button>)}
      </Radio.Group>
      <Button
        type='primary'
        onClick={() => confirmRun('确认压缩', cmd, async () => {
          const rs = await runOnTabs(tabIds, cmd)
          window.store.addOpsAuditLog({ action: 'wizard-compress', detail: { cmd } })
          message.success(`完成 ${rs.filter(r => r.ok).length}/${rs.length}`)
        })}
      >
        预览并执行
      </Button>
    </div>
  )
}

function TrashWizard ({ tabIds }) {
  const [path, setPath] = useState('')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = path.split('/').pop() || 'file'
  const trash = `/tmp/trash/${stamp}_${base}`
  const cmd = `mkdir -p /tmp/trash && mv '${path.replace(/'/g, `'\\''`)}' '${trash}' && echo MOVED_TO:${trash}`
  return (
    <div>
      <p>安全删除：移动到 /tmp/trash/ 而非 rm</p>
      <Input className='mg1b' placeholder='要删除的路径' value={path} onChange={e => setPath(e.target.value)} />
      <Button
        danger
        type='primary'
        onClick={() => confirmRun('确认安全删除', cmd, async () => {
          const rs = await runOnTabs(tabIds, cmd)
          window.store.addOpsAuditLog({ action: 'wizard-trash', detail: { path, trash } })
          message.success(rs[0]?.out || 'done')
        })}
      >
        移到回收站
      </Button>
    </div>
  )
}

function PortWizard ({ tabIds }) {
  const [port, setPort] = useState('80')
  const [out, setOut] = useState('')
  const cmd = `ss -lntp | grep :${port} || netstat -lntp 2>/dev/null | grep :${port}`
  return (
    <div>
      <Space>
        <Input style={{ width: 100 }} value={port} onChange={e => setPort(e.target.value)} />
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
  const [unit, setUnit] = useState('nginx')
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
        <Input style={{ width: 160 }} value={unit} onChange={e => setUnit(e.target.value)} />
        {['start', 'stop', 'restart', 'status'].map(act => (
          <Button
            key={act}
            danger={act === 'stop' || act === 'restart'}
            onClick={() => {
              const cmd = `systemctl ${act} ${unit}`
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
  const [host, setHost] = useState('8.8.8.8')
  const [port, setPort] = useState('53')
  const [out, setOut] = useState('')
  async function diagnose () {
    const id = tabIds[0]
    if (!id) return message.warning('选机器')
    const steps = [
      `ping -c 3 ${host}`,
      `nc -zv ${host} ${port} 2>&1 || timeout 3 bash -c 'echo >/dev/tcp/${host}/${port}' 2>&1`,
      `traceroute -m 8 ${host} 2>/dev/null | head -12 || tracepath ${host} 2>/dev/null | head -12`,
      `nslookup ${host} 2>/dev/null || dig +short ${host} 2>/dev/null`
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
        <Input value={host} onChange={e => setHost(e.target.value)} placeholder='IP/域名' />
        <Input style={{ width: 80 }} value={port} onChange={e => setPort(e.target.value)} />
        <Button type='primary' onClick={diagnose}>一键诊断</Button>
      </Space>
      <pre className='ops-live-out'>{out}</pre>
    </div>
  )
}

function LinkWizard ({ tabIds }) {
  const [src, setSrc] = useState('')
  const [dst, setDst] = useState('')
  const cmd = `ln -s '${src.replace(/'/g, `'\\''`)}' '${dst.replace(/'/g, `'\\''`)}' && ls -la '${dst.replace(/'/g, `'\\''`)}'`
  return (
    <div>
      <Input className='mg1b' placeholder='源' value={src} onChange={e => setSrc(e.target.value)} />
      <Input className='mg1b' placeholder='链接路径' value={dst} onChange={e => setDst(e.target.value)} />
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
  const [user, setUser] = useState('')
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
        <Input style={{ width: 120 }} value={user} onChange={e => setUser(e.target.value)} placeholder='用户名' />
        <Button onClick={() => confirmRun('创建用户', `useradd -m ${user}`, async () => {
          const rs = await runOnTabs(tabIds, `useradd -m '${user.replace(/'/g, `'\\''`)}' && id '${user.replace(/'/g, `'\\''`)}'`)
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
  const [key, setKey] = useState('MY_VAR')
  const [val, setVal] = useState('1')
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
        <Input style={{ width: 120 }} value={key} onChange={e => setKey(e.target.value)} />
        <Input style={{ width: 120 }} value={val} onChange={e => setVal(e.target.value)} />
        <Button onClick={() => {
          const cmd = `echo 'export ${key}=${val}' >> ~/.bashrc && export ${key}=${val} && echo ${key}=$${key}`
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
  return (
    <div className='ops-panel'>
      <OpsTabSelect listProps={listProps} />
      <Tabs
        items={[
          { key: 'chmod', label: '权限 chmod', children: <ChmodWizard tabIds={selectedTabIds} /> },
          { key: 'compress', label: '压缩', children: <CompressWizard tabIds={selectedTabIds} /> },
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
