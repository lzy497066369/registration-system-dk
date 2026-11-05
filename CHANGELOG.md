# 变更记录

## 2026-10-30

### 第 1 日：工程骨架 + 数据层 + 并发核心

- 新增 Docker Compose 三容器编排（db / backend / frontend），端口 5280 / 8110 / 5440，与既有项目隔离
- 建立 9 张表模型：admin_users、activities、shows、ticket_sessions、contacts、registrations、email_templates、email_outbox、system_configs
- 并发核心 `services/booking.py`：原子扣减 SQL（`sold + seats <= capacity`）、`(activity_id, active_key)` 联合唯一索引、幂等键唯一索引；扣减与写单同事务，取消按落库 seats 释放
- 后台登录：JWT + PBKDF2 口令散列，失败 5 次锁 30 分钟
- 前端占位页与 `/api/health` 健康检查

### 第 2 日：后台三大模块 + antd 界面

- 后台接口：活动管理（CRUD、状态流转、图片上传压缩）、剧目与场次维护、通讯录（Excel 导入导出、单条增改停用、员工号修改限制）
- 后台界面改为 Ant Design 布局（深色侧边栏 + 面包屑 + 卡片式列表页），与 ai-pdp-data 风格一致
- 富文本编辑器换为 Quill（react-quill 2.0 + quill 1.3.7），后端 XSS 过滤放行 `data:image/*` 内嵌图（≤1.5MB）
- 全部下拉加搜索，日期控件中文（ConfigProvider zh_CN）

### 需求文档 V1.3.6 修正

- 演出地点、详细地址、演出介绍由活动级下沉为**剧目级**（依据 H5 设计图）：activities 表删除 `venue_name`/`venue_address`，shows 表新增 `location`/`address`
- 后台改为「剧目与场次」在活动下维护，通讯录导入须先选所属活动
- 新增 `app/migrations.py`，启动时执行幂等 DDL，老库自动升级

### 修复

- **前台样式泄漏到后台**：`front.css` 里的 `html { font-size }` 与 `body { max-width: 620px }` 是全局规则，一旦打开过前台页面就残留在文档中，把后台界面压成 620px 宽、表头挤成竖排。现全部限定在 `html.front-mode` 下，由新增的 `front/FrontLayout.tsx` 在进入/离开前台时给 `<html>` 增删该类
- 后台四个列表表格加 `scroll={{ x }}`，列多时横向滚动而不是压缩列宽
- 日期控件中文：antd 的 `locale` 只覆盖按钮文案，月份/星期取自 dayjs 语言包。在 `frontend/src/main.tsx` 增加 `import 'dayjs/locale/zh-cn'` 与 `dayjs.locale('zh-cn')`，面板显示「十月 / 星期五」而非 Oct / Su Mo Tu

### 筛选改为可选（活动维度）

- 剧目管理、场次管理、通讯录三页的「所属活动」下拉改为可选：默认不选＝显示全部活动；表格「所属活动」列**始终显示**（不随筛选隐藏）
- 新增跨活动查询接口：`GET /api/admin/shows`、`GET /api/admin/sessions`、`GET /api/admin/contacts`、`GET /api/admin/contacts/export`（均支持可选 `activity_id` 参数）
- 通讯录「导入 Excel」改为弹窗流程：先选活动（必选）→ 再选文件，避免误导入到错误活动
- 新增场次时在弹窗内先选活动再选剧目（剧目列表随所选活动联动）

### 第 3 日：前台 H5 五页（依静态设计稿还原）

> 说明：本节初版基于旧设计稿目录 `SAP-261030-2/` 还原；随后已按**最新版设计稿 `html/`** 重新对齐样式与素材，本节记录保留以说明演进过程，当前实现以 `html/` 为准。

