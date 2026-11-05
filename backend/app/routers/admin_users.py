"""只读账号（用户账号）管理：仅系统管理员可用。

这类账号与活动挂钩（可多选），登录后只有「报名情况」一个菜单；
接口层面同样只读——报名列表/导出按绑定活动过滤，其余写接口一律 403。
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import Activity, AdminUser, AdminUserActivity
from ..security import hash_password
from ..utils.timez import now_cn

router = APIRouter(prefix="/api/admin", tags=["admin-users"],
                   dependencies=[Depends(require_admin)])

# 用户名允许字母、数字、下划线、点、连字符；中文名放到「备注」里没必要，先不做
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


class UserIn(BaseModel):
    username: str
    password: str
    activity_ids: list[int] = []


class UserUpdate(BaseModel):
    password: str | None = None
    activity_ids: list[int] | None = None


def _check_activities(db: Session, ids: list[int]) -> list[int]:
    clean = sorted({int(i) for i in (ids or [])})
    if not clean:
        raise HTTPException(400, "请至少选择一个可查看的活动")
    found = {r[0] for r in db.query(Activity.id).filter(Activity.id.in_(clean)).all()}
    missing = [i for i in clean if i not in found]
    if missing:
        raise HTTPException(400, f"活动不存在：{missing}")
    return clean


def _bindings(db: Session, user_id: int) -> list[int]:
    return [
        r[0] for r in
        db.query(AdminUserActivity.activity_id)
        .filter(AdminUserActivity.user_id == user_id)
        .order_by(AdminUserActivity.activity_id)
        .all()
    ]


def _view(db: Session, user: AdminUser) -> dict:
    ids = _bindings(db, user.id)
    names = {
        a.id: a.name
        for a in db.query(Activity).filter(Activity.id.in_(ids or [-1])).all()
    }
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role or "admin",
        "activity_ids": ids,
        "activity_names": [names.get(i, "") for i in ids],
        "created_at": user.created_at.isoformat() if user.created_at else "",
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    """只列只读账号：系统管理员不在这里增删改。"""
    rows = (
        db.query(AdminUser)
        .filter(AdminUser.role == "viewer")
        .order_by(AdminUser.id.desc())
        .all()
    )
    return [_view(db, u) for u in rows]


@router.post("/users")
def create_user(body: UserIn, db: Session = Depends(get_db)):
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "用户名须为 3-32 位字母、数字、下划线、点或连字符")
    if len(body.password) < 8:
        raise HTTPException(400, "密码至少 8 位")
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        raise HTTPException(400, "用户名已存在")
    activity_ids = _check_activities(db, body.activity_ids)

    user = AdminUser(
        username=username,
        password_hash=hash_password(body.password),
        role="viewer",
    )
    db.add(user)
    db.flush()
    for aid in activity_ids:
        db.add(AdminUserActivity(user_id=user.id, activity_id=aid))
    db.commit()
    db.refresh(user)
    return {"id": user.id}


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(AdminUser).filter(AdminUser.id == user_id).first()
    if not user or (user.role or "admin") != "viewer":
        raise HTTPException(404, "用户不存在")
    if body.password is not None:
        if len(body.password) < 8:
            raise HTTPException(400, "密码至少 8 位")
        user.password_hash = hash_password(body.password)
    if body.activity_ids is not None:
        activity_ids = _check_activities(db, body.activity_ids)
        db.query(AdminUserActivity).filter(
            AdminUserActivity.user_id == user.id
        ).delete(synchronize_session=False)
        for aid in activity_ids:
            db.add(AdminUserActivity(user_id=user.id, activity_id=aid))
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(AdminUser).filter(AdminUser.id == user_id).first()
    if not user or (user.role or "admin") != "viewer":
        raise HTTPException(404, "用户不存在")
    db.query(AdminUserActivity).filter(
        AdminUserActivity.user_id == user.id
    ).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"ok": True, "deleted_at": now_cn().isoformat()}
