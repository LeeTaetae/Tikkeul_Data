"""공공 API 호출. 키가 담긴 URL·파라미터를 로그나 예외 메시지로 내보내지 않는다."""
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import Settings
from app.errors import ApiError, api_error

_ITS_CODE_MAP = {4001: "UPSTREAM_RATE_LIMIT", 4002: "UPSTREAM_BAD_REQUEST", 4005: "UPSTREAM_AUTH"}


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_list(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


class Upstream:
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self._client = client
        self._settings = settings

    async def _get_json(self, url: str, params: Dict[str, Any]) -> Tuple[int, Any]:
        try:
            response = await self._client.get(url, params=params)
        except httpx.TimeoutException:
            raise api_error("UPSTREAM_TIMEOUT") from None  # 원인 예외에는 키가 든 URL 이 있어 연결하지 않는다
        except httpx.HTTPError:
            raise api_error("UPSTREAM_UNAVAILABLE") from None
        try:
            return response.status_code, response.json()
        except ValueError:
            raise api_error("UPSTREAM_BAD_RESPONSE") from None

    def _key(self, name: str) -> str:
        key = self._settings.secret(name)
        if key is None:
            raise api_error("NOT_CONFIGURED")
        return key

    async def its(self, path: str, key_name: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """ITS OpenAPI 호출. 성공하면 body.items 배열을 돌려준다(빈 영역은 빈 배열)."""
        query = dict(params, apiKey=self._key(key_name), getType="json")
        status, data = await self._get_json(self._settings.its_base_url + "/" + path, query)
        header = data.get("header") if isinstance(data, dict) else None
        code = _as_int(header.get("resultCode")) if isinstance(header, dict) else None
        if code is None:
            raise api_error("UPSTREAM_BAD_RESPONSE")
        if code != 0 or not 200 <= status < 300:
            raise api_error(_ITS_CODE_MAP.get(code, "UPSTREAM_ERROR"))
        body = data.get("body")
        items = body.get("items") if isinstance(body, dict) else None
        return _as_list(items.get("item") if isinstance(items, dict) else items)

    async def kakao_region(self, lat: float, lon: float) -> List[Dict[str, Any]]:
        """Kakao Local coord2regioncode. 키는 헤더로만 보내고, 좌표는 로그·예외에 남기지 않는다."""
        key = self._key("kakao_rest_api_key")
        try:
            response = await self._client.get(
                self._settings.kakao_region_url,
                params={"x": "%.6f" % lon, "y": "%.6f" % lat},
                headers={"Authorization": "KakaoAK " + key},
            )
        except httpx.TimeoutException:
            raise api_error("UPSTREAM_TIMEOUT") from None
        except httpx.HTTPError:
            raise api_error("UPSTREAM_UNAVAILABLE") from None
        status = response.status_code
        if status in (401, 403):
            raise api_error("UPSTREAM_AUTH")
        if status == 429:
            raise api_error("UPSTREAM_RATE_LIMIT")
        if status == 400:
            raise api_error("UPSTREAM_BAD_REQUEST")
        if not 200 <= status < 300:
            raise api_error("UPSTREAM_ERROR")
        try:
            data = response.json()
        except ValueError:
            raise api_error("UPSTREAM_BAD_RESPONSE") from None
        documents = data.get("documents") if isinstance(data, dict) else None
        if not isinstance(documents, list):
            raise api_error("UPSTREAM_BAD_RESPONSE")
        return documents

    async def protection_zone_page(self, sgg_cd: str, page: int, rows: int) -> Tuple[List[Dict[str, Any]], int]:
        """경찰청 보호구역 한 페이지. (항목, 전체 페이지 수)를 돌려준다."""
        params = {"serviceKey": self._key("protection_zone_service_key"), "sggCd": sgg_cd, "numOfRows": rows, "pageNo": page}
        _, data = await self._get_json(self._settings.protection_zone_url, params)
        if not isinstance(data, dict):
            raise api_error("UPSTREAM_BAD_RESPONSE")

        gateway = data.get("OpenAPI_ServiceResponse")  # data.go.kr 게이트웨이 오류(키 미등록, 한도 초과 등)
        if isinstance(gateway, dict):
            message = str((gateway.get("cmmMsgHeader") or {}).get("errMsg", "")).upper()
            if "SERVICE_KEY" in message or "KEY" in message:
                raise api_error("UPSTREAM_AUTH")
            if "LIMIT" in message or "EXCEED" in message:
                raise api_error("UPSTREAM_RATE_LIMIT")
            raise api_error("UPSTREAM_ERROR")

        response = data.get("response")
        header = response.get("header") if isinstance(response, dict) else None
        if not isinstance(header, dict):
            raise api_error("UPSTREAM_BAD_RESPONSE")
        code = str(header.get("resultCode", "")).strip()
        if code == "ERR_03":  # 조회된 데이터가 없습니다. 오류가 아니라 빈 결과다
            return [], 0
        if code == "ERR_01":
            raise api_error("UPSTREAM_BAD_REQUEST")
        if code != "00":
            raise api_error("UPSTREAM_ERROR")
        body = response.get("body")
        if not isinstance(body, dict):
            return [], 0
        items = body.get("items")
        total_pages = _as_int(body.get("totalPages")) or 1
        return _as_list(items.get("item") if isinstance(items, dict) else items), total_pages
