/**
 * settings page
 */

import { Component } from 'react'
import Drawer from '../common/drawer'
import { CloseCircleOutlined } from '@ant-design/icons'
import AppDrag from '../tabs/app-drag'
import './setting-wrap.styl'

export default class SettingWrap extends Component {
  componentDidMount () {
    this.bindEsc()
  }

  componentDidUpdate (prevProps) {
    if (prevProps.visible !== this.props.visible) {
      this.bindEsc()
    }
  }

  componentWillUnmount () {
    this.unbindEsc()
  }

  bindEsc = () => {
    this.unbindEsc()
    if (this.props.visible) {
      document.addEventListener('keydown', this.onKeyDown)
    }
  }

  unbindEsc = () => {
    document.removeEventListener('keydown', this.onKeyDown)
  }

  onKeyDown = (e) => {
    if (e.key !== 'Escape') {
      return
    }
    if (document.querySelector('.ant-modal-root .ant-modal-wrap, .ant-select-dropdown:not(.ant-select-dropdown-hidden)')) {
      return
    }
    e.preventDefault()
    this.props.onCancel()
  }

  renderDrag () {
    return (
      <AppDrag />
    )
  }

  renderRightClose () {
    return (
      <CloseCircleOutlined
        className='close-setting-wrap-icon close-setting-wrap'
        onClick={this.props.onCancel}
      />
    )
  }

  render () {
    const pops = {
      open: this.props.visible,
      onClose: this.props.onCancel,
      className: 'setting-wrap',
      size: this.props.innerWidth - window.store.leftSideBarWidth,
      zIndex: 888,
      placement: 'left'
    }
    return (
      <Drawer
        {...pops}
      >
        {this.renderRightClose()}
        <CloseCircleOutlined
          className='close-setting-wrap alt-close-setting-wrap'
          onClick={this.props.onCancel}
        />
        {
          this.props.useSystemTitleBar ? null : <AppDrag />
        }
        {this.props.children}
      </Drawer>
    )
  }
}
