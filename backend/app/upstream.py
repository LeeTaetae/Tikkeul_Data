"""공공 API 호출. 키가 담긴 URL·파라미터를 로그나 예외 메시지로 내보내지 않는다."""
import logging
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import httpx

from app.config import Settings
from app.errors import ApiError, api_error

logger = logging.getLogger(__name__)

# Kakao 게이트웨이는 dapi.kakao.com 호출마다 KA 헤더(os + origin)를 요구한다. 없으면 키가 유효해도 401 로 거절한다.
# navigation/providers.py 의 KakaoRoutingProvider 와 같은 값이다(그쪽은 실호출로 확인했다). origin 값 자체는 검증되지 않는다.
KAKAO_KA_HEADER = "os/web origin/http://localhost:8081"

_ITS_CODE_MAP = {4001: "UPSTREAM_RATE_LIMIT", 4002: "UPSTREAM_BAD_REQUEST", 4005: "UPSTREAM_AUTH"}
_LOCAL_RELAY_HOSTS = ("127.0.0.1", "localhost")  # 개발 중에만 평문 HTTP 를 허용한다


def _relay_url_allowed(url: str) -> bool:
    """토큰을 평문으로 내보내지 않는 주소인가: https 이거나, 이 PC 안(127.0.0.1, localhost)의 http."""
    parts = urlsplit(url)
    return bool(parts.hostname) and (parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in _LOCAL_RELAY_HOSTS))


def _relay_status_error(status: int) -> str:
    """중계(또는 Cloudflare)가 ITS 응답이 아닌 자기 오류를 냈을 때의 오류 코드. ITS 본문이 있으면 이 함수를 쓰지 않는다."""
    if status in (401, 403, 404):
        return "UPSTREAM_AUTH"  # 중계 토큰이 틀렸거나 주소가 틀렸다
    if status == 504:
        return "UPSTREAM_TIMEOUT"  # 중계가 ITS 에 연결하지 못했다
    if status >= 500:
        return "UPSTREAM_UNAVAILABLE"  # 중계가 꺼졌거나 터널이 끊겼다(Cloudflare 530 등)
    return "UPSTREAM_BAD_RESPONSE"


def _log_failure(url: str, exc: Exception) -> None:
    """운영 로그에서 원인(ConnectTimeout, ReadTimeout, ConnectError ...)을 구분하기 위한 기록. 호스트와 예외 종류만 남기고,
    URL 전체·쿼리(인증키·좌표)·예외 메시지는 남기지 않는다."""
    logger.warning("공공 API 호출 실패 host=%s error=%s", httpx.URL(url).host, type(exc).__name__)


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

    async def _get_json(
        self, url: str, params: Dict[str, Any], headers: Optional[Dict[str, str]] = None, relay: bool = False
    ) -> Tuple[int, Any]:
        try:
            response = await self._client.get(url, params=params, headers=headers)
        except httpx.TimeoutException as exc:
            _log_failure(url, exc)
            raise api_error("UPSTREAM_TIMEOUT") from None  # 원인 예외에는 키가 든 URL 이 있어 연결하지 않는다
        except httpx.HTTPError as exc:
            _log_failure(url, exc)
            raise api_error("UPSTREAM_UNAVAILABLE") from None
        try:
            return response.status_code, response.json()
        except ValueError:
            if relay:
                logger.warning("ITS 중계 응답 해석 실패 status=%d", response.status_code)
                raise api_error(_relay_status_error(response.status_code)) from None
            raise api_error("UPSTREAM_BAD_RESPONSE") from None

    def _key(self, name: str) -> str:
        key = self._settings.secret(name)
        if key is None:
            raise api_error("NOT_CONFIGURED")
        return key

    async def its(self, path: str, key_name: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """ITS OpenAPI 호출. 성공하면 body.items 배열을 돌려준다(빈 영역은 빈 배열)."""
        relay_url = self._settings.its_relay_url.strip()
        if relay_url:
            # 중계 모드: 인증키는 중계 PC 에만 있다. 이 서버의 키는 보내지 않고 토큰 헤더로만 인증한다.
            token = self._settings.secret("its_relay_token")
            if token is None or not _relay_url_allowed(relay_url):
                raise api_error("NOT_CONFIGURED")  # 토큰이 없거나, 토큰을 평문 HTTP 로 보내게 되는 주소
            url, query, headers = relay_url.rstrip("/") + "/" + path, dict(params, getType="json"), {"X-Relay-Token": token}
        else:
            url, query, headers = self._settings.its_base_url + "/" + path, dict(params, apiKey=self._key(key_name), getType="json"), None
        status, data = await self._get_json(url, query, headers, relay=bool(relay_url))
        header = data.get("header") if isinstance(data, dict) else None
        code = _as_int(header.get("resultCode")) if isinstance(header, dict) else None
        if code is None:
            if relay_url:
                logger.warning("ITS 중계 응답에 ITS 헤더가 없음 status=%d", status)
                raise api_error(_relay_status_error(status))
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
                headers={"Authorization": "KakaoAK " + key, "KA": KAKAO_KA_HEADER},
            )
        except httpx.TimeoutException as exc:
            _log_failure(self._settings.kakao_region_url, exc)
            raise api_error("UPSTREAM_TIMEOUT") from None
        except httpx.HTTPError as exc:
            _log_failure(self._settings.kakao_region_url, exc)
            raise api_error("UPSTREAM_UNAVAILABLE") from None
        status = response.status_code
        if status in (401, 403):
            logger.warning("Kakao 인증 거절 status=%d", status)
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
