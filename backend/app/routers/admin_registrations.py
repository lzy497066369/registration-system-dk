"""报名管理：列表筛选、联系/邮寄信息编辑（留痕）、取消、快递单号回填（单个+批量）、
导出 Excel、实时看板。"""
import io
import urllib.parse

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_admin, require_admin, scoped_activity_ids
from ..models import (
    Activity, AdminUser, EmailOutbox, Registration, RegistrationLog, Show, TicketSession,
)
from ..services.mailer import enqueue_mail
from ..utils.timez import now_cn

router = APIRouter(prefix="/api/admin/registrations", tags=["admin-registrations"],
                   dependencies=[Depends(get_current_admin)])

STATUS_TEXT = {"pending": "待邮寄", "shipped": "已邮寄", "cancelled": "已取消"}

# 允许后台编辑的六项信息
EDITABLE_FIELDS = {
    "phone": "联系电话",
    "province": "省份",
    "city": "城市",
    "county": "区县",
    "address_detail": "详细地址",
    "recipient_name": "收件人姓名",
    "recipient_phone": "收件人手机号",
}


def _row_view(db: Session, reg: Registration, show: Show | None, session: TicketSession | None) -> dict:
    return {
        "id": reg.id,
        "reg_no": reg.reg_no,
        "employee_no": reg.employee_no,
        "email": reg.email,
        "activity_id": reg.activity_id,
        "show_id": session.show_id if session else None,
        "show_name": show.name if show else "",
        "location": show.location if show else "",
        "address": show.address if show else "",
        "session_id": reg.session_id,
        "session_name": session.name if session else "",
        "show_at": session.show_at.isoformat() if session else "",
        "companion_count": reg.companion_count,
        "seats": reg.seats,
        "phone": reg.phone,
        "province": reg.province,
        "city": reg.city,
        "county": reg.county,
        "address_detail": reg.address_detail,
        "recipient_name": reg.recipient_name,
        "recipient_phone": reg.recipient_phone,
        "courier_company": reg.courier_company,
        "courier_no": reg.courier_no,
        "status": reg.status,
        "status_text": STATUS_TEXT.get(reg.status, reg.status),
        "created_at": reg.created_at.isoformat() if reg.created_at else "",
    }


def _load_relations(db: Session, regs: list[Registration]):
    show_ids = {r.session_id for r in regs}
    sessions = {
        s.id: s for s in db.query(TicketSession).filter(TicketSession.id.in_(show_ids)).all()
    } if show_ids else {}
    show_ids_set = {s.show_id for s in sessions.values()}
    shows = {
        s.id: s for s in db.query(Show).filter(Show.id.in_(show_ids_set)).all()
    } if show_ids_set else {}
    return shows, sessions


def _apply_filters(
    query,
    *,
    db: Session,
    activity_id: int | None = None,
    show_id: int | None = None,
    session_id: int | None = None,
    status: str = "",
    keyword: str = "",
):
    """列表与导出共用同一套筛选，保证「看到什么就导出什么」。"""
    # 取消功能已下线（只保留删除）：历史「已取消」单子不再出现在列表 / 导出里，
    # 效果等同已删除，避免「报名总数里混着取消单」的歧义。
    query = query.filter(Registration.status != "cancelled")
    if activity_id:
        query = query.filter(Registration.activity_id == activity_id)
    if session_id:
        query = query.filter(Registration.session_id == session_id)
    if show_id:
        session_ids = [s.id for s in db.query(TicketSession).filter(TicketSession.show_id == show_id).all()]
        query = query.filter(Registration.session_id.in_(session_ids or [0]))
    if status:
        query = query.filter(Registration.status == status)
    if keyword.strip():
        kw = f"%{keyword.strip()}%"
        query = query.filter(
            (Registration.employee_no.like(kw))
            | (Registration.email.like(kw))
            | (Registration.reg_no.like(kw))
            | (Registration.recipient_name.like(kw))
            | (Registration.recipient_phone.like(kw))
            | (Registration.courier_no.like(kw))
        )
    return query


