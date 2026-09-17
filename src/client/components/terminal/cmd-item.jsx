import React from 'react'
import { CloseCircleOutlined } from '@ant-design/icons'

const typeLabels = {
  P: '路径',
  H: '历史',
  C: '命令',
  Q: '快捷',
  B: '批量',
  AI: 'AI',
  PW: '密码'
}

const SuggestionItem = ({ item, selected, onSelect, onDelete }) => {
  const handleClick = () => {
    onSelect(item)
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    onDelete(item)
  }

  const isPassword = item.type === 'PW'
  const displayText = isPassword
    ? '••••••••'
    : item.command

  return (
    <div className={selected ? 'suggestion-item selected' : 'suggestion-item'} onClick={handleClick}>
      <span className='suggestion-command'>
        {displayText}
      </span>
      {item.hint && (
        <span className='suggestion-hint'>
          {item.hint}
        </span>
      )}
      <span className='suggestion-type'>
        {typeLabels[item.type] || item.type}
      </span>
      {item.type === 'H' && (
        <CloseCircleOutlined
          className='suggestion-delete'
          onClick={handleDelete}
        />
      )}
    </div>
  )
}

export default SuggestionItem