- 素材：设计稿 18 张图片拷入 `frontend/public/images/`；样式按 `css/global.css` 1:1 复刻为 `src/front/front.css`（620px 设计稿基准、rem 布局、紫色渐变主题）
- 页面：登录 → 选剧目 → 填信息 → 核对 → 成功（`/a/{code}/login|list|form|confirm|success`）
- 配置驱动挂钩：活动「首页背景图」→ 登录页背景；「内页头图」→ 各页顶部 banner；剧目「封面图」→ 剧目卡片底图（未上传则用 list-item1/2 默认图）；剧目名称/地点/地址/演出介绍 → 卡片与介绍弹窗；场次名称/时间/余量 → 场次按钮（5 秒轮询局部刷新）
- 省市二级联动内置 34 个省级行政区数据（`src/front/regions.ts`），不调第三方接口
- 前台后端接口：`POST /api/a/{code}/auth/login`（员工号+邮箱校验、5 次锁 30 分钟）、`GET /api/a/{code}/sessions`（余量轮询，含 not_started/open/closed/full/ended 五态与结伴上限）、`POST /api/a/{code}/register`（提交报名，走原子扣减与唯一索引）、`GET /api/a/{code}/my`
- 数据模型补充：`shows.cover_image`（剧目卡片底图）、`registrations.reg_no`（报名编号），均走幂等迁移自动补列
- 路由由 HashRouter 改为 BrowserRouter，前台 URL 形如 `/a/sap-winter/login`（微信分享可用）；nginx 已有 SPA fallback

### 第 3 日：报名管理后端

- 新增 `registration_logs` 表（报名单修改留痕：字段、旧值、新值、操作人、时间）
- 新增 `services/mailer.py` 统一邮件入队（signup / shipped / remind 三类模板变量替换），前台报名成功与后台回填共用
- 新增接口 `routers/admin_registrations.py`：
  - `GET /api/admin/registrations` 列表（活动/剧目/场次/状态/关键字筛选 + 分页，返回 19 项字段 + 所属活动）
  - `GET /api/admin/registrations/export` 导出 Excel（19 列，与需求文档列表一致）
  - `GET /api/admin/registrations/stats` 实时看板（总数、待邮寄/已邮寄/已取消、占用名额、各剧目场次余量、最近报名）
  - `PUT /api/admin/registrations/{id}/contact` 编辑六项联系/邮寄信息（格式校验 + 逐字段留痕）
  - `POST /api/admin/registrations/{id}/cancel` 作废报名单（释放名额，取消后可重报，留痕）
  - `PUT /api/admin/registrations/{id}/tracking` 回填快递公司与单号（状态自动置为已邮寄 + 入队「已邮寄」提醒邮件）
  - `POST /api/admin/registrations/import-tracking` Excel 批量回填（按报名编号或员工号匹配，逐行错误报告，回填后自动发提醒邮件）

### 第 3 日：邮件体系（接口 + 后台页面）

- 新增 `routers/admin_emails.py`：模板读写（`GET/PUT /api/admin/email-templates`）、发信通道配置（`GET/PUT /api/admin/email-config`）、发送记录（`GET /api/admin/email-outbox`）、立即发送一轮（`POST /api/admin/email-outbox/send-now`）
- `services/mailer.py` 增加内置默认模板文案（signup / shipped / remind），活动未配置模板时后台可直接采用
- 新增 `services/mail_worker.py`：30 秒一轮的定时 worker——先按各场次倒推生成到点的观演提醒（提前量取场次级配置、留空继承活动默认、每单只发一次），再扫描 outbox 队列异步发送；失败重试 3 次后置为 failed
- 开发期「空跑模式」：邮件只入库不外发，后台可查看完整内容与状态；正式上线前在「发信通道配置」填入企业微信邮箱的客户端专用密码并关闭空跑即可
- `main.py` 改用 lifespan 托管 worker 的启动与停止
- 数据模型新增 `registrations.remind_sent`（观演提醒是否已发）

### 后台页面（报名管理 / 邮件模板）

- `pages/Registrations.tsx`：顶部 5 项看板（总数 / 待邮寄 / 已邮寄 / 已取消 / 占用名额 + 各场次余量）、19 列表格（横向滚动）、行内「编辑 / 回填快递 / 取消」、导出 Excel、批量回填弹窗（含逐行错误报告）
- `pages/Emails.tsx`：邮件模板维护（每活动三类模板，未定制显示「用默认」标记）、发信通道配置弹窗（企业微信邮箱 SMTP 参数 + 空跑开关）、发送记录表格与邮件内容预览、「立即发送一轮」

### 修复

