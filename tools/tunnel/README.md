# 临时对外发布（把本机当服务器）

用于**活动报名期间让外网的人先试用**：不需要服务器、不需要域名、不需要备案。
原理是 Cloudflare Quick Tunnel —— 在你电脑和 Cloudflare 之间建一条临时隧道，
给你一个 `https://xxxx.trycloudflare.com` 的公网地址，谁拿到都能打开。

正式上线（自有服务器 + 域名）时，这套工具就不需要了。

## 前提

1. Docker Desktop 已启动，项目根目录执行过 `docker compose up -d`，`http://localhost:5280` 能打开。
2. 电脑保持开机、联网，**不要休眠**。
3. 后台默认密码 `admin / admin123` 必须改掉（系统设置 → 修改密码），否则拿到链接的人都能进后台。

## 用法

双击 `start-tunnel.cmd`，或在项目根目录执行：

```
tools\tunnel\start-tunnel.cmd
```

脚本会做三件事：检查 5280 是否存活 → 启动隧道 → 打印公网地址。

窗口里那个 `https://xxx.trycloudflare.com` 就是给测试者的地址，同时会写进同目录的 `public-url.txt`。

- 员工报名页：`https://xxx.trycloudflare.com/a/sap-winter-2026/login`
  （`sap-winter-2026` 换成你后台里的活动编码，在「活动管理」列表能看到）
- 后台管理：`https://xxx.trycloudflare.com/admin`

## 停止

**直接关掉那个黑窗口**，或者在窗口里按任意键，隧道立即失效，地址作废。

## 注意事项

| 事项 | 说明 |
|---|---|
| 地址会变 | 每次重新运行脚本都会拿到新地址，旧地址立刻失效。要在报名开始前启动，别中途重启 |
| 电脑不能关 | 关机、睡眠、断网、关掉 Docker，别人就打不开 |
| 同项目只能开一个 | 重复运行会提示「已在运行」，先关掉旧窗口 |
| 和 ai-pdp-data 可共存 | 两个项目用不同的内部指标端口（20298 / 20299），可以同时开 |
| 链接是公开的 | trycloudflare 地址不带密码，别发到公开群；后台密码务必改 |
| 速度 | 走 Cloudflare 海外节点，国内访问可能偏慢，用于功能验收足够 |

## 备选方案

如果 trycloudflare 的域名在你这边访问不稳定，可以换成 ngrok（需要注册账号拿 token）：

```
ngrok http 5280
```

或者用花生壳 / frp 之类。换工具不影响项目本身，隧道只要指到 `http://localhost:5280` 就行。

## 正式部署时

把 `docker compose` 这套东西搬到服务器上，前面挂 Nginx（或 Caddy）配域名和 HTTPS，
前端 5280 反代到 `/`，`/api` 反代到后端 8000。数据库只在内网，不要暴露端口。
