# 上线操作单 — 2026 SAP 北分工会冬季家庭主题活动报名系统

按顺序执行，每步都有验证方法。命令分两处执行：标了「本机」的在 Windows cmd / PowerShell 跑，其余在服务器 SSH 里跑。

## 固定信息（已确认）

| 项目 | 值 |
|---|---|
| 代码仓库 | `https://github.com/lzy497066369/registration-system-dk`（**建议先转为私有再 push**） |
| 域名 | `https://weixin.newedm.cn`（2026-11-05 验证解析到 `123.6.146.55`） |
| 服务器内部端口 | `7000`（7000~7003 属本批项目，目前全空） |
| 部署目录 | `/home/ticket` |
| 镜像 | `ghcr.io/lzy497066369/registration-system-dk-backend:latest`、`…-frontend:latest` |
| 镜像架构 | `linux/amd64` |
| 数据 | 全新安装，不迁移本地测试数据 |

## 第 0 步：服务器前置检查

```bash
uname -m                                   # 必须是 x86_64
docker --version && docker compose version
ss -lntp | grep -E ':700[0-3]\b|:80\b|:443\b'
```

- `uname -m` 输出 `aarch64` → 停下，把 `.github/workflows/ghcr.yml` 里 `PLATFORMS` 改成 `linux/arm64` 再推一次。
- `:80` / `:443` 有进程占用 → 记下是什么（大概率是已有的 Caddy 或 Nginx），第 8 步按"已有反代"处理。

## 第 1 步：本机推代码到 GitHub

```cmd
cd /d "D:\桌面\2026SAP北分工会冬季家庭主题活动\registration-system" && git init && git add . && git commit -m "报名系统初始提交"
```

```cmd
cd /d "D:\桌面\2026SAP北分工会冬季家庭主题活动\registration-system" && git remote add origin https://github.com/lzy497066369/registration-system-dk.git && git push -u origin main
```

## 第 2 步：打开 Actions 写权限（只做一次）

仓库 `Settings → Actions → General → Workflow permissions` → 选 **Read and write permissions** → Save。

## 第 3 步：确认镜像构建成功

仓库 `Actions` 页面看到 `build-and-push-ghcr` 绿色通过（首次 5~10 分钟）；
仓库右侧 `Packages` 出现 `仓库名-backend`、`仓库名-frontend` 两个包，tag 为 `latest` 和 `sha-xxxxxxx`。

## 第 4 步：服务器登录 GHCR

GitHub → `Settings → Developer settings → Personal access tokens (classic)` → 生成，只勾 `read:packages`。

```bash
docker login ghcr.io -u lzy497066369
# 密码粘贴 PAT；提示 Login Succeeded 即可
```

## 第 5 步：本机上传两个文件

```cmd
ssh root@123.6.146.55 "mkdir -p /home/ticket"
```

```powershell
scp "D:\桌面\2026SAP北分工会冬季家庭主题活动\registration-system\docker-compose.prod.yml" "D:\桌面\2026SAP北分工会冬季家庭主题活动\registration-system\.env.prod.example" root@123.6.146.55:/home/ticket/
```

只需要这两个文件，**不需要 clone 整个仓库**。

## 第 6 步：服务器生成 .env

```bash
cd /home/ticket
cp .env.prod.example .env      # 模板里 IMAGE_PREFIX 已填好本项目地址，可直接用
# 密码现场生成，不在本机造好再传
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=$(openssl rand -hex 16)
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$DB_PASSWORD|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMIN_PASSWORD|" .env
chmod 600 .env
echo "$ADMIN_PASSWORD"        # 存进密码管理器，不要发到聊天里
grep -E "^IMAGE_PREFIX|^FRONTEND_PORT" .env   # 确认前缀正确、端口 7000
```

## 第 7 步：校验并启动

```bash
cd /home/ticket
docker compose -f docker-compose.prod.yml config --quiet      # 无输出=配置没问题
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --wait        # 等健康检查通过才返回
docker compose -f docker-compose.prod.yml ps                  # 三个都是 running
curl -fsS http://127.0.0.1:7000/api/health                    # 返回 JSON 即链路通
```

此时用 `http://123.6.146.55:7000` 已经能打开页面，但**不要把地址发出去**——还没 HTTPS。

## 第 8 步：接 HTTPS（两种情形选一）

**情形 A：服务器上已有 Caddy/Nginx 占着 80/443**
把 `Caddyfile.snippet` 里 `weixin.newedm.cn { ... }` 那一段加进现有 Caddyfile：

```caddyfile
weixin.newedm.cn {
	encode gzip
	reverse_proxy 127.0.0.1:7000
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

若 Caddy 是容器（bridge 网络），`127.0.0.1` 访问不到宿主机，要改成 `host.docker.internal:7000`。

**情形 B：80/443 空着**
启用 `docker-compose.prod.yml` 里注释掉的 `caddy` 服务（连带 `volumes` 里两项），
并把 `Caddyfile.snippet` 里的 `127.0.0.1:7000` 改成 `frontend:80`，然后
`docker compose -f docker-compose.prod.yml up -d`。证书由 Caddy 自动申请。

**验证**：

```bash
curl -I https://weixin.newedm.cn        # HTTP/2 200，证书有效
```

## 第 9 步：部署后必做（在浏览器里）

1. 打开 `https://weixin.newedm.cn/admin`，用第 6 步的 `ADMIN_PASSWORD` 登录。
2. **后台「邮件设置」→ `public_base_url` 改成 `https://weixin.newedm.cn`**，否则邮件里报名链接是死的。
3. 配 SMTP（`smtp.exmail.qq.com:465` + 客户端专用密码），先开空跑模式发一封测试。
4. 手机微信里打开活动链接，走一遍报名流程（含大图、提交、确认页）。
5. 安全组确认只放行 `22 / 80 / 443`，**7000 不对公网开放**（否则可绕过 HTTPS 访问）。

## 日常更新与回滚

```bash
# 更新（本机 push 后，等 Actions 变绿）
cd /home/ticket && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d --wait

# 回滚：.env 里 IMAGE_TAG 改成上一版 sha-xxxxxxx，再执行上面同一条
```

## 备份（建议每天 cron）

```bash
# 数据库
docker exec reg_db pg_dump -U ticket ticket | gzip > /home/ticket/backup-$(date +%F).sql.gz
# 上传图片（卷名带项目名前缀，先 docker volume ls 确认）
docker run --rm -v ticket_uploads:/data -v /home/ticket:/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```