- **填信息页字体与设计原稿不一致**：原稿 `html/list1.html` 单独引入了 `layui.css`，其全局样式把 body 设为 `font: 14px Helvetica Neue,...`（line-height 被 font 简写重置为 normal），并让表单控件继承字体；我们的实现未引入 layui，body 沿用 81.29px 基准且控件用浏览器默认 Arial。现按 layui 原文等价还原——`front.css` 增加 `:where(html.front-mode.front-layui)` 作用域规则（用 `:where()` 保持与 layui 同优先级，避免盖掉 `.form-input` 等自身的 rem 字号），`FrontLayout` 按路由为填信息页加 `front-layui` 类。实测逐项一致：body 14px/normal、标题 24.71px、输入框 15.45px、人数卡片 16.26/13.82/12.19px、步进器 17.88px、按钮 16.26px，**整页逐点像素差异 0.7**
- **前台整页尺寸比设计稿小一截（根因）**：antd 的 `<App>` 组件会给外层容器设置 `font-size: 14px`，前台页面被它包住后，`em` 基准从设计稿的 81.29px（继承 html 的 `calc(100vw/6.2)`）变成 14px，导致 `height:2em` 占位块由 163px 缩成 28px、卡片高度 509px→385px、剧目地址被压到照片上。现 antd 的 `<App>` 只包裹后台路由，前台不再经过它；并在 `front.css` 加 `html.front-mode .ant-app { font-size: inherit }` 兜底
- **前台与设计稿逐像素比对通过**：用 Chrome 无头模式在 520×1000 视口分别渲染设计稿与项目页并逐行取色对比 —— 登录页差异 0.0、选剧目页逐行 0~2、核对页 0.7、填信息页 0.7、成功页 3.9（差异均来自输入框内容与场次状态，非样式）
- **剧目卡片改回设计稿原样**：整卡背景图（`no-repeat center center` + `cover`）+ `2em` 占位 + 介绍按钮压图 + 场次区，剧目名与地址落在背景图自带的浅色区；后台可换图（提示需「上浅下照片、顶部留白」的剧目照）
- **剧目地址前台不加工**：后台填什么就显示什么（去掉自动加的括号）
- **演出介绍弹窗**：正文标签改回设计稿的 `<p class="intro-body">`；富文本段落继承设计稿的字号/行距/缩进（纯继承，不另设样式）
- **上传后可查看**：新增 `admin/components/ImageField.tsx`——已上传显示缩略图（点击放大预览）、「查看大图」新窗口打开、「替换」按钮；活动列表新增「视觉素材」列
- **编辑弹窗回显丢失**：`destroyOnClose` 会销毁 Form，`setFieldsValue` 在 Form 挂载前调用会丢值。六个表单弹窗统一改为 `forceRender` + 回填前 `resetFields()`；新增 `GET /api/admin/shows/{id}` 单剧目详情接口
- **后台列表接口漏字段**：`GET /api/admin/shows` 未返回 `cover_image`，导致封面图不回显，已补
- **透明 PNG 被转 JPEG**：服务端一律 PNG→JPEG 丢了 alpha，标题块透明区变白色方块。改为「有透明像素存 PNG、无透明转 JPEG」
- **图片上传失败（413）**：nginx 默认 `client_max_body_size` 仅 1MB，底图约 1.5MB 被网关拦截。放开至 **10m**；后端原图上限同步提到 **10MB**（入库前统一压缩为宽 ≤1920）；前端上传失败透传真实原因。需求文档 FR-B-02-04 同步改为「单张原图不超过 10MB」
- **上传后可查看**：新增 `admin/components/ImageField.tsx`——已上传显示缩略图（点击放大预览）、「查看大图」新窗口打开、「替换」按钮；用于活动的底图/标题块/内页头图与剧目卡片底图。活动列表新增「视觉素材」列（底图+标题块双缩略图，点击可预览）

### 前台样式对齐最新版设计稿（html/）

> 设计稿以 `html/` 目录为准（`SAP-261030-2/` 不再作为参考）。

- 前台样式**直接采用设计稿 `html/css/global.css` 原文**（仅改图片路径为 `/images/...`、全局 html/body 规则限定在 `html.front-mode` 下防止泄漏后台），不再手写近似样式
- 新版设计差异同步：登录页移除独立 logo 元素（新稿已注释）、标题块图下移（margin-top 1.51rem）、省市区选择器 `margin: 0 auto !important`
- 素材同步：`html/images/` 全部图片拷入 `frontend/public/images/`（新增 `login-bg1.png` 无 logo 版底图备选）
- 补充设计稿未覆盖的状态样式：禁用态（按钮/输入框/步进器）、错误提示文案、辅助说明文字

### 图片配置层级调整（活的挂钩）

- 新增 `activities.title_image`（活动标题块图）：首页为「整屏底图 + 标题块图」两层结构，标题块叠加在底图上方；后台活动配置新增「上传标题块」，前台登录页按配置显示
- 剧目卡片底图确认为剧目级 `shows.cover_image`，后台剧目编辑弹窗可上传，前台按剧目分别显示
- 需求文档 V1.3.6 同步修订：FR-B-02-04、FR-B-04-01、FR-F-00-03、6.2 表结构（新增 title_image 与 cover_image）、确认记录 Q23

