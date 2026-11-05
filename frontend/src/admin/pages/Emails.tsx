import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert, App, Button, Card, Col, Descriptions, Form, Input, Modal, Popconfirm, Row, Select,
  Space, Switch, Table, Tag, message,
} from 'antd'
import { DeleteOutlined, EditOutlined, MailOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../../api'
import { useActivity } from '../ActivityContext'
import RichTextEditor from '../components/RichTextEditor'

const STATUS_COLOR: Record<string, string> = {
  queued: 'blue', sending: 'processing', sent: 'green', failed: 'red',
}

const STATUS_TEXT: Record<string, string> = {
  queued: '待发送', sending: '发送中', sent: '已发送', failed: '发送失败',
}

export default function Emails() {
  const { activities } = useActivity()
  const [searchParams] = useSearchParams()
  // 支持从「活动管理 → 快捷进入 → 邮件模板」带 ?activity_id= 直接过滤
  const [activityId, setActivityId] = useState<number | undefined>(() => {
    const v = searchParams.get('activity_id')
    return v ? Number(v) : undefined
  })
  const [templates, setTemplates] = useState<any[]>([])
  const [config, setConfig] = useState<any>(null)
  const [outbox, setOutbox] = useState<any[]>([])
  const [outboxTotal, setOutboxTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [mailType, setMailType] = useState('')
  const [mailStatus, setMailStatus] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const [preview, setPreview] = useState<any>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testResult, setTestResult] = useState<any>(null)
  const [testing, setTesting] = useState(false)
  // 行内「发送测试」：针对某一条模板，用它的内容真发一封
  const [tplTest, setTplTest] = useState<any>(null)
  const [tplTestTo, setTplTestTo] = useState('272344013@qq.com')
  const [tplTestResult, setTplTestResult] = useState<any>(null)
  const [tplTesting, setTplTesting] = useState(false)
  const [form] = Form.useForm()
  const [configForm] = Form.useForm()
  const quillRef = useRef<any>(null)
  const { message: msg, modal } = App.useApp()
  // 版式改动要实时反映到源码预览里
  const watchWidth = Form.useWatch('layout_width', form) as number | undefined
  const watchCenter = Form.useWatch('layout_center', form) as boolean | undefined

  async function loadTemplates() {
    try {
      const q = activityId ? `?activity_id=${activityId}` : ''
      setTemplates(await api(`/api/admin/email-templates${q}`))
    } catch (err: any) { msg.error(err.message) }
  }

  async function loadConfig() {
    try {
      const cfg = await api('/api/admin/email-config')
      // 没配过就用「你现在打开后台的这个地址」，换隧道/域名后回这里点保存
      if (!cfg.public_base_url) cfg.public_base_url = window.location.origin
      setConfig(cfg)
      configForm.setFieldsValue(cfg)
    } catch (err: any) { /* ignore */ }
  }

  async function loadOutbox(p = 1, type = mailType, st = mailStatus) {
    try {
      const params = new URLSearchParams({ page: String(p), page_size: '20' })
      if (activityId) params.set('activity_id', String(activityId))
      if (type) params.set('mail_type', type)
      if (st) params.set('status', st)
      const data = await api(`/api/admin/email-outbox?${params.toString()}`)
      setOutbox(data.items); setOutboxTotal(data.total); setPage(p)
    } catch (err: any) { msg.error(err.message) }
  }

  useEffect(() => { loadTemplates(); loadOutbox(1) }, [activityId])
  useEffect(() => { loadConfig() }, [])

  useEffect(() => {
    const v = searchParams.get('activity_id')
    if (v) setActivityId(Number(v))
  }, [searchParams])

  function openEdit(tpl: any) {
    setEditing(tpl)
    form.resetFields()
    form.setFieldsValue({
      subject: tpl.subject,
      body_html: tpl.body_html,
      layout_width: tpl.layout_width ?? 70,
      layout_center: tpl.layout_center ?? true,
    })
  }

  /** 把光标定位到正文里写错的变量上；返回 false 表示正文里没找到（可能在标题里）。 */
  function focusUnknownVar(name: string): boolean {
    const token = `{{${name}}}`
    // 源码模式由编辑器内部 textarea 定位
    if (quillRef.current?.focusToken?.(token)) return true
    const quill = quillRef.current?.getEditor?.()
    if (!quill) return false
    const text: string = quill.getText()
    let idx = text.indexOf(token)
    let len = token.length
    if (idx < 0) {
      idx = text.indexOf(name)
      len = name.length
    }
    if (idx < 0) return false
    quill.setSelection(idx, len)
    quill.focus()
    return true
  }

  async function saveTemplate() {
    const v = await form.validateFields()
    const body = v.body_html || ''
    if (!body.trim()) {
      msg.error('邮件正文不能为空')
      return
    }
    try {
      await api('/api/admin/email-templates', {
        method: 'PUT',
        body: JSON.stringify({
          activity_id: editing.activity_id, type: editing.type,
          subject: v.subject, body_html: body,
          layout_width: v.layout_width ?? 70, layout_center: v.layout_center ?? true,
        }),
      })
      msg.success('模板已保存')
      setEditing(null)
      loadTemplates()
    } catch (err: any) {
      const detail = err.detail
      const bad: string[] = detail?.unknown_vars || []
      if (bad.length) {
        const sug: Record<string, string> = detail?.suggestions || {}
        modal.warning({
          title: `模板里有 ${bad.length} 个变量名写错了，暂未保存`,
          width: 540,
          content: (
            <div style={{ lineHeight: 2 }}>
              {bad.map((n) => (
                <div key={n}>
                  <code style={{ color: '#cf1322', background: '#fff1f0', padding: '1px 4px' }}>
                    {`{{${n}}}`}
                  </code>
                  {sug[n] ? (
                    <> 是不是想写 <code style={{ color: '#389e0d' }}>{`{{${sug[n]}}}`}</code> ？</>
                  ) : (
                    <> 不是系统支持的变量</>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 10, color: '#8a99a8', fontSize: 12 }}>
                点「去修改」后光标会停在第一个写错的变量上，改完再点确定即可。可用变量清单在正文下方。
              </div>
            </div>
          ),
          okText: '去修改',
          onOk: () => {
            setTimeout(() => {
              if (!focusUnknownVar(bad[0])) {
                msg.info('这个变量在邮件标题里，请检查上方的标题输入框')
              }
            }, 150)
          },
        })
        return
      }
      msg.error(err.message)
    }
  }

  async function saveConfig() {
    const v = await configForm.validateFields()
    try {
      await api('/api/admin/email-config', { method: 'PUT', body: JSON.stringify(v) })
      msg.success('发信通道已保存')
      setConfigOpen(false)
      loadConfig()
    } catch (err: any) { msg.error(err.message) }
  }

  async function sendNow() {
    try {
      const res = await api('/api/admin/email-outbox/send-now', { method: 'POST' })
      msg.success(`已处理 ${res.processed} 封邮件`)
      loadOutbox(page)
    } catch (err: any) { msg.error(err.message) }
  }

  async function sendTest() {
    if (!testTo.trim() || !testTo.includes('@')) { msg.warning('请填写合法的收件邮箱'); return }
    setTesting(true); setTestResult(null)
    try {
      const res = await api('/api/admin/email-config/test', {
        method: 'POST', body: JSON.stringify({ to_email: testTo.trim() }),
      })
      if (res.ok) {
        // 成功就走人：只留一条「发送完成」提示，不占着弹窗
        setTestOpen(false)
        setTestResult(null)
        msg.success('发送完成')
      } else {
        setTestResult(res)
        msg.error('发送失败，请看下方原因')
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message })
      msg.error(err.message)
    } finally {
      setTesting(false)
    }
  }

  function openTplTest(row: any) {
    setTplTest(row)
    setTplTestResult(null)
  }

  // 用这一条模板的内容真发一封：变量优先填该活动最近一条真实报名数据
  async function sendTplTest() {
    const to = tplTestTo.trim()
    if (!to || !to.includes('@')) { msg.warning('请填写合法的收件邮箱'); return }
    setTplTesting(true); setTplTestResult(null)
    try {
      const res = await api('/api/admin/email-templates/test', {
        method: 'POST',
        body: JSON.stringify({ activity_id: tplTest.activity_id, type: tplTest.type, to_email: to }),
      })
      if (res.ok) {
        // 发完自动收起弹窗；用示例数据时顺带提一句，免得以为变量没填对
        setTplTest(null)
        setTplTestResult(null)
        msg.success(
          res.real_data === false
            ? '发送完成（该活动暂无报名单，变量用的是示例数据）'
            : '发送完成',
        )
      } else {
        setTplTestResult(res)
        msg.error('发送失败，请看弹窗里的原因')
      }
    } catch (err: any) {
      setTplTestResult({ ok: false, error: err.message })
      msg.error(err.message)
    } finally { setTplTesting(false) }
  }

  async function resendRow(row: any) {
    try {
      const res = await api(`/api/admin/email-outbox/${row.id}/resend`, { method: 'POST' })
      if (!res.ok) {
        modal.error({
          title: '重发失败',
          width: 560,
          content: <div style={{ wordBreak: 'break-all', lineHeight: 1.8 }}>{res.error || '未知错误'}</div>,
        })
      } else if (res.dry_run) {
        msg.warning('当前是空跑模式：只重新生成入库，没有真的外发。要真发请先关掉空跑。')
      } else {
        msg.success(`已重新发送到 ${res.to_email}`)
      }
      loadOutbox(page)
    } catch (err: any) { msg.error(err.message) }
  }

  // 单条删除：只删记录，不影响已发出的邮件；删掉本页最后一条时回退一页
  async function deleteOutboxRow(row: any) {
    try {
      await api(`/api/admin/email-outbox/${row.id}`, { method: 'DELETE' })
      msg.success('已删除该条发送记录')
      const nextPage = outbox.length === 1 && page > 1 ? page - 1 : page
      loadOutbox(nextPage)
    } catch (err: any) { msg.error(err.message) }
  }

  // 清空：按当前筛选条件删（活动 / 类型 / 状态都会带上），不选就清全部
  async function clearOutbox() {
    try {
      const params = new URLSearchParams()
      if (activityId) params.set('activity_id', String(activityId))
      if (mailType) params.set('mail_type', mailType)
      if (mailStatus) params.set('status', mailStatus)
      const q = params.toString()
      const res = await api(`/api/admin/email-outbox${q ? `?${q}` : ''}`, { method: 'DELETE' })
      msg.success(`已删除 ${res.deleted} 条发送记录`)
      loadOutbox(1)
    } catch (err: any) { msg.error(err.message) }
  }

  const columns: any[] = [
    { title: '所属活动', dataIndex: 'activity_name', width: 170 },
    { title: '邮件类型', dataIndex: 'type_name', width: 110, render: (v: string) => (
      <Tag style={{ marginRight: 0 }}>{v}</Tag>
    ) },
    {
      title: '邮件标题', dataIndex: 'subject', ellipsis: true,
      // 「未定制」badge 放进标题列自己的一行（flex + ellipsis），
      // 以前塞在「邮件类型」列里，两个 Tag 挤不下会溢出、压到标题文字上。
      render: (v: string, r: any) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!r.saved && (
            <Tag color="orange" style={{ marginRight: 0, flex: 'none' }}
                 title="还没保存过自定义内容，暂用系统默认模板">
              未定制
            </Tag>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {v}
          </span>
        </div>
      ),
    },
    {
      title: '版式', dataIndex: 'layout_width', width: 110,
      render: (w: number, r: any) => `${w ?? 70}%${r.layout_center ?? true ? ' 居中' : ' 靠左'}`,
    },
    { title: '更新时间', dataIndex: 'updated_at', width: 170, render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '未保存') },
    {
      title: '操作', width: 210, render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" icon={<SendOutlined />} onClick={() => openTplTest(r)}>
            发送测试
          </Button>
        </Space>
      ),
    },
  ]

  const outboxColumns: any[] = [
    { title: '所属活动', dataIndex: 'activity_name', width: 110, ellipsis: true },
    { title: '类型', dataIndex: 'type_name', width: 84 },
    { title: '收件邮箱', dataIndex: 'to_email', width: 160, ellipsis: true },
    { title: '邮件标题', dataIndex: 'subject', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 112,
      render: (s: string, r: any) => (
        <Space direction="vertical" size={2} style={{ maxWidth: 112 }}>
          <Tag color={STATUS_COLOR[s]} style={{ marginRight: 0 }}>{STATUS_TEXT[s] || s}</Tag>
          {r.last_error && (
            // 错误信息可能很长（如 gaierror ...），单行省略、悬停看全文，避免把行撑成竖条
            <span
              title={r.last_error}
              style={{
                display: 'block', maxWidth: 96, fontSize: 11, color: '#999',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {r.last_error}
            </span>
          )}
        </Space>
      ),
    },
    { title: '发送时间', dataIndex: 'sent_at', width: 140, render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-') },
    {
      title: '操作', width: 240, render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setPreview(r)}>查看内容</Button>
          <Popconfirm
            title="重发这封邮件？"
            description="会用「当前模板 + 该报名单数据」重新生成内容，发到原收件邮箱。"
            okText="发送" cancelText="取消"
            onConfirm={() => resendRow(r)}
          >
            <Button type="link" size="small" style={{ padding: 0 }} icon={<SendOutlined />}>重发</Button>
          </Popconfirm>
          <Popconfirm
            title="删除这条发送记录？"
            description="只删除记录，不会召回已发出的邮件。"
            okText="删除" okButtonProps={{ danger: true }} cancelText="取消"
            onConfirm={() => deleteOutboxRow(r)}
          >
            <Button type="link" size="small" danger style={{ padding: 0 }} icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const activityOptions = activities.map((a) => ({ value: a.id, label: a.name }))

  return (
    <div>
      <Card
        title="邮件模板"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { loadTemplates(); loadOutbox(page) }}>刷新</Button>
            <Button icon={<MailOutlined />} onClick={() => { loadConfig(); setTestResult(null); setTestTo(''); setTestOpen(true) }}>
              发送测试邮件
            </Button>
            <Button onClick={() => { loadConfig(); setConfigOpen(true) }}>发信通道配置</Button>
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
          <Tag color={config?.mail_dry_run === '1' ? 'orange' : 'green'}>
            {config?.mail_dry_run === '1' ? '空跑模式：只生成不外发' : '正式发送模式'}
          </Tag>
          {config?.smtp_host && <Tag>通道：{config.smtp_host}:{config.smtp_port || 465}</Tag>}
        </Space>
        <Table rowKey={(r: any) => `${r.activity_id}-${r.type}`} dataSource={templates} columns={columns} size="middle"
               pagination={false} scroll={{ x: 900 }} />
      </Card>

      <Card
        title="发送记录"
        extra={
          <Space>
            <Select style={{ width: 140 }} value={mailType} onChange={(v) => { setMailType(v); loadOutbox(1, v, mailStatus) }}
                    options={[
                      { value: '', label: '全部类型' },
                      { value: 'signup', label: '报名成功' },
                      { value: 'shipped', label: '已邮寄' },
                      { value: 'remind', label: '观演提醒' },
                    ]} />
            <Select style={{ width: 130 }} value={mailStatus} onChange={(v) => { setMailStatus(v); loadOutbox(1, mailType, v) }}
                    options={[
                      { value: '', label: '全部状态' },
                      { value: 'queued', label: '待发送' },
                      { value: 'sending', label: '发送中' },
                      { value: 'sent', label: '已发送' },
                      { value: 'failed', label: '发送失败' },
                    ]} />
            <Button icon={<SendOutlined />} onClick={sendNow}>立即发送一轮</Button>
            <Popconfirm
              title="清空发送记录？"
              description={
                <div style={{ maxWidth: 320 }}>
                  将按当前筛选条件删除
                  {activityId ? '所选活动' : '全部活动'}、
                  {mailType ? `「${({ signup: '报名成功', shipped: '已邮寄', remind: '观演提醒' } as any)[mailType] || mailType}」` : '全部类型'}、
                  {mailStatus ? `「${({ queued: '待发送', sending: '发送中', sent: '已发送', failed: '发送失败' } as any)[mailStatus] || mailStatus}」` : '全部状态'}
                  的记录，共 {outboxTotal} 条。删除后不可恢复，但不会召回已发出的邮件。
                </div>
              }
              okText="清空" okButtonProps={{ danger: true }} cancelText="取消"
              onConfirm={clearOutbox}
            >
              <Button danger icon={<DeleteOutlined />}>清空记录</Button>
            </Popconfirm>
          </Space>
        }
        style={{ marginTop: 16 }}
      >
        <Table rowKey="id" dataSource={outbox} columns={outboxColumns} size="middle" scroll={{ x: 920 }}
          pagination={{
            current: page, pageSize: 20, total: outboxTotal, showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => loadOutbox(p),
          }} />
      </Card>

      {/* 编辑模板 */}
      <Modal
        title={`编辑模板：${editing?.type_name || ''}（${editing?.activity_name || ''}）`}
        open={!!editing} onCancel={() => setEditing(null)} onOk={saveTemplate} width={1000} forceRender
        styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="subject" label="邮件标题" rules={[{ required: true, message: '请填写邮件标题' }]}>
            <Input placeholder="可用变量：{{recipient_name}} {{activity_name}} {{show_name}} {{show_at}} {{reg_no}}" />
          </Form.Item>
          <Form.Item label="整篇版式" style={{ marginBottom: 12 }}>
            <Space size={12} wrap>
              <Form.Item name="layout_width" noStyle>
                <Select
                  style={{ width: 140 }}
                  options={[
                    { value: 100, label: '100% 通栏' },
                    { value: 90, label: '90% 宽' },
                    { value: 80, label: '80% 宽' },
                    { value: 70, label: '70% 宽（推荐）' },
                    { value: 60, label: '60% 宽' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="layout_center" valuePropName="checked" noStyle>
                <Switch checkedChildren="居中" unCheckedChildren="靠左" />
              </Form.Item>
              <span style={{ fontSize: 12, color: '#8a99a8' }}>
                发信时自动给正文套这层宽度，编辑器里怎么改都不会丢
              </span>
            </Space>
          </Form.Item>
          <Form.Item name="body_html" label="邮件正文">
            <RichTextEditor
              key={editing ? `${editing.activity_id}-${editing.type}` : 'none'}
              ref={quillRef} height={420} placeholder="在此编写邮件正文，可用变量见下方清单"
              layoutWidth={watchWidth ?? 70}
              layoutCenter={watchCenter ?? true}
            />
          </Form.Item>
          <div style={{ marginTop: -12, marginBottom: 4, fontSize: 12, color: '#8a99a8', lineHeight: 1.9 }}>
            可用变量：
            <code>{'{{recipient_name}}'}</code> 收件人{' · '}
            <code>{'{{recipient_phone}}'}</code> 收件人手机号{' · '}
            <code>{'{{phone}}'}</code> 报名人电话{' · '}
            <code>{'{{reg_no}}'}</code> 报名编号{' · '}
            <code>{'{{employee_no}}'}</code> 员工号{' · '}
            <code>{'{{email}}'}</code> 报名邮箱
            <br />
            <code>{'{{activity_name}}'}</code> 活动{' · '}
            <code>{'{{show_name}}'}</code> 剧目{' · '}
            <code>{'{{session_name}}'}</code> 场次{' · '}
            <code>{'{{show_at}}'}</code> 演出时间{' · '}
            <code>{'{{location}}'}</code> 演出地点{' · '}
            <code>{'{{address}}'}</code> 场馆地址
            <br />
            <code>{'{{province}}'}</code> <code>{'{{city}}'}</code> <code>{'{{county}}'}</code>{' '}
            <code>{'{{address_detail}}'}</code> 邮寄地址{' · '}
            <code>{'{{companion_count}}'}</code> 随行人数{' · '}
            <code>{'{{seats}}'}</code> 占用名额{' · '}
            <code>{'{{courier_company}}'}</code> <code>{'{{courier_no}}'}</code> 快递信息{' · '}
            <code>{'{{qrcode}}'}</code> 报名进度二维码
            <br />
            <span style={{ color: '#5a708a' }}>
              二维码按下方「前台访问地址」自动生成并内嵌，扫一扫打开前台登录页；
              不写这个变量，邮件里就没有二维码。
            </span>
            <br />
            <span style={{ color: '#c98a1a' }}>变量名写错会原样显示为 {'{{xxx}}'}，发出前请用「发送测试邮件」核对。</span>
          </div>
        </Form>
      </Modal>

      {/* 发信通道配置 */}
      <Modal title="发信通道配置（企业微信邮箱）" open={configOpen} onCancel={() => setConfigOpen(false)} onOk={saveConfig} width={640} forceRender>
        <Form form={configForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="smtp_host" label="SMTP 服务器">
              <Input placeholder="smtp.exmail.qq.com" />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="smtp_port" label="端口"><Input placeholder="465" /></Form.Item></Col>
            <Col span={12}><Form.Item name="smtp_user" label="发信账号"><Input placeholder="noreply@company.com" /></Form.Item></Col>
            <Col span={12}><Form.Item name="smtp_password" label="发信密码（客户端专用密码）">
              <Input.Password placeholder={config?.has_password ? '已配置，留空则不修改' : '请输入密码'} />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="mail_from" label="发件人地址（须与发信账号一致）">
              <Input placeholder="support@imprforest.com" />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="mail_from_name" label="发件人显示名">
              <Input placeholder="SAP北分工会" />
            </Form.Item></Col>
            <Col span={24}>
              <Form.Item
                name="public_base_url"
                label="前台访问地址（邮件里的二维码指向这里）"
                extra={
                  <span style={{ fontSize: 12 }}>
                    当前后台地址：<b>{window.location.origin}</b>
                    <Button type="link" size="small" style={{ padding: '0 4px' }}
                            onClick={() => configForm.setFieldValue('public_base_url', window.location.origin)}>
                      用这个地址
                    </Button>
                    （临时隧道每次重启都会变，换地址后回这里点保存）
                  </span>
                }
              >
                <Input placeholder="https://xxx.trycloudflare.com" />
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="smtp_use_ssl" label="使用 SSL 加密"
              getValueProps={(v) => ({ checked: String(v) === '1' || v === true })}
              normalize={(v) => (v ? '1' : '0')}>
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item></Col>
            <Col span={12}>
              <Form.Item name="mail_dry_run" label="空跑模式（只生成不外发）"
                getValueProps={(v) => ({ checked: String(v) === '1' || v === true })}
                normalize={(v) => (v ? '1' : '0')}>
                <Switch checkedChildren="空跑" unCheckedChildren="正式发送" />
              </Form.Item>
            </Col>
          </Row>
          <Descriptions size="small" column={1} style={{ color: '#8a99a8' }}>
            <Descriptions.Item label="说明">正式上线前：填入企业微信邮箱的客户端专用密码，并关闭空跑模式；开发期保持空跑，邮件只入库不外发。</Descriptions.Item>
          </Descriptions>
        </Form>
      </Modal>

      {/* 发送测试邮件 */}
      <Modal
        title="发送测试邮件" open={testOpen} onCancel={() => setTestOpen(false)}
        onOk={sendTest} okText="发送" confirmLoading={testing} width={560} forceRender
      >
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6, color: '#5a708a' }}>收件邮箱</div>
          <Input
            value={testTo} onChange={(e) => setTestTo(e.target.value)} onPressEnter={sendTest}
            placeholder="填你自己的邮箱，如 yaya@imprforest.com"
          />
          <div style={{ fontSize: 12, color: '#8a99a8', marginTop: 8 }}>
            用当前已保存的通道配置<b>真发一封</b>，不受空跑开关影响。测试前请先保存「发信通道配置」。
          </div>
          {testResult && (
            <Alert
              style={{ marginTop: 12 }}
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              message={testResult.ok ? `已发送到 ${testResult.to_email}` : '发送失败'}
              description={
                testResult.ok
                  ? '通道已打通。若收件箱没看到，请查垃圾邮件夹（首次发信容易被归入推广/垃圾）。'
                  : <span style={{ wordBreak: 'break-all' }}>{testResult.error || '未知错误'}</span>
              }
            />
          )}
        </div>
      </Modal>

      {/* 某一条模板的发送测试 */}
      <Modal
        title={`发送测试：${tplTest?.type_name || ''}（${tplTest?.activity_name || ''}）`}
        open={!!tplTest} onCancel={() => setTplTest(null)}
        onOk={sendTplTest} okText="发送" confirmLoading={tplTesting} width={560}
        okButtonProps={{ icon: <SendOutlined /> }}
      >
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6, color: '#5a708a' }}>收件邮箱</div>
          <Input
            value={tplTestTo} onChange={(e) => setTplTestTo(e.target.value)}
            onPressEnter={sendTplTest}
            placeholder="272344013@qq.com"
          />
          <div style={{ fontSize: 12, color: '#8a99a8', marginTop: 8 }}>
            用这条模板<b>已保存</b>的内容真发一封（不受空跑开关影响）。变量会填成该活动最近一条
            报名数据，该活动还没有报名单时用示例值——发出去的样子就是收件人看到的样子。
          </div>
          {tplTestResult && (
            <Alert
              style={{ marginTop: 12 }}
              type={tplTestResult.ok ? 'success' : 'error'}
              showIcon
              message={tplTestResult.ok ? `已发送到 ${tplTestResult.to_email}` : '发送失败'}
              description={
                tplTestResult.ok
                  ? (
                    <>
                      <div>邮件标题：{tplTestResult.subject}</div>
                      <div>
                        变量数据来源：{tplTestResult.real_data ? '该活动最近一条真实报名单' : '示例值（该活动暂无报名单）'}
                      </div>
                      <div>收件箱没看到的话，查一下垃圾邮件夹。</div>
                    </>
                  )
                  : <span style={{ wordBreak: 'break-all' }}>{tplTestResult.error || '未知错误'}</span>
              }
            />
          )}
        </div>
      </Modal>

      {/* 查看邮件内容 */}
      <Modal title="邮件内容预览" open={!!preview} onCancel={() => setPreview(null)} footer={null} width={640}>
        <div style={{ marginBottom: 8, color: '#8a99a8', fontSize: 12 }}>收件人：{preview?.to_email}</div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{preview?.subject}</div>
        <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 12, maxHeight: '55vh', overflowY: 'auto' }}
             dangerouslySetInnerHTML={{
               __html: (preview?.body_html || '').replace(
                 /<img[^>]*cid:[^>]*>/g,
                 '<span style="color:#8a99a8;font-size:12px">〔二维码：实际发送时按前台地址自动生成〕</span>',
               ),
             }} />
      </Modal>
    </div>
  )
}
