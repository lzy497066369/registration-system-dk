import type { ReactNode } from 'react'

/** 前台统一提示弹层：替代页面底部的红字提示。
 *  用法：const [tip, setTip] = useState('')；setTip('员工号或邮箱不匹配') 即弹出；
 *  tip 为空时不渲染。样式见 front.css 的 .fm-* 系列。
 *
 *  双按钮用法（客户经理要求：余票不足时让用户自己选「重选场次 / 继续报名」）：
 *    <AlertModal tip="…" danger okText="继续报名" onClose={继续} cancelText="重选场次" onCancel={重选} />
 */
type Props = {
  tip: string
  onClose: () => void
  title?: string
  /** 错误类提示：文字变红，标题位换成红色感叹号图标 */
  danger?: boolean
  /** 主按钮文案，默认「我知道了」 */
  okText?: string
  /** 传了 cancelText + onCancel 就变成左右两个按钮（左灰右紫） */
  cancelText?: string
  onCancel?: () => void
}

export default function AlertModal({
  tip, onClose, title = '温馨提示', danger = false, okText = '我知道了', cancelText, onCancel,
}: Props) {
  if (!tip) return null
  const twoBtn = !!(cancelText && onCancel)
  return (
    <div className="fm-mask" role="dialog" aria-modal="true">
      <div className="fm-box">
        {danger ? (
          <div className={twoBtn ? 'fm-icon' : 'fm-icon fm-icon-sm'} aria-hidden>!</div>
        ) : (
          <div className="fm-title">{title}</div>
        )}
        <div className={danger ? 'fm-text fm-text-danger' : 'fm-text'}>{tip}</div>
        {twoBtn ? (
          <div className="fm-actions">
            <button className="fm-btn-ghost" type="button" onClick={onCancel}>{cancelText}</button>
            <button className="fm-btn" type="button" onClick={onClose}>{okText}</button>
          </div>
        ) : (
          <button className="fm-btn" type="button" onClick={onClose}>{okText}</button>
        )}
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
