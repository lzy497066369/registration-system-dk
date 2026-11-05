import { useEffect, useState } from 'react'
import { Button, Card, Input, Select, Space, Table, Tag, message } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, downloadApi } from '../../api'
import { useActivity } from '../ActivityContext'

const STATUS_COLOR: Record<string, string> = {
  pending: 'orange', shipped: 'green', cancelled: 'default',
}

/** 只读账号的唯一页面：按绑定的活动查看报名明细，全字段展示 + 导出，没有任何写操作。 */
export default function MyRegistrations() {
  const { activities, activityId } = useActivity()
  const [actId, setActId] = useState<number | undefined>(activityId)
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [msg, holder] = message.useMessage()

  useEffect(() => { setActId(activityId) }, [activityId])

  async function load(
    p = page, s = pageSize, a = actId, st = status, kw = keyword,
  ) {
    setLoading(true)
    try {
      const q = new URLSearchParams({ page: String(p), page_size: String(s) })
      if (a) q.set('activity_id', String(a))
      if (st) q.set('status', st)
      if (kw.trim()) q.set('keyword', kw.trim())
      const res = await api(`/api/admin/registrations?${q.toString()}`)
      setItems(res.items || [])
      setTotal(res.total || 0)
      setPage(p)
      setPageSize(s)
    } catch (err: any) {
      msg.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1, pageSize, actId) }, [actId])

  function exportExcel() {
    const q = new URLSearchParams()
    if (actId) q.set('activity_id', String(actId))
    if (status) q.set('status', status)
    if (keyword.trim()) q.set('keyword', keyword.trim())
    const actName = activities.find((a) => a.id === actId)?.name || '全部活动'
    const suffix = q.toString() ? `?${q.toString()}` : ''
    downloadApi(`/api/admin/registrations/export${suffix}`, `报名情况_${actName}.xlsx`)
      .catch((e) => msg.error(e.message))
  }

  const columns: any[] = [
    { title: '所属活动', dataIndex: 'activity_name', width: 118, ellipsis: true },
    { title: '员工号', dataIndex: 'employee_no', width: 90, ellipsis: true },
    { title: '邮箱', dataIndex: 'email', width: 170, ellipsis: true },
    { title: '剧目', dataIndex: 'show_name', width: 140, ellipsis: true },
    { title: '演出地点', dataIndex: 'location', width: 130, ellipsis: true },
    { title: '详细地址', dataIndex: 'address', width: 190, ellipsis: true },
    { title: '场次', dataIndex: 'session_name', width: 110, ellipsis: true },
    {
      title: '演出时间', dataIndex: 'show_at', width: 132,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    { title: '随行人数', dataIndex: 'companion_count', width: 84 },
    { title: '观演人数', dataIndex: 'seats', width: 84 },
    { title: '联系电话', dataIndex: 'phone', width: 118 },
    { title: '省份', dataIndex: 'province', width: 92, ellipsis: true },
    { title: '城市', dataIndex: 'city', width: 92, ellipsis: true },
    { title: '区县', dataIndex: 'county', width: 92, ellipsis: true },
    { title: '详细收件地址', dataIndex: 'address_detail', width: 200, ellipsis: true },
    { title: '收件人', dataIndex: 'recipient_name', width: 92, ellipsis: true },
    { title: '收件人手机号', dataIndex: 'recipient_phone', width: 122 },
    { title: '快递公司', dataIndex: 'courier_company', width: 106, ellipsis: true },
    { title: '快递单号', dataIndex: 'courier_no', width: 140, ellipsis: true },
    {
      title: '状态', dataIndex: 'status_text', width: 84,
      render: (_: any, r: any) => <Tag color={STATUS_COLOR[r.status]}>{r.status_text || '-'}</Tag>,
    },
    {
      title: '报名时间', dataIndex: 'created_at', width: 136,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
  ]

  return (
    <div>
      {holder}
      <Card
        title="报名情况"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => load(page)}>刷新</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={exportExcel}>导出 Excel</Button>
          </Space>
        }
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <span>所属活动：</span>
          <Select
            showSearch optionFilterProp="label" allowClear
            placeholder="全部活动（不选即显示全部）" style={{ width: 260 }}
            value={actId} onChange={(v) => setActId(v)}
            options={activities.map((a) => ({ value: a.id, label: a.name }))}
          />
          <Select
            style={{ width: 130 }}
            value={status}
            onChange={(v) => { setStatus(v); load(1, pageSize, actId, v, keyword) }}
            options={[
              { value: '', label: '全部状态' },
              { value: 'pending', label: '待邮寄' },
              { value: 'shipped', label: '已邮寄' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
          <Input.Search
            placeholder="报名编号 / 员工号 / 邮箱 / 收件人 / 快递单号"
            allowClear
            style={{ width: 320 }}
            onSearch={(v) => { setKeyword(v); load(1, pageSize, actId, status, v) }}
          />
        </Space>
        <Table
          rowKey="id"
          dataSource={items}
          columns={columns}
          size="middle"
          loading={loading}
          scroll={{ x: 2440 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => load(p, s),
          }}
        />
      </Card>
    </div>
  )
}
