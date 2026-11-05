import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Upload, message,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { api, uploadApi } from '../../api'
import { useActivity } from '../ActivityContext'
import ImageField from '../components/ImageField'
import RichTextEditor from '../components/RichTextEditor'

export default function Shows() {
  const { activities } = useActivity()
  const nav = useNavigate()
  const [params] = useSearchParams()
  // 支持从「活动管理 → 快捷进入 → 剧目」带 ?activity_id= 直接过滤
  const [activityId, setActivityId] = useState<number | undefined>(() => {
    const v = params.get('activity_id')
    return v ? Number(v) : undefined
  })
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()
  const { message: msg } = App.useApp()

  useEffect(() => {
    const v = params.get('activity_id')
    if (v) setActivityId(Number(v))
  }, [params])

  // 筛选条件
  const [keyword, setKeyword] = useState('')
  const [sessionFilter, setSessionFilter] = useState<string>('')
  const [quotaFilter, setQuotaFilter] = useState<string>('')

  async function load() {
    try {
      const query = activityId ? `?activity_id=${activityId}` : ''
      setRows(await api(`/api/admin/shows${query}`))
    } catch (err: any) {
      msg.error(err.message)
    }
  }
  useEffect(() => { load() }, [activityId])

  const filtered = useMemo(() => {
    return rows.filter((r: any) => {
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const hit = [r.name, r.location, r.address].some((v: string) => (v || '').toLowerCase().includes(kw))
        if (!hit) return false
      }
      const count = r.sessions?.length || 0
      if (sessionFilter === 'yes' && count === 0) return false
      if (sessionFilter === 'no' && count > 0) return false
      const remaining = (r.sessions || []).reduce((s: number, x: any) => s + (x.remaining || 0), 0)
      if (quotaFilter === 'has' && remaining === 0) return false
      if (quotaFilter === 'none' && remaining > 0) return false
      return true
    })
  }, [rows, keyword, sessionFilter, quotaFilter])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ activity_id: activityId })
    setOpen(true)
  }

  async function openEdit(row: any) {
    // 列表接口不再返回演出介绍全文（正文是原图 base64，单张可达 20MB、多张就到几十 MB），
    // 所以先取详情拿到完整正文再打开弹窗，避免先开后补时把内容覆盖或误清空。
    try {
      const detail = await api(`/api/admin/shows/${row.id}`)
      setEditing(detail)
      form.resetFields()
      form.setFieldsValue({
        activity_id: detail.activity_id,
        name: detail.name, location: detail.location, address: detail.address,
        intro_html: detail.intro_html || '', cover_image: detail.cover_image || '',
      })
      setOpen(true)
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  async function submit() {
    const v = await form.validateFields()
    const targetActivity = v.activity_id || activityId
    try {
      if (editing) {
        await api(`/api/admin/shows/${editing.id}`, { method: 'PUT', body: JSON.stringify(v) })
        msg.success('剧目已保存')
      } else {
        await api(`/api/admin/activities/${targetActivity}/shows`, { method: 'POST', body: JSON.stringify(v) })
        msg.success('剧目已添加')
      }
      setOpen(false)
      load()
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  const columns: any[] = [
    { title: '剧目名称', dataIndex: 'name', width: 240 },
    { title: '所属活动', dataIndex: 'activity_name', width: 180 },
    { title: '演出地点', dataIndex: 'location', width: 160, render: (v: string) => v || '-' },
    { title: '详细地址', dataIndex: 'address', width: 240, render: (v: string) => v || '-' },
    {
      title: '演出介绍', dataIndex: 'has_intro', width: 220,
      render: (v: any) => (
        <span style={{ color: '#5a708a' }}>{v ? '已配置' : '-'}</span>
      ),
    },
    { title: '场次数', width: 90, render: (_: any, r: any) => r.sessions?.length || 0 },
    {
      title: '剩余名额', width: 110,
      render: (_: any, r: any) => (r.sessions || []).reduce((s: number, x: any) => s + x.remaining, 0),
    },
    {
      title: '操作', width: 200, render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" style={{ padding: 0 }}
            onClick={() => nav(`/admin/sessions?activity_id=${r.activity_id}&show_id=${r.id}`)}>场次</Button>
          <Popconfirm title="确定删除该剧目？（有场次时无法删除）" onConfirm={async () => {
            try { await api(`/api/admin/shows/${r.id}`, { method: 'DELETE' }); msg.success('已删除'); load() }
            catch (err: any) { msg.error(err.message) }
          }}>
            <Button type="link" size="small" danger style={{ padding: 0 }}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const activityOptions = activities.map((a) => ({ value: a.id, label: a.name }))

  return (
    <Card
      title="剧目管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!activities.length}>新增剧目</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <span>所属活动：</span>
        <Select
          showSearch optionFilterProp="label" allowClear
          placeholder="全部活动（不选即显示全部）" style={{ width: 260 }}
          value={activityId}
          onChange={(v) => setActivityId(v === undefined ? undefined : v)}
          options={activityOptions}
        />
        <Input
          placeholder="剧目名称 / 地点 / 地址" allowClear style={{ width: 240 }}
          prefix={<SearchOutlined />}
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          style={{ width: 140 }}
          value={sessionFilter} onChange={setSessionFilter}
          options={[
            { value: '', label: '场次：全部' },
            { value: 'yes', label: '已有场次' },
            { value: 'no', label: '暂无场次' },
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
        <Button onClick={() => { setKeyword(''); setSessionFilter(''); setQuotaFilter('') }}>重置</Button>
        <Tag color="blue">剧目必须归属于某个活动，地点与地址按剧目维护</Tag>
      </Space>
      <Table
        rowKey="id" dataSource={filtered} columns={columns} size="middle"
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
      <Modal
        title={editing ? '编辑剧目' : '新增剧目'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        width={1000}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="activity_id" label="所属活动" rules={[{ required: true, message: '请选择所属活动' }]}>
              <Select showSearch optionFilterProp="label" options={activityOptions} />
            </Form.Item>
            <Form.Item name="name" label="剧目名称" rules={[{ required: true, message: '请填写剧目名称' }]}>
              <Input placeholder="如 《后来·遇见》赖之音歌行合唱团" />
            </Form.Item>
            <Form.Item name="location" label="演出地点（场馆名称）">
              <Input placeholder="如 北京音乐厅" />
            </Form.Item>
            <Form.Item name="address" label="详细地址">
              <Input placeholder="如 北京市西城区北新华街1号" />
            </Form.Item>
          </div>
          <Form.Item name="intro_html" label="演出介绍（前台「点此查看演出介绍」的内容）">
            <RichTextEditor
              key={editing?.id ?? 'new'}
              placeholder="支持加粗、标题、列表、插图等" height={220}
            />
          </Form.Item>
          {editing && (
            <div style={{ marginBottom: 12 }}>
              <ImageField
                label="剧目卡片背景图（前台卡片底图，未上传则使用默认图）"
                value={editing.cover_image}
                tip="剧目名称与地点会叠在图片上，建议用「上浅下照片、顶部留白」的剧目照（与设计稿默认图同款）"
                onUpload={async (file: File) => {
                  try {
                    const res = await uploadApi(`/api/admin/shows/${editing.id}/image`, file)
                    msg.success('封面图已上传')
                    form.setFieldValue('cover_image', res.path)
                    setEditing({ ...editing, cover_image: res.path })
                    await load()   // 刷新列表，行内也显示新封面
                  } catch (err: any) {
                    msg.error(err.message)
                  }
                  return false
                }}
              />
            </div>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
