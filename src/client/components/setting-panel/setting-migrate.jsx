/**
 * Local data migrate: export / import connections, history, settings.
 */

import { Button, Descriptions } from 'antd'
import {
  ImportOutlined,
  ExportOutlined
} from '@ant-design/icons'
import { auto } from 'manate/react'
import Upload from '../common/upload'

const e = window.translate

const migrateLabels = {
  bookmarks: '连接 / 书签',
  bookmarkGroups: '连接分类',
  profiles: '认证资料',
  addressBookmarks: '地址书签',
  addressBookmarksLocal: '本地地址书签',
  history: '链接历史',
  terminalCommandHistory: '命令历史',
  aiChatHistory: 'AI 对话历史',
  transferHistory: '传输历史',
  fileTransfers: '传输队列',
  quickCommands: '快捷命令',
  terminalThemes: '终端 / UI 主题',
  workspaces: '工作区',
  triggers: '触发器',
  autoRunWidgets: '自动运行组件',
  opsTasks: '运维任务',
  opsAuditLogs: '运维审计日志',
  opsApprovalRequests: '运维审批请求',
  opsApprovalRules: '运维审批规则',
  opsApprovalWhitelist: '运维审批白名单',
  opsCommandTemplates: '运维命令模板',
  opsWizardState: '小白向导表单',
  opsPlaybooks: '编排剧本',
  opsQuickActions: '运维快捷操作',
  opsDiaryEntries: '运维日志',
  batchInputs: '批量输入历史',
  sftpSortSetting: 'SFTP 排序设置',
  expandedKeys: '侧栏展开节点',
  checkedKeys: '侧栏勾选节点',
  resolutions: '自定义分辨率'
}

export default auto(function SettingMigrate () {
  const { store } = window
  const names = typeof store.getMigrateNames === 'function'
    ? store.getMigrateNames()
    : []

  return (
    <div className='pd2 setting-migrate'>
      <div className='pd1b'>
        导出一份 JSON，包含全部应用设置、主题、连接、各类历史与传输记录。换电脑或重装后导入即可恢复。导入会覆盖当前同类数据。
      </div>
      <div className='pd1y'>
        <Button
          type='primary'
          icon={<ExportOutlined />}
          className='mg1r'
          onClick={store.handleExportAllData}
        >
          {e('export') === 'export' ? '导出全部数据' : e('export')}
        </Button>
        <Upload
          beforeUpload={store.importAll}
          fileList={[]}
          className='inline'
        >
          <Button icon={<ImportOutlined />}>
            {e('importFromFile') === 'importFromFile' ? '从文件导入' : e('importFromFile')}
          </Button>
        </Upload>
      </div>
      <Descriptions
        className='mg2t'
        size='small'
        column={1}
        title='当前将导出的内容'
      >
        <Descriptions.Item label='应用设置（含主题选择、字体等）'>
          全部
        </Descriptions.Item>
        {names.map((n) => {
          const v = store[n]
          const label = migrateLabels[n] || n
          let count = 0
          if (Array.isArray(v)) {
            count = v.length
          } else if (v != null && typeof v === 'object') {
            count = Object.keys(v).length
          }
          return (
            <Descriptions.Item key={n} label={label}>
              {count}
            </Descriptions.Item>
          )
        })}
      </Descriptions>
    </div>
  )
})
