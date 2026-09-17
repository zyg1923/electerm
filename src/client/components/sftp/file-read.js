/**
 * file info related functions
 */

import generate from '../../common/uid'
import { isWin } from '../../common/constants'
import resolve, { normalizeWinLocalPath, osResolve } from '../../common/resolve'

export const getFileExt = fileName => {
  if (/^\\\\(?:wsl\$|wsl\.localhost)\\/.test(fileName)) {
    return {
      base: fileName,
      ext: ''
    }
  }
  const sep = '.'
  const arr = fileName.split(sep)
  const len = arr.length
  if (len === 1) {
    return {
      base: fileName,
      ext: ''
    }
  }
  return {
    base: arr.slice(0, len - 1).join(sep),
    ext: arr[len - 1] || ''
  }
}

const modeDirectoryMask = 0o170000
const modeDirectoryValue = 0o040000

const toIsDirectory = (stat) => {
  if (!stat) {
    return false
  }

  if (typeof stat.isDirectory === 'function') {
    return stat.isDirectory()
  }

  if (typeof stat.isDirectory === 'boolean') {
    return stat.isDirectory
  }

  if (typeof stat.type === 'string') {
    return stat.type === 'd'
  }

  if (typeof stat.type === 'number') {
    return stat.type === 2
  }

  if (typeof stat.mode === 'number') {
    return (stat.mode & modeDirectoryMask) === modeDirectoryValue
  }

  return false
}

const toIsSymbolicLink = (stat) => {
  if (!stat) {
    return false
  }

  if (typeof stat.isSymbolicLink === 'function') {
    return stat.isSymbolicLink()
  }

  if (typeof stat.isSymbolicLink === 'boolean') {
    return stat.isSymbolicLink
  }

  if (typeof stat.type === 'string') {
    return stat.type === 'l'
  }

  if (typeof stat.type === 'number') {
    return stat.type === 3
  }

  return false
}

export const getFolderFromFilePath = (filePath, isRemote) => {
  const sep = isRemote ? '/' : window.pre.sep
  const arr = filePath.split(sep)
  const len = arr.length
  const isWinDisk = isWin && filePath.endsWith(sep)
  const isWslRoot = isWin && /^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+$/.test(filePath.replace(/\\$/, ''))
  const path = (isWinDisk || isWslRoot)
    ? '/'
    : arr.slice(0, len - 1).join(sep)
  const name = isWinDisk
    ? filePath.replace(sep, '')
    : isWslRoot
      ? filePath
      : arr[len - 1]

  return {
    path,
    name,
    ...getFileExt(name)
  }
}

function toMs (ms, date) {
  const n = Number(ms)
  if (Number.isFinite(n)) return n
  const d = Number(date)
  return Number.isFinite(d) ? d : 0
}

export const getLocalFileInfo = async (filePath) => {
  const statr = await window.fs.statAsync(filePath)
  const stat = await window.fs.lstatAsync(filePath)
  const isSymbolicLink = toIsSymbolicLink(stat)
  let target = ''
  if (isSymbolicLink && window.fs.readlink) {
    target = await window.fs.readlink(filePath).catch(() => '')
  }
  return {
    size: stat.size,
    accessTime: toMs(stat.atimeMs, stat.atime),
    modifyTime: toMs(stat.mtimeMs, stat.mtime),
    mode: stat.mode,
    owner: stat.uid,
    group: stat.gid,
    type: 'local',
    ...getFolderFromFilePath(filePath, false),
    id: generate(),
    isDirectory: toIsDirectory(statr),
    isSymbolicLink,
    target
  }
}

export const listLocalDirectory = async (dirPath) => {
  const listedPath = isWin ? (normalizeWinLocalPath(dirPath) || dirPath) : dirPath
  if (typeof window.fs.readdirWithStats === 'function') {
    try {
      const items = await window.fs.readdirWithStats(listedPath)
      if (Array.isArray(items)) {
        return items.map(item => ({
          size: item.size,
          accessTime: item.accessTime,
          modifyTime: item.modifyTime,
          mode: item.mode,
          owner: item.owner,
          group: item.group,
          type: 'local',
          path: listedPath,
          name: item.name,
          ...getFileExt(item.name),
          id: generate(),
          isDirectory: !!item.isDirectory,
          isSymbolicLink: !!item.isSymbolicLink,
          target: item.target || '',
          hasChildren: item.isDirectory ? item.hasChildren !== false : false,
          fullPath: osResolve(listedPath, item.name)
        }))
      }
    } catch (e) {
      console.debug(e)
    }
  }
  const names = await window.fs.readdirAsync(listedPath)
  const results = await Promise.all(
    names.map(name => {
      const p = resolve(listedPath, name)
      return getLocalFileInfo(p).catch(console.log)
    })
  )
  return results.filter(Boolean)
}

export const getRemoteFileInfo = async (sftp, filePath) => {
  const stat = await sftp.stat(filePath)
  return {
    size: stat.size,
    accessTime: stat.atime,
    modifyTime: stat.mtime,
    mode: stat.mode,
    group: stat.gid,
    owner: stat.uid,
    type: 'remote',
    ...getFolderFromFilePath(filePath, true),
    id: generate(),
    isDirectory: toIsDirectory(stat)
  }
}