### 列表筛选补全

- 活动管理：关键字（名称/编码/公司）、状态、结伴规则、开抢时间范围；新增「观演提醒默认提前」「创建时间」两列
- 剧目管理：关键字（名称/地点/地址）、有无场次、名额是否已满；新增「演出介绍」列（自动去 HTML 截断显示）
- 场次管理：关键字（场次名称）、演出时间范围、开放状态、名额状态
- 通讯录：新增单条编辑弹窗（员工号、邮箱、启用/停用）；有有效报名单的员工号置灰不可改，邮箱随时可改
- 活动管理：新增「打开报名页面」列——点「打开报名页面」新标签页打开 `/a/{活动编码}/login`，点「复制链接」复制完整前台地址（对应需求 FR-B-02-07）

### 省市区三级联动按设计稿还原（2026-11-02）

- 前台「票券邮寄方式」由自制两级下拉改为设计稿的三级下拉（省 / 市 / 区县），DOM 与尺寸 1:1 复刻原稿 `list1.html`（layui form + bioarea）的实际渲染结果：容器 `gap 0.15rem`、右侧留白 `0.15rem`、下拉高 `0.48rem`、内边距 `0 30px 0 10px`、字号 `14px`、右侧 `#c2c2c2` 三角、圆角 `0.1rem`
- 区域数据取自设计稿原文件 `html/js/bioarea.js`（省=前 2 位、市=前 4 位、区县=前 6 位），生成 `front/regions.ts`：35 省 / 373 市 / 3367 区县
- 新增 `registrations.county` 字段（启动时 `migrations.py` 自动补列，老库无需手工 SQL），前台提交、确认页、成功页、后台列表 / 编辑弹窗 / 导出、邮件变量 `{{county}}` 全部打通
- 第三级占位文案统一为「请选择区」

### 出行人数（结伴）口径修正（2026-11-02）

- 步进器数字改为**随行家属人数**（0 ~ 后台结伴人数上限），不再显示「含本人在内的总人数」——原来上限 1 时页面能显示到 2，与实际可携带人数对不上
- 允许选到 0（0 = 不携带家属，`companion_count = 0`，占用名额 1），减号在 0 时置灰
- 上限统一取后端已算好的 `session.companion_max`（活动上限与「剩余名额−1」取小），不再在前端重复计算
- 后台「不允许携带结伴人」（`companion_enabled=false` 或上限为 0）时，前台整块「请填写您的出行人数」（标题 + 卡片）不再渲染；允许但名额不足时保留区块并提示「本场次剩余名额不足，暂不可携带家属」




### 报名提交 500 修复 + 确认页对齐（2026-11-02）

- **根因**：`registrations.remind_sent` 在早期迁移里建成 `SMALLINT`，而模型是 `Boolean`，插入报名单时 PG 报 `column "remind_sent" is of type smallint but expression is of type boolean` → 报名接口 500，前台只显示「请求失败」。同一问题也让观演提醒 worker 的 `remind_sent IS false` 查询持续报错（提醒邮件一直没发出去）
- `migrations.py` 改为 `ADD COLUMN ... BOOLEAN DEFAULT false`，并加幂等 DO 块把老库的 smallint 列转成 boolean（`USING (COALESCE(remind_sent,0) <> 0)`，同时补 DEFAULT/NOT NULL）；已在当前库执行，重启自动幂等
- 确认页步骤条第三步图标由 `setp3.png` 改为 `setph3.png`（对齐原稿 `list2.html`：三个步骤均为高亮态）
- 确认页提交按钮文案改为「确认，下一步」（原稿 `list2.html`）
- 确认页 / 成功页「随行人员」改为显示**随行家属人数**（不含本人），随行 0 人即显示「成人 0人」

### 「是否已报名」统一按员工号判定（2026-11-02）

- 前台布局加闸门：进入选剧目/填信息/核对前调 `GET /api/a/{code}/my`，已报名（`has_registration`）直接跳成功页，刷新或手改地址也绕不过去
- 成功页改为以 `my` 接口返回的报名单为准，浏览器缓存仅作接口异常时兜底，避免同一标签页换员工登录后仍显示上一个人的邮寄信息
- 草稿按登录员工号归属：登录成功写入 `front_emp_{code}` 并清旧草稿；`readDraft()` 发现草稿里的 `employee_no` 与当前登录人不一致就丢弃
- 后台通讯录「已报名」标记改为按 `(所属活动, 员工号)` 判定，修掉未选活动时同一员工在别的活动报过名、本活动也显示已报名的串号问题
- 前后台均已按活动配置隐藏「随行人员」行（验证：置 `companion_enabled=false` 后确认页/成功页该行不渲染）

