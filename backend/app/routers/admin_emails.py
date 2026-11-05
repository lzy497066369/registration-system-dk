"""邮件体系后台接口：模板维护、发信通道配置、发送记录查询与重试。"""
import difflib

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import (
    Activity, EmailOutbox, EmailTemplate, Registration, Show, SystemConfig, TicketSession,
)
from ..services.image_opt import shrink_data_images
from ..services.mailer import (
    DEFAULT_TEMPLATES, QR_IMG, TEMPLATE_VARS, apply_layout, build_values,
    find_unknown_vars, normalize_mail_html, render_template, strip_layout,
)
from ..services.mail_worker import process_outbox, send_mail
from ..utils.timez import now_cn
from ..utils.xss import clean_mail_html, MAX_MAIL_BYTES

router = APIRouter(prefix="/api/admin", tags=["admin-emails"],
                   dependencies=[Depends(require_admin)])

CONFIG_KEYS = [
    "smtp_host", "smtp_port", "smtp_user", "smtp_password",
    "smtp_use_ssl", "mail_from", "mail_from_name", "mail_dry_run",
    "public_base_url",
]

BOOL_KEYS = {"smtp_use_ssl", "mail_dry_run"}


def _norm_bool(value) -> str:
    """Switch 传 true/false、存量数据写 '0'/'1'，统一存成 '1' / '0'。"""
    return "1" if str(value).strip().lower() in {"1", "true", "yes", "on"} else "0"


class TemplateIn(BaseModel):
    activity_id: int
    type: str  # signup / shipped / remind
    subject: str
    body_html: str
    layout_width: int = 70
    layout_center: bool = True


class ConfigIn(BaseModel):
    smtp_host: str = ""
    smtp_port: str = ""
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_ssl: str | bool = "1"
    mail_from: str = ""
    mail_from_name: str = ""
    mail_dry_run: str | bool = "1"
    public_base_url: str = ""


class TestMailIn(BaseModel):
    to_email: str


class TemplateTestIn(BaseModel):
    activity_id: int
    type: str
    to_email: str


@router.get("/email-templates")
def list_templates(activity_id: int | None = None, db: Session = Depends(get_db)):
    """列出模板；某活动某类型未配置时返回内置默认模板供编辑。"""
    query = db.query(EmailTemplate)
    if activity_id:
        query = query.filter(EmailTemplate.activity_id == activity_id)
    saved = {t: t for t in query.all()}

    rows = []
    activity_query = db.query(Activity)
    if activity_id:
        activity_query = activity_query.filter(Activity.id == activity_id)
    for activity in activity_query.order_by(Activity.id).all():
        for mtype, default in DEFAULT_TEMPLATES.items():
            tpl = next(
                (x for x in saved.values()
                 if x.activity_id == activity.id and x.type == mtype), None
            )
            rows.append({
                "activity_id": activity.id,
                "activity_name": activity.name,
                "type": mtype,
                "type_name": default["name"],
                "saved": tpl is not None,
                "subject": tpl.subject if tpl else default["subject"],
                "body_html": tpl.body_html if tpl else default["body_html"],
                "layout_width": tpl.layout_width if tpl else 70,
                "layout_center": tpl.layout_center if tpl else True,
                "updated_at": tpl.updated_at.isoformat() if tpl else None,
            })
    return rows


