/**
 * Live sample for the terminal font and the theme being previewed.
 * Shown before the theme is saved.
 */

export default function FontThemePreview (props) {
  const fontFamily = props.fontFamily || 'monospace'
  const fontSize = Number(props.fontSize) || 16
  const theme = props.themeConfig || {}
  const ui = props.uiThemeConfig || {}
  const background = theme.background || ui.main || '#1e1e1e'
  const foreground = theme.foreground || ui.text || '#d4d4d4'
  const cursor = theme.cursor || foreground
  const bar = ui.main || background
  const barText = ui.text || foreground
  const primary = ui.primary || '#1677ff'
  return (
    <div className='pd2b'>
      <div className='inline-title mg1b'>预览</div>
      <div
        style={{
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid rgba(128,128,128,.35)',
          maxWidth: 520
        }}
      >
        <div
          style={{
            background: bar,
            color: barText,
            padding: '8px 12px',
            display: 'flex',
            gap: 8,
            alignItems: 'center'
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 10,
              background: primary,
              display: 'inline-block'
            }}
          />
          <span>界面</span>
          <span style={{ marginLeft: 'auto', opacity: 0.85 }}>Aa</span>
        </div>
        <div
          style={{
            fontFamily,
            fontSize,
            background,
            color: foreground,
            padding: '12px 14px',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap'
          }}
        >
          <div>终端字体 Aa 0123 中文 The quick brown fox</div>
          <div style={{ color: cursor }}>root@host:~# ls</div>
        </div>
      </div>
    </div>
  )
}
