import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatShowTime, cleanAddress, joinRegion, frontApi, getToken, guardHasRegistration, setActivityTitle } from '../api'
import '../front.css'

export default function Success() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const [reg, setReg] = useState<any>(null)
  const [activity, setActivity] = useState<any>(null)

  useEffect(() => {
    frontApi.sessions(code).then((d) => {
      setActivity(d.activity)
      // 浏览器标题统一用后台配置的活动名称
      setActivityTitle(d.activity?.name)
    }).catch(() => {})
    // 报名信息一律以「登录员工号当前的有效报名单」为准，不再回退浏览器旧快照，
    // 否则后台把报名取消/删除后，刷新成功页仍会显示「报名成功」。
    ;(async () => {
      const redirect = await guardHasRegistration(code)
      if (redirect) { nav(redirect, { replace: true }); return }
      const token = getToken(code)
      if (token) {
        frontApi.my(code, token)
          .then((d) => { if (d.has_registration) setReg(d.registration) })
          .catch(() => {})
      }
    })()
  }, [code])

  // 邮寄状态：后台回填快递单号后状态为 shipped；老数据只有单号没改状态也算已邮寄
  const shipped = reg?.status === 'shipped' || !!reg?.courier_no

  const banner = activity?.page_header_image || '/images/banner.png'

  return (
    <div className="list1-page">
      <img className="banner-img" src={banner} alt={activity?.name || ''} />

      <div className="list-wrap">
        <div className="suc-tip">
          <img className="suc-icon" src="/images/suc.png" alt="" />
          <div className="suc-text center">
            <p className="suc-title">您已成功报名！</p>
            <p className="suc-desc">以下为您提交的报名信息</p>
          </div>
        </div>
        <div className="info-r">
          <div className="info-row">
            <span className="info-label">演出选择</span>
            <span className="info-value info-value-strong">{reg?.show_name || '-'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">演出场次时间</span>
            <span className="info-value info-value-strong">
              {reg?.show_at ? formatShowTime(reg.show_at) : '-'}
            </span>
          </div>
          {/* 与其他信息行同一套样式：左侧标签 + 右侧值 */}
          <div className="info-row">
            <span className="info-label">演出地点</span>
            <span className="info-value info-value-strong">{reg?.location || '待定'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">详细地址</span>
            <span className="info-value info-value-strong aright">
              {cleanAddress(reg?.address) || '待定'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">您的联系电话</span>
            <span className="info-value info-value-strong">{reg?.phone || '-'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">观演人数</span>
            <span className="info-value info-value-strong">
              {reg?.seats ?? (reg?.companion_count ?? 0) + 1} 人
            </span>
          </div>
          {/* 邮寄信息分组：收件人 / 联系电话 走两列行，邮寄地址长文本单独块状整行 */}
          <div className="info-group-title">票券邮寄信息</div>
          <div className="info-row">
            <span className="info-label">收件人</span>
            <span className="info-value info-value-strong">{reg?.recipient_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">联系电话</span>
            <span className="info-value info-value-strong">{reg?.recipient_phone}</span>
          </div>
          <div className="info-row info-row-block">
            <span className="info-label">邮寄地址</span>
            <span className="info-value info-value-strong">
              {joinRegion(reg?.province, reg?.city, reg?.county, reg?.address_detail)}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">邮寄状态</span>
            <span className={`info-value info-value-strong ${shipped ? 'ship-shipped' : 'ship-waiting'}`}>
              {shipped ? '已邮寄' : '等待邮寄'}
            </span>
          </div>
          {shipped && (
            <>
              <div className="info-row">
                <span className="info-label">快递公司</span>
                <span className="info-value info-value-strong">{reg?.courier_company || '-'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">快递单号</span>
                <span className="info-value info-value-strong">{reg?.courier_no || '-'}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
