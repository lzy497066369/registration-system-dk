import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  App, Button, Card, Col, DatePicker, Descriptions, Form, Input, Modal,
  Row, Select, Space, Statistic, Table, Tag, Upload, message,
} from 'antd'
import {
  DeleteOutlined, DownloadOutlined, InboxOutlined,
  ReloadOutlined, UploadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, downloadApi, uploadApi } from '../../api'
import { useActivity } from '../ActivityContext'

const STATUS_COLOR: Record<string, string> = {
  pending: 'orange',
  shipped: 'green',
  cancelled: 'default',
}

export default function Registrations() {
  const { activities } = useActivity()
  const [params] = useSearchParams()
  // 支持从「活动管理 → 快捷进入 → 报名」带 ?activity_id= 直接过滤
  const [activityId, setActivityId] = useState<number | undefined>(() => {
    const v = params.get('activity_id')
    return v ? Number(v) : undefined
  })
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [stats, setStats] = useState<any>(null)
  const [editing, setEditing] = useState<any>(null)
  const [tracking, setTracking] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importActivity, setImportActivity] = useState<number | undefined>(undefined)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<any>(null)
  const [editForm] = Form.useForm()
  const [trackForm] = Form.useForm()
  const { message: msg, modal } = App.useApp()

  async function load(p = 1, size = pageSize, st = status, kw = keyword) {
    try {
      const params = new URLSearchParams({ page: String(p), page_size: String(size), keyword: kw, status: st })
      if (activityId) params.set('activity_id', String(activityId))
      const data = await api(`/api/admin/registrations?${params.toString()}`)
      setItems(data.items); setTotal(data.total); setPage(p); setPageSize(size)
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  async function loadStats() {
    try {
      const q = activityId ? `?activity_id=${activityId}` : ''
      setStats(await api(`/api/admin/registrations/stats${q}`))
    } catch (err: any) { /* ignore */ }
  }

  useEffect(() => { load(1); loadStats() }, [activityId])

  useEffect(() => {
    const v = params.get('activity_id')
    if (v) setActivityId(Number(v))
  }, [params])

  function openEdit(row: any) {
    setEditing(row)
    editForm.resetFields()
    editForm.setFieldsValue({
      phone: row.phone, province: row.province, city: row.city, county: row.county,
      address_detail: row.address_detail,
      recipient_name: row.recipient_name, recipient_phone: row.recipient_phone,
    })
  }

  async function saveEdit() {
    const v = await editForm.validateFields()
    try {
      await api(`/api/admin/registrations/${editing.id}/contact`, {
        method: 'PUT', body: JSON.stringify(v),
      })
      msg.success('已保存')
      setEditing(null)
      load(page); loadStats()
    } catch (err: any) { msg.error(err.message) }
  }

  function openTracking(row: any) {
    setTracking(row)
    trackForm.resetFields()
    trackForm.setFieldsValue({ courier_company: row.courier_company, courier_no: row.courier_no })
  }

  async function saveTracking() {
    const v = await trackForm.validateFields()
    try {
      const res = await api(`/api/admin/registrations/${tracking.id}/tracking`, {
        method: 'PUT', body: JSON.stringify({ ...v, notify: true }),
      })
      msg.success(res.mail_queued ? '已回填，邮寄提醒邮件已入队' : '已回填（未配置提醒模板）')
      setTracking(null)
      load(page); loadStats()
    } catch (err: any) { msg.error(err.message) }
  }

  async function deleteRow(row: any) {
    modal.confirm({
      title: `确认删除报名单 ${row.reg_no || `#${row.id}`}？`,
      width: 520,
      content: (
        <div style={{ lineHeight: 1.9 }}>
          <div>· 该报名单将从报名管理中<b>彻底删除</b>，无法恢复</div>
          <div>· 已占用名额：<b>{row.seats} 个</b>，删除后自动退回该场次</div>
          <div>· 该员工删除后可重新报名，但历史修改记录与邮件记录一并清除</div>
          <div style={{ color: '#cf1322', marginTop: 8 }}>
            删除即视为取消报名，记录不可恢复，建议先点「导出 Excel」备份。
          </div>
        </div>
      ),
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await api(`/api/admin/registrations/${row.id}`, { method: 'DELETE' })
          msg.success(res.released ? `已删除，释放 ${res.released} 个名额` : '已删除')
          load(page); loadStats()
        } catch (err: any) { msg.error(err.message) }
      },
    })
  }

  async function clearAllRegs() {
    if (!activityId) { msg.warning('请先在上方选择要清空的所属活动'); return }
    const act = activities.find((a) => a.id === activityId)
    const total = stats?.total ?? 0
    const seats = stats?.seats ?? 0
    modal.confirm({
      title: `确认清空「${act?.name || '该活动'}」的全部报名数据？`,
      width: 560,
      content: (
        <div style={{ lineHeight: 1.9 }}>
          <div>· 当前该活动共有报名单 <b>{total} 条</b>，将<b>全部删除</b></div>
          <div>· 其中占用 <b>{seats} 个</b>名额，删除后自动退回各场次</div>
          <div>· 修改留痕与邮件发送记录一并清除，员工可重新报名</div>
          <div style={{ color: '#cf1322', marginTop: 8 }}>
            删除后不可恢复，建议先点「导出 Excel」备份。
          </div>
        </div>
      ),
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await api(`/api/admin/registrations/clear?activity_id=${activityId}`, { method: 'POST' })
          msg.success(`已清空 ${res.deleted} 条报名单${res.released ? `，释放 ${res.released} 个名额` : ''}`)
          load(1); loadStats()
        } catch (err: any) { msg.error(err.message) }
      },
    })
  }

  async function doImport() {
    if (!importActivity) { msg.warning('请选择活动'); return }
    if (!importFile) { msg.warning('请选择 Excel 文件'); return }
    try {
      const res = await uploadApi(
        `/api/admin/registrations/import-tracking?activity_id=${importActivity}`, importFile)
      setImportResult(res)
      msg.success(`回填完成：成功 ${res.updated} 条，邮件入队 ${res.mail_queued} 封`)
      load(page); loadStats()
    } catch (err: any) { msg.error(err.message) }
  }

  const columns: any[] = [
    { title: '所属活动', dataIndex: 'activity_name', width: 100, ellipsis: true },
    { title: '员工号', dataIndex: 'employee_no', width: 84, ellipsis: true },
    { title: '邮箱', dataIndex: 'email', width: 140, ellipsis: true },
    { title: '剧目', dataIndex: 'show_name', width: 108, ellipsis: true },
    { title: '场次', dataIndex: 'session_name', width: 90, ellipsis: true },
    { title: '演出时间', dataIndex: 'show_at', width: 116, render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '') },
    {
      title: '状态', dataIndex: 'status_text', width: 66,
      render: (_: any, r: any) => <Tag color={STATUS_COLOR[r.status]}>{r.status_text || '-'}</Tag>,
    },
    {
      title: '操作', width: 196, render: (_: any, r: any) => (
        <Space size={2}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setDetail(r)}>详细</Button>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openTracking(r)}>回填快递</Button>
          <Button type="link" size="small" danger style={{ padding: 0 }} onClick={() => deleteRow(r)}>删除</Button>
        </Space>
      ),
    },
  ]

  const activityOptions = activities.map((a) => ({ value: a.id, label: a.name }))

  return (
    <div>
      {/* 看板 */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}><Card size="small"><Statistic title="报名总数" value={stats?.total ?? 0} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="占用名额/观演人数" value={stats?.seats ?? 0} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="已邮寄" value={stats?.shipped ?? 0} valueStyle={{ color: '#389e0d' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="待邮寄" value={stats?.pending ?? 0} valueStyle={{ color: '#d48806' }} /></Card></Col>
      </Row>

      {/* 场次余量单独占一行：剧目汇总 + 该剧目下每个场次的余量 */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={24}>
          {/* 不用 size="small"，标题字号才会和「报名管理」一致（antd: small=14px，默认=16px） */}
          <Card title="场次余量" styles={{ body: { padding: '12px 24px' } }}>
            <div style={{ maxHeight: 178, overflowY: 'auto' }}>
              {(stats?.shows || []).map((s: any) => (
                <div key={s.show_id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: '22px', color: '#262626' }}>
                    {s.show_name}
                    <span style={{ marginLeft: 8, fontWeight: 400, color: '#595959' }}>
                      合计剩 {s.remaining} / {s.capacity}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 28, rowGap: 2, paddingLeft: 12, marginTop: 3 }}>
                    {(s.sessions || []).map((x: any) => (
                      <span key={x.id} style={{ fontSize: 12, lineHeight: '20px', color: '#595959' }}>
                        {x.name}
                        {x.show_at ? `（${dayjs(x.show_at).format('MM-DD HH:mm')}）` : ''}：剩 {x.remaining} / {x.capacity}
                      </span>
                    ))}
                    {(s.sessions || []).length === 0 && <span style={{ fontSize: 12, color: '#8c8c8c' }}>暂无场次</span>}
                  </div>
                </div>
              ))}
              {(stats?.shows || []).length === 0 && <span style={{ color: '#8c8c8c' }}>暂无场次</span>}
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        title="报名管理"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { load(page); loadStats() }}>刷新</Button>
            <Button icon={<DownloadOutlined />} disabled={!activities.length}
                    onClick={() => downloadApi(
                      activityId ? `/api/admin/registrations/export?activity_id=${activityId}&status=${status}`
                                 : `/api/admin/registrations/export?status=${status}`,
                      '报名记录.xlsx').catch((e) => msg.error(e.message))}>
              导出 Excel
            </Button>
            <Button icon={<UploadOutlined />} disabled={!activities.length}
                    onClick={() => { setImportActivity(activityId); setImportResult(null); setImportOpen(true) }}>
              批量回填快递
            </Button>
            <Button danger type="primary" icon={<DeleteOutlined />} disabled={!activities.length}
                    onClick={clearAllRegs}>清空报名数据</Button>
          </Space>
        }
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <span>所属活动：</span>
          <Select
            showSearch optionFilterProp="label" allowClear
            placeholder="全部活动（不选即显示全部）" style={{ width: 260 }}
            value={activityId} onChange={(v) => setActivityId(v === undefined ? undefined : v)}
            options={activityOptions}
          />
          <Select
            style={{ width: 130 }}
            value={status} onChange={(v) => { setStatus(v); load(1, pageSize, v, keyword) }}
            options={[
              { value: '', label: '全部状态' },
              { value: 'pending', label: '待邮寄' },
              { value: 'shipped', label: '已邮寄' },
            ]}
          />
          <Input.Search
            placeholder="报名编号 / 员工号 / 邮箱 / 收件人 / 快递单号" allowClear style={{ width: 300 }}
            onSearch={(v) => { setKeyword(v); load(1, pageSize, status, v) }}
          />
        </Space>
        <Table
          rowKey="id" dataSource={items} columns={columns} size="middle" scroll={{ x: 900 }}
          pagination={{
            current: page, pageSize, total, showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => load(p, s),
          }}
        />
      </Card>

      {/* 报名详情（列表只显示核心列，其余信息都在这里） */}
      <Modal
        title={`报名详情：${detail?.reg_no || ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        width={760}
        footer={<Button type="primary" onClick={() => setDetail(null)}>关闭</Button>}
      >
        <Descriptions bordered size="small" column={2} labelStyle={{ width: 110 }} style={{ marginTop: 8 }}>
          <Descriptions.Item label="报名编号">{detail?.reg_no || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS_COLOR[detail?.status]}>{detail?.status_text || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="所属活动">{detail?.activity_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="报名时间">
            {detail?.created_at ? dayjs(detail.created_at).format('YYYY-MM-DD HH:mm') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="员工号">{detail?.employee_no || '-'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{detail?.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="剧目">{detail?.show_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="场次">{detail?.session_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="演出时间">
            {detail?.show_at ? dayjs(detail.show_at).format('YYYY-MM-DD HH:mm') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="演出地点">{detail?.location || '-'}</Descriptions.Item>
          <Descriptions.Item label="场馆地址" span={2}>{detail?.address || '-'}</Descriptions.Item>
          <Descriptions.Item label="结伴人数">{detail?.companion_count ?? 0}</Descriptions.Item>
          <Descriptions.Item label="占用名额">{detail?.seats ?? 0}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{detail?.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="收件人">{detail?.recipient_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="收件人手机号">{detail?.recipient_phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="快递公司">{detail?.courier_company || '-'}</Descriptions.Item>
          <Descriptions.Item label="票券邮寄地址" span={2}>
            {[detail?.province, detail?.city, detail?.county, detail?.address_detail].filter(Boolean).join(' ') || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="快递单号" span={2}>{detail?.courier_no || '-'}</Descriptions.Item>
        </Descriptions>
      </Modal>

      {/* 编辑联系/邮寄信息 */}
      <Modal title={`编辑报名信息：${editing?.reg_no || ''}`} open={!!editing} onCancel={() => setEditing(null)} onOk={saveEdit} width={680} forceRender>
        <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="剧目">{editing?.show_name}</Descriptions.Item>
          <Descriptions.Item label="场次">{editing?.session_name}</Descriptions.Item>
        </Descriptions>
        <Form form={editForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="phone" label="联系电话" rules={[{ required: true, message: '请填写联系电话' }]}>
              <Input />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="province" label="省份" rules={[{ required: true, message: '请填写省份' }]}>
              <Input />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="city" label="城市" rules={[{ required: true, message: '请填写城市' }]}>
              <Input />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="county" label="区县">
              <Input placeholder="选填" />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="recipient_name" label="收件人姓名" rules={[{ required: true, message: '请填写收件人姓名' }]}>
              <Input />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="recipient_phone" label="收件人手机号" rules={[{ required: true, message: '请填写收件人手机号' }]}>
              <Input />
            </Form.Item></Col>
            <Col span={24}><Form.Item name="address_detail" label="详细地址" rules={[{ required: true, message: '请填写详细地址' }]}>
              <Input />
            </Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 回填快递单号 */}
      <Modal title="回填快递信息" open={!!tracking} onCancel={() => setTracking(null)} onOk={saveTracking} forceRender>
        <Form form={trackForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="courier_company" label="快递公司"><Input placeholder="如 顺丰速运" /></Form.Item>
          <Form.Item name="courier_no" label="快递单号" rules={[{ required: true, message: '请填写快递单号' }]}>
            <Input />
          </Form.Item>
          <div style={{ color: '#8a99a8', fontSize: 12 }}>回填后状态自动置为「已邮寄」，并向该报名人发送提醒邮件（需已配置「已邮寄」模板）。</div>
        </Form>
      </Modal>

      {/* 批量回填 */}
      <Modal title="批量回填快递单号" open={importOpen} onCancel={() => setImportOpen(false)} onOk={doImport} okText="开始回填" width={560}>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6, color: '#5a708a' }}>选择活动（必选）</div>
            <Select
              showSearch optionFilterProp="label" style={{ width: '100%' }}
              placeholder="请选择活动" value={importActivity} onChange={setImportActivity}
              options={activityOptions}
            />
          </div>
          <Upload.Dragger
            accept=".xlsx" maxCount={1} beforeUpload={(f) => { setImportFile(f); return false }}
            onRemove={() => setImportFile(null)}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 Excel 文件到此处</p>
            <p className="ant-upload-hint">列顺序：员工号 | 快递公司 | 快递单号（按员工号匹配，首行可以是表头）</p>
          </Upload.Dragger>
          {importResult && (
            <div style={{ marginTop: 12 }}>
              <div className="ok-tip">成功回填 {importResult.updated} 条，邮件入队 {importResult.mail_queued} 封，错误 {importResult.errors.length} 行</div>
              {importResult.errors.length > 0 && (
                <Table
                  size="small" rowKey={(r: any) => r.row} dataSource={importResult.errors} pagination={false}
                  columns={[
                    { title: '行号', dataIndex: 'row', width: 80, render: (v: number) => `第 ${v} 行` },
                    { title: '内容', dataIndex: 'value' },
                    { title: '原因', dataIndex: 'reason', render: (v: string) => <span style={{ color: '#cf1322' }}>{v}</span> },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
