"""前台用户接口：员工号+邮箱登录、场次余量查询、提交报名、查询我的报名。

余量口径：前端每 5 秒轮询 /api/a/{code}/sessions，仅用于展示；
真正的名额裁决在提交时由 services/booking.py 的原子扣减完成。
"""
import time
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, defer

from ..database import get_db
from ..models import Activity, Contact, Registration, Show, TicketSession
from ..security import create_access_token, decode_token
from ..services.booking import DuplicateRegistration, QuotaExceeded, create_registration
from ..services.mailer import enqueue_mail
from ..utils.timez import now_cn
from ..utils.validators import normalize_email, normalize_employee_no

router = APIRouter(prefix="/api/a", tags=["public"])

# 登录失败限流：同一员工号 5 次错误锁 30 分钟
_failures: dict[str, list[float]] = {}
_FAIL_WINDOW = 1800
_FAIL_LIMIT = 5


def _check_lock(key: str) -> None:
    now = time.time()
    fails = [t for t in _failures.get(key, []) if now - t < _FAIL_WINDOW]
    if len(fails) >= _FAIL_LIMIT:
        raise HTTPException(429, "登录失败次数过多，请 30 分钟后再试")
    _failures[key] = fails


def _record_fail(key: str) -> None:
    _failures.setdefault(key, []).append(time.time())


def _get_activity(code: str, db: Session) -> Activity:
    # 活动介绍里可能嵌着原图 base64（单张 20MB），列表/轮询接口一律不取这一列，
    # 需要正文的地方走专门的 intro 接口按需加载
    activity = (
        db.query(Activity).options(defer(Activity.intro_html))
        .filter(Activity.code == code).first()
    )
    if activity is None:
        raise HTTPException(404, "活动不存在")
    if activity.status == "draft":
        raise HTTPException(404, "活动未开放")
    return activity


def _session_status(activity: Activity, s: TicketSession, now: datetime) -> str:
    # 后台把活动置为「已结束」后，所有场次一律不可报名（页面仍可查看，按钮置灰）
    if activity.status == "ended":
        return "ended"
    if activity.signup_start_at and now < activity.signup_start_at:
        return "not_started"
    if not s.is_open:
        return "closed"
    if now >= s.show_at:
        return "ended"
    if s.capacity - s.sold <= 0:
        return "full"
    return "open"


def _current_user(code: str, authorization: str | None, db: Session) -> tuple[Activity, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "未登录")
    subject = decode_token(authorization.split(" ", 1)[1])
    if not subject or not subject.startswith("user:"):
        raise HTTPException(401, "登录已过期")
    parts = subject.split(":")
    if len(parts) != 3 or parts[1] != code:
        raise HTTPException(401, "登录已过期")
    activity = _get_activity(code, db)
    return activity, parts[2]


def _registration_view(db: Session, reg: Registration) -> dict:
    session = db.query(TicketSession).filter(TicketSession.id == reg.session_id).first()
    show = db.query(Show).filter(Show.id == session.show_id).first() if session else None
    return {
        "id": reg.id,
        "reg_no": reg.reg_no,
        "show_name": show.name if show else "",
        "location": show.location if show else "",
        "address": show.address if show else "",
        "session_name": session.name if session else "",
        "show_at": session.show_at.isoformat() if session else "",
        "phone": reg.phone,
        "companion_count": reg.companion_count,
        "seats": reg.seats,
        "province": reg.province,
        "city": reg.city,
        "county": reg.county,
        "address_detail": reg.address_detail,
        "recipient_name": reg.recipient_name,
        "recipient_phone": reg.recipient_phone,
        "courier_company": reg.courier_company,
        "courier_no": reg.courier_no,
        "status": reg.status,
        "created_at": reg.created_at.isoformat() if reg.created_at else "",
    }


class LoginIn(BaseModel):
    employee_no: str
    email: str


