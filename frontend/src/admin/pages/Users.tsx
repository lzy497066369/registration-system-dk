import { useEffect, useState } from 'react'
import {
  App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../../api'
import { useActivity } from '../ActivityContext'

/** 用户账号管理：只读账号 + 绑定活动。账号登录后只看得到「报名情况」一个页面。 */
export default function Users() {
  const { activities } = useActivity()
  const { message: msg } = App.useApp()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      setRows(await api('/api/admin/users'))
    } catch (err: any) {
      msg.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ activity_ids: [] })
    setOpen(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    form.resetFields()
    form.setFieldsValue({ username: row.username, activity_ids: row.activity_ids })
    setOpen(true)
  }

  async function submit() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await api(`/api/admin/users/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            password: values.password || null,
            activity_ids: values.activity_ids,
          }),
        })
        msg.success('已保存')
      } else {
        await api('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            username: values.username,
            password: values.password,
            activity_ids: values.activity_ids,
          }),
        })
        msg.success('账号已创建')
      }
      setOpen(false)
      load()
    } catch (err: any) {
      msg.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: any) {
    try {
      await api(`/api/admin/users/${row.id}`, { method: 'DELETE' })
      msg.success('已删除')
      load()
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  const columns: any[] = [
    { title: '用户名', dataIndex: 'username', width: 160 },
    {
      title: '角色', dataIndex: 'role', width: 110,
      render: () => <Tag color="blue">只读账号</Tag>,
    },
    {
      title: '可查看的活动', dataIndex: 'activity_names',
      render: (names: string[]) => (
        <Space size={[4, 4]} wrap>
          {(names || []).map((n, i) => <Tag key={i}>{n || '(活动已删除)'}</Tag>)}
        </Space>
      ),
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 160,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作', width: 150, render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm
            title="删除该账号？"
            description="删除后该账号立即无法登录，已产生的数据不受影响。"
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            onConfirm={() => remove(r)}
          >
            <Button type="link" size="small" danger style={{ padding: 0 }}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const activityOptions = activities.map((a) => ({ value: a.id, label: a.name }))

  return (
    <Card
      title="用户账号"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建账号</Button>
        </Space>
      }
    >
      <div style={{ color: '#8a99a8', fontSize: 12, marginBottom: 12 }}>
        这类账号只用于查看报名情况：登录后只有「报名情况」一个菜单，可以看到所绑定活动的全部报名明细并导出，不能做任何修改。
      </div>
      <Table rowKey="id" dataSource={rows} columns={columns} size="middle" loading={loading} pagination={false} />

      <Modal
        title={editing ? `编辑账号：${editing.username}` : '新建账号'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: '3-32 位字母、数字、下划线、点或连字符' },
            ]}
          >
            <Input placeholder="如 viewer01" disabled={!!editing} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '重置密码（留空则不修改）' : '密码'}
            rules={editing
              ? [{ min: 8, message: '密码至少 8 位' }]
              : [{ required: true, message: '请输入密码' }, { min: 8, message: '密码至少 8 位' }]}
          >
            <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="activity_ids"
            label="可查看的活动（可多选）"
            rules={[{ required: true, message: '请至少选择一个活动' }]}
          >
            <Select
              mode="multiple" showSearch optionFilterProp="label"
              placeholder="选择该账号能看到的活动"
              options={activityOptions}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
