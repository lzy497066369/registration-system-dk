"""邮件入队服务：报名成功 / 已邮寄 / 观演提醒。

所有邮件先落 email_outbox 表，再由发送 worker 异步发出（开发期为空跑模式），
避免 SMTP 慢响应拖垮报名接口。
"""
import re

from sqlalchemy.orm import Session

from ..models import Activity, EmailOutbox, Registration, Show, TicketSession

TEMPLATE_VARS = [
    "recipient_name", "recipient_phone", "reg_no", "employee_no", "email",
    "activity_name", "show_name", "session_name",
    "show_at", "location", "address", "province", "city", "county", "address_detail",
    "companion_count", "phone", "courier_company", "courier_no", "seats",
    "qrcode",
]

# 二维码占位：发送时才按「前台访问地址」生成并作为内嵌附件（cid）。
# 不用 data: 内嵌图，因为 Gmail / QQ 邮箱会直接屏蔽 data 协议图片。
QR_IMG = (
    '<img src="cid:qrcode" alt="报名进度二维码" width="130" '
    'style="display:block;width:130px;height:auto;border:0">'
)

# 占位符统一用正则替换：模板里写错的变量名原样保留，便于一眼发现
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

# 邮件正文可视宽度上限：比这更宽的图会把外层百分比表格直接撑破
IMAGE_MAX_WIDTH = 700

