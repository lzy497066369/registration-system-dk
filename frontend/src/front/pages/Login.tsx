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
  const [meta, setMeta] = useState<any>(null)

  useEffect(() => {
    frontApi.sessions(code)
      .then((d) => {
        setMeta(d.activity)
        // 浏览器标题用后台配置的活动名称
        setActivityTitle(d.activity?.name)
      })
      // 活动未开放 / 不存在 / 网络异常：弹层告知，不再静默吞掉
      .catch((err: any) => setTip(err?.message || '活动信息加载失败，请稍后重试'))
    setActivityTitle()
  }, [code])

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
  const titleImage = meta?.title_image || '/images/login-top.png'

  return (
    <div className="login-page" style={bg ? { backgroundImage: bg } : undefined}>
      {/* 活动标题块图（叠在底图上方，后台可配置） */}
      <img className="login-title" src={titleImage} alt={meta?.name || '活动报名'} />
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
