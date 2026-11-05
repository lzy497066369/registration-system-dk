"""剧目与场次维护：三层结构中的后两层。

删除规则（需求 4.2.4）：
- 剧目下还有场次时不允许删除；
- 场次已有报名记录（含已取消）时只允许关闭（is_open=false），不允许删除。
- 场次容量不得小于已占用名额。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, defer

from ..database import get_db
from ..deps import require_admin
from ..models import Activity, Registration, Show, TicketSession
from ..utils.files import save_image
from ..utils.xss import clean_rich_html, oversized_data_images

router = APIRouter(prefix="/api/admin", tags=["admin-shows"],
                   dependencies=[Depends(require_admin)])


class ShowIn(BaseModel):
    name: str
    location: str = ""  # 演出地点，剧目级（对应设计图卡片上的「地点：」）
    address: str = ""  # 详细地址，剧目级
    cover_image: str = ""  # 剧目卡片底图（前台整卡背景）
    intro_html: str = ""
    sort: int = 0


def _intro_lens(db: Session, show_ids: list[int]) -> dict[int, int]:
    """只查演出介绍的长度，不把正文（含 base64 原图，单张可达 20MB）拉进进程。

    列表接口返回全文的话，一个剧目列表就要传输几十 MB，后台会直接卡住；
    列表只给「有没有介绍」，正文统一走 /shows/{id} 详情按需加载。
    """
    if not show_ids:
        return {}
    rows = (
        db.query(Show.id, func.length(Show.intro_html))
        .filter(Show.id.in_(show_ids))
        .all()
    )
    return {show_id: (length or 0) for show_id, length in rows}


def _guard_intro_images(raw: str) -> None:
    """演出介绍里的内嵌图有单张上限，超了会被清洗环节静默丢弃。

    静默丢弃的表现是「提示保存成功、图片却没进库」，所以这里先拦一道，
    让用户看到明确原因（图片原样入库不压缩，只有超过 20MB 上限才会触发）。
    """
    big = oversized_data_images(raw)
    if not big:
        return
    mb = max(big) / 1024 / 1024
    raise HTTPException(
        400,
        f"有 {len(big)} 张图片过大（最大的约 {mb:.1f}MB），单张上限约 15MB。"
        "请换一张小一些的图片。",
    )


class SessionIn(BaseModel):
    name: str
    show_at: str  # 演出开始时间，如 2026-11-27T19:30:00
    capacity: int
    remind_hours_before: int | None = None  # 空 = 继承活动默认
    is_open: bool = True
    sort: int = 0


class SessionUpdate(BaseModel):
    name: str | None = None
    show_at: str | None = None
    capacity: int | None = None
    remind_hours_before: int | None = None
    is_open: bool | None = None
    sort: int | None = None


def _parse_dt(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("T", " ").replace("Z", ""))
    except ValueError:
        raise HTTPException(400, f"时间格式不正确：{value}")


def _get_activity(activity_id: int, db: Session) -> Activity:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(404, "活动不存在")
    return activity


# ---------- 剧目 ----------

@router.get("/activities/{activity_id}/shows")
def list_shows(activity_id: int, db: Session = Depends(get_db)):
    _get_activity(activity_id, db)
    shows = (
        db.query(Show).options(defer(Show.intro_html))
        .filter(Show.activity_id == activity_id)
        .order_by(Show.sort, Show.id).all()
    )
    show_ids = [s.id for s in shows]
    intro_lens = _intro_lens(db, show_ids)
    sessions = (
        db.query(TicketSession).filter(TicketSession.show_id.in_(show_ids))
        .order_by(TicketSession.sort, TicketSession.id).all()
        if show_ids else []
    )
    by_show: dict[int, list] = {}
    for s in sessions:
        by_show.setdefault(s.show_id, []).append({
            "id": s.id, "name": s.name, "show_at": s.show_at,
            "capacity": s.capacity, "sold": s.sold,
            "remaining": s.capacity - s.sold,
            "is_open": s.is_open,
            "remind_hours_before": s.remind_hours_before,
            "sort": s.sort,
        })
    return [
        {
            "id": sh.id, "name": sh.name, "sort": sh.sort,
            "location": sh.location, "address": sh.address,
            "has_intro": intro_lens.get(sh.id, 0) > 0,
            "sessions": by_show.get(sh.id, []),
        }
        for sh in shows
    ]


@router.get("/shows/{show_id}")
def get_show(show_id: int, db: Session = Depends(get_db)):
    """单个剧目详情（含封面图与场次），后台编辑弹窗使用。"""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(404, "剧目不存在")
    sessions = (
        db.query(TicketSession).filter(TicketSession.show_id == show_id)
        .order_by(TicketSession.sort, TicketSession.id).all()
    )
    activity = db.query(Activity).filter(Activity.id == show.activity_id).first()
    return {
        "id": show.id, "name": show.name, "sort": show.sort,
        "activity_id": show.activity_id,
        "activity_name": activity.name if activity else "",
        "location": show.location, "address": show.address,
        "cover_image": show.cover_image,
        "intro_html": show.intro_html or "",
        "sessions": [
            {
                "id": s.id, "name": s.name, "show_at": s.show_at,
                "capacity": s.capacity, "sold": s.sold,
                "remaining": s.capacity - s.sold,
                "is_open": s.is_open,
                "remind_hours_before": s.remind_hours_before,
                "sort": s.sort,
            }
            for s in sessions
        ],
    }


@router.get("/shows")
def list_all_shows(activity_id: int | None = None, db: Session = Depends(get_db)):
    """跨活动查询剧目（活动筛选可选，不传则返回全部活动下的剧目）。"""
    query = db.query(Show).options(defer(Show.intro_html))
    if activity_id:
        query = query.filter(Show.activity_id == activity_id)
    shows = query.order_by(Show.activity_id, Show.sort, Show.id).all()
    show_ids = [s.id for s in shows]
    intro_lens = _intro_lens(db, show_ids)
    sessions = (
        db.query(TicketSession).filter(TicketSession.show_id.in_(show_ids))
        .order_by(TicketSession.sort, TicketSession.id).all()
        if show_ids else []
    )
    by_show: dict[int, list] = {}
    for s in sessions:
        by_show.setdefault(s.show_id, []).append({
            "id": s.id, "name": s.name, "show_at": s.show_at,
            "capacity": s.capacity, "sold": s.sold,
            "remaining": s.capacity - s.sold,
            "is_open": s.is_open,
            "remind_hours_before": s.remind_hours_before,
            "sort": s.sort,
        })
    activity_names = {a.id: a.name for a in db.query(Activity).all()}
    return [
        {
            "id": sh.id, "name": sh.name, "sort": sh.sort,
            "activity_id": sh.activity_id,
            "activity_name": activity_names.get(sh.activity_id, ""),
            "location": sh.location, "address": sh.address,
            "cover_image": sh.cover_image,
            "has_intro": intro_lens.get(sh.id, 0) > 0,
            "sessions": by_show.get(sh.id, []),
        }
        for sh in shows
    ]


@router.get("/sessions")
def list_all_sessions(
    activity_id: int | None = None,
    show_id: int | None = None,
    db: Session = Depends(get_db),
):
    """跨活动查询场次（活动、剧目筛选均可选）。"""
    query = db.query(TicketSession)
    if activity_id:
        query = query.filter(TicketSession.activity_id == activity_id)
    if show_id:
        query = query.filter(TicketSession.show_id == show_id)
    rows = query.order_by(TicketSession.activity_id, TicketSession.sort, TicketSession.id).all()
    show_map = {s.id: s for s in db.query(Show).all()}
    activity_names = {a.id: a.name for a in db.query(Activity).all()}
    return [
        {
            "id": r.id, "name": r.name, "show_at": r.show_at,
            "capacity": r.capacity, "sold": r.sold,
            "remaining": r.capacity - r.sold,
            "is_open": r.is_open, "remind_hours_before": r.remind_hours_before,
            "show_id": r.show_id,
            "show_name": show_map[r.show_id].name if r.show_id in show_map else "",
            "activity_id": r.activity_id,
            "activity_name": activity_names.get(r.activity_id, ""),
        }
        for r in rows
    ]


@router.post("/activities/{activity_id}/shows")
def create_show(activity_id: int, body: ShowIn, db: Session = Depends(get_db)):
    _get_activity(activity_id, db)
    if not body.name.strip():
        raise HTTPException(400, "剧目名称不能为空")
    _guard_intro_images(body.intro_html)
    show = Show(
        activity_id=activity_id,
        name=body.name.strip(),
        location=body.location.strip(),
        address=body.address.strip(),
        intro_html=clean_rich_html(body.intro_html),
        sort=body.sort,
    )
    db.add(show)
    db.commit()
    db.refresh(show)
    return {"id": show.id}


@router.put("/shows/{show_id}")
def update_show(show_id: int, body: ShowIn, db: Session = Depends(get_db)):
    """部分更新剧目：只改传入的字段，未传的保持原值。"""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(404, "剧目不存在")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        show.name = data["name"].strip()
    if "location" in data:
        show.location = data["location"].strip()
    if "address" in data:
        show.address = data["address"].strip()
    if "intro_html" in data:
        _guard_intro_images(data["intro_html"])
        show.intro_html = clean_rich_html(data["intro_html"])
    if "sort" in data:
        show.sort = data["sort"]
    db.commit()
    return {"ok": True}


@router.delete("/shows/{show_id}")
def delete_show(show_id: int, db: Session = Depends(get_db)):
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(404, "剧目不存在")
    if db.query(TicketSession).filter(TicketSession.show_id == show_id).first():
        raise HTTPException(400, "该剧目下还有场次，请先删除场次")
    db.delete(show)
    db.commit()
    return {"ok": True}


# ---------- 场次 ----------

@router.post("/shows/{show_id}/sessions")
def create_session(show_id: int, body: SessionIn, db: Session = Depends(get_db)):
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(404, "剧目不存在")
    if body.capacity < 0:
        raise HTTPException(400, "名额不能为负数")
    session = TicketSession(
        activity_id=show.activity_id,
        show_id=show_id,
        name=body.name.strip(),
        show_at=_parse_dt(body.show_at),
        capacity=body.capacity,
        sold=0,
        remind_hours_before=body.remind_hours_before,
        is_open=body.is_open,
        sort=body.sort,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"id": session.id}


@router.put("/sessions/{session_id}")
def update_session(session_id: int, body: SessionUpdate, db: Session = Depends(get_db)):
    session = db.query(TicketSession).filter(TicketSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "场次不存在")
    data = body.model_dump(exclude_unset=True)
    if "show_at" in data and data["show_at"] is not None:
        data["show_at"] = _parse_dt(data["show_at"])
    if "capacity" in data and data["capacity"] is not None:
        if data["capacity"] < session.sold:
            raise HTTPException(400, f"名额不能小于已占用名额（{session.sold}）")
    for key, value in data.items():
        setattr(session, key, value)
    db.commit()
    return {"ok": True}


@router.post("/shows/{show_id}/image")
async def upload_show_image(show_id: int, file: UploadFile, db: Session = Depends(get_db)):
    """上传剧目卡片背景图（前台剧目卡片底图）。"""
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(404, "剧目不存在")
    path = await save_image(file)
    show.cover_image = path
    db.commit()
    return {"path": path}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(TicketSession).filter(TicketSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "场次不存在")
    has_registrations = (
        db.query(Registration.id).filter(Registration.session_id == session_id).first()
        is not None
    )
    if has_registrations:
        raise HTTPException(400, "该场次已有报名记录，只能关闭（下架），不能删除")
    db.delete(session)
    db.commit()
    return {"ok": True}
