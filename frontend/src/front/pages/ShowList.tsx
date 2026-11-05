import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatShowTime, frontApi, setActivityTitle, wrapAddress } from '../api'
import AlertModal from '../AlertModal'
import '../front.css'

const STATUS_TEXT: Record<string, string> = {
  not_started: '报名未开始',
  closed: '暂未开放',
  full: '已报满',
  ended: '报名已结束',
  open: '',
}

/**
 * 选择剧目页：DOM 结构与类名完全照搬设计稿 html/list.html，
 * 仅把静态文案替换为后台配置的数据（剧目名、地点地址、封面图、场次）。
 */
export default function ShowList() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<any>(null)
  const [intro, setIntro] = useState<any>(null)
  const [introHtml, setIntroHtml] = useState('')
  const [introLoading, setIntroLoading] = useState(false)
  const introSeq = useRef(0)
  const [tip, setTip] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // 轮询每 5 秒一次，加载失败只弹一次，别一直糊用户一脸
  const errShown = useRef(false)

  async function load() {
    try {
      setData(await frontApi.sessions(code))
      errShown.current = false
    } catch (err: any) {
      // 活动未开放 / 不存在 / 网络异常
      if (!errShown.current) {
        errShown.current = true
        setTip(err?.message || '活动信息加载失败，请稍后重试')
      }
    }
  }

  // 余量 5 秒轮询（页面不可见时暂停）
  useEffect(() => {
    load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [code])

  // 每次打开演出介绍，滚动位置回到顶部
  useEffect(() => {
    if (!intro) return
    if (dialogRef.current) dialogRef.current.scrollTop = 0
    if (overlayRef.current) overlayRef.current.scrollTop = 0
  }, [intro])

  /** 演出介绍正文按需拉取：轮询接口只带 has_intro。
   *  正文里是原图 base64（单张可达 20MB），塞进 5 秒轮询会把首屏拖死。 */
  async function openIntro(show: any) {
    const seq = introSeq.current + 1
    introSeq.current = seq
    setIntro(show)
    setIntroHtml('')
    setIntroLoading(true)
    try {
      const d = await frontApi.showIntro(code, show.id)
      if (seq === introSeq.current) setIntroHtml(d?.intro_html || '')
    } catch (err: any) {
      if (seq === introSeq.current) setTip(err?.message || '演出介绍加载失败，请稍后重试')
    } finally {
      if (seq === introSeq.current) setIntroLoading(false)
    }
  }

  useEffect(() => {
    setActivityTitle(data?.activity?.name)
  }, [data])


  const banner = data?.activity?.page_header_image || '/images/banner.png'
  // 前台展示顺序（只影响本页，不改后台排序字段）：
  // 1) 场次级：还能报名的场次上提，满额 / 已结束 / 未开放的场次下沉；
  // 2) 剧目级：只要还有一个可报名场次就上提，全部不可报名的剧目下沉。
  // 同组内保持后台设置的 sort 顺序（Array.sort 稳定），__idx 记住原始下标，用于兜底封面图不跳。
  const shows = useMemo(() => {
    const hasOpen = (s: any) => (s.sessions || []).some((x: any) => x.status === 'open')
    return (data?.shows || [])
      .map((show: any, idx: number) => ({
        ...show,
        __idx: idx,
        sessions: [...(show.sessions || [])].sort(
          (a: any, b: any) => Number(b.status === 'open') - Number(a.status === 'open'),
        ),
      }))
      .sort((a: any, b: any) => Number(hasOpen(b)) - Number(hasOpen(a)))
  }, [data])

  return (
    <div className="list-page">
      {/* banner */}
      <img className="banner-img" src={banner} alt={data?.activity?.name || ''} />

      {/* step 步骤条 */}
      <div className="step-bar step-bar-list">
        <img className="step-icon" src="/images/setph1.png" alt="步骤1" />
        <img className="step-next" src="/images/next.png" alt="" />
        <img className="step-icon" src="/images/setp2.png" alt="步骤2" />
        <img className="step-next" src="/images/next.png" alt="" />
        <img className="step-icon" src="/images/setp3.png" alt="步骤3" />
      </div>

      <h2 className="list-title">请选择您想报名的剧目</h2>

      {/* 剧目卡片 */}
      {shows.map((show: any, idx: number) => {
        const allFull = (show.sessions || []).every((s: any) => s.status !== 'open')
        // 兜底封面图按「原始下标」取，避免满额排序后卡片底图跟着换
        const cover = show.cover_image || `/images/list-item${((show.__idx ?? idx) % 2) + 1}.png`
        return (
          <div
            className="show-card"
            key={show.id}
            style={{
              background: `url(${cover}) no-repeat center center`,
              backgroundSize: 'cover',
            }}
          >
            {allFull && <div className="card-ribbon">已报满</div>}
            <h3 className="show-name">{show.name}</h3>
            <p className="show-addr">
              地点：{show.location || '待定'}
              <br />{show.address ? wrapAddress(show.address) : '待定'}
            </p>
            {/* 封面图展示区：高度收窄（原 2em），让一屏能露出第二个剧目 */}
            <div className="show-photo-gap" />
            <button className="show-intro" type="button" onClick={() => openIntro(show)}>
              点此查看演出介绍
            </button>
            <div className="show-cardb">
              <p className="show-label">选择场次</p>
              {(show.sessions || []).map((s: any) => {
                const disabled = s.status !== 'open'
                return (
                  <button
                    key={s.id}
                    className={`show-session ${disabled ? 'show-session-full' : ''}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => nav(`/a/${code}/form?session_id=${s.id}`)}
                  >
                    {s.name}：{formatShowTime(s.show_at)}
                    {disabled ? ` （${STATUS_TEXT[s.status] || '不可报名'}）` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 演出介绍弹层：全屏铺满，右上角常驻 ✕，长图可上下滚动看完 */}
      <div
        ref={overlayRef}
        className={`intro-modal ${intro ? 'intro-modal-open' : ''}`}
        onClick={() => setIntro(null)}
      >
        <div className="intro-dialog" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
          <h4 className="intro-title">{intro?.name || ''}</h4>
          <p className="intro-addr">地点：{intro?.location}{intro?.address ? wrapAddress(intro.address) : ''}</p>
          {introLoading ? (
            <p className="intro-body">正在加载演出介绍…</p>
          ) : (
            <p className="intro-body" dangerouslySetInnerHTML={{ __html: introHtml }} />
          )}
        </div>
        {intro && (
          <button
            className="intro-close" type="button" aria-label="关闭演出介绍"
            onClick={(e) => { e.stopPropagation(); setIntro(null) }}
          >
            ✕
          </button>
        )}
      </div>

      <AlertModal tip={tip} onClose={() => setTip('')} />
    </div>
  )
}
