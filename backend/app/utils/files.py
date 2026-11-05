"""图片上传：原图最大 10MB，等比压缩后入库。

- 带透明通道且确有透明像素的图片（活动标题块等）保存为 PNG，保留透明；
- 其余图片统一转 JPEG（宽 ≤1920，质量 85），避免原图过大拖慢微信加载。
"""
import io
import os
import uuid

from fastapi import HTTPException, UploadFile
from PIL import Image

from ..config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE = 10 * 1024 * 1024  # 原图上传上限 10MB（入库前统一压缩）
MAX_WIDTH = 1920


def _has_transparency(img: Image.Image) -> bool:
    """判断图片是否真的有透明像素（PNG 常带 alpha 通道但整图不透明）。"""
    if img.mode not in ("RGBA", "LA"):
        return False
    alpha = img.convert("RGBA").getchannel("A")
    try:
        lo, _ = alpha.getextrema()
    except Exception:
        return False
    return lo < 255


async def save_image(file: UploadFile) -> str:
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(400, "图片不能超过 10MB，请压缩后再上传")
    if (file.content_type or "") not in ALLOWED_TYPES:
        raise HTTPException(400, "仅支持 jpg / png / webp 格式")

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        raise HTTPException(400, "无法识别的图片文件")

    keep_alpha = _has_transparency(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if keep_alpha else "RGB")
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    if keep_alpha:
        filename = f"{uuid.uuid4().hex}.png"
        img.save(os.path.join(settings.UPLOAD_DIR, filename), "PNG", optimize=True)
    else:
        filename = f"{uuid.uuid4().hex}.jpg"
        img.convert("RGB").save(os.path.join(settings.UPLOAD_DIR, filename), "JPEG", quality=85)
    return f"/uploads/{filename}"
