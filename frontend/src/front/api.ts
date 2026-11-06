/** 前台接口封装（按活动编码区分登录态） */
const key = (code: string) => `front_token_${code}`

export function getToken(code: string): string | null {
  return localStorage.getItem(key(code))
}

export function setToken(code: string, token: string) {
  localStorage.setItem(key(code), token)
}

export function clearToken(code: string) {
  localStorage.removeItem(key(code))
}

/** 当前登录员工号：判断「是否已报名」「草稿归属」都只认它 */
export function getEmp(code: string): string {
  return localStorage.getItem(`front_emp_${code}`) || ''
}

export function setEmp(code: string, employeeNo: string) {
  localStorage.setItem(`front_emp_${code}`, employeeNo)
}

export function clearEmp(code: string) {
  localStorage.removeItem(`front_emp_${code}`)
}

export const draftKey = (code: string) => `front_draft_${code}`

/** 读取未提交草稿：员工号与当前登录人不一致则视为无效草稿（换人登录不串资料） */
export function readDraft(code: string): any | null {
  const raw = localStorage.getItem(draftKey(code))
  if (!raw) return null
  try {
    const d = JSON.parse(raw)
    const emp = getEmp(code)
    if (d.employee_no && emp && d.employee_no !== emp) {
      localStorage.removeItem(draftKey(code))
      return null
    }
    return d
  } catch {
    localStorage.removeItem(draftKey(code))
    return null
  }
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(typeof data.detail === 'string' ? data.detail : '请求失败')
  }
  return res.json()
}

export const frontApi = {
  sessions: (code: string) => request(`/api/a/${code}/sessions`),
  /** 演出介绍正文按需加载：正文里是原图 base64，不放进 5 秒轮询的 sessions 接口 */
  showIntro: (code: string, showId: number) => request(`/api/a/${code}/shows/${showId}/intro`),
  login: (code: string, employee_no: string, email: string) =>
    request(`/api/a/${code}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ employee_no, email }),
    }),
  my: (code: string, token: string) =>
    request(`/api/a/${code}/my`, { headers: { Authorization: `Bearer ${token}` } }),
  register: (code: string, token: string, payload: any) =>
    request(`/api/a/${code}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),
}

/**
 * 前台统一守卫：校验当前登录态并读取报名状态。
 * 后台把报名取消/删除后，该员工 `/my` 返回 has_registration=false。
 * 返回：
 *   - { redirect: '/a/xxx/login' }  —— 未登录 / token 失效，需回登录页重来
 *   - { redirect: '/a/xxx/success' } —— 已登录且已有有效报名单（Form/Confirm 用）
 *   - { has_registration: boolean }  —— 已登录，正常（Success 用它取报名单）
 * 无论哪种跳转，都会顺带清理本地脏状态，避免页面用旧缓存继续渲染。
 */
export async function checkRegistration(code: string): Promise<{
  redirect?: string
  has_registration?: boolean
}> {
  const token = getToken(code)
  if (!token) {
    clearToken(code)
    clearEmp(code)
    localStorage.removeItem(draftKey(code))
    return { redirect: '/a/' + code + '/login' }
  }
  try {
    const d = await frontApi.my(code, token)
    return { has_registration: !!d?.has_registration }
  } catch {
    // token 失效或网络异常：清掉脏状态，回登录页
    clearToken(code)
    clearEmp(code)
    localStorage.removeItem(draftKey(code))
    return { redirect: '/a/' + code + '/login' }
  }
}

/** 报名流程页（Form / Confirm）守卫：未登录回 login，已报名跳 success */
export async function guardBeforeRegister(code: string): Promise<string | null> {
  const r = await checkRegistration(code)
  if (r.redirect) return r.redirect
  if (r.has_registration) return '/a/' + code + '/success'
  return null
}

/** 成功页守卫：未登录回 login，已报名返回 null（正常显示） */
export async function guardHasRegistration(code: string): Promise<string | null> {
  const r = await checkRegistration(code)
  if (r.redirect) return r.redirect
  if (r.has_registration) return null
  // 已登录但无有效报名单（被取消/删除）：清状态回登录页
  clearToken(code)
  clearEmp(code)
  localStorage.removeItem(draftKey(code))
  return '/a/' + code + '/login'
}

/** 2026-12-04 周五 19:30 */
export function formatShowTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${week} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 详细地址展示：后台填的详细地址前后没有括号时，前台自动补一对全角括号；
 * 已经带括号（全角/半角）则原样输出，避免出现两层括号。
 * 只在需要「场馆名 +（详细地址）」排版的页面使用；其它地方一律原样显示。
 */
export function wrapAddress(address?: string): string {
  const raw = (address || '').trim()
  if (!raw) return ''
  return /^[（(][\s\S]*[）)]$/.test(raw) ? raw : `（${raw}）`
}

/**
 * 详细地址纯文本：剥掉外层括号（全角/半角）与「具体地址：」前缀。
 * 用于「演出地点 / 详细地址」两行展示，避免和前缀重复。
 */
export function cleanAddress(address?: string): string {
  return (address || '')
    .replace(/^[（(]\s*/, '')
    .replace(/\s*[）)]$/, '')
    .replace(/^具体地址[:：]\s*/, '')
    .trim()
}

/**
 * 省 / 市 / 区 + 详细地址拼接展示：相邻重复的地名只显示一次。
 * 例如 省=北京市、市=北京市、区=顺义区 → 「北京市顺义区」，不再出现「北京市北京市顺义区」。
 */
export function joinRegion(...parts: (string | undefined | null)[]): string {
  const out: string[] = []
  for (const p of parts) {
    const t = (p || '').trim()
    if (!t) continue
    const last = out[out.length - 1]
    if (last && (last === t || last.endsWith(t))) continue
    out.push(t)
  }
  return out.join('')
}

/**
 * 观演地址整串：北京音乐厅（具体地址：北京市西城区北新华街1号）
 * 详细地址自带的括号 / 「具体地址：」前缀会先剥掉再统一拼，避免出现两层括号。
 */
export function formatVenue(location?: string, address?: string): string {
  const name = (location || '').replace(/[（(]\s*具体地址[:：][^）)]*[）)]/g, '').trim()
  const addr = cleanAddress(address)
  if (!name && !addr) return '待定'
  if (!addr) return name
  if (!name) return addr
  return `${name}（具体地址：${addr}）`
}

/**
 * 浏览器标签标题统一用后台配置的活动名称。
 * 五个前台页面（登录 / 剧目 / 报名 / 确认 / 成功）每次都把拿到的活动名塞进来，
 * 取不到（还没加载完或活动不存在）时退回「活动报名」。
 */
export function setActivityTitle(name?: string) {
  const t = (name || '').trim()
  document.title = t || '活动报名'
}
