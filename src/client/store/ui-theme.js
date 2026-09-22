/**
 * ui theme functions
 */

import {
  settingMap
} from '../common/constants'
import {
  defaultTheme
} from '../common/theme-defaults'

import copy from 'json-deep-copy'

export default Store => {
  Store.prototype.getUiThemeConfig = function () {
    const { store } = window
    const themeId = store.previewThemeId || store.config.theme
    const theme = store.getSidebarList(settingMap.terminalThemes)
      .find(d => d.id === themeId)
    return theme && theme.uiThemeConfig
      ? copy(theme.uiThemeConfig)
      : defaultTheme().uiThemeConfig
  }
}