class RegisterIn(BaseModel):
    session_id: int
    phone: str
    companion_count: int = 0
    province: str = ""
    city: str = ""
    county: str = ""
    address_detail: str = ""
    recipient_name: str = ""
    recipient_phone: str = ""
    idempotency_key: str | None = None


@router.post("/{code}/auth/login")
def front_login(code: str, body: LoginIn, db: Session = Depends(get_db)):
    activity = _get_activity(code, db)
    try:
        employee_no = normalize_employee_no(body.employee_no)
        email = normalize_email(body.email)
    except ValueError:
        raise HTTPException(400, "员工号或邮箱格式不正确")

    _check_lock(employee_no)
    contact = (
        db.query(Contact)
        .filter(Contact.activity_id == activity.id, Contact.employee_no == employee_no)
        .first()
    )
    if contact is None or contact.email != email:
        _record_fail(employee_no)
        raise HTTPException(401, "员工号或邮箱不匹配")
    if not contact.is_active:
        raise HTTPException(403, "您未获得本次活动的参与资格")

    _failures.pop(employee_no, None)
    token = create_access_token(f"user:{code}:{employee_no}")
    reg = (
        db.query(Registration)
        .filter(
            Registration.activity_id == activity.id,
            Registration.employee_no == employee_no,
            Registration.status != "cancelled",
        )
        .order_by(Registration.id.desc())
        .first()
    )
    return {
        "token": token,
        "employee_no": employee_no,
        "has_registration": reg is not None,
        "registration": _registration_view(db, reg) if reg else None,
    }


@router.get("/{code}/sessions")
def front_sessions(code: str, db: Session = Depends(get_db)):
    """场次与余量（前台 5 秒轮询）。"""
    activity = _get_activity(code, db)
    now = now_cn()
    shows = (
        db.query(Show).options(defer(Show.intro_html))
        .filter(Show.activity_id == activity.id)
        .order_by(Show.sort, Show.id).all()
    )
    # 只查介绍长度，不把 base64 原图正文拉进内存（这个接口 5 秒轮询一次）
    intro_lens = dict(
        db.query(Show.id, func.length(Show.intro_html))
        .filter(Show.activity_id == activity.id).all()
    )
    sessions = (
        db.query(TicketSession).filter(TicketSession.activity_id == activity.id)
        .order_by(TicketSession.sort, TicketSession.id).all()
    )
    by_show: dict[int, list] = {}
    for s in sessions:
        remaining = s.capacity - s.sold
        status = _session_status(activity, s, now)
        # 结伴人数上限：活动上限与剩余名额-1 的较小值
        companion_max = 0 if not activity.companion_enabled else min(
            activity.companion_max, max(0, remaining - 1)
        )
        by_show.setdefault(s.show_id, []).append({
            "id": s.id,
            "name": s.name,
            "show_at": s.show_at.isoformat(),
            "capacity": s.capacity,
            "sold": s.sold,
            "remaining": remaining,
            "is_open": s.is_open,
            "status": status,
            "companion_max": companion_max,
        })
    return {
        "activity": {
            "code": activity.code,
            "name": activity.name,
            "company_name": activity.company_name,
            "home_bg_image": activity.home_bg_image,
            "title_image": activity.title_image,
            "page_header_image": activity.page_header_image,
            "signup_start_at": activity.signup_start_at.isoformat() if activity.signup_start_at else None,
            "companion_enabled": activity.companion_enabled,
            "companion_max": activity.companion_max,
            "companion_default": activity.companion_default,
            "status": activity.status,
        },
        "shows": [
            {
                "id": sh.id, "name": sh.name,
                "location": sh.location, "address": sh.address,
                "cover_image": sh.cover_image,
                "has_intro": (intro_lens.get(sh.id) or 0) > 0,
                "sessions": by_show.get(sh.id, []),
            }
            for sh in shows
        ],
        "server_time": now.isoformat(),
    }


