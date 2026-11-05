import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { App as AntdApp, Avatar, Breadcrumb, Dropdown, Layout, Menu, Space, Tag } from 'antd'
import {
  AppstoreOutlined,
  KeyOutlined,
  LogoutOutlined,
  MailOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons'
import { ActivityContext } from '../ActivityContext'
import { api, clearToken, getToken } from '../../api'

const { Sider, Header, Content } = Layout

const ADMIN_MENU = [
  { key: '/admin/activities', icon: <AppstoreOutlined />, label: '活动管理' },
  { key: '/admin/shows', icon: <SolutionOutlined />, label: '剧目管理' },
  { key: '/admin/sessions', icon: <PlayCircleOutlined />, label: '场次管理' },
  { key: '/admin/contacts', icon: <TeamOutlined />, label: '员工管理' },
  { key: '/admin/registrations', icon: <UserOutlined />, label: '报名管理' },
  { key: '/admin/emails', icon: <MailOutlined />, label: '邮件模板' },
  { key: '/admin/users', icon: <UsergroupAddOutlined />, label: '用户账号' },
]

// 只读账号只给这一个入口，别的页面既看不到、也进不去（后端接口同样会拦）
const VIEWER_MENU = [
  { key: '/admin/my-registrations', icon: <ProfileOutlined />, label: '报名情况' },
]

const CRUMB: Record<string, string> = {
  '/admin/activities': '活动管理',
  '/admin/shows': '剧目管理',
  '/admin/sessions': '场次管理',
  '/admin/contacts': '员工管理',
  '/admin/registrations': '报名管理',
  '/admin/emails': '邮件模板',
  '/admin/users': '用户账号',
  '/admin/my-registrations': '报名情况',
}

export default function MainLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  const [activities, setActivities] = useState<any[]>([])
  const [role, setRole] = useState<'admin' | 'viewer'>('admin')
  const [username, setUsername] = useState('')
  const [activityId, setActivityId] = useState<number | undefined>(() => {
    const v = localStorage.getItem('current_activity_id')
    return v ? Number(v) : undefined
  })

  useEffect(() => {
    if (!getToken()) { nav('/admin/login'); return }
    reload()
  }, [])

  /** 身份 + 可见活动：管理员仍取完整活动列表（活动管理页直接用它渲染表格），
   *  只读账号则用 my-scope 里绑定的那几个活动。 */
  async function reload() {
    try {
      const scope = await api('/api/admin/my-scope')
      const viewer = scope.role === 'viewer'
      const list = viewer ? (scope.activities || []) : await api('/api/admin/activities')
      setRole(viewer ? 'viewer' : 'admin')
      setUsername(scope.username || '')
      setActivities(list)
      setActivityId((cur) => {
        if (cur && list.some((a: any) => a.id === cur)) return cur
        const first = list[0]?.id
        if (first) localStorage.setItem('current_activity_id', String(first))
        return first
      })
    } catch (err: any) {
      if (err.message?.includes('登录')) nav('/admin/login')
    }
  }

  // 只读账号访问任何其他后台地址都拉回「报名情况」，避免手动敲 URL 越界
  useEffect(() => {
    if (role !== 'viewer') return
    if (loc.pathname !== '/admin/my-registrations') {
      nav('/admin/my-registrations', { replace: true })
    }
  }, [role, loc.pathname])

  function changeActivity(id?: number) {
    setActivityId(id)
    if (id) localStorage.setItem('current_activity_id', String(id))
  }

  const selected = useMemo(() => activities.find((a) => a.id === activityId), [activities, activityId])
  const isViewer = role === 'viewer'

  const userMenu = {
    items: [
      { key: 'password', icon: <KeyOutlined />, label: '修改密码' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') { clearToken(); nav('/admin/login') }
    },
  }

  return (
    <AntdApp>
    <ActivityContext.Provider value={{ activities, activityId, setActivityId: changeActivity, reloadActivities: reload }}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider theme="dark" width={200}>
          <div style={{ color: '#fff', padding: '18px 20px', fontWeight: 600, fontSize: 15, letterSpacing: 1 }}>
            活动报名系统
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[loc.pathname]}
            items={isViewer ? VIEWER_MENU : ADMIN_MENU}
            onClick={({ key }) => nav(key)}
          />
        </Sider>
        <Layout>
          <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
            <Breadcrumb items={[{ title: '首页' }, { title: CRUMB[loc.pathname] || '后台' }]} />
            <Space size={8}>
              {selected && (
                <span style={{ color: '#8a99a8', fontSize: 12 }}>当前活动：{selected.name}</span>
              )}
              <Dropdown menu={userMenu}>
                <Space style={{ cursor: 'pointer' }}>
                  <Avatar size={30} icon={<UserOutlined />} style={{ background: '#1a5a9e' }} />
                  <span>{username || '管理员'}</span>
                  {isViewer && <Tag color="blue" style={{ marginInlineEnd: 0 }}>只读</Tag>}
                </Space>
              </Dropdown>
            </Space>
          </Header>
          <Content style={{ padding: 20, background: '#f0f2f5', fontSize: 13 }}>
            {/* 只读账号越界时先不渲染子页面，避免打一串 403 请求再跳回来 */}
            {isViewer && loc.pathname !== '/admin/my-registrations' ? null : <Outlet />}
          </Content>
        </Layout>
      </Layout>
    </ActivityContext.Provider>
    </AntdApp>
  )
}