### 通讯录「一键清除数据」（2026-11-02）

- 新增 `POST /api/admin/activities/{activity_id}/contacts/clear`：按活动整批清空通讯录，返回 `total/deleted/kept`；口径与单条删除一致——报过名的员工（含已取消）保留，只删没有报名记录的人
- 通讯录页右上角新增红色「一键清除数据」按钮：必须先在上方选「所属活动」，未选时点击提示先选活动；确认弹窗写明保留规则并提醒先导出备份，成功后提示删除/保留条数并刷新列表
- 未改表结构

### 临时外网访问工具 tools/tunnel/（2026-11-02）

- 新增 `tools/tunnel/`：`start-tunnel.cmd` + `get-url.ps1` + `cloudflared.exe`（复用 ai-pdp-data 的可执行文件），用 Cloudflare Quick Tunnel 把本机 5280 映射到公网，无需服务器/域名/备案
- 脚本先探活 5280，再起隧道，从 cloudflared 的本地 metrics 接口（127.0.0.1:20298，与 ai-pdp-data 的 20299 错开）取回公网地址，写入 `public-url.txt`
- 已实测：公网根路径、`/api/a/{code}/sessions`、`/admin` 均返回 200，延迟约 1.5s；停掉进程后地址变 502（符合预期）
- 脚本保持纯 ASCII + CRLF（GBK 控制台下中文注释会被当命令执行）
- README 增加「临时外网访问」一节

### 通讯录清除拆成两种口径（2026-11-02）

- 后端 `POST /api/admin/activities/{id}/contacts/clear` 新增 `mode` 参数：`unregistered`（默认，保留有报名记录的员工）/ `all`（清空全部，含已报名）。非法值返回 400
- 前端通讯录页拆成两个按钮：「删除未报名数据」（保留已报名）与「删除所有数据」（红色主按钮，二次确认弹窗额外警告：已报名员工删除后无法登录前台，报名单不受影响）
- 未改表结构

### 报名管理新增「删除」功能（2026-11-02）

- 新增 `DELETE /api/admin/registrations/{id}`：物理删除报名单。未取消的单子先按落库 `seats` 原子退回名额（`sold = sold - :seats` 且要求 `sold >= :seats`，不会扣成负数）；已取消的单子不再重复释放
- 外键 `registration_logs` / `email_outbox` 指向 `registrations` 均为 NO ACTION，删除前先清这两张子表，否则外键报错
- 前端报名管理操作列新增红色「删除」按钮 + Modal 二次确认，写明释放名额数、记录不可恢复、只作废请用「取消」；操作列宽度 210 → 270
- 与「取消」的区别：取消=作废留痕（状态改 cancelled、释放名额、可查历史）；删除=记录彻底消失（留痕与邮件记录一并清除）
- 实测：pending 单 seats=2 删除后 sold 3→1、released=2；cancelled 单删除 released=0、sold 不变；子表记录归零；重复删除返回 404
- 未改表结构

### 报名管理「清空报名数据」批量删除（2026-11-02）

- 新增 `POST /api/admin/registrations/clear?activity_id=`：按活动整批物理删除报名单，返回 `deleted`（删除条数）与 `released`（退回名额数）
- 退名额规则：只统计**未取消**的单子，按 `session_id` 汇总后逐场次原子更新（`sold = sold - :seats AND sold >= :seats`）；已取消的单子当初已释放，不重复退
- 同事务内清掉该活动的 `email_outbox`、`registration_logs`，再删报名单（外键 NO ACTION，必须先删子表）
- 前端报名管理右上角新增红色主按钮「清空报名数据」：未选所属活动时只提示不执行；确认框展示当前条数与占用名额（取看板 stats），写明留痕/邮件一并清除、不可恢复
- 实测（测试活动 3 条报名：2 pending 占 3 座、1 cancelled）：清空后 `deleted=3`、`released=3`、`sold` 3→0、日志与邮件归零；重复清空返回 0；OpenAPI 里路由注册正常，未与 `/{registration_id}` 冲突
- 未改表结构

### 后台列表精简 + 整体字号下调（2026-11-02）