@router.get("")
def list_registrations(
    activity_id: int | None = None,
    show_id: int | None = None,
    session_id: int | None = None,
    status: str = "",
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Registration)
    # 只读账号只看到自己被绑定的活动；管理员不受限
    allowed = scoped_activity_ids(db, admin)
    if allowed is not None:
        query = query.filter(Registration.activity_id.in_(allowed or {-1}))
    if activity_id:
        if allowed is not None and activity_id not in allowed:
            raise HTTPException(403, "无权限查看该活动的报名信息")
        query = query.filter(Registration.activity_id == activity_id)
    query = _apply_filters(
        query, db=db, show_id=show_id, session_id=session_id,
        status=status, keyword=keyword,
    )

    total = query.count()
    regs = (
        query.order_by(Registration.id.desc())
        .offset((max(1, page) - 1) * page_size)
        .limit(min(200, page_size))
        .all()
    )
    shows, sessions = _load_relations(db, regs)
    activity_names = {a.id: a.name for a in db.query(Activity).all()}
    return {
        "total": total,
        "items": [
            {
                **_row_view(
                    db, r,
                    shows.get(sessions[r.session_id].show_id) if r.session_id in sessions else None,
                    sessions.get(r.session_id),
                ),
                "activity_name": activity_names.get(r.activity_id, ""),
            }
            for r in regs
        ],
    }


