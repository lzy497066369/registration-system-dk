"""启动时执行的幂等迁移（老库升级用，新库由 create_all 直接建成最新结构）。

2026-10-30：地点/地址由活动级下移到剧目级（设计图中地点地址显示在每个剧目卡片上）。
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

MIGRATIONS = [
    "ALTER TABLE shows ADD COLUMN IF NOT EXISTS location VARCHAR(200) DEFAULT ''",
    "ALTER TABLE shows ADD COLUMN IF NOT EXISTS address VARCHAR(500) DEFAULT ''",
    "ALTER TABLE shows ADD COLUMN IF NOT EXISTS cover_image VARCHAR(500) DEFAULT ''",
    "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS reg_no VARCHAR(32) DEFAULT ''",
    # remind_sent 模型里是 Boolean，早期版本误建成 smallint，这里统一纠正为 boolean
    "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS remind_sent BOOLEAN DEFAULT false",
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'registrations'
              AND column_name = 'remind_sent'
              AND data_type <> 'boolean'
        ) THEN
            ALTER TABLE registrations
                ALTER COLUMN remind_sent DROP DEFAULT,
                ALTER COLUMN remind_sent TYPE BOOLEAN USING (COALESCE(remind_sent, 0) <> 0),
                ALTER COLUMN remind_sent SET DEFAULT false,
                ALTER COLUMN remind_sent SET NOT NULL;
        END IF;
    END $$;
    """,
    "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS county VARCHAR(50) DEFAULT ''",
    "ALTER TABLE activities ADD COLUMN IF NOT EXISTS title_image VARCHAR(500) DEFAULT ''",
    "ALTER TABLE activities DROP COLUMN IF EXISTS location",
    "ALTER TABLE activities DROP COLUMN IF EXISTS address",
    # 邮件模板版式：正文统一套 70% 居中外壳。老库默认补齐，等于自动修复历史模板
    "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS layout_width INT DEFAULT 70",
    "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS layout_center BOOLEAN DEFAULT true",
    # 活动默认随行人数：前台报名页随行人数选择器的初始值
    "ALTER TABLE activities ADD COLUMN IF NOT EXISTS companion_default INT DEFAULT 1",
    # 后台账号分角色：老库的账号一律视为系统管理员，新增的只读账号才是 viewer
    "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin'",
    """
    CREATE TABLE IF NOT EXISTS admin_user_activities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES admin_users(id),
        activity_id INTEGER NOT NULL REFERENCES activities(id),
        CONSTRAINT uq_admin_user_activity UNIQUE (user_id, activity_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_admin_user_activities_user_id ON admin_user_activities (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_admin_user_activities_activity_id ON admin_user_activities (activity_id)",
]


def run_migrations(engine: Engine) -> None:
    with engine.begin() as conn:
        for sql in MIGRATIONS:
            conn.execute(text(sql))
