# 2026 SAP 北分工会冬季家庭主题活动 · 报名系统

多活动报名平台（首期：SAP 北分工会冬季家庭主题活动）。前台 H5 供员工登录报名，后台维护活动、剧目场次、通讯录与报名数据。

## 技术栈

- 后端：FastAPI + SQLAlchemy 2 + PostgreSQL 16（`backend/`）
- 前端：React 18 + TypeScript + Vite + Ant Design 5 + Quill 富文本（`frontend/`）
- 部署：Docker Compose（db / backend / frontend 三容器）

## 本地运行

首次运行先把环境变量模板复制成真实配置并填值（`.env` 不进仓库）：

```cmd
cd /d "D:\桌面\2026SAP北分工会冬季家庭主题活动\registration-system" && copy .env.example .env
```

```cmd
cd /d "D:\桌面\2026SAP北分工会冬季家庭主题活动\registration-system" && docker compose build && docker compose up -d
```

`.env` 里各变量含义见 `.env.example` 的注释；密码只在 `docker-compose.yml` 里以 `${DB_PASSWORD}` 这类形式引用，不再硬编码。

> 邮件 SMTP 账号密码、`public_base_url` **不在** `.env` 里，存在数据库 `system_configs` 表，通过后台「邮件设置」页面维护。

日常改动后的重建范围：

| 改动位置 | 命令 |
|---|---|
| 只改前端 | `docker compose build frontend && docker compose up -d` |
| 只改后端 | `docker compose build backend && docker compose up -d` |
| 数据库表结构变更 | 两个都要重建（后端启动时自动执行迁移） |

## 访问地址

| 访问地址 | 说明 |
|---|---|
| 前台登录 | `http://localhost:5280/a/{活动编码}/login` |
| 前台选剧目 | `http://localhost:5280/a/{活动编码}/list` |
| 后台登录 | `http://localhost:5280/admin/login` |
| 接口文档 | `http://localhost:8110/docs` |
| 健康检查 | `http://localhost:8110/api/health` |

前台 5 个页面：登录 → 选剧目（list）→ 填信息（form）→ 核对（confirm）→ 成功（success），样式**直接采用设计稿 `html/css/global.css` 原文**（图片与文案全部取自后台配置）。

端口与其它项目隔离：前端 5280 / 后端 8110 / 数据库 5440（ai-pdp-data 用 5273/8100/5433，electricity-data 另算）。

默认管理员：`admin / admin123`（**上线前必须改密码**）。

## 目录结构

```
registration-system/
├─ docker-compose.yml
├─ backend/
│  ├─ Dockerfile
│  ├─ requirements.txt
│  └─ app/
│     ├─ main.py            # 入口：建表、迁移、挂路由
│     ├─ config.py          # 环境变量配置
│     ├─ database.py        # 引擎与会话
│     ├─ models.py          # 9 张表模型
│     ├─ migrations.py      # 启动时执行的幂等 DDL（老库自动升级）
│     ├─ security.py        # PBKDF2 口令散列 + JWT
│     ├─ deps.py            # 后台鉴权依赖
│     ├─ utils/             # 图片压缩、XSS 过滤、格式校验
│     ├─ services/booking.py  # 并发核心：原子扣减 + 唯一索引 + 幂等键
│     └─ routers/           # admin_activities / admin_shows / admin_contacts / admin_users / admin_auth / public
└─ frontend/
   ├─ Dockerfile / nginx.conf   # nginx 反代 /api 与 /uploads
   └─ src/
      ├─ api.ts             # fetch 封装（token、401 跳登录、上传、下载）
      └─ admin/
         ├─ layout/MainLayout.tsx   # 深色侧边栏 + 面包屑
         ├─ pages/                  # 活动/剧目/场次/通讯录 + 占位页
         └─ components/RichTextEditor.tsx
```

## 界面约定（后台）

