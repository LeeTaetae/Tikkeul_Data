from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth.deps import get_current_user
from app.auth.models import User
from app.errors import api_error
from app.favorites.models import FavoriteKind, FavoritePlace, FavoritePlaceCreate, FavoritePlacePublic, FavoritePlaceUpdate
from app.navigation.config import get_settings as get_navigation_settings
from app.navigation.providers import translate_labeled_addresses_to_language

router = APIRouter(prefix="/api/favorites", tags=["favorites"])

_KIND_ORDER = {FavoriteKind.home: 0, FavoriteKind.work: 1, FavoriteKind.custom: 2}


def _owned_or_404(session: Session, favorite_id: int, user: User) -> FavoritePlace:
    place = session.get(FavoritePlace, favorite_id)
    if place is None or place.user_id != user.id:
        raise api_error("FAVORITE_NOT_FOUND")
    return place


def _check_kind_not_taken(session: Session, user: User, kind: FavoriteKind, exclude_id: Optional[int] = None) -> None:
    if kind == FavoriteKind.custom:
        return
    existing = session.exec(select(FavoritePlace).where(FavoritePlace.user_id == user.id, FavoritePlace.kind == kind)).first()
    if existing is not None and existing.id != exclude_id:
        raise api_error("FAVORITE_KIND_TAKEN")


@router.get("", response_model=List[FavoritePlacePublic])
async def list_favorites(request: Request, lang: Optional[str] = None, user: User = Depends(get_current_user)) -> List[FavoritePlace]:
    with Session(request.app.state.db_engine) as session:
        places = session.exec(select(FavoritePlace).where(FavoritePlace.user_id == user.id)).all()
        places = sorted(places, key=lambda p: (_KIND_ORDER[p.kind], p.created_at))
    # 사용자가 한국어로 남긴 라벨·주소라, 화면 언어가 ko 가 아니면 번역해서 돌려준다(장소 검색과 같은 방식).
    settings = get_navigation_settings()
    translated = await translate_labeled_addresses_to_language(
        [(p.label, p.address_text) for p in places], lang, settings.papago_client_id, settings.papago_client_secret
    )
    return [p.model_copy(update={"label": label, "address_text": address}) for p, (label, address) in zip(places, translated)]


@router.post("", response_model=FavoritePlacePublic, status_code=201)
def create_favorite(body: FavoritePlaceCreate, request: Request, user: User = Depends(get_current_user)) -> FavoritePlace:
    with Session(request.app.state.db_engine) as session:
        _check_kind_not_taken(session, user, body.kind)
        data = body.model_dump()
        if body.kind != FavoriteKind.custom:
            data["category"] = None
        place = FavoritePlace(user_id=user.id, **data)
        session.add(place)
        try:
            session.commit()
        except IntegrityError:
            # 사전 SELECT 검사를 통과한 뒤 동시 요청이 먼저 커밋된 경우(레이스) - 부분 유니크 인덱스가 막아준다.
            session.rollback()
            raise api_error("FAVORITE_KIND_TAKEN")
        session.refresh(place)
        return place


@router.patch("/{favorite_id}", response_model=FavoritePlacePublic)
def update_favorite(favorite_id: int, body: FavoritePlaceUpdate, request: Request, user: User = Depends(get_current_user)) -> FavoritePlace:
    with Session(request.app.state.db_engine) as session:
        place = _owned_or_404(session, favorite_id, user)
        # 명시적 null 은 "안 바꿈"으로 취급한다 - 모든 필드가 NOT NULL 이라 null 을 실제로 쓸 방법이 없다.
        updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if "kind" in updates:
            _check_kind_not_taken(session, user, updates["kind"], exclude_id=place.id)
        final_kind = updates.get("kind", place.kind)
        if final_kind != FavoriteKind.custom:
            updates["category"] = None
        for field, value in updates.items():
            setattr(place, field, value)
        session.add(place)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise api_error("FAVORITE_KIND_TAKEN")
        session.refresh(place)
        return place


@router.delete("/{favorite_id}", status_code=204)
def delete_favorite(favorite_id: int, request: Request, user: User = Depends(get_current_user)) -> None:
    with Session(request.app.state.db_engine) as session:
        place = _owned_or_404(session, favorite_id, user)
        session.delete(place)
        session.commit()
