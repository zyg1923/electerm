function fileListOf (host) {
  return (host.props.fileList || []).filter(file => file && !file.isParent && file.id)
}

function selectBetween (host, startId, endId) {
  const list = fileListOf(host)
  const a = list.findIndex(file => file.id === startId)
  const b = list.findIndex(file => file.id === endId)
  if (a < 0 || b < 0) {
    return
  }
  const [from, to] = a < b ? [a, b] : [b, a]
  const ids = list.slice(from, to + 1).map(file => file.id)
  host.props.modifier?.({
    selectedFiles: new Set(ids),
    selectedType: host.props.type,
    lastClickedFile: list.find(file => file.id === endId) || null
  })
}

function fileIdAtPoint (host, clientX, clientY) {
  const root = host.containerRef?.current
  if (!root) {
    return null
  }
  const type = host.props.type
  const el = document.elementFromPoint(clientX, clientY)
  const hit = el && el.closest ? el.closest('.sftp-item.real-file-item') : null
  if (hit && hit.getAttribute('data-type') === type) {
    return hit.getAttribute('data-id')
  }

  // Virtual list: pointer may sit on a spacer — estimate from visible rows.
  const list = fileListOf(host)
  if (!list.length) {
    return null
  }
  const items = [...root.querySelectorAll('.sftp-item.real-file-item')]
    .filter(node => node.getAttribute('data-type') === type)
  if (!items.length) {
    return null
  }
  const first = items[0].getBoundingClientRect()
  const last = items[items.length - 1].getBoundingClientRect()
  const rowH = Math.max(24, first.height || 36)
  if (clientY < first.top) {
    const firstId = items[0].getAttribute('data-id')
    const idx = list.findIndex(file => file.id === firstId)
    if (idx < 0) {
      return null
    }
    const steps = Math.ceil((first.top - clientY) / rowH)
    return list[Math.max(0, idx - steps)].id
  }
  if (clientY > last.bottom) {
    const lastId = items[items.length - 1].getAttribute('data-id')
    const idx = list.findIndex(file => file.id === lastId)
    if (idx < 0) {
      return null
    }
    const steps = Math.ceil((clientY - last.bottom) / rowH)
    return list[Math.min(list.length - 1, idx + steps)].id
  }
  return null
}

function autoScrollWhileSelect (host, clientY) {
  const root = host.containerRef?.current
  if (!root) {
    return
  }
  const rect = root.getBoundingClientRect()
  const edge = 28
  if (clientY < rect.top + edge) {
    root.scrollTop -= 18
  } else if (clientY > rect.bottom - edge) {
    root.scrollTop += 18
  }
}

export function beginSlideSelect (host, event) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return
  }
  if (event.target.closest('.sftp-file-info-btn, .sftp-tree-toggle')) {
    return
  }
  const row = event.target.closest('.sftp-item.real-file-item')
  if (!row) {
    return
  }
  const startId = row.getAttribute('data-id')
  if (!startId) {
    return
  }
  const slide = {
    startX: event.clientX,
    startY: event.clientY,
    dx: 0,
    dy: 0,
    mode: 'pending',
    startId,
    type: host.props.type
  }
  host._slide = slide
  const move = (ev) => {
    if (host._slide !== slide) {
      return
    }
    slide.dx = ev.clientX - slide.startX
    slide.dy = ev.clientY - slide.startY
    if (slide.mode === 'pending' && (Math.abs(slide.dx) > 3 || Math.abs(slide.dy) > 3)) {
      // Bias toward range-select; only clear horizontal swipes become file-drag.
      const horizontalDrag = Math.abs(slide.dx) > Math.abs(slide.dy) + 10 && Math.abs(slide.dx) > 14
      slide.mode = horizontalDrag ? 'drag' : 'select'
      if (slide.mode === 'select') {
        host._suppressClick = true
      }
    }
    if (slide.mode !== 'select') {
      return
    }
    autoScrollWhileSelect(host, ev.clientY)
    const id = fileIdAtPoint(host, ev.clientX, ev.clientY)
    if (!id) {
      return
    }
    selectBetween(host, slide.startId, id)
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    if (host._slide === slide) {
      host._slide = null
    }
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

export function blockSlideDrag (host, event) {
  const slide = host._slide
  if (!slide || slide.mode === 'drag') {
    return
  }
  // Cancel HTML5 drag so mousemove keeps driving range select (fixes virtual list).
  const horizontalDrag = Math.abs(slide.dx) > Math.abs(slide.dy) + 10 && Math.abs(slide.dx) > 14
  if (slide.mode === 'select' || !horizontalDrag) {
    event.preventDefault()
    event.stopPropagation()
    slide.mode = 'select'
    host._suppressClick = true
  } else {
    slide.mode = 'drag'
  }
}

export function consumeSuppressClick (host) {
  if (!host._suppressClick) {
    return false
  }
  host._suppressClick = false
  return true
}
