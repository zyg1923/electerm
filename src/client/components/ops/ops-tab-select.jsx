/**
 * Shared tab multi-select for Ops panels
 */

import { useState } from 'react'
import { TabSelectList } from '../footer/tab-select'
import {
  terminalWebType,
  terminalRdpType,
  terminalVncType
} from '../../common/constants'
import { ot } from './ops-i18n'

function filterOpsTabs (tabs = []) {
  return tabs.filter(tab => {
    return tab.type !== terminalWebType &&
      tab.type !== terminalRdpType &&
      tab.type !== terminalVncType &&
      tab.type !== 'spice'
  })
}

function isSshTab (tab) {
  return !!(tab.host || tab.authType || tab.type === 'ssh')
}

export function useOpsTabSelect (initial) {
  const tabs = filterOpsTabs(window.store.tabs || [])
  const sshIds = tabs.filter(isSshTab).map(t => t.id)
  const fallback = sshIds.length ? sshIds : tabs.map(t => t.id)
  const [selectedTabIds, setSelectedTabIds] = useState(
    Array.isArray(initial) && initial.length ? initial : fallback
  )

  const listProps = {
    tabs,
    activeTabId: window.store.activeTabId,
    selectedTabIds,
    onSelect: (id) => {
      setSelectedTabIds(prev => {
        if (prev.includes(id)) return prev.filter(x => x !== id)
        return [...prev, id]
      })
    },
    onSelectAll: () => setSelectedTabIds(tabs.map(t => t.id)),
    onSelectNone: () => setSelectedTabIds([])
  }

  return { tabs, selectedTabIds, setSelectedTabIds, listProps }
}

export function OpsTabSelect (props) {
  const { listProps } = props
  return (
    <div className='ops-tab-select mg1b'>
      <div className='pd1b'>{ot('selectTabs')}</div>
      <TabSelectList {...listProps} />
    </div>
  )
}
