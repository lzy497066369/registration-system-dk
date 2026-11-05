import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select,
  Space, Switch, Table, Tag, Upload, message,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, uploadApi } from '../../api'
import { useActivity } from '../ActivityContext'
import ImageField from '../components/ImageField'
import RichTextEditor from '../components/RichTextEditor'

const STATUS: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '报名中', color: 'blue' },
  ended: { text: '已结束', color: 'red' },
}

export default function Activities() {
  const { activities, reloadActivities } = useActivity()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()
  const { message: msg } = App.useApp()
  const companionEnabled = Form.useWatch('companion_enabled', form)
  const companionMax = Form.useWatch('companion_max', form)

  // 筛选条件
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>('')
  const [startRange, setStartRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [companionFilter, setCompanionFilter] = useState<string>('')

  useEffect(() => { reloadActivities() }, [])

  const filtered = useMemo(() => {
    return activities.filter((a: any) => {
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const hit = [a.name, a.code, a.company_name].some((v: string) => (v || '').toLowerCase().includes(kw))
        if (!hit) return false
      }
      if (status && a.status !== status) return false
      if (companionFilter === 'yes' && !a.companion_enabled) return false
      if (companionFilter === 'no' && a.companion_enabled) return false
      if (startRange) {
        if (!a.signup_start_at) return false
        const t = dayjs(a.signup_start_at)
        if (t.isBefore(startRange[0], 'day') || t.isAfter(startRange[1], 'day')) return false
      }
      return true
    })
  }, [activities, keyword, status, companionFilter, startRange])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ companion_enabled: true, companion_max: 2, companion_default: 1, remind_hours_before: 24 })
    setOpen(true)
  }

  async function openEdit(row: any) {
    setEditing(row)
    const detail = await api(`/api/admin/activities/${row.id}`)
    form.resetFields()
    form.setFieldsValue({
      ...detail,
      signup_start_at: detail.signup_start_at ? dayjs(detail.signup_start_at) : null,
    })
    setOpen(true)
  }

  async function submit() {
    const v = await form.validateFields()
    const payload = {
      name: v.name,
      company_name: v.company_name || '',
      intro_html: v.intro_html || '',
      signup_start_at: v.signup_start_at ? dayjs(v.signup_start_at).format('YYYY-MM-DDTHH:mm:ss') : null,
      companion_enabled: !!v.companion_enabled,
      companion_max: v.companion_enabled ? Number(v.companion_max || 0) : 0,
      companion_default: v.companion_enabled ? Number(v.companion_default || 0) : 0,
      remind_hours_before: Number(v.remind_hours_before || 24),
    }
    try {
      if (editing) {
        await api(`/api/admin/activities/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        msg.success('保存成功')
      } else {
        await api('/api/admin/activities', {
          method: 'POST',
          body: JSON.stringify({ ...payload, code: v.code }),
        })
        msg.success('活动已创建')
      }
      setOpen(false)
      reloadActivities()
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  /** 活动状态流转：草稿 → 报名中 → 已结束（已结束可再次开启） */
  async function changeStatus(row: any, next: string) {
    try {
      await api(`/api/admin/activities/${row.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      })
      msg.success(next === 'active' ? '已开启报名，前台现在可以进入了' : '已结束报名，前台不可再报名')
      await reloadActivities()
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  async function uploadImage(file: File, kind: string) {
    if (!editing) { msg.warning('请先保存活动，再上传图片'); return false }
    try {
      const res = await uploadApi(`/api/admin/activities/${editing.id}/image`, file, { kind })
      msg.success('图片已上传')
      const detail = await api(`/api/admin/activities/${editing.id}`)
      form.setFieldsValue({
        home_bg_image: detail.home_bg_image,
        title_image: detail.title_image,
        page_header_image: detail.page_header_image,
      })
      setEditing({ ...editing, ...detail })
    } catch (err: any) {
      msg.error(err.message)
    }
    return false
  }

  const columns = [
    { title: '活动名称', dataIndex: 'name', width: 130, ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 66, render: (s: string) => <Tag color={STATUS[s]?.color}>{STATUS[s]?.text}</Tag> },
    {
      title: '报名开始时间', dataIndex: 'signup_start_at', width: 116,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '未设置'),
    },
    {
      title: '结伴规则', width: 80,
      render: (_: any, r: any) => (r.companion_enabled ? `最多 ${r.companion_max} 人` : '不允许'),
    },
    {
      title: '提醒提前', width: 70,
      render: (_: any, r: any) => (r.remind_hours_before ? `${r.remind_hours_before} 小时` : '-'),
    },
    {
      title: '前台页面', width: 76, render: (_: any, r: any) => (
        <Space size={4}>
          <Button
            type="link" size="small" style={{ padding: 0 }}
            onClick={() => window.open(`/a/${r.code}/login`, '_blank')}
          >
            打开
          </Button>
          <Button
            type="link" size="small" style={{ padding: 0 }}
            onClick={async () => {
              const url = `${location.origin}/a/${r.code}/login`
              try {
                await navigator.clipboard.writeText(url)
                msg.success('前台链接已复制')
              } catch {
                msg.info(url)
              }
            }}
          >
            复制
          </Button>
        </Space>
      ),
    },
    {
      title: '快捷进入', width: 172, render: (_: any, r: any) => (
        <Space size={2}>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}
            onClick={() => nav(`/admin/shows?activity_id=${r.id}`)}>剧目</Button>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}
            onClick={() => nav(`/admin/sessions?activity_id=${r.id}`)}>场次</Button>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}
            onClick={() => nav(`/admin/contacts?activity_id=${r.id}`)}>员工</Button>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}
            onClick={() => nav(`/admin/registrations?activity_id=${r.id}`)}>报名</Button>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}
            onClick={() => nav(`/admin/emails?activity_id=${r.id}`)}>邮件</Button>
        </Space>
      ),
    },
    {
      title: '操作', width: 140, render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>编辑</Button>
          {r.status === 'draft' && (
            <Popconfirm title="开启后前台即可进入并报名，确定？" onConfirm={() => changeStatus(r, 'active')}>
              <Button type="link" size="small" style={{ padding: 0 }}>开启报名</Button>
            </Popconfirm>
          )}
          {r.status === 'active' && (
            <Popconfirm title="结束后前台将不能再报名，已报名的仍可查看，确定？" onConfirm={() => changeStatus(r, 'ended')}>
              <Button type="link" size="small" danger style={{ padding: 0 }}>结束报名</Button>
            </Popconfirm>
          )}
          {r.status === 'ended' && (
            <Popconfirm title="重新开启报名？" onConfirm={() => changeStatus(r, 'active')}>
              <Button type="link" size="small" style={{ padding: 0 }}>重新开启</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确定删除该活动？" onConfirm={async () => {
            try { await api(`/api/admin/activities/${r.id}`, { method: 'DELETE' }); msg.success('已删除'); reloadActivities() }
            catch (err: any) { msg.error(err.message) }
          }}>
            <Button type="link" size="small" danger style={{ padding: 0 }}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="活动管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => reloadActivities()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增活动</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Input
          placeholder="活动名称 / 编码 / 公司名称" allowClear style={{ width: 240 }}
          prefix={<SearchOutlined />}
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          style={{ width: 120 }}
          value={status} onChange={setStatus}
          options={[
            { value: '', label: '全部状态' },
            { value: 'draft', label: '草稿' },
            { value: 'active', label: '报名中' },
            { value: 'ended', label: '已结束' },
          ]}
        />
        <Select
          style={{ width: 140 }}
          value={companionFilter} onChange={setCompanionFilter}
          options={[
            { value: '', label: '结伴规则：全部' },
            { value: 'yes', label: '允许结伴' },
            { value: 'no', label: '不允许结伴' },
          ]}
        />
        <DatePicker.RangePicker
          value={startRange}
          onChange={(v) => setStartRange(v as any)}
          placeholder={['开抢时间起', '开抢时间止']}
        />
        <Button onClick={() => { setKeyword(''); setStatus(''); setCompanionFilter(''); setStartRange(null) }}>重置</Button>
      </Space>
      <Table
        rowKey="id" dataSource={filtered} columns={columns} size="middle"
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 850 }}
      />
      <Modal
        title={editing ? `编辑活动：${editing.name}` : '新增活动'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        width={1000}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="code" label="活动编码（小写字母/数字/连字符，创建后不可改）"
                       rules={[{ required: true, message: '请填写活动编码' }]}>
              <Input placeholder="如 sap-winter" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="name" label="活动名称" rules={[{ required: true, message: '请填写活动名称' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="company_name" label="公司名称">
              <Input />
            </Form.Item>
            <Form.Item name="signup_start_at" label="报名开始时间（到点自动开放）">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="companion_enabled" label="允许携带结伴人" valuePropName="checked">
              <Switch onChange={(checked) => {
                if (!checked) {
                  form.setFieldValue('companion_max', 0)
                  form.setFieldValue('companion_default', 0)
                } else {
                  if (!form.getFieldValue('companion_max')) form.setFieldValue('companion_max', 2)
                  if (!form.getFieldValue('companion_default')) form.setFieldValue('companion_default', 1)
                }
              }} />
            </Form.Item>
            <Form.Item name="companion_max" label="结伴人数上限" extra={!companionEnabled ? '不允许携带结伴人时固定为 0' : undefined}>
              <InputNumber min={0} style={{ width: '100%' }} disabled={!companionEnabled}
                onChange={(v) => {
                  const cur = Number(form.getFieldValue('companion_default') || 0)
                  if (cur > (v ?? 0)) form.setFieldValue('companion_default', v ?? 0)
                }} />
            </Form.Item>
            <Form.Item
              name="companion_default" label="默认随行人数"
              extra={!companionEnabled ? '不允许携带结伴人时固定为 0' : '前台报名页随行人数选择器的初始值，不能超过结伴人数上限'}
              rules={[{ validator: (_, val) => {
                if (companionEnabled && Number(val ?? 0) > Number(companionMax ?? 0)) {
                  return Promise.reject(new Error('默认随行人数不能超过结伴人数上限'))
                }
                return Promise.resolve()
              } }]}
            >
              <InputNumber min={0} style={{ width: '100%' }} disabled={!companionEnabled} />
            </Form.Item>
            <Form.Item name="remind_hours_before" label="观演提醒默认提前（小时）">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="intro_html" label="活动级通用介绍（选填；演出介绍在剧目管理中维护）">
            <RichTextEditor
              key={editing?.id ?? 'new'}
              placeholder="支持加粗、标题、列表、插图等；入库前服务端自动过滤脚本" height={200}
            />
          </Form.Item>
          {editing && (
            <Space wrap align="start">
              <ImageField
                label="首页底图（整屏背景）"
                value={editing.home_bg_image}
                onUpload={(f) => uploadImage(f, 'home_bg')}
              />
              <ImageField
                label="活动标题块图（叠在底图上方）"
                value={editing.title_image}
                onUpload={(f) => uploadImage(f, 'title')}
              />
              <ImageField
                label="内页头图"
                value={editing.page_header_image}
                onUpload={(f) => uploadImage(f, 'page_header')}
              />
            </Space>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
