import { Button } from 'antd'
import { DesktopOutlined, PlusOutlined, RobotOutlined, ToolOutlined } from '@ant-design/icons'
import LogoElem from '../common/logo-elem.jsx'
import HistoryPanel from '../sidebar/history'
import QuickConnect from './quick-connect'
import { isAIDisabled } from '../../common/ai-feature'
import './no-session.styl'

const e = window.translate

export default function NoSessionPanel ({ height, onNewTab, onNewSsh, batch }) {
  const props = {
    style: {
      height: height + 'px'
    }
  }
  const handleClick = () => {
    window.openTabBatch = batch
  }

  const handleCreateAIBookmark = () => {
    window.store.onNewSshAI()
  }

  // Local terminal only — never opens remote/SFTP
  const newTabDom = window.store.hasNodePty
    ? (
      <Button
        onClick={onNewTab}
        className='add-new-tab-btn'
        icon={<DesktopOutlined />}
        title='打开新链接'
      >
        打开新链接
      </Button>
      )
    : null
  return (
    <div className='no-sessions electerm-logo-bg' {...props}>
      <div className='no-session-btns'>
        {newTabDom}
        <Button
          onClick={onNewSsh}
          icon={<PlusOutlined />}
          title='新增链接'
        >
          新增链接
        </Button>
        <Button
          icon={<ToolOutlined />}
          title='运维中心'
          onClick={() => window.store.openOpsCenter()}
        >
          运维中心
        </Button>
        {!isAIDisabled() && (
          <Button
            onClick={handleCreateAIBookmark}
            icon={<RobotOutlined />}
          >
            {e('createBookmarkByAI') === 'createBookmarkByAI'
              ? 'AI 智能创建书签'
              : e('createBookmarkByAI')}
          </Button>
        )}
        <QuickConnect batch={batch} />
      </div>
      <div className='no-session-logo'>
        <LogoElem />
      </div>
      <div className='no-session-history' onClick={handleClick}>
        <div className='no-session-history-title'>
          {e('history') === 'history' ? '链接历史' : e('history')}
        </div>
        <HistoryPanel sort />
      </div>
    </div>
  )
}
