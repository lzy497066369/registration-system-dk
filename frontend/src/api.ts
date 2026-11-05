const TOKEN_KEY = 'admin_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  // 角色跟着登录态走，退出/过期时一起清掉，避免下次判断用旧身份
  localStorage.removeItem('admin_role')
}

/** 登录时记住的角色：viewer=只读账号（只给「报名情况」） */
export function setRole(role: string) {
  localStorage.setItem('admin_role', role)
}

export function getRole(): string {
  return localStorage.getItem('admin_role') || 'admin'
}

export async function api(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  if (res.status === 401) {
    clearToken()
    location.href = '/admin/login'
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok) {
    // 后端正常错误是 JSON；500 未捕获异常时 FastAPI 返回纯文本，需单独提示状态码
    const text = await res.text().catch(() => '')
    let data: any = null
    try { data = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    const detail = data?.detail
    const msg = detail === undefined || detail === null
      ? `请求失败（HTTP ${res.status}${text && text.length < 120 ? `：${text.trim()}` : ''}）`
      : (typeof detail === 'string'
        ? detail
        : (typeof detail === 'object' && 'message' in detail
          ? String((detail as any).message)
          : JSON.stringify(detail)))
    // 保留结构化明细（如模板里写错的变量名），供调用方精确定位
    const err: any = new Error(msg)
    err.detail = detail
    throw err
  }
  return res.json()
}

export async function uploadApi(path: string, file: File, params: Record<string, string> = {}): Promise<any> {
  const token = getToken()
  const query = new URLSearchParams(params).toString()
  const res = await fetch(`${path}${query ? '?' + query : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: (() => { const fd = new FormData(); fd.append('file', file); return fd })(),
  })
  if (!res.ok) {
    // 后端返回 JSON 错误体；网关（如 nginx 413）返回的是 HTML，需要分别提示
    const text = await res.text()
    let message = `上传失败（HTTP ${res.status}）`
    try {
      const data = JSON.parse(text)
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) message = data.detail[0].msg
    } catch {
      // 413 是 nginx 拦下的（后端会返回自己的 JSON 错误）；封面图 10MB、正文插图 20MB
      if (res.status === 413) message = '图片过大，被网关拦下了，请换一张小一些的图片'
    }
    throw new Error(message)
  }
  return res.json()
}

export async function downloadApi(path: string, filename: string) {
  const token = getToken()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
