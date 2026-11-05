import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import ReactQuill from 'react-quill'
import 'quill/dist/quill.snow.css'
import './RichTextEditor.css'
import { App, Segmented } from 'antd'
import HtmlSourceEditor from './HtmlSourceEditor'

/** 富文本编辑器，两种模式随时切换：
 *  - 可视化编辑：Quill，适合纯文字、加粗、列表、插图
 *  - HTML 源码＋预览：左边写 HTML，右边实时渲染，适合调宽度、居中、表格
 *
 *  为什么要有源码模式：邮件正文/活动介绍常从 Word 粘过来，而 Quill 只认识
 *  自己那套格式，会把表格、百分比宽度、居中样式全部吃掉；这些只能靠 inline
 *  style 表达，所以必须留一条「原样保存」的通道。
 *
 *  ref 暴露：getEditor()（Quill 实例）、focusToken(token)（把光标定位到变量上）。
 */
const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['blockquote'],
  ['link', 'image'],
  [{ size: ['small', false, 'large', 'huge'] }],
  ['clean'],
]

/** 图片原样插入，不做任何压缩：上一版会缩到长边 1600px + JPEG 0.85，
 *  压完在演出介绍全屏弹层里明显发糊。清晰度优先，直接存原图。
 *  后端对单张内嵌图有 20MB 上限（按 base64 串长度算），超过的直接跳过并提示，
 *  避免「提示保存成功、图片却没进库」这种静默失败。 */
const MAX_BASE64 = 20_000_000

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败，请重试'))
    reader.readAsDataURL(file)
  })
}

type RichTextEditorProps = {
  value?: string
  onChange?: (html: string) => void
  placeholder?: string
  height?: number
  /** 邮件模板的整篇版式，仅用于源码模式预览；活动/剧目介绍不传 */
  layoutWidth?: number
  layoutCenter?: boolean
}

/** 正文里有表格，说明是靠表格排版的，切可视化会被吃掉。
 *  整篇宽度与居中已改由模板的「整篇版式」字段控制，不在正文里，所以这里不再看 img 样式。 */
const RICH_LAYOUT_RE = /<table/i

/** 剪贴板里带表格（从别的模板复制、从 Word 复制都会带），粘进 Quill 会被拍平成段落。 */
const PASTE_TABLE_RE = /<table[\s>]/i

const RichTextEditor = forwardRef<any, RichTextEditorProps>(function RichTextEditor(
  { value, onChange, placeholder, height = 220, layoutWidth, layoutCenter },
  ref,
) {
  const quillRef = useRef<any>(null)
  const sourceRef = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // null 表示用户还没手动切过：此时按正文内容自动选模式。
  // 正文里有表格/宽度样式就必须进源码模式，否则一打开可视化就把排版吃掉、
  // 用户每次点「确定」都要重新设一次居中。
  const [manualMode, setManualMode] = useState<'visual' | 'source' | null>(null)
  const autoMode: 'visual' | 'source' = RICH_LAYOUT_RE.test(value || '') ? 'source' : 'visual'
  const mode: 'visual' | 'source' = manualMode ?? autoMode
  const { modal } = App.useApp()

  useImperativeHandle(ref, () => ({
    getEditor: () => (mode === 'visual' ? quillRef.current?.getEditor?.() : null),
    focusToken: (token: string) => (
      mode === 'source' ? !!sourceRef.current?.focusToken?.(token) : false
    ),
  }), [mode])

  /** 图片工具栏按钮与粘贴都走这里：原图直接插入，超上限的跳过并提示。 */
  async function insertImages(files: File[]) {
    const editor = quillRef.current?.getEditor?.()
    if (!editor) return
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      try {
        const url = await readAsDataUrl(file)
        if (url.length > MAX_BASE64) {
          modal.warning({
            title: '图片过大，已跳过',
            content: `「${file.name || '这张图'}」编码后约 ${(url.length / 1024 / 1024).toFixed(1)}MB，`
              + '超过单张 20MB 上限，请换一张小一些的图片。',
          })
          continue
        }
        const range = editor.getSelection(true)
        const index = range ? range.index : editor.getLength()
        editor.insertEmbed(index, 'image', url, 'user')
        editor.setSelection(index + 1, 0)
      } catch (err: any) {
        modal.error({ title: '图片插入失败', content: err?.message || '请稍后重试' })
      }
    }
  }

  // modules 只建一次：Quill 在挂载时读取它，之后换对象会让编辑器重建、内容跳动
  const [modules] = useState(() => ({
    toolbar: {
      container: TOOLBAR_OPTIONS,
      handlers: {
        image: () => fileRef.current?.click(),
      },
    },
  }))

  function switchTo(next: string) {
    if (next === mode) return
    if (next === 'source') {
      setManualMode('source')
      return
    }
    if (RICH_LAYOUT_RE.test(value || '')) {
      modal.confirm({
        title: '正文里有表格或样式，切到可视化会被丢掉',
        content: '可视化编辑器不支持表格、百分比宽度、居中这类排版。建议留在「HTML 源码＋预览」里改；'
          + '确定要切过去的话，表格和宽度样式会被清掉。',
        okText: '仍然切换',
        cancelText: '留在源码模式',
        onOk: () => setManualMode('visual'),
      })
      return
    }
    setManualMode('visual')
  }

  /** 可视化模式里粘贴带表格的 HTML 时拦下来：Quill 会把表格拆成普通段落，
   *  左右并排（左文右二维码）会变成上下堆叠，而且这种损坏是静默的——保存后才发现。
   *  拦下来并引导到源码模式，用户再粘一次即可原样保留。
   *  粘贴的是图片（截图、复制的图片）则原图直接插入。 */
  function handleVisualPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      e.stopPropagation()
      insertImages(files)
      return
    }
    const html = e.clipboardData?.getData('text/html') || ''
    if (!PASTE_TABLE_RE.test(html)) return
    e.preventDefault()
    e.stopPropagation()
    modal.confirm({
      title: '这段内容里带表格，粘到可视化编辑会被拆平',
      content: '邮件模板里的「左侧文字 + 右侧二维码」并排布局、头图宽度都靠表格实现，'
        + '可视化编辑器不支持表格，粘进去会变成上下堆叠且排版丢失。'
        + '已为你切到「HTML 源码＋预览」，请在那里再粘贴一次。',
      okText: '去源码模式粘贴',
      cancelText: '取消',
      onOk: () => setManualMode('source'),
    })
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''  // 清空，允许重复选同一张
          insertImages(files)
        }}
      />
      <div style={{ marginBottom: 6 }}>
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => switchTo(String(v))}
          options={[
            { label: '可视化编辑', value: 'visual' },
            { label: 'HTML 源码＋预览', value: 'source' },
          ]}
        />
        {autoMode === 'source' && (
          <span style={{ fontSize: 12, color: '#8a99a8', marginLeft: 8 }}>
            正文含表格或宽度样式，已自动用源码模式打开，直接确定即可原样保存
          </span>
        )}
      </div>
      {mode === 'visual' ? (
        <div
          className="rich-editor"
          style={{ border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden', background: '#fff', height }}
          onPasteCapture={handleVisualPaste}
        >
          <ReactQuill
            ref={quillRef}
            theme="snow"
            modules={modules}
            value={value || ''}
            onChange={onChange}
            placeholder={placeholder}
          />
        </div>
      ) : (
        <HtmlSourceEditor
          ref={sourceRef}
          value={value || ''}
          onChange={(html) => onChange?.(html)}
          height={height + 90}
          layoutWidth={layoutWidth}
          layoutCenter={layoutCenter}
        />
      )}
    </div>
  )
})

export default RichTextEditor
