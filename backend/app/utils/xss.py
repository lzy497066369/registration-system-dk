"""富文本 XSS 过滤：白名单标签 + 白名单属性 + 协议限制（对应需求 5.8 节、AC-14）。

特殊处理：富文本编辑器插入的图片是 data:image/*;base64 内嵌数据，默认会被协议白名单
拦掉，这里先把它们暂存、过滤后再还原；仅放行图片类型，其他 data 协议（如
data:text/html）仍然被剔除。

两个入口：
- clean_html()      前台可见内容（活动介绍、剧目介绍）用，属性一律不给，最严。
- clean_mail_html() 邮件模板正文用，保留 style / align / 表格等排版属性，
                    因为邮件正文是把 Word 另存为 HTML 后整段粘贴进来的。
"""
import re

import bleach

ALLOWED_TAGS = [
    "p", "br", "strong", "b", "em", "i", "u", "s",
    "h2", "h3", "h4", "ul", "ol", "li", "blockquote",
    "img", "a", "table", "thead", "tbody", "tr", "th", "td",
]
ALLOWED_ATTRIBUTES = {
    "img": ["src", "alt", "width", "height"],
    "a": ["href", "target", "rel"],
}
ALLOWED_PROTOCOLS = ["http", "https"]

_DATA_IMAGE_RE = re.compile(
    r"data:image/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+", re.IGNORECASE
)
# 单张内嵌图（base64 串长度）上限。富文本里的图片原样入库、不做压缩，
# 手机直出照片常见 3~8MB、base64 后 4~11MB，所以上限放宽到 20MB（字符数）。
MAX_IMAGE_BYTES = 20_000_000


def _stash_data_images(text: str) -> tuple[str, dict[str, str]]:
    """把 base64 图片替换成占位符，等 bleach 跑完再还原（否则会被协议白名单拦掉）。"""
    stashed: dict[str, str] = {}

    def _sub(match: re.Match) -> str:
        data = match.group(0)
        if len(data) > MAX_IMAGE_BYTES:
            return ""  # 超过 20MB 的内嵌图直接丢弃
        key = f"__DATA_IMAGE_{len(stashed)}__"
        stashed[key] = data
        return key

    return _DATA_IMAGE_RE.sub(_sub, text), stashed


