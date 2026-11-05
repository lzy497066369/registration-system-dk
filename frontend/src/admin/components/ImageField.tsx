import { Button, Image, Space, Tooltip, Upload } from 'antd'
import { EyeOutlined, UploadOutlined } from '@ant-design/icons'

/**
 * 图片字段：已上传则显示缩略图（可点开看大图），未上传显示上传按钮。
 * 缩略图下方提供「查看大图」与「替换」两个操作。
 */
export default function ImageField({
  label,
  value,
  onUpload,
  tip,
}: {
  label: string
  value?: string
  onUpload: (file: File) => void
  tip?: string
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, color: '#5a708a', marginBottom: 6 }}>{label}</div>
      {value ? (
        <Space direction="vertical" size={6}>
          <Image
            src={value}
            alt={label}
            width={132}
            height={72}
            style={{
              objectFit: 'cover', borderRadius: 6, border: '1px solid #e4e9ee', cursor: 'pointer',
            }}
            preview={{ mask: <EyeOutlined style={{ fontSize: 18 }} /> }}
          />
          <Space size={4}>
            <Tooltip title="在新窗口查看原图">
              <Button size="small" icon={<EyeOutlined />} href={value} target="_blank">查看大图</Button>
            </Tooltip>
            <Upload beforeUpload={onUpload} showUploadList={false} accept="image/*">
              <Button size="small" icon={<UploadOutlined />}>替换</Button>
            </Upload>
          </Space>
          {tip && <span style={{ fontSize: 12, color: '#8a99a8' }}>{tip}</span>}
        </Space>
      ) : (
        <Upload beforeUpload={onUpload} showUploadList={false} accept="image/*">
          <Button icon={<UploadOutlined />}>上传</Button>
        </Upload>
      )}
    </div>
  )
}
