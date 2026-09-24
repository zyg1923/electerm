/**
 * Diary import/export: csv / xlsx / xls via SheetJS.
 */

import * as XLSX from 'xlsx'
import { formatDateTime, toDateKey } from './ops-diary-calendar'
import { createDiaryEntry, withMeta } from './ops-diary'

export const DIARY_HEADERS = [
  '日期',
  '标题',
  '内容',
  '阳历',
  '阴历',
  '是否休息',
  '创建时间',
  '编辑时间',
  'ID'
]

function rowFromEntry (entry) {
  const m = withMeta(entry)
  return {
    日期: m.date,
    标题: m.title || '',
    内容: m.content || '',
    阳历: m.solar || '',
    阴历: m.lunar || '',
    是否休息: m.isRest ? '是' : '否',
    创建时间: formatDateTime(m.createdAt),
    编辑时间: formatDateTime(m.updatedAt),
    ID: m.id || ''
  }
}

function pick (row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') {
      return String(row[k]).trim()
    }
  }
  return ''
}

function parseMaybeTime (s) {
  if (!s) return 0
  const t = Date.parse(String(s).replace(/-/g, '/'))
  return Number.isFinite(t) ? t : 0
}

function normalizeDateCell (v) {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && XLSX.SSF) {
    // excel serial date
    try {
      const parsed = XLSX.SSF.parse_date_code(v)
      if (parsed) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
      }
    } catch (_) {}
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  const t = Date.parse(s)
  if (Number.isFinite(t)) return toDateKey(new Date(t))
  return s
}

export function entryFromImportRow (row) {
  const date = normalizeDateCell(pick(row, ['日期', 'date', 'Date', 'DATE']))
  if (!date) return null
  const title = pick(row, ['标题', 'title', 'Title', 'TITLE'])
  const content = pick(row, ['内容', 'content', 'Content', '正文', 'CONTENT'])
  const id = pick(row, ['ID', 'id', 'Id'])
  const createdAt = parseMaybeTime(pick(row, ['创建时间', 'createdAt', 'created_at', 'Created At']))
  const updatedAt = parseMaybeTime(pick(row, ['编辑时间', 'updatedAt', 'updated_at', 'Updated At']))
  return createDiaryEntry({
    id: id || undefined,
    date,
    title,
    content,
    createdAt: createdAt || Date.now(),
    updatedAt: updatedAt || Date.now()
  })
}

export function buildDiarySheetRows (entries) {
  return (entries || []).map(rowFromEntry)
}

export function exportDiaryBlob (entries, format = 'xlsx') {
  const rows = buildDiarySheetRows(entries)
  const sheet = XLSX.utils.json_to_sheet(rows, { header: DIARY_HEADERS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '日志')
  const fmt = String(format || 'xlsx').toLowerCase()
  if (fmt === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(sheet)
    return {
      blob: new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
      filename: `ops-diary-${toDateKey(new Date())}.csv`
    }
  }
  const bookType = fmt === 'xls' ? 'xls' : 'xlsx'
  const buf = XLSX.write(wb, { bookType, type: 'array' })
  const mime = bookType === 'xls'
    ? 'application/vnd.ms-excel'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return {
    blob: new Blob([buf], { type: mime }),
    filename: `ops-diary-${toDateKey(new Date())}.${bookType}`
  }
}

export function downloadBlob (blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export async function parseDiaryFile (file) {
  const buf = await file.arrayBuffer()
  const name = String(file.name || '').toLowerCase()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    throw new Error('文件中没有工作表')
  }
  const sheet = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const entries = []
  for (const row of json) {
    const e = entryFromImportRow(row)
    if (e) entries.push(e)
  }
  if (!entries.length) {
    throw new Error('未解析到有效日志行（需要「日期」列）')
  }
  return { entries, sheetName, fileName: file.name || name }
}

/**
 * Build import conflict plan against existing diary.
 * Match priority: same id → same date+title → same date (first)
 */
export function buildImportPlan (incomingList, existingList) {
  const existing = existingList || []
  const byId = new Map(existing.map(e => [e.id, e]))
  const byDate = new Map()
  for (const e of existing) {
    if (!byDate.has(e.date)) byDate.set(e.date, [])
    byDate.get(e.date).push(e)
  }

  return (incomingList || []).map((inc, index) => {
    let existingHit = null
    let matchType = ''
    if (inc.id && byId.has(inc.id)) {
      existingHit = byId.get(inc.id)
      matchType = 'id'
    } else {
      const sameDay = byDate.get(inc.date) || []
      existingHit = sameDay.find(e => (e.title || '') === (inc.title || '')) ||
        (sameDay.length === 1 ? sameDay[0] : null)
      if (existingHit) {
        matchType = sameDay.find(e => (e.title || '') === (inc.title || '')) ? 'date+title' : 'date'
      }
    }
    return {
      key: `${index}-${inc.date}-${inc.id || ''}`,
      incoming: inc,
      existing: existingHit,
      matchType,
      action: existingHit ? 'replace' : 'add' // default: replace conflicts, add new
    }
  })
}
