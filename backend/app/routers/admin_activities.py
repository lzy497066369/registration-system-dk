"""活动管理：新建/编辑/状态流转/图片上传。活动编码创建后不可修改。"""
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import (
    Activity, Contact, EmailOutbox, EmailTemplate, Registration, RegistrationLog, Show, TicketSession,
)
from ..utils.files import save_image
from ..utils.xss import clean_rich_html, oversized_data_images

router = APIRouter(
    prefix="/api/admin/activities", tags=["admin-activities"],
    dependencies=[Depends(require_admin)],
)

VALID_STATUS = {"draft", "active", "ended"}


class ActivityIn(BaseModel):
    code: str
    name: str
    company_name: str = ""
    intro_html: str = ""
    signup_start_at: str | None = None  # ISO 格式，如 2026-11-20T10:00:00
    companion_enabled: bool = True
    companion_max: int = 2
    companion_default: int = 1
    remind_hours_before: int = 24


class ActivityUpdate(BaseModel):
    name: str | None = None
    company_name: str | None = None
    intro_html: str | None = None
    signup_start_at: str | None = None
    companion_enabled: bool | None = None
    companion_max: int | None = None
    companion_default: int | None = None
    remind_hours_before: int | None = None


class StatusIn(BaseModel):
    status: str


def _parse_dt(value: str | None):
    if not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("T", " ").replace("Z", ""))
    except ValueError:
        raise HTTPException(400, f"时间格式不正确：{value}")


def _guard_intro_images(raw: str) -> None:
    """活动介绍的内嵌图有单张上限，超了会被清洗环节静默丢弃（保存成功但图没了）。"""
    big = oversized_data_images(raw)
    if not big:
        return
    mb = max(big) / 1024 / 1024
    raise HTTPException(
        400,
        f"有 {len(big)} 张图片过大（最大的约 {mb:.1f}MB），单张上限约 15MB。"
        "请换一张小一些的图片。",
    )


@router.get("")
def list_activities(db: Session = Depends(get_db)):
    rows = db.query(Activity).order_by(Activity.id.desc()).all()
    return [
        {
            "id": a.id, "code": a.code, "name": a.name,
            "company_name": a.company_name, "status": a.status,
            "signup_start_at": a.signup_start_at,
            "companion_enabled": a.companion_enabled, "companion_max": a.companion_max,
            "companion_default": a.companion_default,
            "remind_hours_before": a.remind_hours_before,
            "home_bg_image": a.home_bg_image,
            "title_image": a.title_image,
            "page_header_image": a.page_header_image,
            "created_at": a.created_at,
        }
        for a in rows
    ]


