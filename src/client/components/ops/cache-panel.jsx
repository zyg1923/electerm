/**
 * Cache settings + global invalidate
 */

import { useState } from 'react'
import { Button, Form, Input, InputNumber, Switch, Space, message } from 'antd'
import { invalidateAll, cacheStats } from './ops-cache'

export default function CachePanel () {
  const store = window.store
  const [stats, setStats] = useState(() => cacheStats())

  return (
    <div className='ops-panel'>
      <Form layout='vertical' style={{ maxWidth: 420 }}>
        <Form.Item label='启用本地采集缓存'>
          <Switch
            checked={store.opsCacheEnabled !== false}
            onChange={v => { store.opsCacheEnabled = v }}
          />
        </Form.Item>
        <Form.Item label='机器状态 TTL (秒)'>
          <InputNumber
            min={5}
            value={(store.opsCacheTtl?.machineStatus || 30000) / 1000}
            onChange={v => {
              store.opsCacheTtl = { ...(store.opsCacheTtl || {}), machineStatus: (v || 30) * 1000 }
            }}
          />
        </Form.Item>
        <Form.Item label='Docker 列表 TTL (秒)'>
          <InputNumber
            min={5}
            value={(store.opsCacheTtl?.dockerPs || 15000) / 1000}
            onChange={v => {
              store.opsCacheTtl = { ...(store.opsCacheTtl || {}), dockerPs: (v || 15) * 1000 }
            }}
          />
        </Form.Item>
        <Form.Item label='审批 Webhook URL'>
          <Input
            placeholder='https://hooks.example.com/ops-approval'
            value={store.config?.opsApprovalWebhook || ''}
            onChange={e => store.updateConfig?.({ opsApprovalWebhook: e.target.value })}
          />
        </Form.Item>
        <Form.Item label='采集并发'>
          <InputNumber
            min={1}
            max={16}
            value={store.config?.opsCollectConcurrency || 3}
            onChange={v => store.updateConfig?.({ opsCollectConcurrency: v || 3 })}
          />
        </Form.Item>
      </Form>
      <Space>
        <Button
          danger
          onClick={() => {
            invalidateAll()
            setStats(cacheStats())
            message.success('已清空全部缓存')
          }}
        >
          全局清空缓存
        </Button>
        <Button onClick={() => setStats(cacheStats())}>刷新统计</Button>
        <span>条目数: {stats.size}</span>
      </Space>
      <p className='mg1t font12'>说明：未配置 Redis 时使用进程内内存缓存；多窗口不共享。远程 Redis 可后续接入同一接口。</p>
    </div>
  )
}
