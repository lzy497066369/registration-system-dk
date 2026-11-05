"""后台管理员登录与密码修改。"""
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_admin
from ..models import Activity, AdminUser, AdminUserActivity
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/admin", tags=["admin-auth"])

# 简单内存级登录限流：错 5 次锁 30 分钟（单实例部署够用）
_login_failures: dict[str, list[float]] = {}
_FAIL_WINDOW = 1800  # 30 分钟
_FAIL_LIMIT = 5


def _check_locked(key: str) -> None:
    now = time.time()
    fails = [t for t in _login_failures.get(key, []) if now - t < _FAIL_WINDOW]
    if len(fails) >= _FAIL_LIMIT:
        raise HTTPException(429, "失败次数过多，请 30 分钟后再试")
    _login_failures[key] = fails


def _record_failure(key: str) -> None:
    _login_failures.setdefault(key, []).append(time.time())


class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    _check_locked(body.username)
    admin = db.query(AdminUser).filter(AdminUser.username == body.username).first()
    if admin is None or not verify_password(body.password, admin.password_hash):
        _record_failure(body.username)
        raise HTTPException(401, "用户名或密码错误")
    _login_failures.pop(body.username, None)
    return {
        "token": create_access_token(admin.username),
        "username": admin.username,
        "role": admin.role or "admin",
    }


@router.get("/my-scope")
def my_scope(admin: AdminUser = Depends(get_current_admin), db: Session = Depends(get_db)):
    """当前账号的身份与可见活动：前端据此决定菜单和活动下拉。

    - admin  返回全部活动；
    - viewer 只返回被绑定的活动，菜单里也只会出现「报名情况」。
    """
    role = admin.role or "admin"
    if role == "admin":
        rows = db.query(Activity).order_by(Activity.id.desc()).all()
    else:
        rows = (
            db.query(Activity)
            .join(AdminUserActivity, AdminUserActivity.activity_id == Activity.id)
            .filter(AdminUserActivity.user_id == admin.id)
            .order_by(Activity.id.desc())
            .all()
        )
    return {
        "username": admin.username,
        "role": role,
        "activities": [
            {"id": a.id, "code": a.code, "name": a.name, "status": a.status} for a in rows
        ],
    }


@router.get("/me")
def me(admin: AdminUser = Depends(get_current_admin)):
    return {"username": admin.username, "role": admin.role or "admin"}


@router.put("/password")
def change_password(
    body: PasswordIn,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not verify_password(body.old_password, admin.password_hash):
        raise HTTPException(400, "原密码错误")
    if len(body.new_password) < 8:
        raise HTTPException(400, "新密码至少 8 位")
    admin.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}
