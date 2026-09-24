/**
 * theme list render
 */

import List from '../setting-panel/list'
import { LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { pick } from 'lodash-es'
import { Pagination } from 'antd'
import ThemeListItem from './theme-list-item'
import { settingMap } from '../../common/constants'
import { defaultTheme } from '../../common/theme-defaults'
import getInitItem from '../../common/init-setting-item'
import './terminal-theme-list.styl'

const e = window.translate

export default class ThemeList extends List {
  handlePager = page => {
    this.setState({ page })
  }

  handlePageSizeChange = (page, pageSize) => {
    this.setState({ pageSize, page })
  }

  renderItem = (item, i) => {
    const itemProps = {
      item,
      renderDelBtn: this.renderDelBtn,
      activeItemId: this.props.activeItemId,
      ...pick(
        this.props,
        [
          'onClickItem',
          'theme',
          'keyword',
          'previewThemeId'
        ]
      )
    }
    return (
      <ThemeListItem key={item.id} {...itemProps} />
    )
  }

  renderPreviewHint () {
    const { previewThemeId, theme, list = [] } = this.props
    if (!previewThemeId || previewThemeId === theme) {
      return null
    }
    const item = list.find(d => d.id === previewThemeId)
    if (!item) {
      return null
    }
    const ui = item.uiThemeConfig || {}
    const term = item.themeConfig || {}
    const bar = ui.main || term.background || '#1e1e1e'
    const barText = ui.text || term.foreground || '#d4d4d4'
    const background = term.background || bar
    const foreground = term.foreground || barText
    return (
      <div className='pd2x pd1b'>
        <div
          style={{
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid rgba(128,128,128,.35)'
          }}
        >
          <div style={{ background: bar, color: barText, padding: '6px 10px' }}>
            {item.name}
          </div>
          <div style={{ background, color: foreground, padding: '8px 10px', fontFamily: 'monospace' }}>
            root@host:~# ls
          </div>
        </div>
        <div className='pd1t' style={{ color: 'var(--text-dark)' }}>
          当前是预览，点该主题上的「应用」后才会保存。关闭设置会恢复原来的主题。
        </div>
      </div>
    )
  }

  renderCurrentTheme () {
    const { theme, list } = this.props
    const item = list.find(d => d.id === theme)
    if (!item) {
      return null
    }
    const { name, id } = item
    const title = id === defaultTheme().id
      ? e(id)
      : name
    return (
      <div className='pd2'>
        <CheckCircleOutlined className='mg1r' />
        {title}
      </div>
    )
  }

  renderNewItem () {
    const newThemeItem = getInitItem([], settingMap.terminalThemes)
    const itemProps = {
      item: newThemeItem,
      renderDelBtn: this.renderDelBtn,
      activeItemId: this.props.activeItemId,
      ...pick(
        this.props,
        [
          'onClickItem',
          'theme',
          'keyword'
        ]
      )
    }
    return (
      <ThemeListItem key='new-theme' {...itemProps} />
    )
  }

  filter = list => {
    const { keyword } = this.state
    return keyword
      ? list.filter(item => {
        return item.name.toLowerCase().includes(keyword.toLowerCase())
      })
      : list
  }

  paged = list => {
    const { pageSize, ready, page } = this.state
    if (!ready) {
      return list
    }
    return list.slice((page - 1) * pageSize, pageSize * page)
  }

  render () {
    const { ready, page, pageSize } = this.state
    if (!ready) {
      return (
        <div className='pd3 aligncenter'>
          <LoadingOutlined />
        </div>
      )
    }
    let {
      list = [],
      type,
      listStyle = {}
    } = this.props
    list = this.filter(list)
    const all = list.length
    list = this.paged(this.filter(list))
    return (
      <div className={`item-list item-type-${type}`}>
        {this.renderTransport ? this.renderTransport() : null}
        {this.renderLabels ? this.renderLabels() : null}
        {this.renderSearch()}
        {this.renderCurrentTheme()}
        {this.renderPreviewHint()}
        <div className='item-list-wrap' style={listStyle}>
          {this.renderNewItem()}
          {
            list.map(this.renderItem)
          }
        </div>
        <Pagination
          onChange={this.handlePager}
          total={all}
          current={page}
          pageSize={pageSize}
          showLessItems
          simple
          onShowSizeChange={this.handlePageSizeChange}
        />
      </div>
    )
  }
}
