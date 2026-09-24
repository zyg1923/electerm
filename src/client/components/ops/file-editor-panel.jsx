/**
 * Visible entry for the GUI file editor (instead of raw vi/vim).
 */

import { useEffect, useState } from 'react'
import { Button, Space, message } from 'antd'
import { ot } from './ops-i18n'
import { OpsTabSelect, useOpsTabSelect } from './ops-tab-select'
import { openOpsFileEditor } from './ops-file-editor'
import PathField from './path-field'

export default function FileEditorPanel ({ request }) {
  const { selectedTabIds, setSelectedTabIds, listProps } = useOpsTabSelect()
  const [path, setPath] = useState('')

  useEffect(() => {
    if (!request?.token) {
      return
    }
    if (request.tabId) {
      setSelectedTabIds([request.tabId])
    }
    if (request.path) {
      setPath(request.path)
    }
    if (request.tabId && request.path) {
      openOpsFileEditor({ tabId: request.tabId, path: request.path })
    }
  }, [request?.token])

  function open () {
    const tabId = selectedTabIds[0]
    if (!tabId) {
      message.warning(ot('tabsRequired'))
      return
    }
    const filePath = path.trim()
    if (!filePath) {
      message.warning(ot('pathRequired'))
      return
    }
    openOpsFileEditor({ tabId, path: filePath })
  }

  return (
    <div className='ops-panel'>
      <p>
        不用在终端里操作 vi。选一台机器，填远程文件路径，然后打开编辑器。
        在已连接的终端里输入 <b>vi</b>、<b>vim</b> 或 <b>cat 文件路径</b> 后按回车，也会打开这个编辑器。
        如果仍想用系统自带的 vi 或 cat，在命令末尾加上 <b>--raw</b>。
      </p>
      <OpsTabSelect listProps={listProps} />
      <Space>
        <PathField
          style={{ width: 480 }}
          tabId={selectedTabIds[0]}
          value={path}
          placeholder='/etc/nginx/nginx.conf'
          onChange={setPath}
          onPressEnter={open}
        />
        <Button type='primary' onClick={open}>打开编辑器</Button>
      </Space>
    </div>
  )
}