- 活动管理列表去掉「活动编码」「公司名称」「创建时间」「视觉素材」四列（编码/公司名仍在搜索框里参与匹配，图片仍在编辑弹窗上传查看）；去掉横向滚动，表格撑满卡片
- 报名管理列表只保留「所属活动 / 员工号 / 邮箱 / 剧目 / 场次 / 演出时间 / 操作」（状态也收进详情），操作列新增「详细」按钮，弹窗用 Descriptions 展示全部字段：报名编号、状态、活动、报名时间、员工号、邮箱、剧目、场次、演出时间、演出地点、场馆地址、结伴人数、占用名额、联系电话、收件人、收件人手机、快递公司、邮寄地址、快递单号
- 后端 `_row_view` 增加 `location` / `address` 两个字段，供详情弹窗展示剧目级演出地点与地址
- 后台整体字号：`ConfigProvider` token `fontSize` 14 → 13（antd 组件全量跟随），`Content` 容器同步 `fontSize: 13`；前台 H5 不使用 antd 组件，不受影响
- 无表结构变更

## 2026-11-03

### 全站时间统一为北京时间（根因修复 + 历史数据校正）

- 根因：PG 的 `timezone` 来自 initdb 生成的 `postgresql.conf`（UTC），只给容器加 `TZ=Asia/Shanghai` 环境变量并不改变 GUC，于是 `server_default=func.now()` / `onupdate=func.now()` 落库的是 UTC 时间，前端按本地时间渲染就少 8 小时（报名时间、模板更新时间、发信创建时间、活动创建时间等全部受影响）
- 修复：`docker-compose.yml` 的 db 服务加 `command: postgres -c timezone=Asia/Shanghai -c log_timezone=Asia/Shanghai`；并对现有库执行 `ALTER DATABASE ticket SET timezone TO 'Asia/Shanghai'`（写入库级设置，新连接立即生效，重建容器也不丢）
- backend 服务补 `TZ: Asia/Shanghai`，与 `now_cn()` 口径一致
- 历史数据校正：对 `activities/admin_users/contacts/shows/ticket_sessions/registration_logs/system_configs/email_templates/email_outbox/registrations` 的 `created_at`、`updated_at` 统一 +8 小时（`email_outbox` 7、8 两条与 `registrations` 1233 的 `created_at` 本来就是北京时间，已排除）。**此校正只执行一次，勿重复跑**
- 导出的 Excel 文件名时间戳改用 `now_cn()`（`admin_contacts.py`、`admin_registrations.py` 里 3 处 `datetime.now()`）
- 邮件模板列表「更新时间」「发送时间」改用 `dayjs('YYYY-MM-DD HH:mm:ss')` 渲染，与其它页面格式统一

### 发信 DNS 抖动重试

- `mail_worker._open_server()`：DNS 解析失败 / 连接被重置自动重试 3 次（间隔 2s、4s），仍失败返回中文提示「域名解析失败…」，不再直接暴露 `gaierror: [Errno -2]`
- `docker-compose.yml` 的 backend 增加 `dns: [223.5.5.5, 119.29.29.29]`，绕开宿主机 DNS 抖动（刚重建容器、挂 VPN/代理时最易触发）

### 前后台小改

- 前台成功页新增「邮寄状态」：未回填快递单号显示「等待邮寄」，回填后显示「已邮寄」并展示快递公司与快递单号（`/my` 接口补 `courier_company`、`courier_no`）
- 后台「通讯录」模块改名为「员工管理」（菜单、面包屑、页面标题、导入弹窗、导出文件名与工作表名）
- 邮件模板列表「未定制」由挤在「邮件类型」列里（溢出压到标题）改为标题列前置徽标；「发送记录 → 状态」列失败原因单行省略、悬停看全文

### 邮件正文自动补 600px 箱体（图与文字等宽）

- 现象：把「报名成功」模板的 HTML 源码粘到「已邮寄」「观演提醒」后，头图比正文文字短、标题看着不居中
- 根因：粘贴时外层那两个宽度表格被编辑器吃掉（库里正文只剩 1 个 table，signup 是 3 个），头图的 `width="100%"` 也丢了；于是头图按自身 600px 显示，正文却在 70% 版式壳（约 896px）里，标题在 896px 中居中自然偏右
- 修复：`mailer.ensure_mail_box()` —— 发送前检测正文有无固定像素宽容器（480~760px 表格），没有就自动套一层 600px 居中箱体；箱体必须套在 `mail-wrap` **内部**（否则 70% 会以 600px 为基准再打折到 420px），函数递归拆壳再套回，幂等
- 调用点：`mail_worker.build_message()` 在 `normalize_mail_html()` 之后；保存接口不调用，库里仍只存正文
- 实测三条模板（signup / shipped / remind）渲染后 box600、banner、title 三者左右边界均为 L=241 R=841 W=600，中心 541 完全一致

