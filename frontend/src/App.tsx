import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { getRole } from './api'
import AdminLayout from './admin/layout/MainLayout'
import Activities from './admin/pages/Activities'
import Contacts from './admin/pages/Contacts'
import Emails from './admin/pages/Emails'
import MyRegistrations from './admin/pages/MyRegistrations'
import Users from './admin/pages/Users'
import FrontConfirm from './front/pages/Confirm'
import FrontLayout from './front/FrontLayout'
import FrontLogin from './front/pages/Login'
import FrontRegisterForm from './front/pages/RegisterForm'
import FrontShowList from './front/pages/ShowList'
import FrontSuccess from './front/pages/Success'
import Login from './admin/Login'
import Placeholder from './admin/pages/Placeholder'
import Registrations from './admin/pages/Registrations'
import Sessions from './admin/pages/Sessions'
import Shows from './admin/pages/Shows'

function HomePlaceholder() {
  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: 'linear-gradient(160deg, #1a5a9e 0%, #0f3d6e 100%)',
        color: '#fff', fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>2026 SAP 北分工会冬季家庭主题活动</h1>
      <p style={{ fontSize: 16, opacity: 0.85 }}>活动报名系统 · 前台入口 /a/活动编码/login</p>
    </div>
  )
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1a5a9e', fontSize: 13 } }}>
      <BrowserRouter>
        <Routes>
          {/* 前台 H5：不放在 antd 的 <App> 容器里 —— 它会设置 font-size:14px，
              导致 em 基准变化、整页尺寸与设计稿不一致 */}
          <Route path="/a/:code" element={<FrontLayout />}>
            {/* 只带活动编码时默认落到登录页，二维码/短链可以直接用 /a/xxx */}
            <Route index element={<Navigate to="login" replace />} />
            <Route path="login" element={<FrontLogin />} />
            <Route path="list" element={<FrontShowList />} />
            <Route path="form" element={<FrontRegisterForm />} />
            <Route path="confirm" element={<FrontConfirm />} />
            <Route path="success" element={<FrontSuccess />} />
          </Route>

          {/* 后台管理 */}
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={
              <Navigate to={getRole() === 'viewer' ? '/admin/my-registrations' : '/admin/activities'} replace />
            } />
            <Route path="activities" element={<Activities />} />
            <Route path="shows" element={<Shows />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="registrations" element={<Registrations />} />
            <Route path="emails" element={<Emails />} />
            <Route path="users" element={<Users />} />
            <Route path="my-registrations" element={<MyRegistrations />} />
          </Route>

          <Route path="/" element={<HomePlaceholder />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
