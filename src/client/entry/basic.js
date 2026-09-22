/**
 * init app data then write main script to html body
 */
import '../css/basic.styl'
import '../css/mobile.styl'
import { get as _get } from 'lodash-es'
import '../common/pre'

const { isDev } = window.et
const { version } = window.pre.packInfo

async function loadWorker () {
  return new Promise((resolve) => {
    const url = !isDev ? `js/worker-${version}.js` : 'js/worker.js'
    window.worker = new window.Worker(url)
    function onInit (e) {
      if (!e || !e.data) {
        return false
      }
      const {
        action
      } = e.data
      if (action === 'worker-init') {
        window.worker.removeEventListener('message', onInit)
        resolve(1)
      }
    }
    window.worker.addEventListener('message', onInit)
  })
}

async function load () {
  window.capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1)
  }
  function loadScript () {
    const rcs = document.createElement('script')
    const url = !isDev ? `js/electerm-${version}.js` : 'js/electerm.js'
    rcs.src = url
    rcs.type = 'module'
    rcs.onload = () => {
      const loadingEl = document.getElementById('content-loading')
      if (loadingEl) {
        document.body.removeChild(loadingEl)
      }
    }
    document.body.appendChild(rcs)
  }
  const initLocale = window.pre.runSync('getInitLocale') || {}
  window.langMap = initLocale.langMap
  window.initLanguage = initLocale.language
  window.getLang = (lang = window.store?.config.language || window.initLanguage || 'en_us') => {
    return _get(window.langMap, `[${lang}].lang`)
  }
  window.translate = txt => {
    const langCode = window.store?.config?.language || window.initLanguage || 'en_us'
    if (String(langCode).startsWith('zh')) {
      const zhMap = {
        bookmarks: '连接设置',
        newBookmark: '新增链接',
        newTab: '打开新链接',
        newTerminal: '打开新链接',
        history: '链接历史',
        bookmarkCategory: '连接分类',
        closeTabLeft: '关闭左侧连接',
        closeTabRight: '关闭右侧连接',
        closeOtherTabs: '关闭其他连接',
        sessionLogDir: 'Log地址',
        sessionLogEnabled: '日志已启用',
        sessionLogDirHint: '不选择文件夹则不记录日志；连接后会在窗口顶部显示实际路径',
        createBookmarkByAI: 'AI 智能创建书签',
        quickConnect: '快速连接',
        transferHistory: '传输历史',
        settingSync: '云同步',
        dataMigrate: '数据迁移',
        export: '导出',
        importFromFile: '从文件导入'
      }
      if (zhMap[txt]) {
        return zhMap[txt]
      }
    }
    const lang = window.getLang()
    const str = _get(lang, `[${txt}]`) || txt
    return window.capitalizeFirstLetter(str)
  }
  await loadWorker()
  loadScript()
}

// window.addEventListener('load', load)
load()
