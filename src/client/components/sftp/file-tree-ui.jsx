/**
 * Expandable directory tree for sftp
 */

import { Component, createRef } from 'react'
import { Dropdown } from 'antd'
import classnames from 'classnames'
import FileSection from './file-item'
import { filesRef } from '../common/ref'
import findParent from '../../common/find-parent'
import { removeClass } from '../../common/class'
import { beginSlideSelect, blockSlideDrag, consumeSuppressClick } from './slide-select'
import resolve, { osResolve, normalizeWinLocalPath } from '../../common/resolve'
import { typeMap } from '../../common/constants'

const fileItemCls = 'sftp-item'
const onDragCls = 'sftp-ondrag'
const onDragOverCls = 'sftp-dragover'
const onMultiDragCls = 'sftp-dragover-multi'

export default class FileTreeTable extends Component {
  containerRef = createRef()

  onDragOver = e => {
    e.preventDefault()
  }

  onDragEnter = e => {
    let { target } = e
    target = findParent(target, '.' + fileItemCls)
    if (!target) {
      return e.preventDefault()
    }
    if (this.dropTarget && this.dropTarget !== target) {
      this.dropTarget.classList.remove(onDragOverCls)
    }
    this.dropTarget = target
    target.classList.add(onDragOverCls)
  }

  onDragLeave = e => {
    let { target } = e
    target = findParent(target, '.' + fileItemCls)
    if (!target) {
      return e.preventDefault()
    }
    if (
      this.containerRef.current &&
      !this.containerRef.current.contains(e.relatedTarget)
    ) {
      target.classList.remove(onDragOverCls)
    }
  }

  onDrop = e => {
    e.preventDefault()
    let { target } = e
    if (!target) {
      return
    }
    target = findParent(target, '.' + fileItemCls)
    if (target) {
      const id = target.getAttribute('data-id')
      const ref = filesRef.get('file-' + id)
      if (ref) {
        ref.onDrop(e)
        return
      }
    }
    const inst = this.findPanelFile()
    if (inst) {
      inst.onDrop(e, { intoCurrent: true })
    }
  }

  findPanelFile = () => {
    const tabId = this.props.tab?.id
    const type = this.props.type
    for (const inst of window.filesRef.values()) {
      if (inst?.props?.tab?.id === tabId && inst?.props?.file?.type === type) {
        return inst
      }
    }
    return null
  }

  onDragEnd = () => {
    document.querySelectorAll('.' + onDragOverCls).forEach((d) => {
      removeClass(d, onDragOverCls)
    })
    document.querySelectorAll('.' + onDragCls).forEach((d) => {
      removeClass(d, onDragCls, onMultiDragCls)
    })
  }

  setClickFileId = (id) => {
    this.currentFileId = id
  }

  getClickedFile = () => {
    return filesRef.get(this.currentFileId)
  }

  handleClick = (e) => {
    if (consumeSuppressClick(this)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.target.closest('.sftp-tree-toggle') || e.target.closest('.sftp-file-info-btn')) {
      return
    }
    const target = e.target.closest('[data-id]')
    if (target) {
      const id = target.getAttribute('data-id')
      const ref = filesRef.get('file-' + id)
      if (ref) {
        ref.onClick(e)
      }
    }
  }

  handleDoubleClick = (e) => {
    if (e.target.closest('.sftp-tree-toggle') || e.target.closest('.sftp-file-info-btn')) {
      return
    }
    const target = e.target.closest('[data-id]')
    if (target) {
      const id = target.getAttribute('data-id')
      const ref = filesRef.get('file-' + id)
      if (ref) {
        ref.transferOrEnterDirectory(e)
      }
    }
  }

  handleDropdownOpenChange = (open) => {
    if (open) {
      this.forceUpdate()
    }
  }

  onContextMenuCapture = (e) => {
    const target = e.target.closest('[data-id]')
    if (target) {
      this.setClickFileId('file-' + target.getAttribute('data-id'))
    }
  }