@router.post("")
def create_activity(body: ActivityIn, db: Session = Depends(get_db)):
    if not re.match(r"^[a-z0-9][a-z0-9-]{2,31}$", body.code):
        raise HTTPException(400, "活动编码须为 3-32 位小写字母、数字或连字符")
    _guard_intro_images(body.intro_html)
    if not body.name.strip():
        raise HTTPException(400, "活动名称不能为空")
    if db.query(Activity).filter(Activity.code == body.code).first():
        raise HTTPException(400, "活动编码已存在")
    activity = Activity(
        code=body.code,
        name=body.name.strip(),
        company_name=body.company_name.strip(),
        intro_html=clean_rich_html(body.intro_html),
        signup_start_at=_parse_dt(body.signup_start_at),
        companion_enabled=body.companion_enabled,
        companion_max=max(0, body.companion_max),
        companion_default=min(max(0, body.companion_default), max(0, body.companion_max)),
        remind_hours_before=max(1, body.remind_hours_before),
        status="draft",
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return {"id": activity.id, "code": activity.code}


@router.get("/{activity_id}")
def get_activity(activity_id: int, db: Session = Depends(get_db)):
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    return {
        "id": activity.id, "code": activity.code, "name": activity.name,
        "company_name": activity.company_name,
        "home_bg_image": activity.home_bg_image,
        "title_image": activity.title_image,
        "page_header_image": activity.page_header_image,
        "intro_html": activity.intro_html,
        "signup_start_at": activity.signup_start_at,
        "companion_enabled": activity.companion_enabled,
        "companion_max": activity.companion_max,
        "companion_default": activity.companion_default,
        "remind_hours_before": activity.remind_hours_before,
        "status": activity.status,
    }


@router.put("/{activity_id}")
def update_activity(activity_id: int, body: ActivityUpdate, db: Session = Depends(get_db)):
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    data = body.model_dump(exclude_unset=True)
    if "intro_html" in data:
        _guard_intro_images(data["intro_html"] or "")
        data["intro_html"] = clean_rich_html(data["intro_html"])
    if "signup_start_at" in data:
        data["signup_start_at"] = _parse_dt(data["signup_start_at"])
    if "companion_max" in data and data["companion_max"] is not None:
        data["companion_max"] = max(0, data["companion_max"])
    if "remind_hours_before" in data and data["remind_hours_before"] is not None:
        data["remind_hours_before"] = max(1, data["remind_hours_before"])
    # 默认随行人数不能超过结伴上限；联动收敛（上限 / 默认值单独改了都做一次钳制）
    if "companion_default" in data and data["companion_default"] is not None:
        data["companion_default"] = max(0, data["companion_default"])
    eff_max = data.get("companion_max", activity.companion_max)
    eff_default = data.get("companion_default", activity.companion_default)
    if not (data.get("companion_enabled", activity.companion_enabled)):
        data["companion_default"] = 0
    elif eff_default > max(0, eff_max):
        data["companion_default"] = max(0, eff_max)
    for key, value in data.items():
        setattr(activity, key, value)
    db.commit()
    return {"ok": True}


@router.delete("/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    """已有报名记录的活动不可删除，只可下线（FR-B-02-08）。

    其余子表（邮件模板、发送记录、操作日志、员工、场次、剧目）按外键依赖顺序一并清理，
    否则 PG 会抛外键约束错误（前端只看到「请求失败」）。
    """
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    has_reg = (
        db.query(Registration.id)
        .filter(Registration.activity_id == activity_id).first() is not None
    )
    if has_reg:
        raise HTTPException(400, "该活动已有报名记录，不可删除，可将状态改为「已结束」")
    try:
        # 先删依赖 registrations/staff 的叶子表，再删主表
        db.query(EmailOutbox).filter(EmailOutbox.activity_id == activity_id).delete()
        db.query(EmailTemplate).filter(EmailTemplate.activity_id == activity_id).delete()
        db.query(RegistrationLog).filter(RegistrationLog.activity_id == activity_id).delete()
        db.query(Contact).filter(Contact.activity_id == activity_id).delete()
        db.query(TicketSession).filter(TicketSession.activity_id == activity_id).delete()
        db.query(Show).filter(Show.activity_id == activity_id).delete()
        db.delete(activity)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "该活动下仍有报名或发信等关联数据，无法删除；可先把状态改为「已结束」")
    return {"ok": True}


@router.put("/{activity_id}/status")
def change_status(activity_id: int, body: StatusIn, db: Session = Depends(get_db)):
    if body.status not in VALID_STATUS:
        raise HTTPException(400, "状态只能为 draft / active / ended")
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    activity.status = body.status
    db.commit()
    return {"ok": True}


@router.post("/{activity_id}/image")
async def upload_image(
    activity_id: int,
    file: UploadFile,
    kind: str = "home_bg",  # home_bg=首页底图 title=活动标题块图 page_header=内页头图
    db: Session = Depends(get_db),
):
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    if kind not in ("home_bg", "title", "page_header"):
        raise HTTPException(400, "kind 只能是 home_bg / title / page_header")
    path = await save_image(file)
    if kind == "home_bg":
        activity.home_bg_image = path
    elif kind == "title":
        activity.title_image = path
    else:
        activity.page_header_image = path
    db.commit()
    return {"path": path}