@router.get("/{code}/shows/{show_id}/intro")
def front_show_intro(code: str, show_id: int, db: Session = Depends(get_db)):
    """按需取单个剧目的演出介绍正文（点「点此查看演出介绍」时才拉）。

    介绍里是原图 base64，单张可达 20MB，放进 5 秒轮询的 sessions 接口会把
    首屏拖垮，所以正文单独走这里。
    """
    activity = _get_activity(code, db)
    show = (
        db.query(Show)
        .filter(Show.id == show_id, Show.activity_id == activity.id)
        .first()
    )
    if show is None:
        raise HTTPException(404, "剧目不存在")
    return {"intro_html": show.intro_html or ""}


@router.post("/{code}/register")
def front_register(
    code: str,
    body: RegisterIn,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    activity, employee_no = _current_user(code, authorization, db)
    # 后台把活动置为「已结束」后不再接受新报名（draft 在 _get_activity 里已按 404 拦掉）
    if activity.status != "active":
        raise HTTPException(400, "活动报名已结束")
    contact = (
        db.query(Contact)
        .filter(Contact.activity_id == activity.id, Contact.employee_no == employee_no)
        .first()
    )
    if contact is None or not contact.is_active:
        raise HTTPException(403, "您未获得本次活动的参与资格")

    session = (
        db.query(TicketSession)
        .filter(TicketSession.id == body.session_id, TicketSession.activity_id == activity.id)
        .first()
    )
    if not session:
        raise HTTPException(404, "场次不存在")
    now = now_cn()
    status = _session_status(activity, session, now)
    if status == "not_started":
        raise HTTPException(400, "报名尚未开始")
    if status == "closed":
        raise HTTPException(400, "该场次未开放报名")
    if status == "ended":
        raise HTTPException(400, "该场次演出已开始，无法报名")
    if body.companion_count < 0:
        raise HTTPException(400, "结伴人数不正确")
    if not activity.companion_enabled and body.companion_count > 0:
        raise HTTPException(400, "本活动不支持携带结伴人")
    if body.companion_count > activity.companion_max:
        raise HTTPException(400, f"最多可携带 {activity.companion_max} 位家属")
    if not body.phone or len(body.phone) < 7:
        raise HTTPException(400, "请填写正确的联系电话")
    if not body.recipient_name:
        raise HTTPException(400, "请填写收件人姓名")
    if not body.recipient_phone or len(body.recipient_phone) < 7:
        raise HTTPException(400, "请填写正确的收件人手机号")
    if not body.province or not body.city:
        raise HTTPException(400, "请选择省份与城市")
    if not body.address_detail:
        raise HTTPException(400, "请填写详细收件地址")

    try:
        reg = create_registration(
            db,
            session_id=session.id,
            activity_id=activity.id,
            employee_no=employee_no,
            email=contact.email,
            companion_count=body.companion_count,
            phone=body.phone,
            province=body.province,
            city=body.city,
            county=body.county,
            address_detail=body.address_detail,
            recipient_name=body.recipient_name,
            recipient_phone=body.recipient_phone,
            idempotency_key=body.idempotency_key,
        )
    except QuotaExceeded:
        raise HTTPException(409, "名额不足或场次已关闭，请刷新后重试")
    except DuplicateRegistration as exc:
        raise HTTPException(409, str(exc) or "您已报名过本次活动，请勿重复提交")

    # 报名确认邮件入队（模板由后台维护；无模板时跳过）
    enqueue_mail(db, activity, reg, "signup")
    return {"ok": True, "registration": _registration_view(db, reg)}


@router.get("/{code}/my")
def front_my(
    code: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """查询我的报名单（登录后分流用）。"""
    activity, employee_no = _current_user(code, authorization, db)
    reg = (
        db.query(Registration)
        .filter(
            Registration.activity_id == activity.id,
            Registration.employee_no == employee_no,
            Registration.status != "cancelled",
        )
        .order_by(Registration.id.desc())
        .first()
    )
    if not reg:
        return {"has_registration": False}
    return {"has_registration": True, "registration": _registration_view(db, reg)}
