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

export default auto(function SettingMigrate () {
  const { store } = window
  const {
    bookmarks = [],
    bookmarkGroups = [],
    history = [],
    profiles = [],
    terminalCommandHistory = [],
    transferHistory = [],
    quickCommands = [],
    terminalThemes = [],
    workspaces = []
  } = store

  return (
    <div className='pd2 setting-migrate'>
      <div className='pd1b'>
        导出一份 JSON，换电脑或重装后导入即可恢复连接、历史和配置。导入会覆盖当前同类数据。
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
        <Descriptions.Item label='连接 / 书签'>{bookmarks.length}</Descriptions.Item>
        <Descriptions.Item label='连接分类'>{bookmarkGroups.length}</Descriptions.Item>
        <Descriptions.Item label='认证资料'>{profiles.length}</Descriptions.Item>
        <Descriptions.Item label='链接历史'>{history.length}</Descriptions.Item>
        <Descriptions.Item label='命令历史'>{terminalCommandHistory.length}</Descriptions.Item>
        <Descriptions.Item label='传输历史'>{transferHistory.length}</Descriptions.Item>
        <Descriptions.Item label='快捷命令'>{quickCommands.length}</Descriptions.Item>
        <Descriptions.Item label='终端主题'>{terminalThemes.length}</Descriptions.Item>
        <Descriptions.Item label='工作区'>{workspaces.length}</Descriptions.Item>
      </Descriptions>
    </div>
  )
})
