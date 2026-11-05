import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select,
  Space, Switch, Table, Tag, message,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../../api'
import { useActivity } from '../ActivityContext'

export default function Sessions() {
  const { activities } = useActivity()
  const [params] = useSearchParams()
  // 支持从「活动管理 / 剧目管理」带 ?activity_id=&show_id= 直接过滤
  const [activityId, setActivityId] = useState<number | undefined>(() => {
    const v = params.get('activity_id')
    return v ? Number(v) : undefined
  })
  const [showId, setShowId] = useState<number | undefined>(() => {
    const v = params.get('show_id')
    return v ? Number(v) : undefined
  })
  const [shows, setShows] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()
  const { message: msg } = App.useApp()
  const modalActivity = Form.useWatch('activity_id', form)

  // 筛选条件
  const [keyword, setKeyword] = useState('')
  const [timeRange, setTimeRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [openFilter, setOpenFilter] = useState<string>('')
  const [quotaFilter, setQuotaFilter] = useState<string>('')

  async function load() {
    try {
      const params = new URLSearchParams()
      if (activityId) params.set('activity_id', String(activityId))
      if (showId) params.set('show_id', String(showId))
      const query = params.toString() ? `?${params.toString()}` : ''
      setRows(await api(`/api/admin/sessions${query}`))
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  async function loadShows() {
    try {
      const query = activityId ? `?activity_id=${activityId}` : ''
      setShows(await api(`/api/admin/shows${query}`))
    } catch (err: any) {
      setShows([])
    }
  }

  // 同一个路由内再次点击别的链接（URL 变化但组件未卸载）时同步筛选条件
  useEffect(() => {
    const a = params.get('activity_id')
    const s = params.get('show_id')
    if (a) setActivityId(Number(a))
    if (s) setShowId(Number(s))
  }, [params])

  useEffect(() => { load() }, [activityId, showId])
  useEffect(() => { loadShows() }, [activityId])

  const filtered = useMemo(() => {
    return rows.filter((r: any) => {
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        if (!(r.name || '').toLowerCase().includes(kw)) return false
      }
      if (openFilter === 'open' && !r.is_open) return false
      if (openFilter === 'closed' && r.is_open) return false
      if (quotaFilter === 'has' && r.remaining <= 0) return false
      if (quotaFilter === 'none' && r.remaining > 0) return false
      if (quotaFilter === 'none_seat' && r.remaining > 0 && r.remaining < r.capacity) return false
      if (timeRange) {
        const t = dayjs(r.show_at)
        if (t.isBefore(timeRange[0], 'day') || t.isAfter(timeRange[1], 'day')) return false
      }
      return true
    })
  }, [rows, keyword, openFilter, quotaFilter, timeRange])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ activity_id: activityId, capacity: 100, is_open: true })
    setOpen(true)
  }

  async function openEdit(row: any) {
    setEditing(row)
    form.resetFields()
    form.setFieldsValue({
      activity_id: row.activity_id,
      name: row.name,
      show_id: row.show_id,
      show_at: dayjs(row.show_at),
      capacity: row.capacity,
      remind_hours_before: row.remind_hours_before,
      is_open: row.is_open,
    })
    setOpen(true)
  }

  async function submit() {
    const v = await form.validateFields()
    const payload = {
      name: v.name,
      show_at: dayjs(v.show_at).format('YYYY-MM-DDTHH:mm:ss'),
      capacity: Number(v.capacity || 0),
      remind_hours_before: v.remind_hours_before === undefined || v.remind_hours_before === null || v.remind_hours_before === '' ? null : Number(v.remind_hours_before),
      is_open: !!v.is_open,
    }
    try {
      if (editing) {
        await api(`/api/admin/sessions/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        msg.success('场次已保存')
      } else {
        await api(`/api/admin/shows/${v.show_id}/sessions`, { method: 'POST', body: JSON.stringify(payload) })
        msg.success('场次已添加')
      }
      setOpen(false)
      load()
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  const columns: any[] = [
    { title: '场次名称', dataIndex: 'name', width: 110, ellipsis: true },
    { title: '所属活动', dataIndex: 'activity_name', width: 104, ellipsis: true },
    { title: '所属剧目', dataIndex: 'show_name', width: 112, ellipsis: true },
    { title: '演出时间', dataIndex: 'show_at', width: 118, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '名额', dataIndex: 'capacity', width: 54 },
    { title: '已占用', dataIndex: 'sold', width: 60 },
    { title: '剩余', dataIndex: 'remaining', width: 54 },
    { title: '提醒提前', width: 64, render: (_: any, r: any) => (r.remind_hours_before ? `${r.remind_hours_before} 小时` : '默认') },
    { title: '状态', dataIndex: 'is_open', width: 62, render: (v: boolean) => (v ? <Tag color="blue">开放</Tag> : <Tag>关闭</Tag>) },
    {
      title: '操作', width: 132, render: (_: any, r: any) => (
        <Space size={2}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={async () => {
            try {
              await api(`/api/admin/sessions/${r.id}`, { method: 'PUT', body: JSON.stringify({ is_open: !r.is_open }) })
              msg.success(r.is_open ? '已关闭' : '已开放'); load()
            } catch (err: any) { msg.error(err.message) }
          }}>{r.is_open ? '关闭' : '开放'}</Button>
          <Popconfirm title="确定删除该场次？有报名记录的场次无法删除。" onConfirm={async () => {
            try { await api(`/api/admin/sessions/${r.id}`, { method: 'DELETE' }); msg.success('已删除'); load() }
            catch (err: any) { msg.error(err.message) }
          }}>
            <Button type="link" size="small" danger style={{ padding: 0 }}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const activityOptions = activities.map((a) => ({ value: a.id, label: a.name }))
  const showOptions = shows
    .filter((s) => !modalActivity || s.activity_id === modalActivity)
    .map((s) => ({ value: s.id, label: s.name }))

  return (
    <Card
      title="场次管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!activities.length}>新增场次</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <span>所属活动：</span>
        <Select
          showSearch optionFilterProp="label" allowClear
          placeholder="全部活动（不选即显示全部）" style={{ width: 240 }}
          value={activityId}
          onChange={(v) => { setActivityId(v === undefined ? undefined : v); setShowId(undefined) }}
          options={activityOptions}
        />
        <span>剧目：</span>
        <Select
          showSearch optionFilterProp="label" allowClear
          placeholder="全部剧目" style={{ width: 200 }}
          value={showId}
          onChange={setShowId}
          options={shows.map((s: any) => ({ value: s.id, label: s.name }))}
        />
        <Input
          placeholder="场次名称" allowClear style={{ width: 160 }}
          prefix={<SearchOutlined />}
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
        />
        <DatePicker.RangePicker
          value={timeRange}
          onChange={(v) => setTimeRange(v as any)}
          placeholder={['演出时间起', '演出时间止']}
        />
        <Select
          style={{ width: 120 }}
          value={openFilter} onChange={setOpenFilter}
          options={[
            { value: '', label: '状态：全部' },
            { value: 'open', label: '开放' },
            { value: 'closed', label: '关闭' },
          ]}
        />
        <Select
          style={{ width: 150 }}
          value={quotaFilter} onChange={setQuotaFilter}
          options={[
            { value: '', label: '名额：全部' },
            { value: 'has', label: '仍有名额' },
            { value: 'none', label: '名额已满' },
          ]}
        />
        <Button onClick={() => { setKeyword(''); setTimeRange(null); setOpenFilter(''); setQuotaFilter('') }}>重置</Button>
      </Space>
      <Table
        rowKey="id" dataSource={filtered} columns={columns} size="middle"
        scroll={{ x: 870 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
      <Modal
        title={editing ? '编辑场次' : '新增场次'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        width={640}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="activity_id" label="所属活动" rules={[{ required: true, message: '请选择所属活动' }]}>
              <Select showSearch optionFilterProp="label" options={activityOptions} />
            </Form.Item>
            <Form.Item name="show_id" label="所属剧目" rules={[{ required: true, message: '请选择剧目' }]}>
              <Select showSearch optionFilterProp="label" options={showOptions} />
            </Form.Item>
            <Form.Item name="name" label="场次名称" rules={[{ required: true, message: '请填写场次名称' }]}>
              <Input placeholder="如 场次1" />
            </Form.Item>
            <Form.Item name="show_at" label="演出开始时间" rules={[{ required: true, message: '请选择演出时间' }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="capacity" label="名额总数" rules={[{ required: true, message: '请填写名额' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="remind_hours_before" label="提醒提前小时（留空继承活动默认）">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="is_open" label="开放状态" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </Card>
  )
}
