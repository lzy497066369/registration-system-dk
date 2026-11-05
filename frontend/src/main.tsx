import { createRoot } from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'

// antd 的日期面板月份/星期取自 dayjs 语言包，不设置会显示 Oct / Su Mo Tu
dayjs.locale('zh-cn')

// 不启用 StrictMode：react-quill 依赖 findDOMNode，在 StrictMode 下会告警
createRoot(document.getElementById('root')!).render(<App />)

/** 撤掉 index.html 里的启动遮罩（首屏防闪，说明见 index.html）。 */
function dismissSplash() {
  const el = document.getElementById('boot-splash')
  if (!el) return
  el.classList.add('is-hidden')
  // 等淡出动画（0.26s）跑完再摘掉，避免这个全屏层继续盖着页面
  window.setTimeout(() => el.remove(), 320)
}

/**
 * 等页面所有资源加载完（window.load）再撤遮罩。
 *
 * 为什么不是「React 画完就撤」：慢网下 CSS 和图片比 JS 后到，
 * 那时页面会用未套样式的方式先画一遍——标题图按原始 739px 撑开、背景图 cover
 * 跟着放大，等样式生效再缩回去，肉眼就是「画面先大后小」地跳一下。
 * load 事件要等 CSS 和所有图片（含背景大图）都就绪，正好盖住这段中间态。
 */
function dismissWhenLoaded() {
  /*
    登录页（/a/<活动编码>）额外等一个条件：标题块图预加载完。
    标题图要在接口回来后才知道用哪张（活动配置图 / 兜底图），只等 window.load 会先露出
    「没有标题图的半成品」，等图到了登录卡片再往下跳一下。Login.tsx 预加载完会派发 front-ready。
    其它页面（后台、剧目列表等）行为不变。
  */
  const gated = /^\/a\/[^/]+\/?$/.test(location.pathname)
  let loadDone = false
  let frontDone = !gated
  const finish = () => {
    if (loadDone && frontDone) dismissSplash()
  }
  if (gated) {
    window.addEventListener('front-ready', () => { frontDone = true; finish() }, { once: true })
  }
  const markLoad = () => { loadDone = true; finish() }
  if (document.readyState === 'complete') {
    // 已经 load 完了（缓存命中时很快），再等一帧确保这一帧已经画出来
    requestAnimationFrame(() => requestAnimationFrame(markLoad))
  } else {
    window.addEventListener('load', markLoad, { once: true })
  }
  // 兜底：接口慢、图片卡住或 404 时不能一直转圈
  window.setTimeout(() => { loadDone = true; frontDone = true; finish() }, 3000)
}

requestAnimationFrame(() => {
  requestAnimationFrame(dismissWhenLoaded)
})

// 最终保险：无论如何 6 秒后撤掉遮罩
window.setTimeout(dismissSplash, 6000)
