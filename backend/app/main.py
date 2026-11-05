"""FastAPI 应用入口：建表、迁移、种子管理员、挂载路由、启动邮件 worker。"""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, SessionLocal, engine
from .migrations import run_migrations
from .models import AdminUser  # noqa: F401  确保模型注册到 Base.metadata
from .routers import (
    admin_activities, admin_auth, admin_contacts, admin_emails, admin_registrations,
    admin_shows, admin_users, public,
)
from .security import hash_password
from .services.mail_worker import mail_worker_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    Base.metadata.create_all(engine)
    run_migrations(engine)
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

    db = SessionLocal()
    try:
        if not db.query(AdminUser).first():
            db.add(
                AdminUser(
                    username=settings.ADMIN_USERNAME,
                    password_hash=hash_password(settings.ADMIN_PASSWORD),
                )
            )
            db.commit()
    finally:
        db.close()

    # 邮件发送 worker：每 30 秒扫一次待发队列
    task = asyncio.create_task(mail_worker_loop(interval=30))
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="2026SAP北分工会冬季家庭主题活动报名系统",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境收紧为具体域名
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_auth.router)
app.include_router(admin_activities.router)
app.include_router(admin_shows.router)
app.include_router(admin_contacts.router)
app.include_router(admin_registrations.router)
app.include_router(admin_emails.router)
app.include_router(admin_users.router)
app.include_router(public.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
