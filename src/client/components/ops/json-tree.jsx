/**
 * JSON tree view with expand/collapse and built-in value renderers
 * (color swatch, underlined links, booleans, dates…).
 */

import { useEffect, useMemo, useState } from 'react'

const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGB_RE = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)$/i
const URL_RE = /^(https?:\/\/|ftp:\/\/)/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

function typeOf (v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function typeLabel (v) {
  const t = typeOf(v)
  if (t === 'array') return `Array(${v.length})`
  if (t === 'object') return `Object(${Object.keys(v).length})`
  return t
}

export function detectValueKind (v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (COLOR_RE.test(s) || RGB_RE.test(s)) return 'color'
  if (URL_RE.test(s)) return 'url'
  if (ISO_DATE_RE.test(s)) return 'date'
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(s)) return 'email'
  return null
}

function ValueView ({ value }) {
  const t = typeOf(value)
  if (t === 'null') {
    return <span className='jt-null'>null</span>
  }
  if (t === 'boolean') {
    return <span className={value ? 'jt-bool-true' : 'jt-bool-false'}>{String(value)}</span>
  }
  if (t === 'number') {
    return <span className='jt-num'>{value}</span>
  }
  if (t === 'string') {
    const kind = detectValueKind(value)
    if (kind === 'color') {
      return (
        <span className='jt-color'>
          <span className='jt-color-swatch' style={{ background: value }} title={value} />
          <span className='jt-str'>"{value}"</span>
        </span>
      )
    }
    if (kind === 'url') {
      return (
        <a
          className='jt-link'
          href={value}
          target='_blank'
          rel='noreferrer'
          onClick={e => e.stopPropagation()}
        >
          "{value}"
        </a>
      )
    }
    if (kind === 'email') {
      return (
        <a
          className='jt-link'
          href={'mailto:' + value}
          onClick={e => e.stopPropagation()}
        >
          "{value}"
        </a>
      )
    }
    if (kind === 'date') {
      let tip = value
      try {
        tip = new Date(value).toLocaleString()
      } catch (_) {}
      return <span className='jt-date' title={tip}>"{value}"</span>
    }
    return <span className='jt-str'>"{value}"</span>
  }
  return <span className='jt-type'>{typeLabel(value)}</span>
}

function TreeNode ({ name, value, path, depth, expanded, toggle }) {
  const t = typeOf(value)
  const isContainer = t === 'object' || t === 'array'
  const isOpen = isContainer && expanded.has(path)
  const entries = isContainer
    ? (t === 'array'
        ? value.map((v, i) => [String(i), v])
        : Object.keys(value).map(k => [k, value[k]]))
    : []

  return (
    <div className='jt-node'>
      <div
        className={'jt-row' + (isContainer ? ' jt-row-click' : '')}
        style={{ paddingLeft: depth * 14 }}
        onClick={() => {
          if (isContainer) toggle(path)
        }}
      >
        {isContainer
          ? <span className='jt-caret'>{isOpen ? '▼' : '▶'}</span>
          : <span className='jt-caret jt-caret-leaf' />}
        {name != null
          ? <span className='jt-key'>{name}</span>
          : <span className='jt-key jt-root'>root</span>}
        <span className='jt-colon'>: </span>
        {isContainer
          ? <span className='jt-type'>{isOpen ? (t === 'array' ? '[' : '{') : typeLabel(value)}</span>
          : <ValueView value={value} />}
      </div>
      {isContainer && isOpen
        ? (
          <>
            {entries.map(([k, v]) => (
              <TreeNode
                key={path + '/' + k}
                name={k}
                value={v}
                path={path + '/' + k}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
              />
            ))}
            <div className='jt-row jt-close' style={{ paddingLeft: (depth + 1) * 14 }}>
              <span className='jt-caret jt-caret-leaf' />
              <span className='jt-type'>{t === 'array' ? ']' : '}'}</span>
            </div>
          </>
          )
        : null}
    </div>
  )
}

function collectExpandablePaths (value, path = '$', acc = [], maxDepth = 30, depth = 0) {
  if (!value || typeof value !== 'object' || depth > maxDepth) return acc
  acc.push(path)
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectExpandablePaths(v, path + '/' + i, acc, maxDepth, depth + 1))
  } else {
    Object.keys(value).forEach(k => collectExpandablePaths(value[k], path + '/' + k, acc, maxDepth, depth + 1))
  }
  return acc
}

function initialExpanded (data, defaultExpandDepth) {
  const all = collectExpandablePaths(data)
  return new Set(all.filter(p => (p.split('/').length - 1) < defaultExpandDepth))
}

export default function JsonTree ({ data, defaultExpandDepth = 2 }) {
  const allPaths = useMemo(() => collectExpandablePaths(data), [data])
  const [expanded, setExpanded] = useState(() => initialExpanded(data, defaultExpandDepth))

  useEffect(() => {
    setExpanded(initialExpanded(data, defaultExpandDepth))
  }, [data, defaultExpandDepth])

  function toggle (path) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (data === undefined) {
    return <div className='jt-empty'>粘贴合法 JSON 后显示树形结构</div>
  }

  return (
    <div className='jt-wrap'>
      <div className='jt-toolbar'>
        <button type='button' className='jt-btn' onClick={() => setExpanded(new Set(allPaths))}>全部展开</button>
        <button type='button' className='jt-btn' onClick={() => setExpanded(new Set())}>全部折叠</button>
        <span className='jt-hint'>色值显示色块 · 链接下划线可点 · 日期悬停看本地时间</span>
      </div>
      <div className='jt-tree'>
        <TreeNode
          name={null}
          value={data}
          path='$'
          depth={0}
          expanded={expanded}
          toggle={toggle}
        />
      </div>
    </div>
  )
}