  onContextMenuFile = ({ key }) => {
    if (key === 'more-submenu' || key === 'new-submenu') {
      return
    }
    const inst = this.getClickedFile()
    if (inst && typeof inst[key] === 'function') {
      inst[key]()
    }
  }

  renderContextMenuFile = () => {
    const fileInst = this.getClickedFile()
    return fileInst ? fileInst.renderContextMenu() : []
  }

  joinPath = (parent, name) => {
    if (this.props.type === typeMap.local) {
      return osResolve(normalizeWinLocalPath(parent) || parent, name)
    }
    return resolve(parent, name)
  }

  renderItem = (item, level = 0) => {
    const { type } = this.props
    const cls = item.isParent ? 'parent-file-item' : 'real-file-item'
    const path = item.isDirectory && !item.isParent
      ? (item.fullPath || this.joinPath(item.path, item.name))
      : ''
    const treeExpanded = !!(
      (item.id && this.props.expandedMap[item.id]) ||
      (path && this.props.expandedMap[path])
    )
    const treeLoading = !!(
      (item.id && this.props.loadingMap[item.id]) ||
      (path && this.props.loadingMap[path])
    )
    const fileProps = {
      ...this.props.getFileProps(item, type),
      cls,
      layout: 'tree',
      treeLevel: level,
      treeExpanded,
      treeLoading,
      onToggleTree: this.props.onToggleTree,
      setClickFileId: this.setClickFileId
    }
    return (
      <FileSection
        {...fileProps}
        key={item.id}
      />
    )
  }

  renderBranch = (files, level) => {
    const { type } = this.props
    return files.map(item => {
      const path = item.isDirectory && !item.isParent
        ? (item.fullPath || this.joinPath(item.path, item.name))
        : ''
      const expanded = !!(
        (item.id && this.props.expandedMap[item.id]) ||
        (path && this.props.expandedMap[path])
      )
      const children = expanded
        ? this.props.getTreeChildren(type, path)
        : []
      return (
        <div
          className='sftp-tree-node'
          key={item.id}
        >
          {this.renderItem(item, level)}
          {
            expanded
              ? (
                <div className='sftp-tree-children'>
                  {this.renderBranch(children, level + 1)}
                </div>
                )
              : null
          }
        </div>
      )
    })
  }

  renderParent = () => {
    const { parentItem } = this.props
    return parentItem
      ? this.renderItem(parentItem, 0)
      : null
  }

  render () {
    const { fileList, height, type } = this.props
    const extra = this.props.sshSftpSplitView ? 118 : 194
    const containerHeight = Math.max(80, (height || 400) - extra)
    const props = {
      ref: this.containerRef,
      className: 'sftp-table-content sftp-tree-content overscroll-y relative',
      style: {
        height: containerHeight
      },
      draggable: false,
      onClick: this.handleClick,
      onDoubleClick: this.handleDoubleClick,
      onDragOver: this.onDragOver,
      onDragEnter: this.onDragEnter,
      onDragLeave: this.onDragLeave,
      onDrop: this.onDrop,
      onDragEnd: this.onDragEnd,
      onMouseDown: (event) => beginSlideSelect(this, event),
      onDragStartCapture: (event) => blockSlideDrag(this, event)
    }
    const ddProps = {
      menu: {
        items: this.renderContextMenuFile(),
        onClick: this.onContextMenuFile
      },
      trigger: ['contextMenu'],
      onOpenChange: this.handleDropdownOpenChange
    }
    return (
      <div className={classnames('sftp-table sftp-tree relative')}>
        <Dropdown {...ddProps}>
          <div
            {...props}
            onContextMenu={this.onContextMenuCapture}
          >
            {
              this.props.renderEmptyFile(
                type,
                {
                  setClickFileId: this.setClickFileId
                }
              )
            }
            {this.renderParent()}
            {this.renderBranch(fileList, 0)}
          </div>
        </Dropdown>
      </div>
    )
  }
}
