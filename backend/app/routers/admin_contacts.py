"""通讯录：Excel 批量导入、单条维护、导出。

边界规则（需求 FR-B-03、V1.3.2 确认）：
- 已有有效报名单的员工，员工号不可修改（防绕过限报），邮箱可随时改；
- 报过名的员工（含已取消）只能停用，不能删除。
"""
import io
import urllib.parse

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import Activity, Contact, Registration
from ..utils.timez import now_cn
from ..utils.validators import EMAIL_RE, normalize_email, normalize_employee_no

router = APIRouter(prefix="/api/admin", tags=["admin-contacts"],
                   dependencies=[Depends(require_admin)])


class ContactIn(BaseModel):
    employee_no: str
    email: str
    is_active: bool = True


class ContactUpdate(BaseModel):
    employee_no: str | None = None
    email: str | None = None
    is_active: bool | None = None


def _get_activity(activity_id: int, db: Session) -> Activity:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    return activity


def _has_active_registration(db: Session, activity_id: int, employee_no: str) -> bool:
    return (
        db.query(Registration.id)
        .filter(
            Registration.activity_id == activity_id,
            Registration.employee_no == employee_no,
            Registration.status != "cancelled",
        )
        .first()
        is not None
    )


def _has_any_registration(db: Session, activity_id: int, employee_no: str) -> bool:
    return (
        db.query(Registration.id)
        .filter(
            Registration.activity_id == activity_id,
            Registration.employee_no == employee_no,
        )
        .first()
        is not None
    )


@router.get("/contacts")
def list_all_contacts(
    activity_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
    keyword: str = "",
    active: str = "",
    db: Session = Depends(get_db),
):
    """跨活动查询通讯录（活动筛选可选，不传则返回全部活动下的员工）。"""
    query = db.query(Contact)
    if activity_id:
        query = query.filter(Contact.activity_id == activity_id)
    if keyword.strip():
        kw = f"%{keyword.strip().lower()}%"
        query = query.filter((Contact.employee_no.like(kw)) | (Contact.email.like(kw)))
    if active == "1":
        query = query.filter(Contact.is_active.is_(True))
    elif active == "0":
        query = query.filter(Contact.is_active.is_(False))

    total = query.count()
    rows = (
        query.order_by(Contact.activity_id, Contact.id)
        .offset((max(1, page) - 1) * page_size)
        .limit(min(200, page_size))
        .all()
    )
    employee_nos = [c.employee_no for c in rows]
    registered = set()
    if employee_nos:
        # 已报名只认「员工号 + 所属活动」：同一员工在别的活动报过名，不算本活动已报名
        reg_query = db.query(Registration.activity_id, Registration.employee_no).filter(
            Registration.employee_no.in_(employee_nos),
            Registration.status != "cancelled",
        )
        if activity_id:
            reg_query = reg_query.filter(Registration.activity_id == activity_id)
        registered = {(r[0], r[1]) for r in reg_query.all()}
    activity_names = {a.id: a.name for a in db.query(Activity).all()}
    return {
        "total": total,
        "items": [
            {
                "id": c.id, "employee_no": c.employee_no, "email": c.email,
                "is_active": c.is_active,
                "activity_id": c.activity_id,
                "activity_name": activity_names.get(c.activity_id, ""),
                "has_registration": (c.activity_id, c.employee_no) in registered,
            }
            for c in rows
        ],
    }


@router.get("/contacts/export")
def export_all_contacts(activity_id: int | None = None, db: Session = Depends(get_db)):
    """导出通讯录（不传活动则导出全部活动，带所属活动列）。"""
    query = db.query(Contact)
    if activity_id:
        query = query.filter(Contact.activity_id == activity_id)
    rows = query.order_by(Contact.activity_id, Contact.id).all()
    activity_names = {a.id: a.name for a in db.query(Activity).all()}

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "员工管理"
    ws.append(["所属活动", "员工号", "邮箱", "状态", "是否已报名"])
    registered_rows = db.query(
        Registration.activity_id, Registration.employee_no
    ).filter(Registration.status != "cancelled").all()
    registered = {(aid, emp) for aid, emp in registered_rows}
    for c in rows:
        ws.append([
            activity_names.get(c.activity_id, ""), c.employee_no, c.email,
            "启用" if c.is_active else "停用",
            "是" if (c.activity_id, c.employee_no) in registered else "否",
        ])
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    now = now_cn().strftime("%Y%m%d_%H%M%S")
    filename = urllib.parse.quote(f"员工管理_{now}.xlsx")
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


