"""统一时间基准：全系统按北京时间（UTC+8）记录与比较。

容器默认时区是 UTC，若直接用 datetime.now()，用户按北京时间填的演出时间
会比系统时间早 8 小时，导致观演提醒推迟、列表时间显示错位。
这里显式加 8 小时，不依赖镜像里是否装了 tzdata。
"""
from datetime import datetime, timedelta, timezone

CN_TZ = timezone(timedelta(hours=8))


def now_cn() -> datetime:
    """当前北京时间（naive，与库中 timestamp without time zone 列一致）。"""
    return datetime.now(CN_TZ).replace(tzinfo=None)
