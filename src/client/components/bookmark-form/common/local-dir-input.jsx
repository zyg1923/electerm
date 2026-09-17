import { Input } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { chooseSaveDirectory } from '../../../common/choose-save-folder'

const e = window.translate

export default function LocalDirInput ({ value, onChange, allowClear, ...rest }) {
  const handleChoose = async () => {
    const path = await chooseSaveDirectory({
      title: e('chooseFolder'),
      message: e('chooseFolder'),
      defaultPath: value || undefined
    })
    if (path && onChange) {
      onChange(path)
    }
  }
  return (
    <Input
      {...rest}
      value={value}
      allowClear={allowClear}
      placeholder={rest.placeholder || e('chooseFolder')}
      onChange={e => onChange && onChange(e.target.value)}
      addonAfter={
        <span
          className='pointer'
          onMouseDown={ev => ev.preventDefault()}
          onClick={handleChoose}
          title={e('chooseFolder')}
        >
          <FolderOpenOutlined className='mg1r' />
          {e('chooseFolder')}
        </span>
      }
    />
  )
}