## 2026-11-03（补）

### 修复：误报「您已报名过本次活动」（幂等键设计错误）

- 现象：填完报名 → 确认页 → 上一步 → 再确认 → 点确定，提示「您已报名过本次活动，请勿重复提交」，但后台报名管理里查不到这个人
- 根因：`Confirm.tsx` 的幂等键是 `${session_id}-${手机号}`，与员工无关；而 `registrations.uq_reg_idempotency` 是**全表唯一**。于是任何历史报名单只要用了同一手机号（库里 `1-15007106459`、`1-15007106451` 就是这种形态），换员工号再报也会撞键，被当成「重复提交」
- 前端：幂等键改为按草稿生成的一次性随机键（`newIdemKey`，16 字节随机 hex），并在载入确认页时写回草稿，保证「上一步 / 反复点确定」复用同一个键
- 后端：`booking.create_registration()` 遇到幂等键冲突不再报错，而是回滚后查出首次那单直接返回（真正的幂等语义）；`active_key` 冲突才是「已有报名」
- `public.py` 透出 `DuplicateRegistration` 的具体文案，不再一律显示「已报名过」
- 回归实测：同键提交两次 → 同一单、库里 1 条；换键同员工 → 被拦截；`sold` 只扣一次，清理测试数据后复原

### 报名页文案与默认值

- 「请填写您的出行人数」→「请填写您的随行人数」
- 随行人数默认 1；场次数据加载完成后按「可携上限 / 剩余名额」自动收敛，活动不允许带随行时自动归 0（`useEffect` 加 `if (!session) return`，避免加载前把默认值抹成 0）

## 2026-11-03（补2）

### 前台三页统一登录态守卫（取消/删除报名后不再显示「报名成功」）

- 现象：i123456 报名成功 → 后台取消/删除 → 刷新前台成功页，仍显示「您已成功报名」
- 根因：`Success.tsx` 在 `/my` 返回 `has_registration=false` 时回退去读 `sessionStorage` 里的旧快照，删除/取消后快照还在，于是照常渲染成功页
- 修复（`front/api.ts` 新增 `checkRegistration` / `guardBeforeRegister` / `guardHasRegistration`，并补 `clearEmp`）：
  - `Success.tsx`：去掉 sessionStorage 回退，统一走 `guardHasRegistration`——未登录或已无有效报名单，都清 token/emp/草稿后跳登录页
  - `RegisterForm.tsx` / `Confirm.tsx`：新增 `guardBeforeRegister`——未登录回登录页；已报名跳成功页（防止再填一份）
  - `Confirm.tsx`：提交成功后不再写 sessionStorage 快照（该字段已无消费方）
- 语义区分：报名前（Form/Confirm）守卫 = 「已登录且未报名」；成功页守卫 = 「已登录且有有效报名单」
- 后台取消报名会 `active_key=NULL` 释放名额、`status=cancelled`，前端 `/my` 按 `status != cancelled` 过滤，故取消/删除后前端会正确回登录页

## 2026-11-03（补3）

### 活动新增「默认随行人数」配置

- 需求：活动允许携带结伴人时，再设一个「默认随行人数」，前台报名页随行人数选择器按此值初始化，且不能超过结伴人数上限
- 数据：`activities` 新增 `companion_default INT DEFAULT 1`（migrations.py 加 `ADD COLUMN IF NOT EXISTS`，并手动对存量 `companion_enabled=false` 的记录归 0）
- 后端 `admin_activities.py`：schema/list/get/create/update 补 `companion_default`；create/update 做钳制——不允许携带时强制 0、超过上限时收敛到上限
- 后端 `public.py`：前台 sessions 返回 `companion_default`
- 前端 `Activities.tsx`：结伴人数上限下方加「默认随行人数」输入项，带联动（改上限自动收敛默认值、不允许携带时禁用归 0）+ 表单校验「不能超过上限」
- 前端 `RegisterForm.tsx`：随行人数选择器初始值从硬编码 1 改为读取 `activity.companion_default`（无草稿覆盖时），并按 `companion_max` 钳制

## 2026-11-04

### 活动状态终于可切换（补漏）

