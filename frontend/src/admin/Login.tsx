import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Form, Input, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { api, setRole, setToken } from '../api'

export default function Login() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  async function submit(values: { username: string; password: string }) {
    setLoading(true)
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      setToken(data.token)
      setRole(data.role || 'admin')
      messageApi.success('登录成功')
      // 只读账号只有「报名情况」一个页面，直接送过去
      nav(data.role === 'viewer' ? '/admin/my-registrations' : '/admin/activities')
    } catch (err: any) {
      messageApi.error(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #1a5a9e 0%, #0f3d6e 100%)',
    }}>
      {contextHolder}
      <div style={{ width: 380, background: '#fff', borderRadius: 10, padding: '36px 32px', boxShadow: '0 8px 30px rgba(0,0,0,.25)' }}>
        <h2 style={{ textAlign: 'center', color: '#0f3d6e', marginBottom: 4 }}>活动报名系统</h2>
        <p style={{ textAlign: 'center', color: '#8a99a8', fontSize: 13, marginBottom: 24 }}>
          2026 SAP 北分工会冬季家庭主题活动 · 后台管理
        </p>
        <Form onFinish={submit} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>登 录</Button>
        </Form>
      </div>
    </div>
  )
}
