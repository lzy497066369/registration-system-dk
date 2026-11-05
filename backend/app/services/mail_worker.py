"""邮件发送 worker：定时扫描 email_outbox 队列，通过 SMTP 真实外发。

报名接口只负责入队，真正发信在这里做，SMTP 慢或失败都不阻塞业务。
发信通道参数存在 system_configs 表，可在后台「发信通道配置」里改。
"""
import asyncio
import io
import logging
import re
import smtplib
import socket
import ssl
import time
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr
from html import unescape

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import Activity, EmailOutbox, SystemConfig
from ..utils.timez import now_cn
from .image_opt import shrink_data_images
from .mailer import enqueue_mail, ensure_mail_box, normalize_mail_html

log = logging.getLogger("mail_worker")

MAX_RETRY = 3
BATCH = 20
TIMEOUT = 30
DEFAULT_FROM_NAME = "SAP北分工会"

AUTH_ERROR_HINT = (
    "认证失败（535）：该账号密码不能用于 SMTP。腾讯企业邮箱需在"
    "邮箱设置 → 客户端设置 中生成「客户端专用密码」，并确认管理员已开启 SMTP 服务"
)

DNS_ERROR_HINT = (
    "域名解析失败：容器内无法把 SMTP 服务器域名解析成 IP（Docker 内嵌 DNS 抖动）。"
    "已自动重试仍失败，通常是宿主机断网 / 挂了代理 / 刚重启容器。"
    "请点一次「重建」按钮再发，或执行 docker compose restart backend"
)

CONNECT_RETRY = 3  # 建立连接的重试次数（含首次）



def get_config(db: Session) -> dict:
    rows = db.query(SystemConfig).all()
    return {r.key: r.value for r in rows}


def html_to_text(body_html: str) -> str:
    """富文本转纯文本，作为邮件的 text/plain 备选部分（缺了容易被判垃圾邮件）。"""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", body_html or "")
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</h[1-6]>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = unescape(text).replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


QR_IMG_RE = re.compile(r"<img[^>]*cid:qrcode[^>]*>")


def make_qrcode(url: str) -> bytes:
    """生成二维码 PNG（segno 纯 Python 实现，不依赖外部图床）。"""
    import segno

    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="png", scale=10, border=2)
    return buf.getvalue()


def build_message(cfg: dict, to_email: str, subject: str, body_html: str, activity_code: str = ""):
    """构造标准 MIME 邮件；发件地址强制用登录账号（企业邮箱不允许伪造发件人）。"""
    user = (cfg.get("smtp_user") or "").strip()
    sender = (cfg.get("mail_from") or "").strip() or user
    from_name = (cfg.get("mail_from_name") or "").strip() or DEFAULT_FROM_NAME

    # 兜底补客户端兼容样式（图片限宽、宽度壳），老模板不重新保存也能正常显示
    body_html = normalize_mail_html(shrink_data_images(body_html))
    # 再兜一层固定宽度箱体：模板正文里没写 600px 容器时自动补，保证头图与文字等宽
    body_html = ensure_mail_box(body_html)

    images: list[dict] = []
    if "cid:qrcode" in body_html:
        base = (cfg.get("public_base_url") or "").strip().rstrip("/")
        if base and activity_code:
            images.append({"cid": "qrcode", "data": make_qrcode(f"{base}/a/{activity_code}/login")})
        else:
            # 没配前台地址就不生成，换成文字，免得收件人看到裂图
            body_html = QR_IMG_RE.sub("（报名进度二维码：请在报名页面查看）", body_html)

    msg = EmailMessage()
    msg["From"] = formataddr((from_name, sender))
    msg["To"] = to_email
    msg["Subject"] = subject or "（无标题）"
    msg.set_content(html_to_text(body_html) or subject or "")
    if body_html:
        msg.add_alternative(body_html, subtype="html")
        if images:
            html_part = msg.get_payload()[-1]
            for img in images:
                html_part.add_related(
                    img["data"], maintype="image", subtype="png",
                    cid=f'<{img["cid"]}>',
                )
    return msg, sender


def _open_server(host: str, port: int, use_ssl: bool, context: ssl.SSLContext):
    """建立 SMTP 连接。DNS 解析失败 / 连接被重置时自动重试几次。

    Docker 内嵌 DNS（127.0.0.11）在容器刚启动、或宿主机网络切换（VPN、代理、
    无线重连）时会短暂返回 SERVFAIL，表现为 gaierror [Errno -2]。这类抖动
    重试一次基本就能过去，不该直接把这封邮件判死。
    """
    last_exc: Exception | None = None
    for attempt in range(1, CONNECT_RETRY + 1):
        try:
            if use_ssl:
                return smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=context)
            server = smtplib.SMTP(host, port, timeout=TIMEOUT)
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            return server
        except (socket.gaierror, ConnectionError, TimeoutError, ssl.SSLError,
                smtplib.SMTPServerDisconnected) as exc:
            last_exc = exc
            log.warning(
                "SMTP 连接失败（第 %s/%s 次）%s:%s → %s: %s",
                attempt, CONNECT_RETRY, host, port, type(exc).__name__, exc,
            )
            if attempt < CONNECT_RETRY:
                time.sleep(attempt * 2)
    raise last_exc  # type: ignore[misc]