- 问题：活动创建后固定为 `draft`，后台没有任何入口改状态，前台 `_get_activity` 对 draft 直接 404「活动不存在」，等于活动永远打不开
- 原因：后端 `PUT /api/admin/activities/{id}/status` 早就写好（`VALID_STATUS = draft/active/ended`），但前端从未调用，属开发遗漏
- 前端 `Activities.tsx`：操作列按状态显示「开启报名 / 结束报名 / 重新开启」，均带二次确认；操作列 140 → 240，表格加 `scroll={{x:1240}}`
- 后端 `public.py`：
  - `_session_status()` 增加 `activity.status == "ended"` → 所有场次返回 `ended`，前台场次按钮显示「报名已结束」并置灰
  - `front_register()` 增加 `activity.status != "active"` → 400「活动报名已结束」，防止绕过界面直接调接口
- 实测：active → 场次全 open；切 ended → 场次全 ended；恢复 active → 全 open（数据已复原）

### 列表间快捷跳转

- `Activities.tsx` 新增「快捷进入」列：**剧目** → `/admin/shows?activity_id=X`、**场次** → `/admin/sessions?activity_id=X`
- `Shows.tsx` 操作列新增「场次」→ `/admin/sessions?activity_id=X&show_id=Y`
- `Shows.tsx` / `Sessions.tsx` 改用 `useSearchParams` 读取 `activity_id` / `show_id` 作为初始筛选，并监听 URL 变化（同路由重复跳转也能生效）

### 邮寄回填批量导入改列

- 列顺序由「报名编号 | 员工号 | 快递公司 | 快递单号（前两列任填其一）」改为「员工号 | 快递公司 | 快递单号」，**只按员工号匹配**（跳过已取消的报名单）
- 首行是表头（员工号 / 工号 / employee_no）时自动跳过；缺员工号、缺快递单号、查不到报名单分别回到 `errors`
- 前端上传提示文案同步

### 只读用户账号（报名情况）

- `admin_users` 新增 `role`（`admin` / `viewer`）；新增 `admin_user_activities` 绑定表，一个账号可挂钩多个活动
- `deps.py` 新增 `require_admin`（写接口 403）与 `scoped_activity_ids`（只读接口按绑定活动过滤）
- 活动/剧目/场次/员工/邮件路由改用 `require_admin`；报名列表、导出、统计保留只读，但自动限定活动范围，越权传 `activity_id` 直接 403
- 新增 `GET /api/admin/my-scope`（返回角色 + 可见活动）与 `/api/admin/users` CRUD（仅管理员，只管理 viewer）
- 前端新增「用户账号」页（新建/编辑/删除、多选绑定活动、重置密码）与「报名情况」页（全字段列表 + 活动/状态/关键字筛选 + 导出 Excel）
- 只读账号登录后菜单只剩「报名情况」，手敲其他后台地址会被拉回该页；接口层面同样拦截，不只是前端隐藏
- 迁移：`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role ...` + `CREATE TABLE IF NOT EXISTS admin_user_activities`，老库启动自动升级，存量账号默认为 admin

### 富文本图片改为原图直存（不再压缩）

- 前端 `RichTextEditor` 删掉 canvas 压缩（原长边 1600px + JPEG 0.85 → 图片在全屏演出介绍里发糊），上传/粘贴的图**原样**以 base64 插入；单张超过 20MB（编码后长度）弹「图片过大，已跳过」，不再静默丢失
- 后端 `MAX_IMAGE_BYTES` 1.5MB → **20MB**（`utils/xss.py`），超限提示文案同步改为「单张上限约 15MB（原图）」
- `nginx.conf` 的 `client_max_body_size` 10m → **120m**（一次可能存多张原图）
- 副作用修复：正文变重后，列表与轮询接口不再返回 `intro_html` 全文
  - 后台 `GET /activities/{id}/shows`、`GET /shows` 改用 `defer(Show.intro_html)` + `func.length()`，只返回 `has_intro`；剧目列表「演出介绍」列显示「已配置」，编辑弹窗改为先取详情再打开（避免正文被覆盖/清空）
  - 前台 `GET /api/a/{code}/sessions`（5 秒轮询）同样只返回 `has_intro`，活动介绍字段移出响应
  - 新增 `GET /api/a/{code}/shows/{id}/intro`，点「点此查看演出介绍」时才拉正文，弹层显示「正在加载演出介绍…」
- 邮件模板正文仍保留 600px 重编码（`services/image_opt.py`）：邮件显示宽度就是 600px，且 Gmail 对超过 102KB 的 HTML 正文会截断
