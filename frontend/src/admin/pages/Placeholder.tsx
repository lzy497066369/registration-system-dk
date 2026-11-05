import { Card, Empty, Tag } from 'antd'

export default function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <Card title={title}>
      <Empty description={<span>{desc}<br /><Tag color="blue">下一轮交付</Tag></span>} />
    </Card>
  )
}
