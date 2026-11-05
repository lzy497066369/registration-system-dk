import type { ReactNode } from 'react'

/** 前台统一提示弹层：替代页面底部的红字提示。
 *  用法：const [tip, setTip] = useState('')；setTip('员工号或邮箱不匹配') 即弹出；
 *  tip 为空时不渲染。样式见 front.css 的 .fm-* 系列。 */
type Props = {
  tip: string
  onClose: () => void
  title?: string
}

export default function AlertModal({ tip, onClose, title = '温馨提示' }: Props) {
  if (!tip) return null
  return (
    <div className="fm-mask" role="dialog" aria-modal="true">
      <div className="fm-box">
        <div className="fm-title">{title}</div>
        <div className="fm-text">{tip}</div>
        <button className="fm-btn" type="button" onClick={onClose}>我知道了</button>
      </div>
    </div>
  )
}

/** 二次确认弹层：把内容（如报名信息）再列一遍，用户点「确认提交」才继续。
 *  内容区自身可滚动，超出屏幕也不会溢出。 */
type ConfirmProps = {
  open: boolean
  title?: string
  children: ReactNode
  note?: string
  okText?: string
  cancelText?: string
  loading?: boolean
  onOk: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title = '请确认报名信息', children, note,
  okText = '确认提交', cancelText = '再改改', loading = false, onOk, onCancel,
}: ConfirmProps) {
  if (!open) return null
  return (
    <div className="fm-mask" role="dialog" aria-modal="true">
      <div className="fm-box fm-box-wide">
        <div className="fm-title">{title}</div>
        <div className="fm-review">{children}</div>
        {note && <p className="fm-note">{note}</p>}
        <div className="fm-actions">
          <button className="fm-btn-ghost" type="button" onClick={onCancel} disabled={loading}>
            {cancelText}
          </button>
          <button className="fm-btn" type="button" onClick={onOk} disabled={loading}>
            {loading ? '提交中…' : okText}
          </button>
        </div>
      </div>
    </div>
  )
}
