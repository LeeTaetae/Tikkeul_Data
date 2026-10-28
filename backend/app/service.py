from datetime import datetime
from typing import List, Optional, Tuple

from app.adapters import (
    parse_region,
    parse_caution_zones,
    parse_incidents,
    parse_predictions,
    parse_protection_zones,
    parse_traffic_flow,
)
from app.cache import TtlCache
from app.config import Settings
from app.geo import BBox
from app.models import (
    CautionZone,
    DataKind,
    Incident,
    Meta,
    PredictionItem,
    ProtectionZone,
    Region,
    TrafficFlowItem,
)
from app.timeutil import KST, now_kst
from app.errors import api_error
from app.upstream import Upstream

# 대한민국 영토(제주·울릉·독도 포함)를 넉넉히 감싼 범위. 밖이면 외부 API 를 부르지 않고 바로 '지역 없음'으로 답한다.
KOREA_LAT = (32.5, 39.0)
KOREA_LON = (123.5, 132.5)

ZONE_PAGE_SIZE = 200
ZONE_MAX_PAGES = 30  # 시군구 하나가 이 한도를 넘는 일은 없다고 본다. 넘으면 이후 페이지는 받지 않는다.


class TrafficService:
    """공공 API 호출 + 캐시 + 정규화. 라우터는 이 클래스만 안다."""

    def __init__(self, upstream: Upstream, settings: Settings, cache: TtlCache):
        self._up = upstream
        self._s = settings
        self._cache = cache

    def _meta(self, source: str, kind: DataKind, fetched_at: datetime, stale: bool, updated_at: Optional[datetime] = None) -> Meta:
        return Meta(source=source, data_kind=kind, updated_at=updated_at, fetched_at=fetched_at, stale=stale)

    async def region(self, lat: float, lon: float) -> Region:
        # 좌표는 캐시하지 않고 로그에도 남기지 않는다. 호출은 프런트가 위치를 새로 읽었을 때만 발생한다.
        if not (KOREA_LAT[0] <= lat <= KOREA_LAT[1] and KOREA_LON[0] <= lon <= KOREA_LON[1]):
            raise api_error("REGION_NOT_FOUND")
        region = parse_region(await self._up.kakao_region(lat, lon))
        if region is None:
            raise api_error("REGION_NOT_FOUND")
        return region

    async def incidents(self, bbox: BBox) -> Tuple[List[Incident], Meta]:
        snapped = bbox.snapped()

        async def fetch() -> List[Incident]:
            raw = await self._up.its("eventInfo", "its_event_api_key", {"type": "all", "eventType": "all", **snapped.its_params()})
            return parse_incidents(raw)

        items, fetched_at, stale = await self._cache.get(("incidents", snapped), self._s.ttl_incidents_s, self._s.max_stale_s, fetch)
        items = [i for i in items if bbox.contains(i.location.lat, i.location.lon)]
        return items, self._meta("국가교통정보센터 돌발상황정보", DataKind.realtime, fetched_at, stale)

    async def caution_zones(self, bbox: BBox) -> Tuple[List[CautionZone], Meta]:
        snapped = bbox.snapped()

        async def fetch() -> List[CautionZone]:
            return parse_caution_zones(await self._up.its("posIncidentInfo", "its_caution_api_key", snapped.its_params()))

        items, fetched_at, stale = await self._cache.get(("caution", snapped), self._s.ttl_caution_s, self._s.max_stale_s, fetch)
        items = [z for z in items if bbox.contains(z.start.location.lat, z.start.location.lon)]
        return items, self._meta("국가교통정보센터 주의운전구간정보", DataKind.realtime, fetched_at, stale)

    async def traffic_flow(self, bbox: BBox) -> Tuple[List[TrafficFlowItem], Meta]:
        snapped = bbox.snapped()

        async def fetch() -> List[TrafficFlowItem]:
            return parse_traffic_flow(await self._up.its("trafficInfo", "its_traffic_api_key", {"type": "all", **snapped.its_params()}))

        # 링크 좌표가 없어 영역으로 걸러내지 못한다. 격자에 맞춘 영역 전체를 돌려준다.
        items, fetched_at, stale = await self._cache.get(("flow", snapped), self._s.ttl_flow_s, self._s.max_stale_s, fetch)
        observed = [i.observed_at for i in items if i.observed_at]
        return items, self._meta("국가교통정보센터 교통소통정보", DataKind.realtime, fetched_at, stale, max(observed) if observed else None)

    async def predictions(
        self, section_id: str, route_no: str, forecast_for: datetime
    ) -> Tuple[List[PredictionItem], Meta]:
        async def fetch() -> List[PredictionItem]:
            params = {
                "sectionId": section_id,
                "routeNo": route_no,
                "fCastDate": forecast_for.strftime("%Y%m%d"),
                "fCastHour": forecast_for.strftime("%H"),
            }
            return parse_predictions(await self._up.its("bypassFCastInfo", "its_prediction_api_key", params))

        key = ("prediction", section_id, route_no, forecast_for.strftime("%Y%m%d%H"))
        items, fetched_at, stale = await self._cache.get(key, self._s.ttl_prediction_s, self._s.max_stale_s, fetch)
        # 예측은 실시간이 아니다. data_kind=forecast 로 화면이 구분해서 표시한다.
        return items, self._meta("국가교통정보센터 교통예측정보", DataKind.forecast, fetched_at, stale)

    async def protection_zones(self, sgg_cd: str, include_geometry: bool) -> Tuple[List[ProtectionZone], Meta]:
        async def fetch() -> List[ProtectionZone]:
            raw: list = []
            page, total_pages = 1, 1
            while page <= total_pages and page <= ZONE_MAX_PAGES:
                items, total_pages = await self._up.protection_zone_page(sgg_cd, page, ZONE_PAGE_SIZE)
                raw.extend(items)
                page += 1
            return parse_protection_zones(raw)

        zones, fetched_at, stale = await self._cache.get(("zones", sgg_cd), self._s.ttl_protection_s, self._s.max_stale_s, fetch)
        if not include_geometry:
            zones = [z.model_copy(update={"geometry": None}) for z in zones]
        return zones, self._meta("경찰청 전국 보호구역 현황", DataKind.registry, fetched_at, stale)


def default_forecast_time() -> datetime:
    """예측 대상 시각 기본값: 지금(KST)의 정시."""
    return now_kst().astimezone(KST).replace(minute=0, second=0, microsecond=0)
