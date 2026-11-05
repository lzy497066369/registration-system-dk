import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Upload, message,
} from 'antd'
import { DeleteOutlined, DownloadOutlined, InboxOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { api, downloadApi, uploadApi } from '../../api'
import { useActivity } from '../ActivityContext'

export default function Contacts() {
  const { activities } = useActivity()
  const [params] = useSearchParams()
  // 支持从「活动管理 → 快捷进入 → 员工」带 ?activity_id= 直接过滤
  const [activityId, setActivityId] = useState<number | undefined>(() => {
    const v = params.get('activity_id')
    return v ? Number(v) : undefined
  })
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [active, setActive] = useState<string>('')
  const [importResult, setImportResult] = useState<any>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importActivity, setImportActivity] = useState<number | undefined>(undefined)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const { message: msg, modal } = App.useApp()

  async function load(p = 1, size = pageSize) {
    try {
      const params = new URLSearchParams({ page: String(p), page_size: String(size), keyword, active })
      if (activityId) params.set('activity_id', String(activityId))
      const data = await api(`/api/admin/contacts?${params.toString()}`)
      setItems(data.items); setTotal(data.total); setPage(p); setPageSize(size)
    } catch (err: any) {
      msg.error(err.message)
    }
  }
  useEffect(() => { load(1) }, [activityId])

  useEffect(() => {
    const v = params.get('activity_id')
    if (v) setActivityId(Number(v))
  }, [params])

  async function doImport() {
    if (!importActivity) { msg.warning('请选择导入到哪个活动'); return }
    if (!importFile) { msg.warning('请选择 Excel 文件'); return }
    try {
      const res = await uploadApi(`/api/admin/activities/${importActivity}/contacts/import`, importFile)
      setImportResult(res)
      msg.success(`导入完成：新增 ${res.inserted} 条，更新 ${res.updated} 条，错误 ${res.errors.length} 行`)
      setImportOpen(false); setImportFile(null); setImportActivity(undefined)
      load(1)
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  async function clearContacts(mode: 'unregistered' | 'all') {
    if (!activityId) { msg.warning('请先在上方选择要清除的所属活动'); return }
    const act = activities.find((a) => a.id === activityId)
    const isAll = mode === 'all'
    modal.confirm({
      title: isAll
        ? `确认清空「${act?.name || '该活动'}」的全部员工？`
        : `确认删除「${act?.name || '该活动'}」中未报名的数据？`,
      width: 560,
      content: isAll ? (
        <div style={{ lineHeight: 1.9 }}>
          <div>· 该活动下的员工：<b>全部删除</b>（含已报名的）</div>
          <div>· 报名单不会被删除，报名管理里仍可查看、导出</div>
          <div style={{ color: '#cf1322' }}>
            · 已报名的员工删除后<b>无法再登录前台</b>查看自己的报名，需要重新导入才能恢复
          </div>
          <div style={{ color: '#cf1322', marginTop: 8 }}>删除后不可恢复，建议先点「导出 Excel」备份。</div>
        </div>
      ) : (
        <div style={{ lineHeight: 1.9 }}>
          <div>· 没有报名记录的员工：<b>整批删除</b></div>
          <div>· 已有报名记录的员工：<b>保留</b>（报过名的只能停用，不能删除）</div>
          <div style={{ color: '#cf1322', marginTop: 8 }}>删除后不可恢复，建议先点「导出 Excel」备份。</div>
        </div>
      ),
      okText: isAll ? '确认全部清空' : '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await api(
            `/api/admin/activities/${activityId}/contacts/clear?mode=${mode}`,
            { method: 'POST' },
          )
          msg.success(
            isAll
              ? `已清空 ${res.deleted} 条`
              : `已删除 ${res.deleted} 条${res.kept > 0 ? `，保留 ${res.kept} 条（有报名记录）` : ''}`,
          )
          load(1)
        } catch (err: any) {
          msg.error(err.message)
        }
      },
    })
  }

  async function addOne() {
    const v = await form.validateFields()
    try {
      await api(`/api/admin/activities/${v.activity_id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ employee_no: v.employee_no, email: v.email, is_active: true }),
      })
      msg.success('已添加')
      setAddOpen(false)
      form.resetFields()
      load(1)
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  function openEdit(row: any) {
    setEditing(row)
    editForm.resetFields()
    editForm.setFieldsValue({
      employee_no: row.employee_no,
      email: row.email,
      is_active: row.is_active,
    })
    setEditOpen(true)
  }

  async function saveEdit() {
    const v = await editForm.validateFields()
    try {
      await api(`/api/admin/contacts/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          employee_no: v.employee_no,
          email: v.email,
          is_active: !!v.is_active,
        }),
      })
      msg.success('已保存')
      setEditOpen(false)
      load(page)
    } catch (err: any) {
      msg.error(err.message)
    }
  }

  const columns: any[] = [
    { title: '所属活动', dataIndex: 'activity_name', width: 170 },
    { title: '员工号', dataIndex: 'employee_no', width: 130 },
    { title: '邮箱', dataIndex: 'email' },
    {
      title: '状态', dataIndex: 'is_active', width: 100,
      render: (v: boolean) => (v ? <Tag color="blue">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '已报名', dataIndex: 'has_registration', width: 100,
      render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '操作', width: 230, render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" onClick={async () => {
            try {
              await api(`/api/admin/contacts/${r.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !r.is_active }) })
              msg.success(r.is_active ? '已停用' : '已启用'); load(page)
            } catch (err: any) { msg.error(err.message) }
          }}>{r.is_active ? '停用' : '启用'}</Button>
          <Popconfirm title="确定删除该员工？有报名记录的员工无法删除。" onConfirm={async () => {
            try { await api(`/api/admin/contacts/${r.id}`, { method: 'DELETE' }); msg.success('已删除'); load(page) }
            catch (err: any) { msg.error(err.message) }
          }}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const activityOptions = activities.map((a) => ({ value: a.id, label: a.name }))

  return (
    <Card
      title="员工管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => load(page)}>刷新</Button>
          <Button icon={<DownloadOutlined />} disabled={!activities.length}
                  onClick={() => downloadApi(
                    activityId ? `/api/admin/contacts/export?activity_id=${activityId}` : '/api/admin/contacts/export',
                    '员工管理.xlsx',
                  ).catch((e) => msg.error(e.message))}>
            导出 Excel
          </Button>
          <Button icon={<UploadOutlined />} disabled={!activities.length}
                  onClick={() => { setImportActivity(activityId); setImportOpen(true) }}>
            导入 Excel
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!activities.length}
                  onClick={() => {
                    form.resetFields()
                    form.setFieldsValue({ activity_id: activityId })
                    setAddOpen(true)
                  }}>添加员工</Button>
          <Button danger icon={<DeleteOutlined />} disabled={!activities.length}
                  onClick={() => clearContacts('unregistered')}>删除未报名数据</Button>
          <Button danger type="primary" icon={<DeleteOutlined />} disabled={!activities.length}
                  onClick={() => clearContacts('all')}>删除所有数据</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <span>所属活动：</span>
        <Select
          showSearch optionFilterProp="label" allowClear
          placeholder="全部活动（不选即显示全部）" style={{ width: 280 }}
          value={activityId}
          onChange={(v) => setActivityId(v === undefined ? undefined : v)}
          options={activityOptions}
        />
        <Input.Search placeholder="搜索员工号 / 邮箱" allowClear style={{ width: 240 }}
                      onSearch={(v) => { setKeyword(v); load(1) }} />
        <Select
          style={{ width: 130 }}
          value={active}
          onChange={(v) => { setActive(v); load(1) }}
          options={[
            { value: '', label: '全部状态' },
            { value: '1', label: '启用' },
            { value: '0', label: '停用' },
          ]}
        />
      </Space>
      {importResult && importResult.errors.length > 0 && (
        <Table
          style={{ marginBottom: 12 }}
          size="small"
          rowKey={(r: any) => r.row}
          dataSource={importResult.errors}
          pagination={false}
          columns={[
            { title: 'Excel 行号', dataIndex: 'row', width: 100, render: (v: number) => `第 ${v} 行` },
            { title: '内容', dataIndex: 'value' },
            { title: '错误原因', dataIndex: 'reason', render: (v: string) => <span style={{ color: '#cf1322' }}>{v}</span> },
          ]}
        />
      )}
      <Table
        rowKey="id" dataSource={items} columns={columns} size="middle"
        scroll={{ x: 900 }}
        pagination={{
          current: page, pageSize, total,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => load(p, s),
        }}
      />

      {/* 添加员工 */}
      <Modal title="添加员工" open={addOpen} onCancel={() => setAddOpen(false)} onOk={addOne} forceRender>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="activity_id" label="所属活动" rules={[{ required: true, message: '请选择所属活动' }]}>
            <Select showSearch optionFilterProp="label" options={activityOptions} />
          </Form.Item>
          <Form.Item name="employee_no" label="员工号" rules={[{ required: true, message: '请填写员工号' }]}>
            <Input placeholder="i + 6 位数字，如 i123456" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请填写邮箱' }]}>
            <Input placeholder="如 name@company.com" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑单条记录 */}
      <Modal title="编辑员工信息" open={editOpen} onCancel={() => setEditOpen(false)} onOk={saveEdit} forceRender>
        <Form form={editForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="employee_no"
            label="员工号"
            extra={editing?.has_registration ? '该员工已有有效报名单，员工号不可修改' : undefined}
            rules={[{ required: true, message: '请填写员工号' }]}
          >
            <Input placeholder="i + 6 位数字，如 i123456" disabled={editing?.has_registration} />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请填写邮箱' }]}>
            <Input placeholder="如 name@company.com" />
          </Form.Item>
          <Form.Item name="is_active" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入 Excel：先选活动再选文件 */}
      <Modal title="导入员工" open={importOpen} onCancel={() => setImportOpen(false)} onOk={doImport} okText="开始导入">
        <div style={{ marginTop: 12 }}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, color: '#5a708a' }}>导入到哪个活动（必选）</label>
            <Select
              showSearch optionFilterProp="label"
              placeholder="请选择活动" style={{ width: '100%' }}
              value={importActivity}
              onChange={setImportActivity}
              options={activityOptions}
            />
          </div>
          <Upload.Dragger
            accept=".xlsx" maxCount={1} beforeUpload={(f) => { setImportFile(f); return false }}
            onRemove={() => setImportFile(null)}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 Excel 文件到此处</p>
            <p className="ant-upload-hint">第 1 列员工号（i+6 位数字），第 2 列邮箱；只支持 .xlsx</p>
          </Upload.Dragger>
        </div>
      </Modal>
    </Card>
  )
}