_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_STYLE_ATTR = re.compile(r"""\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
_WIDTH_ATTR = re.compile(r"""(\bwidth\s*=\s*)(?:"(\d+)"|'(\d+)'|(\d+))""", re.I)
_WRAP_TABLE = re.compile(
    r"""<table\b[^>]*\bclass\s*=\s*(?:"[^"]*mail-wrap[^"]*"|'[^']*mail-wrap[^']*'|mail-wrap)[^>]*>""",
    re.I,
)
_WIDTH_PCT = re.compile(r"""\bwidth\s*=\s*["']?(\d{1,3})%""", re.I)


def _style_value(tag: str) -> tuple[re.Match, str]:
    m = _STYLE_ATTR.search(tag)
    if not m:
        return m, ""
    return m, (m.group(1) if m.group(1) is not None else (m.group(2) or ""))


def _add_css(tag: str, rules: list[str]) -> str:
    """把缺的 CSS 规则合并进标签的 style；已有同名属性不覆盖。"""
    m, css = _style_value(tag)
    lower = css.lower()
    extra = [r for r in rules if r.split(":")[0].strip().lower() not in lower]
    if not extra:
        return tag
    merged = (css.rstrip().rstrip(";") + ";" if css.strip() else "") + ";".join(extra)
    if m:
        return tag[: m.start()] + f'style="{merged}"' + tag[m.end():]
    idx = tag.rfind(">")
    head = tag[:idx].rstrip()
    if head.endswith("/"):
        head = head[:-1].rstrip()
    return head + f' style="{merged}">'


def normalize_mail_html(html: str) -> str:
    """邮件客户端兼容补丁（幂等，不改内容、只补样式属性）。

    1. 图片补 `max-width:100%;height:auto`。这一步是关键：外层表格写 `width:70%` 只是
       "建议宽度"，表格里若有一张 1250px 宽的图，浏览器/邮件客户端会把表格撑回图片宽度，
       70% 直接失效。编辑器预览里看不出（预览页自带这条 CSS），只有真发出去才暴露。
    2. 超过 IMAGE_MAX_WIDTH 的 width 属性钳到上限，免得 Outlook 这类不认 max-width 的客户端撕开布局。
    3. 外层宽度壳（class="mail-wrap"）把百分比同时写进 style —— 部分客户端只认其一。
    """
    if not html:
        return ""

    def _img(m: re.Match) -> str:
        tag = m.group(0)

        def _clamp(wm: re.Match) -> str:
            value = wm.group(2) or wm.group(3) or wm.group(4) or ""
            try:
                size = int(value)
            except ValueError:
                return wm.group(0)
            if size <= IMAGE_MAX_WIDTH:
                return wm.group(0)
            return f'{wm.group(1)}"{IMAGE_MAX_WIDTH}"'

        tag = _WIDTH_ATTR.sub(_clamp, tag)
        return _add_css(tag, ["max-width:100%", "height:auto"])

    def _wrap_table(m: re.Match) -> str:
        tag = m.group(0)
        pct_match = _WIDTH_PCT.search(tag)
        pct = pct_match.group(1) if pct_match else "70"
        tag = _add_css(tag, [f"width:{pct}%", "max-width:760px", "margin:0 auto"])
        if not re.search(r"""\balign\s*=""", tag, re.I):
            tag = tag[:-1].rstrip() + ' align="center">'
        return tag

    html = _IMG_TAG.sub(_img, html)
    return _WRAP_TABLE.sub(_wrap_table, html)


# 外层版式壳：apply_layout 先把已有的拆掉再按设置重套，所以可重复调用
_WRAP_BLOCK = re.compile(
    r"""^\s*<table\b[^>]*\bclass\s*=\s*(?:"[^"]*mail-wrap[^"]*"|'[^']*mail-wrap[^']*')[^>]*>\s*"""
    r"""(?:<tbody>\s*)?<tr\b[^>]*>\s*<td\b[^>]*>(?P<body>.*)</td>\s*</tr>\s*(?:</tbody>\s*)?</table>\s*$""",
    re.I | re.S,
)


def strip_layout(html: str) -> str:
    """去掉外层版式壳，只留正文内容（入库前用，保证正文里不存版式）。"""
    body = (html or "").strip()
    m = _WRAP_BLOCK.match(body)
    return m.group("body").strip() if m else body


# --------------------------------------------------------------------------
# 正文固定宽度箱体
#
# 邮件里「图片比文字短」几乎都是同一个原因：版式壳是百分比（如 70%），在 QQ 邮箱
# 里算出来约 896px，而横幅图压缩后只有 600px 宽，于是一边撑满一边留白，标题在
# 896px 里居中看着也偏了。
#
# 解法是行业标准做法：正文外面固定一层 600px 的居中箱体，图与文字共用同一条左右
# 边界。这层箱体由发送端自动补，不要求模板正文里手写——运营复制粘贴模板时表格很
# 容易被编辑器吃掉，靠人工维护并不可靠。已有固定宽箱体的模板（488~760px 的表格）
# 不会被重复包裹。
# --------------------------------------------------------------------------
MAIL_BOX_WIDTH = 600
_TABLE_OPEN_RE = re.compile(r"<table\b[^>]*>", re.I)
_BOX_W_ATTR_RE = re.compile(r"""\bwidth\s*=\s*["']?\s*(\d{2,4})\s*(?:px)?\s*["'\s>]""", re.I)
_BOX_W_STYLE_RE = re.compile(r"""\bwidth\s*:\s*(\d{2,4})\s*px""", re.I)


def _has_fixed_box(html: str, lo: int = 480, hi: int = 760) -> bool:
    """正文里是否已有固定像素宽的容器（480~760px 之间的表格宽度）。"""
    for m in _TABLE_OPEN_RE.finditer(html):
        tag = m.group(0)
        for wm in list(_BOX_W_ATTR_RE.finditer(tag)) + list(_BOX_W_STYLE_RE.finditer(tag)):
            try:
                size = int(wm.group(1))
            except (TypeError, ValueError):
                continue
            if lo <= size <= hi:
                return True
    return False


def ensure_mail_box(html: str, width: int = MAIL_BOX_WIDTH) -> str:
    """给没有固定宽度容器的正文套 600px 居中箱体（幂等）。

    版式壳（class="mail-wrap"）是百分比宽度，箱体必须套在壳**内部**，否则 70% 会
    以 600px 为基准再打折，正文被压到 420px。所以先拆壳、处理内层、再原样套回。
    """
    body = (html or "").strip()
    if not body:
        return body

    m = _WRAP_BLOCK.match(body)
    if m:
        inner = ensure_mail_box(m.group("body"), width)
        return body[: m.start("body")] + inner + body[m.end("body"):]

    if _has_fixed_box(body):
        return body

    return (
        '<table width="100%" cellpadding="0" cellspacing="0" border="0"'
        ' style="width:100%;border-collapse:collapse;"><tr><td align="center">'
        f'<table width="{width}" cellpadding="0" cellspacing="0" border="0"'
        f' style="width:{width}px;max-width:100%;border-collapse:collapse;"><tr><td>'
        f"{body}"
        "</td></tr></table></td></tr></table>"
    )


def apply_layout(html: str, width: int = 70, center: bool = True) -> str:
    """按模板的版式设置给正文套外层宽度壳，幂等。

    宽度与居中放在模板字段里、不写进正文，这样在可视化编辑器里改内容也不会把版式弄丢。
    """
    body = strip_layout(html)
    try:
        pct = int(width)
    except (TypeError, ValueError):
        pct = 70
    pct = max(20, min(100, pct))
    if pct >= 100 and not center:
        return body
    align = "center" if center else "left"
    margin = "0 auto" if center else "0"
    return (
        f'<table class="mail-wrap" width="{pct}%" align="{align}"'
        f' style="width:{pct}%;max-width:760px;border-collapse:collapse;margin:{margin}">'
        f"<tr><td>\n{body}\n</td></tr></table>"
    )


def render_template(text: str, values: dict) -> str:
    """把 {{变量}} 换成实际值；未定义的变量名保持原样（不静默清空）。"""

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in values:
            return m.group(0)
        return str(values.get(key) or "")

    return PLACEHOLDER.sub(_sub, text or "")


def find_unknown_vars(*texts: str) -> list[str]:
    """找出模板里出现、但未登记的变量名（按出现顺序去重）。"""
    known = set(TEMPLATE_VARS)
    found: list[str] = []
    for text in texts:
        for m in PLACEHOLDER.finditer(text or ""):
            name = m.group(1)
            if name not in known and name not in found:
                found.append(name)
    return found

# 内置默认模板：活动未配置模板时，后台打开邮件模板页可一键采用
DEFAULT_TEMPLATES: dict[str, dict[str, str]] = {
    "signup": {
        "name": "报名成功",
        "subject": "{{activity_name}} 报名成功通知",
        "body_html": (
            "<p>{{recipient_name}}，您好：</p>"
            "<p>您已成功报名 <strong>{{activity_name}}</strong>，报名编号 {{reg_no}}。</p>"
            "<p>演出选择：{{show_name}}<br/>演出场次：{{session_name}}（{{show_at}}）<br/>"
            "演出地点：{{location}}（{{address}}）</p>"
            "<p>随行人数：{{companion_count}} 人（共 {{seats}} 个名额）<br/>"
            "您的联系电话：{{phone}}<br/>票券邮寄地址：{{province}}{{city}}{{county}}{{address_detail}} "
            "{{recipient_name}} {{recipient_phone}}</p>"
            "<p>票券将按上述地址邮寄，请保持电话畅通。如需变更信息请联系工会。</p>"
        ),
    },
    "shipped": {
        "name": "已邮寄",
        "subject": "{{activity_name}} 票券已寄出通知",
        "body_html": (
            "<p>{{recipient_name}}，您好：</p>"
            "<p>您报名的 <strong>{{show_name}}</strong>（{{session_name}}，{{show_at}}）"
            "票券已寄出。</p>"
            "<p>快递公司：{{courier_company}}<br/>快递单号：{{courier_no}}</p>"
            "<p>请注意查收，如未收到请及时联系工会。</p>"
        ),
    },
    "remind": {
        "name": "观演提醒",
        "subject": "{{activity_name}} 观演提醒",
        "body_html": (
            "<p>{{recipient_name}}，您好：</p>"
            "<p>提醒您即将到来的演出：<strong>{{show_name}}</strong>。</p>"
            "<p>演出场次：{{session_name}}（{{show_at}}）<br/>"
            "演出地点：{{location}}（{{address}}）</p>"
            "<p>请提前到场，凭报名编号 {{reg_no}} 换取票券入场。祝观演愉快！</p>"
        ),
    },
}


def build_values(db: Session, activity: Activity, reg: Registration) -> dict:
    session = db.query(TicketSession).filter(TicketSession.id == reg.session_id).first()
    show = db.query(Show).filter(Show.id == session.show_id).first() if session else None
    return {
        "recipient_name": reg.recipient_name or reg.employee_no,
        "recipient_phone": reg.recipient_phone,
        "reg_no": reg.reg_no or str(reg.id),
        "employee_no": reg.employee_no,
        "email": reg.email,
        "activity_name": activity.name,
        "show_name": show.name if show else "",
        "session_name": session.name if session else "",
        "show_at": session.show_at.strftime("%Y-%m-%d %H:%M") if session else "",
        "location": show.location if show else "",
        "address": show.address if show else "",
        "province": reg.province,
        "city": reg.city,
        "county": reg.county,
        "address_detail": reg.address_detail,
        "companion_count": str(reg.companion_count),
        "phone": reg.phone,
        "courier_company": reg.courier_company,
        "courier_no": reg.courier_no,
        "seats": str(reg.seats),
        "qrcode": QR_IMG,
    }


def enqueue_mail(
    db: Session,
    activity: Activity,
    reg: Registration,
    mail_type: str,
) -> bool:
    """按模板生成邮件并入队。模板未配置时返回 False（不阻塞业务）。"""
    from ..models import EmailTemplate

    template = (
        db.query(EmailTemplate)
        .filter(EmailTemplate.activity_id == activity.id, EmailTemplate.type == mail_type)
        .first()
    )
    if not template:
        return False

    values = build_values(db, activity, reg)
    body_html = apply_layout(
        render_template(template.body_html, values),
        template.layout_width, template.layout_center,
    )
    subject = render_template(template.subject, values)

    db.add(EmailOutbox(
        activity_id=activity.id,
        registration_id=reg.id,
        type=mail_type,
        to_email=reg.email,
        subject=subject,
        body_html=body_html,
        status="queued",
    ))
    db.commit()
    return True
