import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Button, Input, Space } from 'antd'

/** 邮件正文源码编辑器：左侧写 HTML，右侧实时预览。
 *
 *  为什么不用富文本编辑器：Quill 只认识自己那套格式，会把 Word 的表格、
 *  百分比宽度、居中样式全部吃掉，而邮件排版恰恰全靠 inline style。
 *  整篇宽度与居中不在这里设，由模板的「整篇版式」字段控制（见 mailer.apply_layout）。
 */

const PREVIEW_HEAD = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'body{margin:0;padding:10px;background:#fff;color:#333;'
  + 'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7}'
  + 'img{max-width:100%;height:auto}table{max-width:100%}a{color:#1677ff}'
  + '</style></head><body>'

type Props = {
  value: string
  onChange: (html: string) => void
  height?: number
  /** 传了才按版式包壳预览；活动/剧目介绍没有这一层 */
  layoutWidth?: number
  layoutCenter?: boolean
}

const HtmlSourceEditor = forwardRef<any, Props>(function HtmlSourceEditor(
  { value, onChange, height = 340, layoutWidth, layoutCenter },
  ref,
) {
  const taRef = useRef<any>(null)
  // 预览要防抖：正文常带 1MB 级的 base64 图片，每敲一个字重渲染会直接把浏览器卡住
  const [previewHtml, setPreviewHtml] = useState(value || '')

  useEffect(() => {
    const timer = setTimeout(() => setPreviewHtml(value || ''), 400)
    return () => clearTimeout(timer)
  }, [value])

  const preview = useMemo(() => {
    const inner = previewHtml.replace(
      /<img[^>]*cid:[^>]*>/g,
      '<span style="color:#8a99a8;font-size:12px">〔二维码：发送时自动生成〕</span>',
    )
    let shell = inner
    if (typeof layoutWidth === 'number') {
      const pct = Math.max(20, Math.min(100, layoutWidth))
      const centered = layoutCenter !== false
      if (pct < 100 || centered) {
        const align = centered ? 'center' : 'left'
        const margin = centered ? '0 auto' : '0'
        shell = `<table width="${pct}%" align="${align}" style="width:${pct}%;`
          + `max-width:760px;border-collapse:collapse;margin:${margin}"><tr><td>${inner}</td></tr></table>`
      }
    }
    return PREVIEW_HEAD + shell + '</body></html>'
  }, [previewHtml, layoutWidth, layoutCenter])

  function textarea(): HTMLTextAreaElement | undefined {
    const r: any = taRef.current
    // 开了 autoSize 时是 rc-textarea 的包装对象，否则直接是 textarea 元素
    return (r?.resizableTextArea?.textArea || r) as HTMLTextAreaElement | undefined
  }

  function insertAtCursor(snippet: string) {
    const ta = textarea()
    if (!ta) {
      onChange((value || '') + snippet)
      return
    }
    const start = ta.selectionStart ?? (value || '').length
    const end = ta.selectionEnd ?? start
    const next = (value || '').slice(0, start) + snippet + (value || '').slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  useImperativeHandle(ref, () => ({
    focusToken(token: string): boolean {
      const ta = textarea()
      if (!ta) return false
      const pos = (value || '').indexOf(token)
      if (pos < 0) return false
      ta.focus()
      ta.setSelectionRange(pos, pos + token.length)
      return true
    },
  }), [value])

  return (
    <div>
      <Space size={6} wrap style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => insertAtCursor('{{qrcode}}')}>插入二维码变量</Button>
        <span style={{ fontSize: 12, color: '#8a99a8' }}>
          整篇宽度与居中在模板上方的「整篇版式」里设置，这里只写内容
        </span>
      </Space>

      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <Input.TextArea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{
            flex: '1 1 0', height, minHeight: 200, fontFamily: 'Consolas, Menlo, monospace',
            fontSize: 12, lineHeight: 1.6, resize: 'vertical',
          }}
          placeholder={'把 Word「另存为网页」得到的 HTML 整段粘到这里，右边实时看效果。\n改宽度和居中用上面的按钮，或直接改 style="width:70%"。'}
        />
        <iframe
          title="邮件预览"
          sandbox=""
          srcDoc={preview}
          style={{
            flex: '1 1 0', height, border: '1px solid #e5e5e5', borderRadius: 6,
            background: '#fff', minWidth: 0,
          }}
        />
      </div>
    </div>
  )
})

export default HtmlSourceEditor
