import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { formatShowTime, frontApi, getEmp, readDraft, draftKey, guardBeforeRegister, setActivityTitle } from '../api'
import { citiesOf, countiesOf, REGIONS } from '../regions'
import AlertModal from '../AlertModal'
import '../front.css'

// 邮寄地址默认省市（用户多数寄往北京）
const DEFAULT_PROVINCE = '北京市'
const DEFAULT_CITY = '北京市'
// 手机号：1 开头 11 位
const PHONE_RE = /^1\d{10}$/

/** 记一项提示的附加形态：红色文案 / 按钮文案 / 左按钮（客户经理要求的双选择弹窗） */
type TipOpts = {
  danger?: boolean
  okText?: string
  cancel?: { text: string; go: () => void }
}

export default function RegisterForm() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const sessionId = Number(params.get('session_id'))
  const [data, setData] = useState<any>(null)
  const [phone, setPhone] = useState('')
  // 随行人数默认 1（场次加载后会按「上限 / 剩余名额」自动收敛，不允许带随行时归 0）
  const [companions, setCompanions] = useState(1)
  const [province, setProvince] = useState(DEFAULT_PROVINCE)
  const [city, setCity] = useState(DEFAULT_CITY)
  const [county, setCounty] = useState('')
  const [address, setAddress] = useState('')
  const [recipient, setRecipient] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  // 校验/提交失败的提示一律走弹层
  const [tip, setTip] = useState('')
  const [tipOpts, setTipOpts] = useState<TipOpts>({})
  // 弹层关闭后要做的事（例如「已报满 → 回选择剧目页」）
  const tipAfter = useRef<null | (() => void)>(null)

  function showTip(msg: string, after?: () => void, opts: TipOpts = {}) {
    tipAfter.current = after || null
    setTipOpts(opts)
    setTip(msg)
  }

  function closeTip() {
    const after = tipAfter.current
    tipAfter.current = null
    setTip('')
    setTipOpts({})
    if (after) after()
  }

  /** 双按钮弹窗的左按钮：只执行它自己的动作，不跑「关闭后回调」 */
  function closeTipCancel() {
    const go = tipOpts.cancel?.go
    tipAfter.current = null
    setTip('')
    setTipOpts({})
    if (go) go()
  }

  const session = useMemo(() => {
    if (!data) return null
    for (const sh of data.shows || []) {
      const hit = (sh.sessions || []).find((s: any) => s.id === sessionId)
      if (hit) return { ...hit, show: sh }
    }
    return null
  }, [data, sessionId])

  async function load() {
    try {
      setData(await frontApi.sessions(code))
    } catch (err: any) { /* ignore */ }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [code])

  // 登录态守卫：未登录回登录页；已报名则跳成功页，避免再填一份
  useEffect(() => {
    guardBeforeRegister(code).then((redirect) => {
      if (redirect) nav(redirect, { replace: true })
    })
  }, [code])

  // 恢复上次未提交的草稿（仅限当前登录员工号，换人不复用）
  // 注意：随行人数不在这里恢复 —— 草稿是按活动存的，而人数跟场次强相关，
  // 换场次后沿用旧值就会出现「上一场带不了 → 这一场默认 0」这种串场 bug，
  // 统一交给下面 initForSession 那段按 session_id 判断。
  useEffect(() => {
    const d = readDraft(code)
    if (d) {
      setPhone(d.phone || '')
      // 老草稿可能没有省市：没有就落回默认北京，有省市但没选市则留空让用户自己选
      const p = d.province || DEFAULT_PROVINCE
      setProvince(p)
      setCity(d.city || (d.province ? '' : DEFAULT_CITY))
      setCounty(d.county || '')
      setAddress(d.address || ''); setRecipient(d.recipient || '')
      setRecipientPhone(d.recipientPhone || '')
    }
  }, [code])

  // 结伴人数：后台「允许携带」且「上限 > 0」才展示该区块；上限取后端按剩余名额算好的 session.companion_max
  const companionEnabled = !!data?.activity?.companion_enabled
    && (data?.activity?.companion_max ?? 0) > 0
  const activityMax = Number(data?.activity?.companion_max ?? 0)
  // 场次实际可携上限：后端已按「活动上限 / 剩余名额 - 1」取小值，这里再夹一次防止异常数据
  const maxCompanions = session ? Math.max(0, Number(session.companion_max ?? 0)) : 0
  // 名额只够本人（或活动不允许带人）时整块隐藏，提交按 0 人处理
  const showCompanion = companionEnabled && maxCompanions > 0
  // 默认随行人数：后台活动配置，前台报名页选择器初始值；没有配置时退回 1
  const defaultCompanions = Math.min(
    Number(data?.activity?.companion_default ?? 1),
    activityMax > 0 ? activityMax : 1,
  )
  // 剩余名额卡住了活动上限 / 默认人数时，提示语改成「最多可携带 x 名家属」
  const companionLimited = showCompanion
    && (maxCompanions < activityMax || maxCompanions < defaultCompanions)
  const companionTip = companionLimited
    ? `本场次剩余名额不足，最多可携带${maxCompanions}名家属，累计${maxCompanions + 1}人。`
    : `至高可携${maxCompanions}名成人家属共同参与，累计${maxCompanions + 1}人。`

  // 随行人数初始化：每个场次只落一次。
  // 关键修复：草稿里的 companions 只对「同一场次」有效。之前按活动维度存草稿，
  // 从「带不了家属」的场次（人数被压成 0）切到名额充足的场次会继承 0；
  // 从「带不满」的场次切过去则继承上一场的可携上限。换场次一律回到后台默认人数。
  const initForSession = useRef<number | null>(null)

  useEffect(() => {
    if (!data) return
    // 浏览器标题统一用后台配置的活动名称
    setActivityTitle(data?.activity?.name)
    if (!session) return
    if (initForSession.current === session.id) return
    initForSession.current = session.id
    const d = readDraft(code)
    // 草稿属于当前场次才沿用，否则用后台默认值（再被本场次可携上限夹一次）
    const want = d && Number(d.session_id) === session.id ? Number(d.companions ?? 0) : defaultCompanions
    setCompanions(Math.max(0, Math.min(want, maxCompanions)))
  }, [data, session, maxCompanions, defaultCompanions, code])

  // 只做「向下收敛」：轮询时剩余名额变少（别人抢走了），把已选人数压到新上限；
  // 从不往上抬，否则会和上面的一次性初始化互相打，出现 0/1 来回跳。
  useEffect(() => {
    if (!session) return
    if (companions > maxCompanions) setCompanions(Math.max(0, maxCompanions))
  }, [session, maxCompanions, companions])

  // 随行区块被隐藏（名额不够 / 活动不允许）时人数一律归 0，
  // 避免旧草稿里的人数被带进提交，导致后端报「本活动不支持携带结伴人」
  useEffect(() => {
    if (!session) return
    if (!showCompanion && companions !== 0) setCompanions(0)
  }, [session, showCompanion, companions])

  // 进入报名页先按剩余名额判一次：
  // 名额为 0 → 红字提示 + 「重选场次」；名额不够带家属 → 红字提示 + 「重选场次 / 继续报名」两个选择；
  // 名额够本人但不够活动上限 / 默认人数 → 同上，让用户自己决定换场次还是就本人报名。
  const entered = useRef(false)
  useEffect(() => {
    if (!data || entered.current) return
    const goList = () => nav(`/a/${code}/list`, { replace: true })
    // 只能回剧目页的提示：红字 + 单按钮「重选场次」
    const backOnly = (text: string) => showTip(text, goList, { danger: true, okText: '重选场次' })
    if (!session) {
      if (!sessionId) return
      entered.current = true
      backOnly('该场次不存在或已下线，请重新选择场次。')
      return
    }
    entered.current = true
    const remaining = Math.max(0, Number(session.remaining ?? 0))
    if (session.status === 'full' || remaining <= 0) {
      backOnly('本场次已报满，请选择其他场次。')
      return
    }
    if (session.status !== 'open') {
      backOnly(session.status === 'not_started'
        ? '本场次报名尚未开始，请稍后再来。'
        : session.status === 'ended'
          ? '本场次报名已结束，请选择其他场次。'
          : '本场次暂未开放报名，请选择其他场次。')
      return
    }
    if (!companionEnabled) return
    const canCarry = Math.max(0, Math.min(activityMax, remaining - 1))
    // 带不了家属 / 带不满：客户经理要求给「重选场次 / 继续报名」两个选择，
    // 让用户自己决定是换个场次带家属，还是就本人（或少带人）报名。
    const chooseTip = (text: string) => showTip(text, undefined, {
      danger: true,
      okText: '继续报名',
      cancel: { text: '重选场次', go: goList },
    })
    if (canCarry <= 0) {
      chooseTip('本场次剩余名额不足，暂不可携带家属。如需携带家属，请返回选择别的场次。')
      return
    }
    if (canCarry < activityMax || canCarry < defaultCompanions) {
      // 不做任何去重：每次进入（含刷新）都按当前余量判一次并提示，避免出现「有时弹有时不弹」
      chooseTip(`本场次剩余名额不足，最多可携带${canCarry}名家属。你可选择重选场次或继续报名。`)
    }
  }, [data, session, sessionId, code, companionEnabled, activityMax, defaultCompanions])

  const cities = useMemo(() => citiesOf(province), [province])
  const counties = useMemo(() => countiesOf(province, city), [province, city])

  /* ---------- 实时校验（客户经理要求）----------
     1) 手机号类字段：用户还在输入（没离开输入框）就按格式判断，不合格时输入框右侧显示红字「请检查格式」；
     2) 必填项没填 / 格式不对 → 底部「确认，下一步」按钮置灰不可点，全部满足才恢复紫色。 */
  const phoneOk = PHONE_RE.test(phone)
  const phoneBad = phone.length > 0 && !phoneOk
  const recipientPhoneOk = PHONE_RE.test(recipientPhone)
  const recipientPhoneBad = recipientPhone.length > 0 && !recipientPhoneOk
  const addressOk = address.trim().length > 0
  const recipientOk = recipient.trim().length > 0
  const regionOk = !!province && !!city
  const quotaOk = !!session && session.status === 'open' && Number(session.remaining ?? 0) > 0
  const companionOk = !showCompanion || companions <= maxCompanions
  const canNext = quotaOk && phoneOk && regionOk && addressOk && recipientOk && recipientPhoneOk && companionOk

  function next() {
    if (!session) { showTip('场次信息加载中，请稍候'); return }
    // 名额复核：进页面后还在 5 秒轮询，提交前再判一次，避免名额被别人抢走后照样提交
    if (session.status === 'full' || (session.remaining ?? 0) <= 0) {
      showTip('本场次已报满，请选择其他场次。', () => nav(`/a/${code}/list`, { replace: true }), {
        danger: true,
        okText: '重选场次',
      })
      return
    }
    if (session.status !== 'open') { showTip('该场次当前不可报名'); return }
    if (!phoneOk) { showTip('请填写正确的联系电话'); return }
    if (!regionOk) { showTip('请选择省份与城市'); return }
    if (!addressOk) { showTip('请填写详细收件地址'); return }
    if (!recipientOk) { showTip('请填写收件人姓名'); return }
    if (!recipientPhoneOk) { showTip('请填写正确的收件人手机号'); return }
    // 随行人数复核：超过剩余名额可带的人数不允许进下一步
    if (showCompanion && companions > maxCompanions) {
      showTip(`本场次剩余名额不足，最多可携带${maxCompanions}名家属，请调整随行人数。`)
      return
    }

    localStorage.setItem(draftKey(code), JSON.stringify({
      employee_no: getEmp(code),
      session_id: session.id,
      phone,
      // 随行区块隐藏时一律按 0 人提交
      companions: showCompanion ? companions : 0,
      province, city, county,
      address, recipient, recipientPhone,
    }))
    nav(`/a/${code}/confirm`)
  }

  const banner = data?.activity?.page_header_image || '/images/banner.png'

  return (
    <div className="list1-page">
      <img className="banner-img" src={banner} alt={data?.activity?.name || ''} />

      <div className="step-bar step-bar-list">
        <img className="step-icon" src="/images/setph1.png" alt="步骤1" />
        <img className="step-next" src="/images/nexth.png" alt="" />
        <img className="step-icon" src="/images/setph2.png" alt="步骤2" />
        <img className="step-next" src="/images/next.png" alt="" />
        <img className="step-icon" src="/images/setp3.png" alt="步骤3" />
      </div>

      <div className="list-wrap">
        {session && (
          <div className="info-r">
            <div className="info-row">
              <span className="info-label">演出选择</span>
              <span className="info-value info-value-strong">{session.show?.name}</span>
            </div>
            <div className="info-row">
              <span className="info-label">演出场次时间</span>
              <span className="info-value info-value-strong">{formatShowTime(session.show_at)}</span>
            </div>
          </div>
        )}

        <h2 className="form-title">请填写具体报名信息</h2>

        <h3 className="form-subtitle">您的联系电话<em className="req">*</em></h3>
        <div className="form-field">
          <input
            className="form-input" type="tel" placeholder="联系电话"
            value={phone} onChange={(e) => setPhone(e.target.value)}
          />
          {phoneBad && <span className="field-err">请检查格式</span>}
        </div>

        {showCompanion && (
          <>
            <h3 className="form-subtitle">请填写您的随行人数</h3>
            <div className="people-card">
              <p className="people-tip">{companionTip}</p>
              <div className="people-row">
                <div className="people-label">
                  <strong>随行人数</strong>
                  <span>1.2m以下儿童谢绝入场，1.2m以上凭票入场。</span>
                </div>
                <div className="stepper">
                  <button
                    className="stepper-btn" type="button" disabled={companions <= 0}
                    onClick={() => setCompanions(companions - 1)}
                  >−</button>
                  <span className="stepper-num">{companions}</span>
                  <button
                    className="stepper-btn" type="button" disabled={companions >= maxCompanions}
                    onClick={() => setCompanions(companions + 1)}
                  >＋</button>
                </div>
              </div>
            </div>
          </>
        )}

        <h3 className="form-subtitle">票券邮寄方式<em className="req">*</em></h3>
        <div className="layui-form bio-form-box">
          <div className="layui-form-item" id="bioarea-wrap">
            <div className="layui-form-select">
              <select
                className="layui-input level-1-select" value={province}
                onChange={(e) => { setProvince(e.target.value); setCity(''); setCounty('') }}
              >
                <option value="">请选择省</option>
                {REGIONS.map((r) => <option key={r.province} value={r.province}>{r.province}</option>)}
              </select>
              <i className="layui-edge" />
            </div>
            <div className="layui-form-select">
              <select
                className="layui-input level-2-select" value={city} disabled={!province}
                onChange={(e) => { setCity(e.target.value); setCounty('') }}
              >
                <option value="">请选择市</option>
                {cities.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
              </select>
              <i className="layui-edge" />
            </div>
            <div className="layui-form-select">
              <select
                className="layui-input level-3-select" value={county} disabled={!city || counties.length === 0}
                onChange={(e) => setCounty(e.target.value)}
              >
                <option value="">请选择区</option>
                {counties.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <i className="layui-edge" />
            </div>
          </div>
        </div>
        <div className="form-field">
          <input
            className="form-input" type="text" placeholder="详细收件地址"
            style={address ? undefined : { paddingLeft: '0.46rem' }}
            value={address} onChange={(e) => setAddress(e.target.value)}
          />
          {!address && <em className="field-star">*</em>}
        </div>
        <div className="form-field form-field-gap">
          <input
            className="form-input" type="text" placeholder="收件人姓名"
            style={recipient ? undefined : { paddingLeft: '0.46rem' }}
            value={recipient} onChange={(e) => setRecipient(e.target.value)}
          />
          {!recipient && <em className="field-star">*</em>}
        </div>
        <div className="form-field form-field-gap">
          <input
            className="form-input" type="tel" placeholder="收件人手机号"
            style={recipientPhone ? undefined : { paddingLeft: '0.46rem' }}
            value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)}
          />
          {!recipientPhone && <em className="field-star">*</em>}
          {recipientPhoneBad && <span className="field-err">请检查格式</span>}
        </div>

      </div>

      <div className="btn-row">
        <button className="btn-prev" type="button" onClick={() => nav(`/a/${code}/list`)}>上一步</button>
        <button className="btn-next" type="button" onClick={next} disabled={!canNext}>确认，下一步</button>
      </div>

      <AlertModal
        tip={tip}
        onClose={closeTip}
        danger={!!tipOpts.danger}
        okText={tipOpts.okText}
        cancelText={tipOpts.cancel?.text}
        onCancel={tipOpts.cancel ? closeTipCancel : undefined}
      />
    </div>
  )
}
