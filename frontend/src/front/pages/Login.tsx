import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { frontApi, setToken, setEmp, draftKey, setActivityTitle } from '../api'
import AlertModal from '../AlertModal'
import '../front.css'

export default function FrontLogin() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const [employeeNo, setEmployeeNo] = useState('')
  const [email, setEmail] = useState('')
  // 所有提示统一走弹层（提示为空 = 不显示）
  const [tip, setTip] = useState('')
  const [loading, setLoading] = useState(false)
  // undefined = 接口还没回来（标题图先不画）；null = 加载失败
  const [meta, setMeta] = useState<any>(undefined)
  // 标题块图：确定用哪张 + 预加载完成后才挂进页面
  const [title, setTitle] = useState<{ src: string; ratio: string } | null>(null)

  useEffect(() => {
    let alive = true
    setMeta(undefined)
    setTitle(null)
    frontApi.sessions(code)
      .then((d) => {
        if (!alive) return
        setMeta(d.activity)
        // 浏览器标题用后台配置的活动名称
        setActivityTitle(d.activity?.name)
      })
      // 活动未开放 / 不存在 / 网络异常：弹层告知，不再静默吞掉
      .catch((err: any) => {
        if (!alive) return
        setMeta(null)
        setTip(err?.message || '活动信息加载失败，请稍后重试')
      })
    setActivityTitle()
    return () => {
      alive = false
    }
  }, [code])

  /*
    标题块图为什么不在 render 里直接 <img src>：
    以前是先渲染兜底图 /images/login-top.png（739×525），接口回来再换成活动配置图，
    两张图比例不一样（配置图 739×659），框高写死在 739/525 时 contain 会把真图缩到 80% 宽，
    换图那一瞬间整块图「缩一圈」——就是肉眼看到的「先大后小」，而且取决于接口/图片缓存，
    所以时有时无。现在改成：先确定用哪张图 → 预加载解码完 → 一次性挂上去，中间只留透明占位。
  */
  useEffect(() => {
    if (meta === undefined) return
    const src: string = meta?.title_image || '/images/login-top.png'
    let alive = true
    const settle = (ratio: string) => {
      if (!alive) return
      setTitle({ src, ratio })
      // 通知启动遮罩可以撤了（见 src/main.tsx：登录页等标题图就绪再撤，避免看到中间态）
      window.dispatchEvent(new Event('front-ready'))
    }
    const img = new Image()
    img.onload = () =>
      settle(img.naturalWidth && img.naturalHeight ? `${img.naturalWidth} / ${img.naturalHeight}` : '739 / 525')
    img.onerror = () => settle('739 / 525')
    img.src = src
    return () => {
      alive = false
    }
  }, [meta])

  async function submit() {
    if (!employeeNo.trim()) { setTip('请输入员工号'); return }
    if (!email.trim()) { setTip('请输入邮箱'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setTip('请输入正确的邮箱地址'); return }
    setLoading(true)
    try {
      const data = await frontApi.login(code, employeeNo.trim(), email.trim())
      setToken(code, data.token)
      setEmp(code, data.employee_no)
      // 换人登录时清掉旧草稿，避免带出上一个员工的电话/邮寄信息
      localStorage.removeItem(draftKey(code))
      if (data.has_registration) nav(`/a/${code}/success`)
      else nav(`/a/${code}/list`)
    } catch (err: any) {
      setTip(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const bg = meta?.home_bg_image ? `url(${meta.home_bg_image})` : undefined

  return (
    <div className="login-page" style={bg ? { backgroundImage: bg } : undefined}>
      {/* 活动标题块图（叠在底图上方，后台可配置）：比例取自图片自身尺寸，加载完才显示 */}
      {title ? (
        <img
          className="login-title"
          src={title.src}
          style={{ aspectRatio: title.ratio }}
          alt={meta?.name || '活动报名'}
        />
      ) : (
        <div className="login-title login-title-hold" />
      )}
      <div className="login-card">
        <h2 className="login-tip">员工登录</h2>
        <div className="input-row">
          <img className="input-icon icon-user" src="/images/login-icon1.png" alt="" />
          <input
            type="text"
            placeholder="请输入7位员工号（i+6位数字）"
            value={employeeNo}
            onChange={(e) => setEmployeeNo(e.target.value)}
          />
        </div>
        <div className="input-row">
          <img className="input-icon icon-mail" src="/images/login-icon2.png" alt="" />
          <input
            type="text"
            placeholder="请输入邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="login-btn" type="button" onClick={submit} disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </div>
      <AlertModal tip={tip} onClose={() => setTip('')} />
    </div>
  )
}
