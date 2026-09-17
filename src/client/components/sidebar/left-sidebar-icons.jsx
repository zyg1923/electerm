/**
 * renders the customizable far-left sidebar icons.
 *
 * which icons appear, and in what order, is driven by `iconIds`
 * (from config.leftSideBarIcons). The "about" and "hide sidebar"
 * icons are not customizable — they are rendered directly by the parent
 * (sidebar/index.jsx). Live transfers stay in TransferList.
 */

import { useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  CloudSyncOutlined,
  HistoryOutlined,
  PictureOutlined,
  PlusCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { Badge, Popover } from 'antd'
import SideIcon from './side-icon'
import QuickConnect from '../tabs/quick-connect'
import TransportHistory from './transfer-history-modal'
import FloatWindow from '../common/float-window'
import { settingMap } from '../../common/constants'
import { defaultLeftSideBarIcons } from '../../common/left-sidebar-icon-defs'

const e = window.translate

export default function LeftSidebarIcons (props) {
  const {
    iconIds,
    handleClickBookmark,
    onNewSsh,
    openSetting,
    openSettingSync,
    openTerminalThemes,
    openWidgetsModal,
    bookmarksActive,
    themeActive,
    settingActive,
    syncActive,
    widgetsActive,
    isSyncingSetting,
    widgetInstancesLength,
    transferHistory
  } = props
  const [historyOpen, setHistoryOpen] = useState(false)

  const ids = Array.isArray(iconIds) && iconIds.length
    ? iconIds
    : defaultLeftSideBarIcons

  const registry = {
    newBookmark: (
      <SideIcon
        key='newBookmark'
        title={e('newBookmark')}
      >
        <PlusCircleOutlined
          className='font22 iblock control-icon'
          onClick={onNewSsh}
        />
      </SideIcon>
    ),
    quickConnect: (
      <Popover
        key='quickConnect'
        content={<QuickConnect inputOnly />}
        trigger='click'
        placement='right'
      >
        <div
          className='control-icon-wrap'
          title={e('quickConnect')}
        >
          <ThunderboltOutlined className='font20 iblock control-icon' />
        </div>
      </Popover>
    ),
    bookmarks: (
      <SideIcon
        key='bookmarks'
        title={e(settingMap.bookmarks)}
        active={bookmarksActive}
      >
        <CloudServerOutlined
          onClick={handleClickBookmark}
          className='font20 iblock control-icon bookmark-sidebar-toggle'
        />
      </SideIcon>
    ),
    transferHistory: (
      <SideIcon
        key='transferHistory'
        title={e('transferHistory')}
      >
        <HistoryOutlined
          className='font20 iblock control-icon'
          onClick={() => setHistoryOpen(true)}
        />
      </SideIcon>
    ),
    terminalThemes: (
      <SideIcon
        key='terminalThemes'
        title={e(settingMap.terminalThemes)}
        active={themeActive}
      >
        <PictureOutlined
          className='font20 iblock pointer control-icon'
          onClick={openTerminalThemes}
        />
      </SideIcon>
    ),
    setting: (
      <SideIcon
        key='setting'
        title={e(settingMap.setting)}
        active={settingActive}
      >
        <SettingOutlined
          className='iblock font20 control-icon'
          onClick={openSetting}
        />
      </SideIcon>
    ),
    settingSync: (
      <SideIcon
        key='settingSync'
        title={e('settingSync')}
        active={syncActive}
      >
        <CloudSyncOutlined
          className='iblock font20 control-icon'
          onClick={openSettingSync}
          spin={isSyncingSetting}
        />
      </SideIcon>
    ),
    widgets: (
      <SideIcon
        key='widgets'
        title={e('widgets')}
        active={widgetsActive}
      >
        <Badge
          count={widgetInstancesLength}
          size='small'
          offset={[0, 0]}
          color='green'
          overflowCount={99}
        >
          <AppstoreOutlined
            className='iblock font20 control-icon'
            onClick={openWidgetsModal}
          />
        </Badge>
      </SideIcon>
    )
  }

  return (
    <>
      {ids.map(id => registry[id] || null)}
      {
        ids.includes('transferHistory')
          ? (
            <FloatWindow
              open={historyOpen}
              title={e('transferHistory')}
              width={Math.min(980, Math.round(window.innerWidth * 0.8))}
              height={Math.min(560, Math.round(window.innerHeight * 0.7))}
              onClose={() => setHistoryOpen(false)}
            >
              <TransportHistory
                transferHistory={transferHistory || []}
              />
            </FloatWindow>
            )
          : null
      }
    </>
  )
}
