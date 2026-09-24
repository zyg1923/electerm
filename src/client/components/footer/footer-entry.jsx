import { auto } from 'manate/react'
import {
  Select,
  Dropdown,
  Badge,
  Switch
} from 'antd'
import { BarChartOutlined, TranslationOutlined, DoubleRightOutlined, FunctionOutlined } from '@ant-design/icons'
import './footer.styl'
import { statusMap, minTerminalFontSize, isWin } from '../../common/constants'
import BatchInput from './batch-input'
import encodes from '../bookmark-form/common/encodes'
import { refs } from '../common/ref'
import Qm from '../quick-commands/quick-commands-select'
import TriggerSessionModal from '../triggers/trigger-session-modal'
import AIIcon from '../icons/ai-icon'
import { isAIDisabled } from '../../common/ai-feature'
import CmdHistory from './cmd-history'

const e = window.translate

const {
  Option
} = Select

export default auto(function FooterEntry (props) {
  function handleInfoPanel () {
    window.store.openInfoPanel()
  }

  function batchInput (cmd, selectedTabIds) {
    selectedTabIds.map(id => {
      return refs.get('term-' + id)
    }).forEach(term => {
      term?.batchInput(cmd)
    })
  }

  function handleSwitchEncoding (encode) {
    const term = refs.get('term-' + props.store.activeTabId)
    if (term) {
      term.switchEncoding(encode)
    }
  }

  function isLoading () {
    const { currentTab } = props.store
    if (!currentTab) {
      return true
    }
    const {
      status
    } = currentTab
    return status !== statusMap.success
  }

  function renderBatchInputs () {
    const { store } = props
    const batchProps = {
      input: batchInput,
      tabs: store.tabs,
      batchInputSelectedTabIds: store.batchInputSelectedTabIds,
      activeTabId: store.activeTabId,
      isMobile: store.isMobile
    }
    return (
      <div className='terminal-footer-unit terminal-footer-center'>
        <BatchInput
          {...batchProps}
        />
      </div>
    )
  }

  function renderQuickCommands () {
    return (
      <div className='terminal-footer-unit terminal-footer-qm'>
        <Qm />
      </div>
    )
  }

  function renderTriggers () {
    const { store } = props
    const tab = store.currentTab
    let count = 0
    try {
      count = tab ? store.getEffectiveTriggers(tab).length : store.triggers.length
    } catch (err) {
      count = 0
    }
    return (
      <div className='terminal-footer-unit terminal-footer-triggers'>
        <Badge
          count={count}
          size='small'
          offset={[-2, 2]}
        >
          <FunctionOutlined
            onClick={() => store.toggleTriggerSessionModal(true)}
            className='pointer font14 terminal-trigger-icon'
            title={e('triggers')}
          />
        </Badge>
        <TriggerSessionModal store={store} />
      </div>
    )
  }

  function renderAIIcon () {
    return (
      <div className='terminal-footer-unit terminal-footer-ai'>
        <AIIcon
          onClick={window.store.handleOpenAIPanel}
        />
      </div>
    )
  }

  function renderEncodingInfo () {
    const selectProps = {
      style: {
        minWidth: 30
      },
      placeholder: e('encode'),
      defaultValue: props.store.currentTab?.encode,
      onSelect: handleSwitchEncoding,
      size: 'small',
      variant: 'borderless',
      popupMatchSelectWidth: false
    }
    if (props.store.isMobile) {
      const items = encodes.map(k => {
        return {
          key: k,
          label: k.toUpperCase(),
          onClick: () => handleSwitchEncoding(k)
        }
      })
      return (
        <div className='terminal-footer-unit terminal-footer-info'>
          <Dropdown
            menu={{ items }}
            placement='topRight'
            trigger={['click']}
          >
            <TranslationOutlined
              className='pointer font18 mobile-encode-trigger'
            />
          </Dropdown>
        </div>
      )
    }
    return (
      <div className='terminal-footer-unit terminal-footer-info'>
        <div className='fleft relative'>
          <Select
            {...selectProps}
          >
            {
              encodes.map(k => {
                return (
                  <Option key={k} value={k}>
                    {k.toUpperCase()}
                  </Option>
                )
              })
            }
          </Select>
        </div>
      </div>
    )
  }

  function renderInfoIcon () {
    const loading = isLoading()
    if (loading) {
      return null
    }
    return (
      <div className='terminal-footer-unit terminal-footer-info'>
        <BarChartOutlined
          onClick={handleInfoPanel}
          className='pointer font14 terminal-info-icon'
        />
      </div>
    )
  }

  function renderCmdHistory () {
    return (
      <div className='terminal-footer-unit terminal-footer-history'>
        <CmdHistory store={props.store} />
      </div>
    )
  }

  const zoomChoices = [50, 75, 100, 125, 150, 175, 200, 250, 300]

  function withCurrent (current) {
    const list = zoomChoices.includes(current)
      ? zoomChoices
      : [...zoomChoices, current].sort((a, b) => a - b)
    return list.map(n => ({ value: n, label: `${n}%` }))
  }

  function setUiZoom (percent) {
    props.store.zoom(percent / 100)
  }

  function setTermZoom (percent) {
    const inst = refs.get('term-' + props.store.activeTabId)
    if (!inst?.term) {
      return
    }
    const base = props.store.config?.fontSize || inst.term.options.fontSize
    const next = Math.max(minTerminalFontSize, Math.round(base * percent / 100))
    inst.originalFontSize = base
    inst.term.options.fontSize = next
    props.store.terminalFontSize = next
    props.store.terminalFontBase = base
    inst.setState({ fontSizeChanged: next !== base }, () => {
      inst.fitAndRefresh?.()
      setTimeout(() => inst.fitAndRefresh?.(), 60)
    })
  }

  function localShellOf (tab) {
    if (tab?.localShell === 'cmd' || tab?.localShell === 'powershell') {
      return tab.localShell
    }
    return /cmd\.exe$/i.test(String(tab?.execWindows || '')) ? 'cmd' : 'powershell'
  }

  function isLocalWindowsTab (tab) {
    if (!isWin || !tab || tab.host) {
      return false
    }
    return !tab.type || tab.type === 'local'
  }

  function reopenLocalShell (shell, admin) {
    const id = props.store.activeTabId
    const execWindows = shell === 'cmd'
      ? 'System32/cmd.exe'
      : 'System32/WindowsPowerShell/v1.0/powershell.exe'
    window.store.updateTab(id, {
      execWindows,
      execWindowsArgs: [],
      localShell: shell,
      localAdmin: !!admin
    })
    window.store.reloadTab(id)
  }

  function renderLocalShell () {
    const tab = props.store.currentTab
    // Show even when status is error/processing — otherwise a failed local
    // shell leaves an empty pane with no way to switch CMD/PowerShell.
    if (!isLocalWindowsTab(tab)) {
      return null
    }
    const shell = localShellOf(tab)
    const admin = !!tab.localAdmin
    return (
      <div className='terminal-footer-unit terminal-footer-shell'>
        <Select
          size='small'
          value={shell}
          popupMatchSelectWidth={false}
          options={[
            { value: 'powershell', label: 'PowerShell' },
            { value: 'cmd', label: 'CMD' }
          ]}
          onChange={(next) => reopenLocalShell(next, admin)}
        />
        <span className='terminal-footer-shell-admin'>管理员</span>
        <Switch
          size='small'
          checked={admin}
          onChange={(next) => reopenLocalShell(shell, next)}
        />
      </div>
    )
  }

  function renderZoomRatio () {
    const { store } = props
    const ui = Math.round((store.uiZoom || store.config?.zoom || 1) * 100)
    const base = store.terminalFontBase || store.config?.fontSize
    const size = store.terminalFontSize || base
    const inTerm = store.inActiveTerminal
    const term = inTerm && base > 0 && size > 0
      ? Math.round(size / base * 100)
      : null
    return (
      <div className='terminal-footer-zoom'>
        <span>界面</span>
        <Select
          size='small'
          value={ui}
          options={withCurrent(ui)}
          onChange={setUiZoom}
          popupMatchSelectWidth={false}
          placement='topRight'
        />
        {
          term == null
            ? null
            : (
              <>
                <span>终端</span>
                <Select
                  size='small'
                  value={term}
                  options={withCurrent(term)}
                  onChange={setTermZoom}
                  popupMatchSelectWidth={false}
                  placement='topRight'
                />
              </>
              )
        }
      </div>
    )
  }

  function handleShowSidebar () {
    window.store.toggleLeftSideBar()
  }

  const {
    leftSidePanelWidth,
    leftSideBarWidth,
    openedSideBar,
    inActiveTerminal
  } = props.store
  const w = leftSideBarWidth + leftSidePanelWidth
  // icon bar hidden: show a control on the left of the footer to bring the
  // sidebar back
  const showSidebarIcon = leftSideBarWidth === 0
    ? (
      <div className='terminal-footer-unit terminal-footer-show-sidebar'>
        <DoubleRightOutlined
          className='pointer font18 show-sidebar-icon'
          onClick={handleShowSidebar}
        />
      </div>
      )
    : null
  const sideProps = openedSideBar
    ? {
        className: 'main-footer',
        style: {
          left: `${w}px`
        }
      }
    : {
        className: 'main-footer'
      }
  if (
    !inActiveTerminal
  ) {
    return (
      <div className='main-footer' {...sideProps}>
        {showSidebarIcon}
        {renderZoomRatio()}
      </div>
    )
  }
  return (
    <div {...sideProps}>
      <div className='terminal-footer-flex'>
        {showSidebarIcon}
        {!isAIDisabled() && renderAIIcon()}
        {renderCmdHistory()}
        {renderQuickCommands()}
        {renderTriggers()}
        {renderBatchInputs()}
        {renderEncodingInfo()}
        {renderInfoIcon()}
        {renderLocalShell()}
        {renderZoomRatio()}
      </div>
    </div>
  )
})
