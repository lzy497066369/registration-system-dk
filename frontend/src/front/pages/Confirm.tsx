import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatShowTime, cleanAddress, frontApi, getToken, readDraft, draftKey, guardBeforeRegister, setActivityTitle } from '../api'
import AlertModal, { ConfirmDialog } from '../AlertModal'
import '../front.css'

/** 一次性幂等键：同一份草稿内保持不变，只用于「同一次提交」被重复触发时去重。
 *  以前用的是 `${session_id}-${手机号}`，与员工无关，不同员工用同一手机号会被唯一索引
 *  误判成重复提交（显示「您已报名过本次活动」但后台查不到单）。 */
function newIdemKey(sessionId: number | string): string {
  const buf = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf)
  else for (let i = 0; i < 16; i += 1) buf[i] = Math.floor(Math.random() * 256)
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${sessionId}-${hex}`
}

export default function Confirm() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const [draft, setDraft] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  // 提交失败等提示走弹层
  const [tip, setTip] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 点「确认，下一步」先弹二次确认层，把报名信息再列一遍
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    // 登录态守卫：未登录回登录页；已报名跳成功页（报名一旦提交就不该再回到确认页）
    guardBeforeRegister(code).then((redirect) => {
      if (redirect) { nav(redirect, { replace: true }); return }
      let d = readDraft(code)
      if (!d) { nav(`/a/${code}/list`, { replace: true }); return }
      // 首版草稿可能没有幂等键，这里补一个并写回，保证「上一步 / 再提交」复用同一个键
      if (!d.idem) {
        d = { ...d, idem: newIdemKey(d.session_id) }
        localStorage.setItem(draftKey(code), JSON.stringify(d))
      }
      setDraft(d)
      frontApi.sessions(code).then((resp) => {
        setData(resp)
        setActivityTitle(resp?.activity?.name)
      }).catch(() => {})
    })
  }, [code])

  const session = (() => {
    if (!data || !draft) return null
    for (const sh of data.shows || []) {
      const hit = (sh.sessions || []).find((s: any) => s.id === draft.session_id)
      if (hit) return { ...hit, show: sh }
    }
    return null
  })()

  // 活动不允许携带随行人员（或上限为 0）时，提交的随行人数强制为 0
  const companionAllowed = !!data?.activity?.companion_enabled && (data.activity?.companion_max ?? 0) > 0
  // 随行人数：报名页可能因为名额不足把人数字压下来了，这里按场次当前可携上限再夹一次
  const effectiveCompanions = companionAllowed
    ? (session
      ? Math.max(0, Math.min(Number(draft?.companions ?? 0), Number(session.companion_max ?? 0)))
      : Number(draft?.companions ?? 0))
    : 0
  // 观演人数 = 本人 + 随行
  const headcount = effectiveCompanions + 1

  async function submit() {
    if (!draft) return
    const token = getToken(code)
    if (!token) { nav(`/a/${code}/login`, { replace: true }); return }
    setSubmitting(true)
    try {
      await frontApi.register(code, token, {
        session_id: draft.session_id,
        phone: draft.phone,
        companion_count: effectiveCompanions,
        province: draft.province,
        city: draft.city,
        county: draft.county,
        address_detail: draft.address,
        recipient_name: draft.recipient,
        recipient_phone: draft.recipientPhone,
        // 幂等键按草稿固定生成：重复点「确认」只会产生一单，不会误报「已报名过」
        idempotency_key: draft.idem,
      })
      localStorage.removeItem(draftKey(code))
      nav(`/a/${code}/success`)
    } catch (err: any) {
      setConfirmOpen(false)
      setTip(err.message || '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  // 报名信息清单：页面和二次确认弹层共用同一份，避免两处口径不一致
  const reviewRows = (
    <>
      <div className="info-row">
        <span className="info-label">演出选择</span>
        <span className="info-value info-value-strong">{session?.show?.name || '-'}</span>
      </div>
      <div className="info-row">
        <span className="info-label">演出场次时间</span>
        <span className="info-value info-value-strong">{session ? formatShowTime(session.show_at) : '-'}</span>
      </div>
      <div className="info-row">
        <span className="info-label">演出地点</span>
        <span className="info-value info-value-strong">{session?.show?.location || '待定'}</span>
      </div>
      <div className="info-row">
        <span className="info-label">详细地址</span>
        <span className="info-value info-value-strong aright">
          {cleanAddress(session?.show?.address) || '待定'}
        </span>
      </div>
      <div className="info-row">
        <span className="info-label">您的联系电话</span>
        <span className="info-value info-value-strong">{draft?.phone}</span>
      </div>
      <div className="info-row">
        <span className="info-label">观演人数</span>
        <span className="info-value info-value-strong">{headcount} 人</span>
      </div>
      <div className="info-row">
        <span className="info-label">票券邮寄地址</span>
        <span className="info-value info-value-strong aright">
          {draft?.province}{draft?.city}{draft?.county}{draft?.address}<br />
          {draft?.recipient}<br />
          {draft?.recipientPhone}
        </span>
      </div>
    </>
  )

  const banner = data?.activity?.page_header_image || '/images/banner.png'

  return (
    <div className="list1-page">
      <img className="banner-img" src={banner} alt={data?.activity?.name || ''} />

      <div className="step-bar step-bar-list">
        <img className="step-icon" src="/images/setph1.png" alt="步骤1" />
        <img className="step-next" src="/images/nexth.png" alt="" />
        <img className="step-icon" src="/images/setph2.png" alt="步骤2" />
        <img className="step-next" src="/images/nexth.png" alt="" />
        <img className="step-icon" src="/images/setp3.png" alt="步骤3" />
      </div>
      <div className="list-wrap">
        <h2 className="form-title">请仔细核对并确认您的报名信息</h2>
        <div className="info-r">{reviewRows}</div>
      </div>

      <div className="btn-row">
        <button className="btn-prev" type="button" onClick={() => nav(`/a/${code}/form?session_id=${draft?.session_id}`)}>
          上一步
        </button>
        <button className="btn-next" type="button" onClick={() => setConfirmOpen(true)} disabled={submitting}>
          {submitting ? '提交中…' : '确认，下一步'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="请再次确认报名信息"
        note="报名信息提交后不可修改，是否确认提交？"
        okText="确认提交"
        cancelText="再改改"
        loading={submitting}
        onOk={submit}
        // 「再改改」直接回报名页改信息，不是简单关掉弹层
        onCancel={() => {
          setConfirmOpen(false)
          nav(`/a/${code}/form?session_id=${draft?.session_id}`)
        }}
      >
        {reviewRows}
      </ConfirmDialog>

      <AlertModal tip={tip} onClose={() => setTip('')} />
    </div>
  )
}
