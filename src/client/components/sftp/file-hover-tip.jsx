/**
 * Instant hover details for sftp files
 */

import { filesize } from 'filesize'
import time from '../../common/time'
import { mode2rwx } from '../../common/mode2permission'

const e = window.translate

export default function FileHoverTip ({ file }) {
  if (!file || file.isParent || file.isEmpty) {
    return null
  }
  const sizeText = file.isDirectory
    ? '-'
    : filesize(Number(file.size) || 0, {
      standard: 'iec',
      round: 1
    }).replace(' ', '')
  return (
    <div className='sftp-file-hover-tip'>
      <div>{e('size')}: {sizeText}</div>
      <div>{e('mode')}: {mode2rwx(file.mode)}</div>
      <div>{e('accessTime')}: {file.accessTime ? time(file.accessTime) : '-'}</div>
      <div>{e('modifyTime')}: {file.modifyTime ? time(file.modifyTime) : '-'}</div>
    </div>
  )
}