@router.put("/email-templates")
def save_template(body: TemplateIn, db: Session = Depends(get_db)):
    if body.type not in DEFAULT_TEMPLATES:
        raise HTTPException(400, "模板类型只能是 signup / shipped / remind")
    if not body.subject.strip():
        raise HTTPException(400, "邮件标题不能为空")
    activity = db.query(Activity).filter(Activity.id == body.activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")

    # 邮件正文保留 style/align/表格等排版属性（Word 另存的 HTML 靠它们排版）
    # 内嵌图片先缩到 600px：既能让 70% 宽度生效，也避免 Gmail 因正文超 102KB 截断
    # 外层宽度壳不入库，统一交给 layout_width / layout_center 两个字段
    body_html = strip_layout(normalize_mail_html(shrink_data_images(clean_mail_html(body.body_html))))
    if len(body_html) > MAX_MAIL_BYTES:
        raise HTTPException(
            400,
            f"正文太大（{len(body_html) // 1024} KB），超过 5 MB 上限。"
            "Word 导出的 HTML 会带很多冗余样式与内嵌图片，建议把图片压小或删掉多余空段落。",
        )
    if not body_html.strip():
        raise HTTPException(400, "邮件正文不能为空")
    unknown = find_unknown_vars(body.subject, body_html)
    if unknown:
        suggestions = {
            name: (difflib.get_close_matches(name, TEMPLATE_VARS, n=1) or [""])[0]
            for name in unknown
        }
        raise HTTPException(400, detail={
            "message": "模板里有未定义的变量：" + "、".join("{{" + u + "}}" for u in unknown),
            "unknown_vars": unknown,
            "suggestions": suggestions,
        })

    tpl = (
        db.query(EmailTemplate)
        .filter(EmailTemplate.activity_id == body.activity_id, EmailTemplate.type == body.type)
        .first()
    )
    layout_width = max(20, min(100, body.layout_width or 70))
    if not tpl:
        tpl = EmailTemplate(activity_id=body.activity_id, type=body.type,
                            subject=body.subject, body_html=body_html,
                            layout_width=layout_width, layout_center=bool(body.layout_center))
        db.add(tpl)
    else:
        tpl.subject = body.subject.strip()
        tpl.body_html = body_html
        tpl.layout_width = layout_width
        tpl.layout_center = bool(body.layout_center)
    db.commit()
    return {"ok": True}


@router.get("/email-config")
def get_config(db: Session = Depends(get_db)):
    rows = db.query(SystemConfig).all()
    cfg = {r.key: r.value for r in rows}
    out = {k: cfg.get(k, "") for k in CONFIG_KEYS}
    out["smtp_use_ssl"] = out["smtp_use_ssl"] or "1"
    out["mail_dry_run"] = out["mail_dry_run"] or "1"
    out["has_password"] = bool(cfg.get("smtp_password"))
    out["smtp_password"] = "******" if cfg.get("smtp_password") else ""
    return out


@router.put("/email-config")
def save_config(body: ConfigIn, db: Session = Depends(get_db)):
    values = body.model_dump()
    if values.get("smtp_password") == "******":
        values.pop("smtp_password")
    for key, value in values.items():
        if key in BOOL_KEYS:
            value = _norm_bool(value)
        elif isinstance(value, str):
            value = value.strip()
        row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if not row:
            row = SystemConfig(key=key, value=value or "")
            db.add(row)
        else:
            row.value = value or ""
    db.commit()
    return {"ok": True}


@router.post("/email-config/test")
def send_test_mail(body: TestMailIn, db: Session = Depends(get_db)):
    """用当前配置真发一封测试邮件（不受空跑开关影响），用于验证通道是否打通。"""
    from ..services.mail_worker import send_mail

    to_email = (body.to_email or "").strip()
    if "@" not in to_email:
        raise HTTPException(400, "请填写合法的收件邮箱")

    cfg = {r.key: r.value for r in db.query(SystemConfig).all()}
    if not cfg.get("smtp_host") or not cfg.get("smtp_user") or not cfg.get("smtp_password"):
        raise HTTPException(400, "请先保存发信通道配置（服务器、发信账号、密码）")

    subject = "【测试】SAP北分工会活动报名系统发信通道测试"
    body_html = (
        "<p>这是一封来自「2026 SAP 北分工会冬季家庭主题活动报名系统」的测试邮件。</p>"
        "<p>收到即表示发信通道已打通，可以正常给报名员工发送通知邮件。</p>"
        f'<p style="text-align:center;margin:16px 0">{QR_IMG}</p>'
        "<p>上面这张二维码指向前台登录页。若手机能扫开并进入登录页，说明「前台访问地址」配置正确。</p>"
        f"<p style=\"color:#8a99a8;font-size:12px\">发信账号：{cfg.get('smtp_user')}"
        f"　服务器：{cfg.get('smtp_host')}:{cfg.get('smtp_port') or '465'}"
    )
    activity = db.query(Activity).order_by(Activity.id).first()
    ok, error = send_mail(
        cfg, to_email, subject, body_html, ignore_dry_run=True,
        activity_code=activity.code if activity else "",
    )
    return {"ok": ok, "error": error, "to_email": to_email}


def _test_values(db: Session, activity: Activity) -> tuple[dict, bool]:
    """测试发信用的变量值：优先取该活动最近一条真实报名单，没有就用示例值。"""
    reg = (
        db.query(Registration)
        .filter(Registration.activity_id == activity.id)
        .order_by(Registration.id.desc())
        .first()
    )
    if reg:
        return build_values(db, activity, reg), True

    show = db.query(Show).filter(Show.activity_id == activity.id).order_by(Show.id).first()
    session = (
        db.query(TicketSession).filter(TicketSession.show_id == show.id)
        .order_by(TicketSession.show_at).first()
        if show else None
    )
    return {
        "recipient_name": "张测试",
        "recipient_phone": "13800000000",
        "reg_no": "TEST0001",
        "employee_no": "i000000",
        "email": "test@example.com",
        "activity_name": activity.name,
        "show_name": show.name if show else "测试剧目",
        "session_name": session.name if session else "测试场次",
        "show_at": session.show_at.strftime("%Y-%m-%d %H:%M") if session else "",
        "location": show.location if show else "",
        "address": show.address if show else "",
        "province": "北京市",
        "city": "北京市",
        "county": "西城区",
        "address_detail": "测试路 1 号",
        "companion_count": "1",
        "phone": "13800000000",
        "courier_company": "顺丰速运",
        "courier_no": "SF0000000000",
        "seats": "2",
        "qrcode": QR_IMG,
    }, False


@router.post("/email-templates/test")
def send_template_test(body: TemplateTestIn, db: Session = Depends(get_db)):
    """按某条模板真发一封测试邮件（不受空跑开关影响），用于核对版式与变量替换结果。"""
    to_email = (body.to_email or "").strip()
    if "@" not in to_email:
        raise HTTPException(400, "请填写合法的收件邮箱")

    activity = db.query(Activity).filter(Activity.id == body.activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")

    tpl = (
        db.query(EmailTemplate)
        .filter(EmailTemplate.activity_id == activity.id, EmailTemplate.type == body.type)
        .first()
    )
    if tpl:
        raw_body, raw_subject = tpl.body_html, tpl.subject
        width, center = tpl.layout_width, tpl.layout_center
    else:
        # 还没定制过：用内置默认模板，跟列表里展示的一致
        default = DEFAULT_TEMPLATES.get(body.type)
        if not default:
            raise HTTPException(404, "模板类型不存在")
        raw_body, raw_subject = default["body_html"], default["subject"]
        width, center = 70, True

    cfg = {r.key: r.value for r in db.query(SystemConfig).all()}
    if not cfg.get("smtp_host") or not cfg.get("smtp_user") or not cfg.get("smtp_password"):
        raise HTTPException(400, "请先保存发信通道配置（服务器、发信账号、密码）")

    values, real_data = _test_values(db, activity)
    subject = render_template(raw_subject, values)
    body_html = apply_layout(render_template(raw_body, values), width, center)

    ok, error = send_mail(
        cfg, to_email, subject, body_html, ignore_dry_run=True,
        activity_code=activity.code,
    )
    return {
        "ok": ok, "error": error, "to_email": to_email,
        "subject": subject, "real_data": real_data,
    }


@router.get("/email-outbox")
def list_outbox(
    activity_id: int | None = None,
    mail_type: str = "",
    status: str = "",
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(EmailOutbox)
    if activity_id:
        query = query.filter(EmailOutbox.activity_id == activity_id)
    if mail_type:
        query = query.filter(EmailOutbox.type == mail_type)
    if status:
        query = query.filter(EmailOutbox.status == status)
    total = query.count()
    rows = (
        query.order_by(EmailOutbox.id.desc())
        .offset((max(1, page) - 1) * page_size)
        .limit(min(200, page_size))
        .all()
    )
    activity_names = {a.id: a.name for a in db.query(Activity).all()}
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "activity_name": activity_names.get(r.activity_id, ""),
                "type": r.type,
                "type_name": DEFAULT_TEMPLATES.get(r.type, {}).get("name", r.type),
                "to_email": r.to_email,
                "subject": r.subject,
                "status": r.status,
                "retry_count": r.retry_count,
                "last_error": r.last_error,
                "sent_at": r.sent_at.isoformat() if r.sent_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else "",
                "body_html": r.body_html,
            }
            for r in rows
        ],
    }