def send_mail(
    cfg: dict,
    to_email: str,
    subject: str,
    body_html: str,
    ignore_dry_run: bool = False,
    activity_code: str = "",
) -> tuple[bool, str]:
    """发一封邮件，返回 (是否成功, 错误说明)。ignore_dry_run 供「发送测试邮件」用。"""
    if not ignore_dry_run and cfg.get("mail_dry_run", "1") == "1":
        return True, "空跑模式：已生成未发送"

    host = (cfg.get("smtp_host") or "").strip()
    user = (cfg.get("smtp_user") or "").strip()
    password = cfg.get("smtp_password") or ""
    if not host or not user or not password:
        return False, "SMTP 未配置完整：请填写服务器、发信账号与密码"
    if not to_email or "@" not in to_email:
        return False, f"收件邮箱不合法：{to_email or '(空)'}"

    use_ssl = cfg.get("smtp_use_ssl", "1") == "1"
    try:
        port = int(cfg.get("smtp_port") or (465 if use_ssl else 587))
    except ValueError:
        return False, f"SMTP 端口不合法：{cfg.get('smtp_port')}"

    msg, sender = build_message(cfg, to_email, subject, body_html, activity_code)
    context = ssl.create_default_context()
    try:
        server = _open_server(host, port, use_ssl, context)
        try:
            server.login(user, password)
            server.send_message(msg, from_addr=sender, to_addrs=[to_email])
        finally:
            try:
                server.quit()
            except Exception:  # noqa: BLE001
                pass
        return True, ""
    except socket.gaierror as exc:
        return False, f"{DNS_ERROR_HINT}（{exc}）"
    except smtplib.SMTPAuthenticationError:
        return False, AUTH_ERROR_HINT
    except smtplib.SMTPRecipientsRefused as exc:
        return False, f"收件人被服务器拒绝：{exc}"
    except smtplib.SMTPSenderRefused as exc:
        return False, f"发件人被服务器拒绝（发件地址须与登录账号一致）：{exc}"
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        return False, f"{type(exc).__name__}: {str(exc)[:400]}"


def process_outbox(limit: int = BATCH) -> int:
    """处理一批待发邮件，返回处理条数。"""
    db = SessionLocal()
    processed = 0
    try:
        cfg = get_config(db)
        now = now_cn()
        activity_codes = {a.id: a.code for a in db.query(Activity).all()}
        items = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.status == "queued")
            .order_by(EmailOutbox.id)
            .limit(limit)
            .all()
        )
        for item in items:
            if item.scheduled_at and item.scheduled_at > now:
                continue
            item.status = "sending"
            db.commit()

            ok, error = send_mail(
                cfg, item.to_email, item.subject, item.body_html,
                activity_code=activity_codes.get(item.activity_id, ""),
            )
            if ok:
                item.status = "sent"
                item.sent_at = now_cn()
                item.last_error = error
                item.retry_count += 1
            else:
                item.retry_count += 1
                item.last_error = error
                item.status = "failed" if item.retry_count >= MAX_RETRY else "queued"
            db.commit()
            processed += 1
    except Exception:  # noqa: BLE001
        log.exception("邮件队列处理异常")
        db.rollback()
    finally:
        db.close()
    return processed


def reset_stuck_sending() -> int:
    """worker 重启后，把上次中断在「发送中」的邮件放回队列，避免永久卡住。"""
    db = SessionLocal()
    try:
        count = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.status == "sending")
            .update({EmailOutbox.status: "queued"}, synchronize_session=False)
        )
        db.commit()
        return count or 0
    except Exception:  # noqa: BLE001
        log.exception("重置卡住的发送中邮件失败")
        db.rollback()
        return 0
    finally:
        db.close()


async def mail_worker_loop(interval: int = 30) -> None:
    """后台定时任务：每 interval 秒扫一次队列，并生成到点的观演提醒。"""
    reset = reset_stuck_sending()
    if reset:
        log.warning("启动时把 %s 封「发送中」邮件放回队列", reset)
    while True:
        try:
            await asyncio.to_thread(process_reminders)
            await asyncio.to_thread(process_outbox)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("邮件 worker 循环异常")
        await asyncio.sleep(interval)


def process_reminders() -> int:
    """观演提醒：按各场次演出时间倒推，提前量取场次级配置，留空继承活动默认值。

    触发条件：当前时间已到「演出时间 - 提前小时数」，且该单未发过提醒、未被取消。
    """
    from datetime import timedelta

    from ..models import Activity, Registration, TicketSession

    db = SessionLocal()
    created = 0
    try:
        now = now_cn()
        regs = (
            db.query(Registration)
            .filter(Registration.status != "cancelled", Registration.remind_sent.is_(False))
            .all()
        )
        if not regs:
            return 0

        activity_map = {a.id: a for a in db.query(Activity).all()}
        session_ids = {r.session_id for r in regs}
        session_map = {
            s.id: s for s in db.query(TicketSession).filter(TicketSession.id.in_(session_ids)).all()
        } if session_ids else {}

        for reg in regs:
            session = session_map.get(reg.session_id)
            if not session:
                continue
            activity = activity_map.get(reg.activity_id)
            hours = session.remind_hours_before
            if hours is None:
                hours = activity.remind_hours_before if activity else 24
            trigger_at = session.show_at - timedelta(hours=hours)
            if now < trigger_at:
                continue
            if not activity:
                continue
            # 只有真正入队成功才标记已提醒：模板缺失时保持未提醒，配好模板后还能补发
            if enqueue_mail(db, activity, reg, "remind"):
                reg.remind_sent = True
                db.commit()
                created += 1
    except Exception:  # noqa: BLE001
        log.exception("观演提醒生成异常")
        db.rollback()
    finally:
        db.close()
    return created