# ---------- 单条维护 ----------

@router.post("/activities/{activity_id}/contacts")
def create_contact(activity_id: int, body: ContactIn, db: Session = Depends(get_db)):
    _get_activity(activity_id, db)
    try:
        employee_no = normalize_employee_no(body.employee_no)
        email = normalize_email(body.email)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    # 查重范围＝同一个活动（不同活动之间允许同一个员工号/邮箱各存一份）
    dup_no = db.query(Contact).filter(
        Contact.activity_id == activity_id, Contact.employee_no == employee_no
    ).first()
    if dup_no:
        raise HTTPException(400, f"该员工号已存在（本活动内绑定邮箱 {dup_no.email}）")
    dup_mail = db.query(Contact).filter(
        Contact.activity_id == activity_id, Contact.email == email
    ).first()
    if dup_mail:
        raise HTTPException(400, f"该邮箱已存在（本活动内已绑定员工号 {dup_mail.employee_no}）")
    contact = Contact(activity_id=activity_id, employee_no=employee_no,
                      email=email, is_active=body.is_active)
    db.add(contact)
    db.commit()
    return {"id": contact.id}


@router.put("/contacts/{contact_id}")
def update_contact(contact_id: int, body: ContactUpdate, db: Session = Depends(get_db)):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(404, "记录不存在")

    if body.employee_no is not None:
        new_no = normalize_employee_no(body.employee_no)
        if new_no != contact.employee_no:
            if _has_active_registration(db, contact.activity_id, contact.employee_no):
                raise HTTPException(400, "该员工已有有效报名单，员工号不可修改")
            conflict = db.query(Contact).filter(
                Contact.activity_id == contact.activity_id,
                Contact.employee_no == new_no, Contact.id != contact_id,
            ).first()
            if conflict:
                raise HTTPException(400, f"新员工号已存在（本活动内绑定邮箱 {conflict.email}）")
            contact.employee_no = new_no

    if body.email is not None:
        new_email = normalize_email(body.email)
        conflict = db.query(Contact).filter(
            Contact.activity_id == contact.activity_id,
            Contact.email == new_email, Contact.id != contact_id,
        ).first()
        if conflict:
            raise HTTPException(400, f"新邮箱已存在（本活动内已绑定员工号 {conflict.employee_no}）")
        contact.email = new_email

    if body.is_active is not None:
        contact.is_active = body.is_active

    db.commit()
    return {"ok": True}


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(404, "记录不存在")
    if _has_any_registration(db, contact.activity_id, contact.employee_no):
        raise HTTPException(400, "该员工已有报名记录，只能停用，不能删除")
    db.delete(contact)
    db.commit()
    return {"ok": True}


@router.post("/activities/{activity_id}/contacts/clear")
def clear_contacts(
    activity_id: int,
    mode: str = "unregistered",  # unregistered=只清未报名  all=清空全部
    db: Session = Depends(get_db),
):
    """一键清除某活动的通讯录，两种口径：

    - mode=unregistered（默认）：与单条删除同一口径，报过名的员工（含已取消）
      保留、只能停用，其余没有报名记录的员工整批删除。
    - mode=all：连有报名记录的员工一起删除。报名单本身仍保留在报名管理里，
      但这些员工之后无法再登录前台（登录要校验通讯录），除非重新导入。
    """
    if mode not in ("unregistered", "all"):
        raise HTTPException(400, "mode 只能是 unregistered 或 all")

    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")

    total = db.query(Contact).filter(Contact.activity_id == activity_id).count()
    query = db.query(Contact).filter(Contact.activity_id == activity_id)
    if mode == "unregistered":
        registered = {
            r[0]
            for r in db.query(Registration.employee_no)
            .filter(Registration.activity_id == activity_id)
            .distinct()
        }
        if registered:
            query = query.filter(Contact.employee_no.notin_(registered))
    deleted = query.delete(synchronize_session=False)
    db.commit()
    return {
        "activity_id": activity_id,
        "activity_name": activity.name,
        "mode": mode,
        "total": total,
        "deleted": deleted,
        "kept": total - deleted,
    }


# ---------- 列表 ----------

