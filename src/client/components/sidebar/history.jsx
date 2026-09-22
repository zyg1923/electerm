/**
 * history select
 */

import React, { useState, useEffect } from 'react'
import { auto } from 'manate/react'
import { UnorderedListOutlined } from '@ant-design/icons'
import SwitchLabel from '../common/switch'
import HistoryItem from './history-item'
import { getItemJSON, setItemJSON } from '../../common/safe-local-storage.js'
import { historyIdentity, resolveHistoryTitle } from '../../common/unique-tab-title'
import '../setting-panel/list.styl'

const SORT_BY_FREQ_KEY = 'electerm-history-sort-by-frequency'

export default auto(function HistoryPanel (props) {
  const { store } = window
  const [sortByFrequency, setSortByFrequency] = useState(() => {
    return getItemJSON(SORT_BY_FREQ_KEY, false)
  })

  useEffect(() => {
    setItemJSON(SORT_BY_FREQ_KEY, sortByFrequency)
  }, [sortByFrequency])

  const {
    history
  } = store
  let arr = store.config.disableConnectionHistory ? [] : history
  if (arr.length) {
    const map = new Map()
    for (const item of arr) {
      const tab = item.tab
      if (!tab) {
        continue
      }
      const key = historyIdentity(tab)
      const titled = {
        ...item,
        tab: {
          ...tab,
          title: resolveHistoryTitle(tab) || tab.title
        }
      }
      const prev = map.get(key)
      if (!prev) {
        map.set(key, titled)
      } else {
        prev.count = (prev.count || 0) + (item.count || 0)
        if ((item.time || 0) > (prev.time || 0)) {
          prev.time = item.time
        }
      }
    }
    arr = [...map.values()]
  }
  if (sortByFrequency) {
    arr = [...arr].sort((a, b) => { return b.count - a.count })
  }

  const handleSortByFrequencyChange = (checked) => {
    setSortByFrequency(checked)
  }

  const handleClearHistory = () => {
    store.clearHistory()
  }
  const e = window.translate
  function renderHeader () {
    if (!arr.length) {
      return null
    }
    return (
      <div className='history-header pd2x pd2b'>
        <div className='history-sort'>
          <SwitchLabel
            checked={sortByFrequency}
            onChange={handleSortByFrequencyChange}
            size='small'
            label={e('sortByFrequency')}
          />
        </div>
        <UnorderedListOutlined
          {...clearIconProps}
        />
      </div>
    )
  }
  const clearIconProps = {
    className: 'history-clear-icon pointer clear-ai-icon icon-hover',
    title: window.translate('clear'),
    onClick: handleClearHistory
  }
  return (
    <div
      className='sidebar-panel-history'
    >
      {renderHeader()}
      <div className='history-body'>
        {
          arr.length
            ? arr.map((item) => {
              return (
                <HistoryItem
                  key={item.id}
                  item={item}
                />
              )
            })
            : (
              <div className='pd2x pd2y color-grey' style={{ opacity: 0.65 }}>
                {store.config.disableConnectionHistory
                  ? (e('disableConnectionHistory') === 'disableConnectionHistory'
                    ? '连接历史已在设置中关闭'
                    : e('disableConnectionHistory'))
                  : '暂无链接历史，连接后会显示在这里'}
              </div>
              )
        }
      </div>
    </div>
  )
})