- 布局沿用 ai-pdp-data：深色侧边栏 + 面包屑 + 卡片式列表页（标题栏右侧「刷新 / 新增」按钮 + 筛选行 + 表格行内操作）
- **所有业务页面（活动 / 剧目 / 场次 / 通讯录 / 报名管理 / 邮件模板）顶部都有「所属活动」下拉框，且可清空**：默认不选＝显示全部活动，选中＝只看该活动
- 表格中的「所属活动」列**始终显示**（不随筛选隐藏），便于一眼看清数据归属
- 新增/编辑数据时，弹窗内必须指定所属活动（数据归属不可省），已在上方选定的活动自动带入
- 所有下拉可搜索（`showSearch`）、日期中文（dayjs zh-cn）、富文本用 Quill
- 导入类操作必须先选目标活动，再选文件（避免误导入）

## 账号与权限

后台有两类账号（`admin_users.role`）：

| 角色 | 来源 | 能做什么 |
|---|---|---|
| `admin` | 启动时按环境变量种子的系统管理员 | 全部功能 |
| `viewer` | 管理员在「用户账号」里创建 | **只有「报名情况」一个菜单**：按绑定活动查看全部报名明细 + 导出 Excel，不能做任何修改 |

- viewer 与活动的绑定在 `admin_user_activities`（多对多，可挂钩多个活动），新建时必须至少勾一个
- 权限不只在前端藏菜单：`require_admin` 依赖把写接口全部拦住（403），只读接口用 `scoped_activity_ids()` 自动按绑定活动过滤，前端传别人活动的 `activity_id` 也会被拒
- `GET /api/admin/my-scope` 返回当前账号的角色与可见活动，前端据此渲染菜单和活动下拉
- 账号管理入口：后台左侧「用户账号」（仅管理员可见）

## 图片配置层级（前台显示来源）

| 位置 | 字段 | 层级 | 前台默认图 |
|---|---|---|---|
| 首页整屏底图 | `activities.home_bg_image` | 活动级 | `login-bg.png` |
| 首页活动标题块图（叠在底图上方） | `activities.title_image` | 活动级 | `login-top.png` |
| 内页顶部 banner | `activities.page_header_image` | 活动级 | `banner.png` |
| 剧目卡片底图 | `shows.cover_image` | 剧目级 | `list-item1/2.png` 交替 |

## 功能进度

| 模块 | 状态 |
|---|---|
| 活动管理（含图片上传、开抢时间、结伴规则） | ✅ |
| 剧目管理（地点、地址、演出介绍富文本） | ✅ |
| 场次管理（时间、名额、提醒提前、开放状态） | ✅ |
| 通讯录（Excel 导入导出、单条增改、启停） | ✅ |
| 并发核心（原子扣减、唯一索引、幂等键） | ✅ 底层已就绪，联调在第 4 日 |
| 报名管理（列表、六项编辑留痕、取消、快递回填、导出、看板） | ✅ |
| 邮件体系（模板、SMTP、空跑模式、异步队列、观演提醒定时任务） | ✅ |
| 前台五页（登录、选剧目、填信息、核对、成功） | ✅ 依最新版设计稿 `html/` 还原 |

## 数据模型要点

- 三层结构：活动 → 剧目 → 场次。**演出地点、详细地址、演出介绍属剧目级**（以 H5 设计图为准）。
- 防超卖三道防线：`ticket_sessions` 原子扣减 SQL、`(activity_id, active_key)` 联合唯一索引、`idempotency_key` 唯一索引。
- `seats`（占用名额）独立落库，取消时按落库值释放，不重新计算。
- 通讯录、报名、邮件模板均按 `activity_id` 隔离。

## 临时外网访问（把本机当服务器）

活动前期让别人试用时，用 `tools/tunnel/` 里的 Cloudflare Quick Tunnel 把本机 5280 端口临时映射到公网，
不需要服务器、域名、备案：

```
tools\tunnel\start-tunnel.cmd
```

窗口里打印的 `https://xxx.trycloudflare.com` 就是公网地址（同时写入 `tools/tunnel/public-url.txt`）。
电脑关机、睡眠、关掉窗口或 Docker，地址立即失效；每次重启脚本地址都会变。
**分享链接前务必先改管理员密码。** 细节见 `tools/tunnel/README.md`。

## 服务器部署（GHCR）

整体链路：`git push` → GitHub Actions 自动构建镜像 → 推到 GHCR（GitHub 的镜像仓库）→ 服务器只拉镜像、不编译。相关文件：`.github/workflows/ghcr.yml`（构建流水线）、`docker-compose.prod.yml`（服务器编排）、`.env.prod.example`（服务器环境变量模板）。