def oversized_data_images(raw: str) -> list[int]:
    """列出超过单图上限的内嵌图（返回各自的原始字节大小）。

    _stash_data_images 对超限图是直接丢弃的，否则 base64 会把库和请求撑爆；
    但静默丢弃的表现是「提示保存成功、图片其实不见了」，所以保存端要先问一句，
    有超限图就报错让用户压缩后重传。
    """
    sizes: list[int] = []
    for match in _DATA_IMAGE_RE.finditer(raw or ""):
        data = match.group(0)
        if len(data) > MAX_IMAGE_BYTES:
            sizes.append(len(data) * 3 // 4)  # base64 长度换算回原始字节
    return sizes


def clean_html(raw: str) -> str:
    """过滤 script/iframe/事件属性等，仅保留安全标签。入库前必须调用。"""
    text, stashed = _stash_data_images(raw or "")
    cleaned = bleach.clean(
        text,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    for key, value in stashed.items():
        cleaned = cleaned.replace(key, value)
    return cleaned


# --------------------------------------------------------------------------
# 邮件模板专用
#
# 邮件正文一般是 Word「另存为网页」后整段粘进来的，排版几乎全靠 style 属性
# （表格宽度、70% 居中、字体、行距）。通用白名单不带 style，会把排版全剥掉，
# 所以这里单独放宽属性；脚本、事件属性、危险协议、危险 CSS 仍然剔除。
# 只用于 email_templates.body_html，不要拿去渲染前台页面。
# --------------------------------------------------------------------------
MAIL_ALLOWED_TAGS = ALLOWED_TAGS + [
    "div", "span", "center", "font", "hr", "small", "sup", "sub",
    "colgroup", "col", "caption", "tfoot", "address", "pre", "code",
    "dl", "dt", "dd", "strike",
]

MAIL_LAYOUT_ATTRS = [
    # 注意：这里刻意不放 "style" —— style 已全部提前换成 data-css 令牌，
    # 过滤后再还原；留着它 bleach 会因为没有 css_sanitizer 而报警并把值清空。
    "align", "valign", "width", "height", "bgcolor", "color",
    "face", "size", "border", "cellpadding", "cellspacing", "class", "dir", "lang",
    "data-css",  # style 值的暂存令牌，过滤后还原成 style，别删
]

MAIL_ALLOWED_ATTRIBUTES = {
    "*": MAIL_LAYOUT_ATTRS,
    "img": ["src", "alt", "width", "height", "align", "border"],
    "a": ["href", "target", "rel"],
    "table": MAIL_LAYOUT_ATTRS + ["summary"],
    "td": MAIL_LAYOUT_ATTRS + ["colspan", "rowspan", "nowrap"],
    "th": MAIL_LAYOUT_ATTRS + ["colspan", "rowspan", "nowrap", "scope"],
}

# style 里出现这些就整条丢掉（IE 表达式、脚本协议、CSS 注入）
_DANGEROUS_CSS = re.compile(
    r"(expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:"
    r"|-moz-binding|url\s*\(\s*['\"]?((javascript|vbscript|data:text)))",
    re.IGNORECASE,
)
_STYLE_ATTR_RE = re.compile(r"""\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.IGNORECASE)
_CSS_TOKEN_ATTR = "data-css"
_WORD_HEAD_RE = re.compile(r"<body[^>]*>", re.IGNORECASE)
_DROP_BLOCK_RE = re.compile(r"(?is)<(style|script|xml|head)\b.*?</\1\s*>")
_COMMENT_RE = re.compile(r"(?s)<!--.*?-->")
_ORPHAN_TAG_RE = re.compile(r"(?is)</?(html|head|body|meta|link|title|o:p)\b[^>]*>")
MAX_MAIL_BYTES = 5_000_000


def strip_word_head(raw: str) -> str:
    """砍掉 Word 导出的 <head>/<style>/<xml> 与注释，只留正文。

    bleach 只去掉不认识的标签、内容会留下，<style> 里那几百行 mso 规则
    会变成正文开头的可见乱码，所以必须先整块删掉。
    """
    text = raw or ""
    m = _WORD_HEAD_RE.search(text)
    if m:
        text = text[m.end():]
    text = _COMMENT_RE.sub("", text)
    text = _DROP_BLOCK_RE.sub("", text)
    text = _ORPHAN_TAG_RE.sub("", text)
    return text.strip()


def clean_mail_html(raw: str) -> str:
    """邮件模板正文清洗：保留排版属性，剔除脚本与危险 CSS。

    bleach 在不带 css_sanitizer 时会把 style 的值清空（只留空属性），
    所以这里先把每条 style 暂存成 data-css 令牌，过滤完再还原成原值。
    """
    text = strip_word_head(raw)
    styles: dict[str, str] = {}

    def _stash_style(match: re.Match) -> str:
        css = match.group(1) if match.group(1) is not None else (match.group(2) or "")
        if _DANGEROUS_CSS.search(css):
            return ""  # 危险样式整条丢掉
        key = f"__CSS_{len(styles)}__"
        styles[key] = css
        return f' {_CSS_TOKEN_ATTR}="{key}"'

    text = _STYLE_ATTR_RE.sub(_stash_style, text)
    text, stashed = _stash_data_images(text)
    cleaned = bleach.clean(
        text,
        tags=MAIL_ALLOWED_TAGS,
        attributes=MAIL_ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    for key, css in styles.items():
        cleaned = cleaned.replace(
            f' {_CSS_TOKEN_ATTR}="{key}"',
            ' style="' + css.replace('"', "&quot;") + '"',
        )
    for key, value in stashed.items():
        cleaned = cleaned.replace(key, value)
    return cleaned

# 活动介绍、剧目介绍与邮件正文一样，都是富文本编辑器产出、靠 inline style 排版，
# 走同一套放宽策略；script、危险协议、危险 CSS 的拦截与 clean_html() 保持一致。
clean_rich_html = clean_mail_html
