"""并发核心：报名单创建的事务化流程（对应需求文档 5.5.2 三道防线）。

第一道：原子扣减 —— 判断与修改在一条 SQL 内完成，行级锁保证并发请求排队，
        影响行数 0 即名额不足/已满/未开放。
第二道：(activity_id, active_key) 联合唯一索引 —— 同一员工多设备并发提交，
        只有第一条能写入。
第三道：idempotency_key 唯一索引 —— 前端防连点失效时，同一幂等键只产生一单。

扣减 sold 与写入报名单在同一事务中，任一步失败整体回滚，不产生脏数据。
"""
from datetime import datetime
import secrets

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Registration
from ..utils.timez import now_cn


class QuotaExceeded(Exception):
    """名额已满 / 剩余不足 / 场次未开放。"""


class DuplicateRegistration(Exception):
    """该员工在本活动已有有效报名单，或幂等键重复。"""


def create_registration(
    db: Session,
    *,
    session_id: int,
    activity_id: int,
    employee_no: str,
    email: str,
    companion_count: int,
    phone: str,
    province: str = "",
    city: str = "",
    county: str = "",
    address_detail: str = "",
    recipient_name: str = "",
    recipient_phone: str = "",
    idempotency_key: str | None = None,
) -> Registration:
    seats = 1 + companion_count

    # 第一道防线：原子扣减（条件含 is_open，未开放的场次直接扣不动）
    res = db.execute(
        text(
            "UPDATE ticket_sessions SET sold = sold + :seats "
            "WHERE id = :sid AND is_open = true AND sold + :seats <= capacity"
        ),
        {"seats": seats, "sid": session_id},
    )
    if res.rowcount != 1:
        db.rollback()
        raise QuotaExceeded()

    # 第二道 + 第三道防线：唯一索引兜底
    reg_no = "R" + now_cn().strftime("%y%m%d%H%M%S") + secrets.token_hex(3).upper()
    reg = Registration(
        activity_id=activity_id,
        session_id=session_id,
        reg_no=reg_no,
        employee_no=employee_no,
        email=email,
        companion_count=companion_count,
        seats=seats,
        phone=phone,
        province=province,
        city=city,
        county=county,
        address_detail=address_detail,
        recipient_name=recipient_name,
        recipient_phone=recipient_phone,
        status="pending",
        active_key=employee_no,
        idempotency_key=idempotency_key,
    )
    db.add(reg)
    try:
        db.commit()
    except IntegrityError as exc:
        # 事务回滚，第一道防线的名额扣减同时被释放
        db.rollback()
        msg = str(exc.orig) if exc.orig else ""
        # 第三道防线（幂等键）：同一次提交被重复触发，不报错，直接返回首次那单
        if "idempotency" in msg and idempotency_key:
            existing = (
                db.query(Registration)
                .filter(Registration.idempotency_key == idempotency_key)
                .first()
            )
            if existing is not None and existing.status != "cancelled":
                return existing
        if "active_key" in msg:
            raise DuplicateRegistration("您在该活动中已有报名，请勿重复提交") from exc
        if "idempotency" in msg:
            raise DuplicateRegistration("该报名单已被取消，请返回重新填写后再提交") from exc
        raise
    db.refresh(reg)
    return reg


def cancel_registration(db: Session, reg: Registration) -> None:
    """后台取消：释放名额（按落库的 seats 整单释放）、置空 active_key 允许重报。"""
    db.execute(
        text(
            "UPDATE ticket_sessions SET sold = sold - :seats "
            "WHERE id = :sid AND sold >= :seats"
        ),
        {"seats": reg.seats, "sid": reg.session_id},
    )
    reg.status = "cancelled"
    reg.active_key = None
    db.commit()
