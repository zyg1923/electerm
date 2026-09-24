import React, { useRef, useEffect, useState } from 'react'
import {
  ArrowUpOutlined,
  EyeInvisibleFilled,
  EyeFilled,
  ReloadOutlined,
  ArrowRightOutlined,
  LoadingOutlined,
  HomeOutlined,
  PlusOutlined,
  MenuOutlined,
  FolderOpenOutlined
} from '@ant-design/icons'
import {
  Input,
  Tooltip,
  Popover
} from 'antd'
import {
  typeMap,
  isWin
} from '../../common/constants'
import classnames from 'classnames'
import AddrBookmark from './address-bookmark'
import KeywordFilter from './keyword-filter'
import { chooseSaveDirectory } from '../../common/choose-save-folder'

const e = window.translate

function splitPathCrumbs (fullPath, type) {
  if (!fullPath) {
    return []
  }
  const isRemote = type === typeMap.remote
  if (isRemote || fullPath.startsWith('/')) {
    // Root crumb uses empty label so the following "/" separator
    // renders "/root" instead of "//root".
    if (fullPath === '/') {
      return [{ label: '/', path: '/' }]
    }
    const crumbs = [{ label: '', path: '/' }]
    const parts = fullPath.split('/').filter(Boolean)
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      crumbs.push({ label: part, path: acc })
    }
    return crumbs
  }
  const sep = window.pre?.sep || '\\'
  const normalized = String(fullPath).replace(/\//g, sep)
  if (/^[a-zA-Z]:\\/.test(normalized) || (isWin && /^[a-zA-Z]:/.test(normalized))) {
    const drive = normalized.slice(0, 2)
    const root = drive + sep
    const crumbs = [{ label: drive, path: root }]
    const rest = normalized.slice(drive.length).split(/[\\/]/).filter(Boolean)
    let acc = drive
    for (const part of rest) {
      acc += sep + part
      crumbs.push({ label: part, path: acc })
    }
    return crumbs
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  const crumbs = []
  let acc = ''
  for (const part of parts) {
    acc = acc ? acc + sep + part : part
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}

function AddressPrefixIcons (props) {
  const {
    type,
    host,
    realPath
  } = props
  const isShow = props[`${type}ShowHiddenFile`]
  const title = `${isShow ? e('hide') : e('show')} ${e('hfd')}`
  const Icon = isShow ? EyeFilled : EyeInvisibleFilled
  const keywordProps = {
    keyword: props[`${type}Keyword`],
    type,
    updateKeyword: props.updateKeyword
  }
  return (
    <>
      <Tooltip
        title={title}
        placement='topLeft'
        arrow={{ pointAtCenter: true }}
      >
        <Icon
          type='eye'
          className='mg1r'
          onClick={() => props.toggleShowHiddenFile(type)}
        />
      </Tooltip>
      <Tooltip
        title={e('goParent')}
        arrow={{ pointAtCenter: true }}
        placement='topLeft'
      >
        <ArrowUpOutlined
          onClick={() => props.goParent(type)}
          className='mg1r'
        />
      </Tooltip>
      <HomeOutlined
        onClick={() => props.gotoHome(type)}
        className='mg1r'
      />
      <KeywordFilter {...keywordProps} />
      <AddrBookmark
        store={window.store}
        realPath={realPath}
        host={host}
        type={type}
        className='mg1r'
        onClickHistory={props.onClickHistory}
      />
    </>
  )
}

function MobileAddressPrefix (props) {
  const [open, setOpen] = useState(false)
  const content = (
    <div className='sftp-addr-menu-content'>
      <AddressPrefixIcons {...props} />
    </div>
  )
  return (
    <Popover
      content={content}
      trigger='click'
      placement='bottomLeft'
      open={open}
      onOpenChange={setOpen}
    >
      <MenuOutlined className='sftp-addr-menu-icon' />
    </Popover>
  )
}

function renderAddonBefore (props, realPath) {
  if (window.store.isMobile) {
    return (
      <MobileAddressPrefix {...props} realPath={realPath} />
    )
  }
  return (
    <AddressPrefixIcons {...props} realPath={realPath} />
  )
}

function renderAddonAfter (isLoadingRemote, onGoto, GoIcon, type, handleUploadFromBrowser, onChooseLocal) {
  const handleClick = (e) => {
    e.stopPropagation()
    if (!isLoadingRemote) {
      onGoto(type)
    }
  }
  return (
    <>
      {
        type === typeMap.local && onChooseLocal
          ? (
            <FolderOpenOutlined
              className='mg1r pointer'
              title={e('chooseFolder')}
              onMouseDown={ev => ev.preventDefault()}
              onClick={(ev) => {
                ev.stopPropagation()
                onChooseLocal()
              }}
            />
            )
          : null
      }
      {
        type === typeMap.local && window.et.isWebApp
          ? (
            <PlusOutlined
              className='mg1r'
              title={e('uploadFromBrowser')}
              onClick={(e) => {
                e.stopPropagation()
                handleUploadFromBrowser()
              }}
            />
            )
          : null
      }
      <GoIcon
        onClick={handleClick}
      />
    </>
  )
}

function renderHistory (props, type, setEditing) {
  const currentPath = props[type + 'Path']
  const options = props[type + 'PathHistory']
    .filter(o => o !== currentPath)
  const focused = props[type + 'InputFocus']
  if (!options.length) {
    return null
  }
  const cls = classnames(
    'sftp-history',
    `sftp-history-${type}`,
    { focused }
  )
  return (
    <div
      className={cls}
    >
      {
        options.map(o => {
          return (
            <div
              key={o}
              className='sftp-history-item'
              onClick={() => {
                props.onClickHistory(type, o)
                setEditing(false)
                props.onInputBlur(type)
              }}
            >
              {o}
            </div>
          )
        })
      }
    </div>
  )
}

export default function AddressBar (props) {
  const {
    loadingSftp,
    type,
    onGoto
  } = props
  const n = `${type}PathTemp`
  const path = props[n]
  const realPath = props[`${type}Path`]
  const isLoadingRemote = type === typeMap.remote && loadingSftp
  const GoIcon = isLoadingRemote
    ? LoadingOutlined
    : (realPath === path ? ReloadOutlined : ArrowRightOutlined)
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const crumbs = splitPathCrumbs(realPath, type)

  useEffect(() => {
    const wrapEl = inputRef.current
    if (!wrapEl) return
    const inputEl = wrapEl.querySelector('input')
    if (!inputEl) return
    const handler = () => props.onInputFocus(type)
    inputEl.addEventListener('click', handler)
    return () => {
      inputEl.removeEventListener('click', handler)
    }
  }, [type, editing])

  const finishEdit = () => {
    setEditing(false)
    props.onInputBlur(type, true)
  }

  const chooseLocalPath = async () => {
    if (type !== typeMap.local) {
      return
    }
    const selected = await chooseSaveDirectory({
      title: e('chooseFolder'),
      message: e('chooseFolder'),
      defaultPath: realPath || path || undefined
    })
    if (!selected) {
      return
    }
    props.onClickHistory(type, selected)
    setEditing(false)
    props.onInputBlur(type, true)
  }

  const goCrumb = (crumbPath, e) => {
    e.preventDefault()
    e.stopPropagation()
    if (crumbPath !== realPath) {
      props.onClickHistory(type, crumbPath)
    }
  }

  return (
    <div className='pd1y sftp-title-wrap'>
      <div className='sftp-title' ref={inputRef}>
        {
          editing
            ? (
              <Input
                autoFocus
                value={path}
                onChange={ev => props.onChange(ev, n)}
                onPressEnter={ev => {
                  onGoto(type, ev)
                  finishEdit()
                }}
                prefix={renderAddonBefore(props, realPath)}
                onBlur={finishEdit}
                disabled={loadingSftp}
                suffix={
                  renderAddonAfter(isLoadingRemote, onGoto, GoIcon, type, props.handleUploadFromBrowser, chooseLocalPath)
                }
              />
              )
            : (
              <div className='sftp-path-bar'>
                <span className='sftp-path-prefix'>
                  {renderAddonBefore(props, realPath)}
                </span>
                <div
                  className='sftp-path-crumbs'
                  onClick={() => {
                    props.onChange({ target: { value: realPath } }, n)
                    props.onInputFocus(type)
                    setEditing(true)
                  }}
                >
                  {
                    crumbs.map((crumb, i) => (
                      <span key={crumb.path + i} className='sftp-path-crumb-wrap'>
                        {
                          i > 0
                            ? <span className='sftp-path-sep'>/</span>
                            : null
                        }
                        <span
                          className='sftp-path-crumb'
                          onClick={ev => goCrumb(crumb.path, ev)}
                        >
                          {crumb.label}
                        </span>
                      </span>
                    ))
                  }
                </div>
                <span className='sftp-path-suffix'>
                  {renderAddonAfter(isLoadingRemote, onGoto, GoIcon, type, props.handleUploadFromBrowser, chooseLocalPath)}
                </span>
              </div>
              )
        }
        {renderHistory(props, type, setEditing)}
      </div>
    </div>
  )
}
