"""
数据模型（对应需求文档 V1.3.5 第 6 章，共 9 张表）。

并发防超卖的三道防线落在：
1. ticket_sessions.sold / capacity + 原子扣减 SQL（见 services/booking.py）
2. registrations 上 (activity_id, active_key) 联合唯一索引（取消时置 NULL，允许重报）
3. registrations.idempotency_key 唯一索引（幂等键防连点重试）
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class AdminUser(Base):
    """后台账号：admin=系统管理员（全功能），viewer=只读账号（只看绑定活动的报名情况）。"""

    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AdminUserActivity(Base):
    """只读账号与活动的绑定关系（一个账号可挂钩多个活动）。

    只读账号的可见范围完全由这张表决定：没绑定任何活动就什么也看不到，
    所以新建账号时要求至少勾一个活动。
    """

    __tablename__ = "admin_user_activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("admin_users.id"), index=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"), index=True)
    __table_args__ = (
        UniqueConstraint("user_id", "activity_id", name="uq_admin_user_activity"),
    )


class Activity(Base):
    """活动（多活动平台的核心实体，前台按 /a/{code} 路由）。"""

    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)  # 3-32 位小写字母/数字/连字符
    name: Mapped[str] = mapped_column(String(200))  # 预留：浏览器标题、后台识别、邮件变量
    company_name: Mapped[str] = mapped_column(String(200), default="")
    home_bg_image: Mapped[str] = mapped_column(String(500), default="")  # 首页整屏底图
    title_image: Mapped[str] = mapped_column(String(500), default="")  # 活动标题块图（叠在底图上方）
    page_header_image: Mapped[str] = mapped_column(String(500), default="")  # 内页头图路径
    intro_html: Mapped[str] = mapped_column(Text, default="")  # 活动级介绍（跨剧目通用说明，可空）
    signup_start_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    companion_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    companion_max: Mapped[int] = mapped_column(Integer, default=2)
    companion_default: Mapped[int] = mapped_column(Integer, default=1)  # 默认随行人数（≤ companion_max）
    remind_hours_before: Mapped[int] = mapped_column(Integer, default=24)  # 活动级默认
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft/active/ended
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class Show(Base):
    """剧目（活动 → 剧目 → 场次，三层结构）。"""

    __tablename__ = "shows"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(200), default="")  # 演出地点（如 北京音乐厅），剧目级
    address: Mapped[str] = mapped_column(String(500), default="")  # 详细地址，剧目级
    cover_image: Mapped[str] = mapped_column(String(500), default="")  # 剧目卡片背景图（前台卡片底图）
    intro_html: Mapped[str] = mapped_column(Text, default="")  # 演出介绍（点此查看演出介绍），剧目级
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (Index("ix_shows_activity_sort", "activity_id", "sort"),)


class TicketSession(Base):
    """场次（表名带前缀避免与 session 概念混淆）。"""

    __tablename__ = "ticket_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    show_id: Mapped[int] = mapped_column(ForeignKey("shows.id"))
    name: Mapped[str] = mapped_column(String(200))
    show_at: Mapped[datetime] = mapped_column(DateTime)  # 演出开始时间
    capacity: Mapped[int] = mapped_column(Integer, default=0)  # 名额
    sold: Mapped[int] = mapped_column(Integer, default=0)  # 已占用名额（seats 累加）
    remind_hours_before: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # 场次级提醒提前量，NULL 继承活动默认
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (Index("ix_sessions_activity_sort", "activity_id", "sort"),)


class Contact(Base):
    """通讯录（按活动隔离，员工号+邮箱两列）。"""

    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    employee_no: Mapped[str] = mapped_column(String(20))  # i + 6 位数字
    email: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # 停用后不可登录
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("activity_id", "employee_no", name="uq_contact_activity_empno"),
        UniqueConstraint("activity_id", "email", name="uq_contact_activity_email"),
    )


class Registration(Base):
    """报名单。状态：pending 待邮寄 / shipped 已邮寄 / cancelled 已取消（后台动作）。"""

    __tablename__ = "registrations"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    session_id: Mapped[int] = mapped_column(ForeignKey("ticket_sessions.id"))
    reg_no: Mapped[str] = mapped_column(String(32), unique=True)  # 报名编号，对外展示
    employee_no: Mapped[str] = mapped_column(String(20))
    email: Mapped[str] = mapped_column(String(200))
    companion_count: Mapped[int] = mapped_column(Integer, default=0)
    seats: Mapped[int] = mapped_column(Integer, default=1)  # = 1 + companion_count，独立落库
    phone: Mapped[str] = mapped_column(String(20))
    province: Mapped[str] = mapped_column(String(50), default="")
    city: Mapped[str] = mapped_column(String(50), default="")
    county: Mapped[str] = mapped_column(String(50), default="")
    address_detail: Mapped[str] = mapped_column(String(500), default="")
    recipient_name: Mapped[str] = mapped_column(String(50), default="")
    recipient_phone: Mapped[str] = mapped_column(String(20), default="")
    courier_company: Mapped[str] = mapped_column(String(50), default="")
    courier_no: Mapped[str] = mapped_column(String(100), default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    remind_sent: Mapped[bool] = mapped_column(Boolean, default=False)  # 观演提醒是否已发送
    # active_key = employee_no（有效单）；取消时置 NULL，使该员工可重新报名
    active_key: Mapped[str | None] = mapped_column(String(20), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # 第二道防线：同一活动内，一人只能有一张有效报名单（空值之间不冲突，取消后可重报）
        Index("uq_reg_activity_activekey", "activity_id", "active_key", unique=True),
        # 第三道防线：幂等键防连点/重试重复提交
        Index("uq_reg_idempotency", "idempotency_key", unique=True),
    )


class RegistrationLog(Base):
    """报名单修改留痕：谁改的、什么时候、改前改后（需求 FR-B-06-12）。"""

    __tablename__ = "registration_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    registration_id: Mapped[int] = mapped_column(ForeignKey("registrations.id"))
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    field: Mapped[str] = mapped_column(String(50))  # 修改的字段名
    old_value: Mapped[str] = mapped_column(Text, default="")
    new_value: Mapped[str] = mapped_column(Text, default="")
    operator: Mapped[str] = mapped_column(String(50), default="admin")  # 操作人
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class EmailTemplate(Base):
    """邮件模板（按活动隔离）：signup 报名成功 / shipped 已邮寄 / remind 观演提醒。"""

    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    type: Mapped[str] = mapped_column(String(20))  # signup/shipped/remind
    subject: Mapped[str] = mapped_column(String(300))
    body_html: Mapped[str] = mapped_column(Text)
    # 版式（模板级设置，不进正文）：正文统一套一层固定宽度居中的外壳。
    # 放成模板字段而不是写死在 body_html 里，是为了让可视化编辑器怎么改都不会丢版式。
    layout_width: Mapped[int] = mapped_column(Integer, default=70)
    layout_center: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (UniqueConstraint("activity_id", "type", name="uq_tpl_activity_type"),)


class EmailOutbox(Base):
    """邮件发件箱：先落库再异步发送，失败重试 3 次。"""

    __tablename__ = "email_outbox"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id"))
    registration_id: Mapped[int | None] = mapped_column(
        ForeignKey("registrations.id"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(20))
    to_email: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(300))
    body_html: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued/sending/sent/failed
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # remind 用
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class SystemConfig(Base):
    """全局系统配置（SMTP 通道、空跑开关等，key-value）。"""

    __tablename__ = "system_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