1. **代码进 GitHub（私有仓库）**。push 到 `main` 后 Actions 自动构建两个镜像：
   `ghcr.io/<用户名>/<仓库名>-backend:latest` 与 `…-frontend:latest`。
   首次要在仓库 `Settings → Actions → General → Workflow permissions` 选 **Read and write permissions**。
   服务器是 ARM 的话，把 workflow 里 `PLATFORMS` 改成 `linux/arm64`（默认 `linux/amd64`，选错服务器上会报 `exec format error`）。
2. **服务器装 Docker**：`curl -fsSL https://get.docker.com | sh`
3. **服务器登录 GHCR**：GitHub 上建 classic PAT（勾 `read:packages`）后执行 `docker login ghcr.io -u <用户名>`，粘贴 PAT 当密码。镜像默认是私有包，不登录拉不到。
4. **上传两个文件**到服务器部署目录（如 `/home/ticket`）：`docker-compose.prod.yml` 和 `.env`（由 `.env.prod.example` 复制填写，注意 `IMAGE_PREFIX` 全小写）。**不需要 clone 整个仓库。**
   密码建议在服务器上用 `openssl rand -hex 24` 现场生成，`.env.prod.example` 顶部有现成命令；改完 `chmod 600 .env`。
5. **端口与 HTTPS**：本系统只用 **7000**（服务器上 7000~7003 属本批项目，挑未占用的那个，`ss -lntp | grep 7000` 可查占用）。对外由 `https://weixin.newedm.cn` 提供 HTTPS：80/443 已被其它服务占用时，把 `Caddyfile.snippet` 里那一段加进现有 Caddyfile 并 reload；80/443 空着时启用 `docker-compose.prod.yml` 里注释掉的 `caddy` 服务（此时 snippet 里的 `127.0.0.1:7000` 要改成 `frontend:80`）。完整操作见 **`DEPLOY.md`**。
6. **校验并启动**：
   ```bash
   docker compose -f docker-compose.prod.yml config --quiet   # 检查变量有没有漏
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d --wait    # 等健康检查通过才返回
   docker compose -f docker-compose.prod.yml ps
   curl -fsS http://127.0.0.1:7000/api/health                # 前端 nginx → backend 整条链路
   ```
7. **部署后必做**：后台「邮件设置」把 `public_base_url` 改成 `https://你的域名`，否则邮件里的报名链接是 `http` 或 localhost。
8. **以后更新**：本地改代码 → `git push` → 等 Actions 跑完（首次约 5~10 分钟，有缓存后 2~3 分钟）→ 服务器重复第 5、6 步（`IMAGE_TAG=latest` 会自动拿到最新镜像）。
9. **回滚**：Actions 每次构建都会额外打 `sha-<提交号>` 标签，把 `.env` 里 `IMAGE_TAG` 改成上一版的 `sha-xxxxxxx` 再 `up -d` 即可。

## 上线前必须处理

1. 复制 `.env.example` 为 `.env`，换掉全部 `change-me-*`：数据库密码、`JWT_SECRET`、`ADMIN_PASSWORD`（`.env` 已被 `.gitignore` 排除，只有模板进仓库）
2. 去掉 `docker-compose.yml` 里 `db` 的 `5440` 和 `backend` 的 `8110` 端口映射，只保留前端 `${FRONTEND_PORT}`（服务器上设 80）；`/api` 由前端 nginx 反代，外部无需直连后端与数据库
3. 域名与 HTTPS（微信内置浏览器要求 https）；境内服务器需 ICP 备案
4. 配置企业微信邮箱 SMTP（`smtp.exmail.qq.com:465`，用客户端专用密码），开发期邮件走空跑模式；同时把 `public_base_url` 改成正式域名
5. 后端 `main.py` 的 CORS `allow_origins=["*"]` 收窄到正式域名
6. 数据卷 `db_data` 与 `uploads` 纳入每日备份
7. 通讯录 Excel、场次名额与演出时间、三类邮件文案由客户方提供

需求口径以 `output/20261029-1516-reqdoc/stage3/…-V1.3.6.docx` 为准；变更记录见 `CHANGELOG.md`。