@router.delete("/email-outbox")
def clear_outbox(
    activity_id: int | None = None,
    mail_type: str = "",
    status: str = "",
    db: Session = Depends(get_db),
):
    """按当前筛选条件清空发送记录；不带条件则清空全部。"""
    query = db.query(EmailOutbox)
    if activity_id:
        query = query.filter(EmailOutbox.activity_id == activity_id)
    if mail_type:
        query = query.filter(EmailOutbox.type == mail_type)
    if status:
        query = query.filter(EmailOutbox.status == status)
    deleted = query.delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@router.delete("/email-outbox/{item_id}")
def delete_outbox_item(item_id: int, db: Session = Depends(get_db)):
    """删除单条发送记录（只删记录，不影响已经发出去的邮件）。"""
    row = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
    if not row:
        raise HTTPException(404, "邮件记录不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/email-outbox/send-now")
def send_now():
    """立即处理一轮待发邮件（后台手动触发发送 worker）。"""
    count = process_outbox(limit=50)
    return {"processed": count}


@router.post("/email-outbox/{item_id}/resend")
def resend_outbox(item_id: int, db: Session = Depends(get_db)):
    """按当前模板重新生成一封并立即发送，用于测试模板效果。

    模板或关联报名单已不存在时，退回用原记录内容（历史快照）发送。
    """
    row = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
    if not row:
        raise HTTPException(404, "邮件记录不存在")

    cfg = {r.key: r.value for r in db.query(SystemConfig).all()}
    subject, body_html, source = row.subject, row.body_html, "snapshot"

    reg = (
        db.query(Registration).filter(Registration.id == row.registration_id).first()
        if row.registration_id
        else None
    )
    activity = db.query(Activity).filter(Activity.id == row.activity_id).first()
    if reg and activity:
        tpl = (
            db.query(EmailTemplate)
            .filter(EmailTemplate.activity_id == activity.id, EmailTemplate.type == row.type)
            .first()
        )
        if tpl:
            values = build_values(db, activity, reg)
            subject = render_template(tpl.subject, values)
            body_html = apply_layout(
                render_template(tpl.body_html, values),
                tpl.layout_width, tpl.layout_center,
            )
            source = "template"

    item = EmailOutbox(
        activity_id=row.activity_id,
        registration_id=row.registration_id,
        type=row.type,
        to_email=row.to_email,
        subject=subject,
        body_html=body_html,
        status="sending",
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    ok, error = send_mail(
        cfg, item.to_email, item.subject, item.body_html,
        activity_code=activity.code if activity else "",
    )
    item.status = "sent" if ok else "failed"
    item.retry_count = 1
    item.last_error = error
    if ok:
        item.sent_at = now_cn()
    db.commit()

    return {
        "ok": ok,
        "error": error,
        "id": item.id,
        "source": source,
        "to_email": item.to_email,
        "subject": item.subject,
        "dry_run": cfg.get("mail_dry_run", "1") == "1",
    }