@router.get("/activities/{activity_id}/contacts")
def list_contacts(
    activity_id: int,
    page: int = 1,
    page_size: int = 20,
    keyword: str = "",
    active: str = "",  # ""=全部 "1"=启用 "0"=停用
    db: Session = Depends(get_db),
):
    _get_activity(activity_id, db)
    query = db.query(Contact).filter(Contact.activity_id == activity_id)
    if keyword.strip():
        kw = f"%{keyword.strip().lower()}%"
        query = query.filter(
            (Contact.employee_no.like(kw)) | (Contact.email.like(kw))
        )
    if active == "1":
        query = query.filter(Contact.is_active.is_(True))
    elif active == "0":
        query = query.filter(Contact.is_active.is_(False))

    total = query.count()
    rows = (
        query.order_by(Contact.id)
        .offset((max(1, page) - 1) * page_size)
        .limit(min(200, page_size))
        .all()
    )
    # 标记哪些员工已有报名（列表页显示状态用）
    employee_nos = [c.employee_no for c in rows]
    registered = set()
    if employee_nos:
        regs = (
            db.query(Registration.employee_no)
            .filter(
                Registration.activity_id == activity_id,
                Registration.employee_no.in_(employee_nos),
                Registration.status != "cancelled",
            )
            .all()
        )
        registered = {r[0] for r in regs}
    return {
        "total": total,
        "items": [
            {
                "id": c.id, "employee_no": c.employee_no, "email": c.email,
                "is_active": c.is_active, "has_registration": c.employee_no in registered,
            }
            for c in rows
        ],
    }


# ---------- Excel 批量导入 ----------

@router.post("/activities/{activity_id}/contacts/import")
async def import_contacts(activity_id: int, file: UploadFile, db: Session = Depends(get_db)):
    _get_activity(activity_id, db)
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

    # 第 1 行若含表头（首个单元格不是合法员工号）则跳过
    start = 0
    first = str(rows[0][0] or "").strip().lower()
    try:
        normalize_employee_no(first)
    except ValueError:
        start = 1

    inserted = updated = 0
    errors: list[dict] = []
    for idx, row in enumerate(rows[start:], start=start + 1):
        raw_no = row[0] if row else None
        raw_email = row[1] if len(row) > 1 else None
        if raw_no is None and raw_email is None:
            continue  # 空行
        try:
            employee_no = normalize_employee_no(str(raw_no))
        except ValueError:
            errors.append({"row": idx, "value": str(raw_no), "reason": "员工号格式不正确（i+6位数字）"})
            continue
        email = str(raw_email or "").strip().lower()
        if not EMAIL_RE.match(email):
            errors.append({"row": idx, "value": email, "reason": "邮箱格式不正确"})
            continue

        existing = (
            db.query(Contact)
            .filter(Contact.activity_id == activity_id, Contact.employee_no == employee_no)
            .first()
        )
        if existing:
            if existing.email != email:
                conflict = db.query(Contact).filter(
                    Contact.activity_id == activity_id,
                    Contact.email == email, Contact.id != existing.id,
                ).first()
                if conflict:
                    errors.append({"row": idx, "value": email,
                                   "reason": f"邮箱已被员工号 {conflict.employee_no} 使用"})
                    continue
                existing.email = email
                updated += 1
        else:
            conflict = db.query(Contact).filter(
                Contact.activity_id == activity_id, Contact.email == email
            ).first()
            if conflict:
                errors.append({"row": idx, "value": email,
                               "reason": f"邮箱已存在（员工号 {conflict.employee_no} 已使用）"})
                continue
            db.add(Contact(activity_id=activity_id, employee_no=employee_no, email=email))
            inserted += 1
    db.commit()
    return {"inserted": inserted, "updated": updated, "errors": errors, "total_rows": len(rows) - start}


# ---------- 导出 ----------

@router.get("/activities/{activity_id}/contacts/export")
def export_contacts(activity_id: int, db: Session = Depends(get_db)):
    _get_activity(activity_id, db)
    rows = (
        db.query(Contact).filter(Contact.activity_id == activity_id)
        .order_by(Contact.id).all()
    )
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "员工管理"
    ws.append(["员工号", "邮箱", "状态", "是否已报名"])
    registered_nos = {
        r[0] for r in db.query(Registration.employee_no)
        .filter(Registration.activity_id == activity_id).all()
    }
    for c in rows:
        ws.append([
            c.employee_no, c.email,
            "启用" if c.is_active else "停用",
            "是" if c.employee_no in registered_nos else "否",
        ])
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    now = now_cn().strftime("%Y%m%d_%H%M%S")
    filename = urllib.parse.quote(f"员工管理_{now}.xlsx")
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
