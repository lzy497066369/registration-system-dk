"""公共依赖：后台账号鉴权与可见范围。

两种角色：
- admin  系统管理员，全功能；
- viewer 只读账号，只能看自己被绑定的那几个活动的报名情况。

写接口一律用 require_admin，只读接口自己按 scoped_activity_ids() 过滤。
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import AdminUser, AdminUserActivity
from .security import decode_token

_bearer = HTTPBearer(auto_error=False)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> AdminUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    username = decode_token(credentials.credentials)
    if not username:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已过期")
    admin = db.query(AdminUser).filter(AdminUser.username == username).first()
    if admin is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "账号不存在")
    return admin


def require_admin(admin: AdminUser = Depends(get_current_admin)) -> AdminUser:
    """系统管理员专用：只读账号碰到写接口直接 403，而不是前端藏起来就完事。"""
    if (admin.role or "admin") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "当前账号为只读账号，无此操作权限")
    return admin


def scoped_activity_ids(db: Session, admin: AdminUser) -> set[int] | None:
    """账号可见的活动 id 集合；返回 None 表示不限（系统管理员）。"""
    if (admin.role or "admin") == "admin":
        return None
    rows = (
        db.query(AdminUserActivity.activity_id)
        .filter(AdminUserActivity.user_id == admin.id)
        .all()
    )
    return {r[0] for r in rows}
