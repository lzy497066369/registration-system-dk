import { useEffect, useLayoutEffect } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { frontApi, getToken } from './api'

/**
 * 前台布局：
 * 1) 进入时给 <html> 加 front-mode，使 front.css 里的 html/body 全局规则（rem 基准、620px 宽度）
 *    只在前台生效，离开前台即移除，后台界面恢复正常样式；
 * 2) 填信息页（/form）额外加 front-layui，等价还原原稿 list1.html 引入的 layui 全局样式
 *    （body 14px + Helvetica Neue + 表单控件继承字体），使该页字号行高与原稿完全一致。
 */
export default function FrontLayout() {
  const loc = useLocation()
  const nav = useNavigate()
  const { code = '' } = useParams()

  // 用 useLayoutEffect 而不是 useEffect：前者在浏览器绘制前同步执行，
  // 保证「挂类」和「首帧渲染」发生在同一帧，不会出现先按 16px 基准画一遍、
  // 再整体放大到 calc(100vw/6.2) 的跳动。
  useLayoutEffect(() => {
    document.documentElement.classList.add('front-mode')
    return () => document.documentElement.classList.remove('front-mode')
  }, [])

  // 同上：填信息页的 layui 字号基准也必须在绘制前挂上，否则会闪一下 14px/16px 的错版
  useLayoutEffect(() => {
    const html = document.documentElement
    const isForm = /\/form(\?|$)/.test(loc.pathname + loc.search)
    if (isForm) html.classList.add('front-layui')
    else html.classList.remove('front-layui')
    return () => html.classList.remove('front-layui')
  }, [loc.pathname, loc.search])

  // 是否已报名只认「登录员工号」：进入选剧目/填信息/核对前向后端查一次，
  // 已报名就直接跳到成功页，避免刷新或直接改地址绕过登录时的分流。
  useEffect(() => {
    const path = loc.pathname
    if (/\/login$/.test(path) || /\/success$/.test(path)) return
    const token = getToken(code)
    if (!token) return
    let alive = true
    frontApi.my(code, token)
      .then((d) => {
        if (alive && d.has_registration) nav(`/a/${code}/success`, { replace: true })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [loc.pathname, code])

  return <Outlet />
}