@router.get("/export")
def export_registrations(
    activity_id: int | None = None,
    show_id: int | None = None,
    session_id: int | None = None,
    status: str = "",
    keyword: str = "",
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Registration)
    allowed = scoped_activity_ids(db, admin)
    if allowed is not None:
        query = query.filter(Registration.activity_id.in_(allowed or {-1}))
    if activity_id:
        if allowed is not None and activity_id not in allowed:
            raise HTTPException(403, "无权限导出该活动的报名信息")
        query = query.filter(Registration.activity_id == activity_id)
    query = _apply_filters(
        query, db=db, show_id=show_id, session_id=session_id,
        status=status, keyword=keyword,
    )
    regs = query.order_by(Registration.id).all()
    shows, sessions = _load_relations(db, regs)
    activity_names = {a.id: a.name for a in db.query(Activity).all()}

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "报名记录"
    ws.append([
        "报名编号", "所属活动", "员工号", "邮箱", "剧目", "场次", "演出时间",
        "结伴人数", "占用名额", "联系电话", "省份", "城市", "区县", "详细地址",
        "收件人姓名", "收件人手机号", "快递公司", "快递单号", "报名状态", "报名时间",
    ])
    for r in regs:
        show = shows.get(sessions[r.session_id].show_id) if r.session_id in sessions else None
        session = sessions.get(r.session_id)
        ws.append([
            r.reg_no,
            activity_names.get(r.activity_id, ""),
            r.employee_no, r.email,
            show.name if show else "",
            session.name if session else "",
            session.show_at.strftime("%Y-%m-%d %H:%M") if session else "",
            r.companion_count, r.seats, r.phone, r.province, r.city, r.county, r.address_detail,
            r.recipient_name, r.recipient_phone, r.courier_company, r.courier_no,
            STATUS_TEXT.get(r.status, r.status),
            r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
        ])
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    now = now_cn().strftime("%Y%m%d_%H%M%S")
    filename = urllib.parse.quote(f"报名记录_{now}.xlsx")
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.get("/stats")
def registration_stats(
    activity_id: int | None = None,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """实时看板：报名总数、各状态、占用名额、各场次余量。"""
    query = db.query(Registration)
    allowed = scoped_activity_ids(db, admin)
    if allowed is not None:
        query = query.filter(Registration.activity_id.in_(allowed or {-1}))
    if activity_id:
        if allowed is not None and activity_id not in allowed:
            raise HTTPException(403, "无权限查看该活动的统计")
        query = query.filter(Registration.activity_id == activity_id)
    # 与列表同口径：历史已取消的单子不计入任何统计
    regs = query.filter(Registration.status != "cancelled").all()

    counts = {"pending": 0, "shipped": 0}
    seats = 0
    for r in regs:
        counts[r.status] = counts.get(r.status, 0) + 1
        seats += r.seats

    session_query = db.query(TicketSession)
    if allowed is not None:
        session_query = session_query.filter(TicketSession.activity_id.in_(allowed or {-1}))
    if activity_id:
        session_query = session_query.filter(TicketSession.activity_id == activity_id)
    sessions = session_query.order_by(TicketSession.sort, TicketSession.id).all()
    show_ids = {s.show_id for s in sessions}
    shows = {s.id: s for s in db.query(Show).filter(Show.id.in_(show_ids)).all()} if show_ids else {}

    by_show: dict[int, dict] = {}
    for s in sessions:
        item = by_show.setdefault(s.show_id, {
            "show_id": s.show_id,
            "show_name": shows[s.show_id].name if s.show_id in shows else "",
            "capacity": 0, "sold": 0, "remaining": 0, "sessions": [],
        })
        item["capacity"] += s.capacity
        item["sold"] += s.sold
        item["remaining"] += s.capacity - s.sold
        item["sessions"].append({
            "id": s.id, "name": s.name,
            "show_at": s.show_at.isoformat(),
            "capacity": s.capacity, "sold": s.sold,
            "remaining": s.capacity - s.sold,
            "is_open": s.is_open,
        })

    recent = sorted(regs, key=lambda r: r.id, reverse=True)[:10]
    return {
        "total": len(regs),
        "pending": counts.get("pending", 0),
        "shipped": counts.get("shipped", 0),
        "seats": seats,
        "shows": list(by_show.values()),
        "recent": [
            {
                "id": r.id, "reg_no": r.reg_no, "employee_no": r.employee_no,
                "seats": r.seats, "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in recent
        ],
    }


class ContactUpdate(BaseModel):
    phone: str | None = None
    province: str | None = None
    city: str | None = None
    county: str | None = None
    address_detail: str | None = None
    recipient_name: str | None = None
    recipient_phone: str | None = None


@router.put("/{registration_id}/contact")
def update_contact(
    registration_id: int,
    body: ContactUpdate,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """编辑报名单的六项联系/邮寄信息，并记录修改留痕。"""
    reg = db.query(Registration).filter(Registration.id == registration_id).first()
    if not reg:
        raise HTTPException(404, "报名单不存在")
    if reg.status == "cancelled":
        raise HTTPException(400, "已取消的报名单不可编辑")

    data = body.model_dump(exclude_unset=True)
    if "phone" in data and data["phone"] and len(data["phone"]) < 7:
        raise HTTPException(400, "联系电话格式不正确")
    if "recipient_phone" in data and data["recipient_phone"] and len(data["recipient_phone"]) < 7:
        raise HTTPException(400, "收件人手机号格式不正确")

    changed = []
    for field, value in data.items():
        if field not in EDITABLE_FIELDS:
            continue
        old = getattr(reg, field) or ""
        new = (value or "").strip()
        if old == new:
            continue
        setattr(reg, field, new)
        db.add(RegistrationLog(
            registration_id=reg.id,
            activity_id=reg.activity_id,
            field=EDITABLE_FIELDS[field],
            old_value=old,
            new_value=new,
            operator=getattr(admin, "username", "admin"),
        ))
        changed.append(field)
    db.commit()
    return {"ok": True, "changed": changed}


@router.delete("/{registration_id}")
def delete_registration(
    registration_id: int,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """删除报名单（物理删除）：删除即视为取消报名，记录不再存在，员工可重新报名。

    - 按落库的 seats 退回名额（原子扣减，防止 sold 变负）
    - 关联的修改留痕与邮件队列记录一并删除（外键为 NO ACTION，必须先删子表）
    - 删除后 active_key 随之消失，该员工可以重新报名
    """
    reg = db.query(Registration).filter(Registration.id == registration_id).first()
    if not reg:
        raise HTTPException(404, "报名单不存在")

    reg_no = reg.reg_no or f"#{reg.id}"
    released = 0
    if reg.status != "cancelled":
        db.execute(
            text(
                "UPDATE ticket_sessions SET sold = sold - :seats "
                "WHERE id = :sid AND sold >= :seats"
            ),
            {"seats": reg.seats, "sid": reg.session_id},
        )
        released = reg.seats

    db.query(EmailOutbox).filter(EmailOutbox.registration_id == reg.id).delete(
        synchronize_session=False
    )
    db.query(RegistrationLog).filter(RegistrationLog.registration_id == reg.id).delete(
        synchronize_session=False
    )
    db.delete(reg)
    db.commit()
    return {
        "ok": True,
        "registration_id": registration_id,
        "reg_no": reg_no,
        "released": released,
        "operator": getattr(admin, "username", "admin"),
    }


@router.post("/clear")
def clear_registrations(
    activity_id: int,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """清空某活动的全部报名单（物理删除）。

    - 未取消的报名单按场次汇总后批量退回名额（原子扣减，不会把 sold 扣成负数）
    - 该活动的修改留痕与邮件队列一并清除
    - 报名单删除后员工可重新报名，场次名额回到初始状态
    """
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")

    regs = db.query(Registration).filter(Registration.activity_id == activity_id).all()
    if not regs:
        return {
            "activity_id": activity_id, "activity_name": activity.name,
            "deleted": 0, "released": 0,
        }

    # 按场次汇总需退回的名额：已取消的单子当初已释放过，不再重复退
    refund: dict[int, int] = {}
    for r in regs:
        if r.status != "cancelled" and r.seats:
            refund[r.session_id] = refund.get(r.session_id, 0) + r.seats

    released = 0
    for sid, seats in refund.items():
        result = db.execute(
            text(
                "UPDATE ticket_sessions SET sold = sold - :seats "
                "WHERE id = :sid AND sold >= :seats"
            ),
            {"seats": seats, "sid": sid},
        )
        if result.rowcount:
            released += seats

    db.query(EmailOutbox).filter(EmailOutbox.activity_id == activity_id).delete(
        synchronize_session=False
    )
    db.query(RegistrationLog).filter(RegistrationLog.activity_id == activity_id).delete(
        synchronize_session=False
    )
    deleted = (
        db.query(Registration)
        .filter(Registration.activity_id == activity_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {
        "activity_id": activity_id,
        "activity_name": activity.name,
        "deleted": deleted,
        "released": released,
        "operator": getattr(admin, "username", "admin"),
    }


class TrackingIn(BaseModel):
    courier_company: str = ""
    courier_no: str = ""
    notify: bool = True  # 是否发送「已邮寄」提醒邮件

@router.put("/{registration_id}/tracking")
def update_tracking(
    registration_id: int,
    body: TrackingIn,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """回填快递公司与快递单号，并可触发已邮寄提醒邮件。"""
    reg = db.query(Registration).filter(Registration.id == registration_id).first()
    if not reg:
        raise HTTPException(404, "报名单不存在")
    if reg.status == "cancelled":
        raise HTTPException(400, "已取消的报名单不可回填")
    if not body.courier_no.strip():
        raise HTTPException(400, "请填写快递单号")

    old_company, old_no = reg.courier_company, reg.courier_no
    reg.courier_company = body.courier_company.strip()
    reg.courier_no = body.courier_no.strip()
    if reg.status == "pending":
        reg.status = "shipped"
    db.add(RegistrationLog(
        registration_id=reg.id, activity_id=reg.activity_id,
        field="快递单号", old_value=old_no or "", new_value=reg.courier_no,
        operator=getattr(admin, "username", "admin"),
    ))
    db.commit()

    mailed = False
    if body.notify:
        activity = db.query(Activity).filter(Activity.id == reg.activity_id).first()
        if activity:
            mailed = enqueue_mail(db, activity, reg, "shipped")
    return {"ok": True, "mail_queued": mailed}


@router.post("/import-tracking")
async def import_tracking(
    file: UploadFile = File(...),
    activity_id: int | None = None,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Excel 批量回填快递单号：列顺序「员工号 | 快递公司 | 快递单号」，仅按员工号匹配。"""
    data = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(400, "无法解析 Excel 文件，请使用 .xlsx 格式")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        raise HTTPException(400, "Excel 内容为空")

    updated = 0
    errors: list[dict] = []
    mails = 0
    for idx, row in enumerate(rows, start=1):
        if not row or all(c is None for c in row[:3]):
            continue
        employee_no = str(row[0] or "").strip().lower()
        courier_company = str(row[1] or "").strip()
        courier_no = str(row[2] or "").strip()
        # 首行是表头时跳过（用户直接用自己维护的表格导入很常见）
        if employee_no in ("员工号", "工号", "employee_no"):
            continue
        if not employee_no:
            errors.append({"row": idx, "value": "", "reason": "缺少员工号"})
            continue
        if not courier_no:
            errors.append({"row": idx, "value": employee_no, "reason": "缺少快递单号"})
            continue

        query = db.query(Registration)
        if activity_id:
            query = query.filter(Registration.activity_id == activity_id)
        reg = query.filter(
            Registration.employee_no == employee_no,
            Registration.status != "cancelled",
        ).order_by(Registration.id.desc()).first()
        if reg is None:
            errors.append({"row": idx, "value": employee_no, "reason": "未找到对应报名单"})
            continue

        reg.courier_company = courier_company
        reg.courier_no = courier_no
        if reg.status == "pending":
            reg.status = "shipped"
        db.add(RegistrationLog(
            registration_id=reg.id, activity_id=reg.activity_id,
            field="快递单号", old_value="", new_value=courier_no,
            operator=getattr(admin, "username", "admin"),
        ))
        updated += 1
        activity = db.query(Activity).filter(Activity.id == reg.activity_id).first()
        if activity and enqueue_mail(db, activity, reg, "shipped"):
            mails += 1

    db.commit()
    return {"updated": updated, "mail_queued": mails, "errors": errors}
