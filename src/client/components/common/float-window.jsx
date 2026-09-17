import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CloseOutlined,
  MinusOutlined
} from '@ant-design/icons'
import classnames from 'classnames'
import './float-window.styl'

const e = window.translate

export default function FloatWindow (props) {
  const {
    open,
    title,
    onClose,
    children,
    width = 880,
    height = 520,
    zIndex = 1200
  } = props
  const [minimized, setMinimized] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [pos, setPos] = useState(null)
  const dragRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }
    setMinimized(false)
    setMaximized(false)
    setPos(null)
    const onKey = (ev) => {
      if (ev.key !== 'Escape') {
        return
      }
      if (ev.target?.closest?.('input, textarea, [contenteditable="true"]')) {
        return
      }
      ev.preventDefault()
      ev.stopPropagation()
      onClose && onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  useEffect(() => {
    const onMove = (ev) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      const left = ev.clientX - drag.ox
      const top = ev.clientY - drag.oy
      const maxLeft = window.innerWidth - 160
      const maxTop = window.innerHeight - 40
      setPos({
        left: Math.max(0, Math.min(left, maxLeft)),
        top: Math.max(0, Math.min(top, maxTop))
      })
    }
    const onUp = () => {
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!open) {
    return null
  }

  const startDrag = (ev) => {
    if (ev.button !== 0) {
      return
    }
    if (ev.target.closest('.float-window-btn')) {
      return
    }
    if (maximized) {
      setMaximized(false)
    }
    const box = boxRef.current
    const rect = box.getBoundingClientRect()
    dragRef.current = {
      ox: ev.clientX - rect.left,
      oy: ev.clientY - rect.top
    }
    setPos({
      left: rect.left,
      top: rect.top
    })
    ev.preventDefault()
  }

  const style = {
    zIndex,
    width: maximized ? '100vw' : (minimized ? 320 : width),
    height: maximized ? '100vh' : (minimized ? 40 : height)
  }
  if (maximized) {
    style.left = 0
    style.top = 0
  } else if (pos) {
    style.left = pos.left
    style.top = pos.top
  }

  const cls = classnames('float-window', {
    'is-min': minimized,
    'is-max': maximized,
    'is-centered': !pos && !maximized
  })

  return createPortal(
    <div
      ref={boxRef}
      className={cls}
      style={style}
    >
      <div
        className='float-window-header'
        onMouseDown={startDrag}
      >
        <div className='float-window-title' title={title}>{title}</div>
        <div className='float-window-actions'>
          <button
            type='button'
            className='float-window-btn'
            title={e('minimize')}
            onClick={() => {
              setMaximized(false)
              setMinimized(v => !v)
            }}
          >
            <MinusOutlined />
          </button>
          <button
            type='button'
            className='float-window-btn'
            title={maximized ? e('unmaximize') : e('maximize')}
            onClick={() => {
              setMinimized(false)
              setMaximized(v => !v)
            }}
          >
            <span className={'float-window-max-icon' + (maximized ? ' is-max' : '')} />
          </button>
          <button
            type='button'
            className='float-window-btn is-close'
            title={e('close')}
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </div>
      </div>
      {
        minimized
          ? null
          : (
            <div className='float-window-body'>
              {children}
            </div>
            )
      }
    </div>,
    document.body
  )
}
