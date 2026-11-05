"""邮件正文内嵌图片优化。

Word「另存为网页」和编辑器粘贴都会把图片转成 data: base64 直接塞进正文。
一张 1250×428 的横幅就有 1 MB（base64 比原图还大三分之一），后果有两个：

1. Gmail 对 HTML 正文超过 102 KB 的邮件会直接截断，收件人只看到前半封；
2. 图比正文容器宽，会把 `width:70%` 的表格撑破，居中失效。

所以入库和发送前都把这类图缩到邮件可显示宽度并重新编码。只动图片本身，
不改排版结构，函数是幂等的（已经是小图就原样返回）。
"""
import base64
import io
import logging
import re
from functools import lru_cache

from PIL import Image

log = logging.getLogger(__name__)

# 邮件正文的可视宽度上限：600px 是邮件行业惯例（Outlook 默认阅读窗格约 640px）
MAX_IMAGE_WIDTH = 600
JPEG_QUALITY = 88
# 宽度已达标但体积仍超过这个值时，也重新编码一次
RECODE_ABOVE_BYTES = 150 * 1024

_DATA_URI = re.compile(
    r"""(?P<q>["'])(?P<uri>data:image/(?P<mime>[a-zA-Z0-9.+-]+);base64,(?P<b64>[A-Za-z0-9+/=\s]{100,}))(?P=q)""",
    re.I,
)


def _encode(img: Image.Image) -> tuple[bytes, str]:
    """透明图保 PNG，其余走 JPEG（体积能小一个数量级）。"""
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    buf = io.BytesIO()
    if has_alpha:
        img.convert("RGBA").save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "png"
    img.convert("RGB").save(
        buf, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True,
    )
    return buf.getvalue(), "jpeg"


@lru_cache(maxsize=4)
def _process(b64: str, max_width: int) -> str | None:
    """把一段 base64 图片重编码，返回新的 data URI 中间段；无法处理时返回 None。

    用 lru_cache 是因为同一次群发里所有邮件的图片完全相同，1 MB 的字符串做 key
    虽然占点内存，但只压缩一次，比每封邮件都跑一遍 Pillow 划算。
    """
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", b64))
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:  # noqa: BLE001
        log.warning("内嵌图片解码失败，保留原图", exc_info=True)
        return None

    width, height = img.size
    too_wide = width > max_width
    too_heavy = len(raw) > RECODE_ABOVE_BYTES
    if not too_wide and not too_heavy:
        return None

    if too_wide:
        ratio = max_width / float(width)
        img = img.resize((max_width, max(1, round(height * ratio))), Image.LANCZOS)

    data, mime = _encode(img)
    if len(data) >= len(raw) and not too_wide:
        return None
    return f"data:image/{mime};base64," + base64.b64encode(data).decode()


def shrink_data_images(html: str, max_width: int = MAX_IMAGE_WIDTH) -> str:
    """缩小正文里所有 data: base64 图片；失败或没有收益时保持原样。"""
    if not html or "base64," not in html:
        return html

    def _replace(m: re.Match) -> str:
        new_uri = _process(m.group("b64"), max_width)
        if not new_uri:
            return m.group(0)
        return m.group("q") + new_uri + m.group("q")

    return _DATA_URI.sub(_replace, html)
