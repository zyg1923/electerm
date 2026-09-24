/**
 * Approval rules / requests panel
 */

import { useState } from 'react'
import {
  Button,
  Input,
  Table,
  Space,
  Switch,
  Tabs,
  message
} from 'antd'
import { ot } from './ops-i18n'
import uid from '../../common/uid'
import { auto } from 'manate/react'

export default auto(function ApprovalPanel () {
  const store = window.store
  const [ruleForm, setRuleForm] = useState({ name: '', pattern: '', severity: 'danger' })
  const [wlForm, setWlForm] = useState({ type: 'host', refId: '', reason: '' })

  const pending = (store.opsApprovalRequests || []).filter(r => r.status === 'pending')

  async function approve (id) {
    await store.decideApproval(id, 'approve')
    message.success(ot('approvalPassed'))
  }

  async function reject (id) {
    const comment = window.prompt(ot('rejectReason')) || ''
    await store.decideApproval(id, 'reject', comment)
    message.warning(ot('approvalRejected'))
  }

  async function addRule () {
    if (!ruleForm.name || !ruleForm.pattern) return
    const rules = [
      ...store.opsApprovalRules,
      {
        id: uid(),
        name: ruleForm.name,
        pattern: ruleForm.pattern,
        severity: ruleForm.severity || 'danger',
        requireApproval: true,
        enabled: true
      }
    ]
    await store.saveApprovalRules(rules)
    setRuleForm({ name: '', pattern: '', severity: 'danger' })
  }

  async function toggleRule (id, enabled) {
    const rules = store.opsApprovalRules.map(r =>
      r.id === id ? { ...r, enabled } : r
    )
    await store.saveApprovalRules(rules)
  }

  async function addWhitelist () {
    if (!wlForm.refId) return
    const list = [
      ...store.opsApprovalWhitelist,
      {
        id: uid(),
        type: wlForm.type,
        refId: wlForm.refId,
        reason: wlForm.reason,
        createdAt: Date.now(),
        createdBy: 'local'
      }
    ]
    await store.saveApprovalWhitelist(list)
    setWlForm({ type: 'host', refId: '', reason: '' })
  }

  const reqColumns = [
    { title: ot('command'), dataIndex: 'command', key: 'command', ellipsis: true },
    {
      title: ot('targetHosts'),
      key: 'targets',
      render: (_, r) => (r.targets || []).length
    },
    { title: ot('status'), dataIndex: 'status', key: 'status', width: 90 },
    {
      title: '',
      key: 'act',
      width: 160,
      render: (_, r) => r.status === 'pending'
        ? (
          <Space>
            <Button size='small' type='primary' onClick={() => approve(r.id)}>{ot('approve')}</Button>
            <Button size='small' danger onClick={() => reject(r.id)}>{ot('reject')}</Button>
          </Space>
          )
        : null
    }
  ]

  const ruleColumns = [
    { title: ot('name') || 'name', dataIndex: 'name', key: 'name' },
    { title: ot('pattern'), dataIndex: 'pattern', key: 'pattern', ellipsis: true },
    { title: ot('severity'), dataIndex: 'severity', key: 'severity', width: 90 },
    {
      title: ot('enabled'),
      key: 'en',
      width: 80,
      render: (_, r) => (
        <Switch
          size='small'
          checked={r.enabled !== false}
          onChange={v => toggleRule(r.id, v)}
        />
      )
    }
  ]

  return (
    <div className='ops-panel ops-approval'>
      <Tabs
        items={[
          {
            key: 'pending',
            label: `${ot('pendingApprovals')} (${pending.length})`,
            children: (
              <Table
                size='small'
                rowKey='id'
                pagination={false}
                columns={reqColumns}
                dataSource={store.opsApprovalRequests || []}
                locale={{ emptyText: ot('empty') }}
              />
            )
          },
          {
            key: 'rules',
            label: ot('rules'),
            children: (
              <div>
                <Space className='mg1b' wrap>
                  <Input
                    placeholder={ot('name') || 'name'}
                    value={ruleForm.name}
                    onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })}
                  />
                  <Input
                    style={{ width: 280 }}
                    placeholder={ot('pattern')}
                    value={ruleForm.pattern}
                    onChange={e => setRuleForm({ ...ruleForm, pattern: e.target.value })}
                  />
                  <Button type='primary' onClick={addRule}>{ot('addRule')}</Button>
                </Space>
                <Table
                  size='small'
                  rowKey='id'
                  pagination={false}
                  columns={ruleColumns}
                  dataSource={store.opsApprovalRules || []}
                />
              </div>
            )
          },
          {
            key: 'whitelist',
            label: ot('whitelist'),
            children: (
              <div>
                <Space className='mg1b' wrap>
                  <Input
                    placeholder='类型：主机 / 分组 / 命令模板 / 用户'
                    value={wlForm.type}
                    onChange={e => setWlForm({ ...wlForm, type: e.target.value })}
                    style={{ width: 200 }}
                  />
                  <Input
                    placeholder='对象编号'
                    value={wlForm.refId}
                    onChange={e => setWlForm({ ...wlForm, refId: e.target.value })}
                  />
                  <Input
                    placeholder={ot('reason')}
                    value={wlForm.reason}
                    onChange={e => setWlForm({ ...wlForm, reason: e.target.value })}
                  />
                  <Button type='primary' onClick={addWhitelist}>{ot('addWhitelist')}</Button>
                </Space>
                <Table
                  size='small'
                  rowKey='id'
                  pagination={false}
                  dataSource={store.opsApprovalWhitelist || []}
                  columns={[
                    { title: ot('type'), dataIndex: 'type', key: 'type' },
                    { title: ot('refId'), dataIndex: 'refId', key: 'refId' },
                    { title: ot('reason'), dataIndex: 'reason', key: 'reason' }
                  ]}
                  locale={{ emptyText: ot('empty') }}
                />
              </div>
            )
          }
        ]}
      />
    </div>
  )
})
