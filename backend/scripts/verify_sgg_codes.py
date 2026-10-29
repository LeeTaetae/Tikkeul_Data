"""Kakao Local 의 법정동코드 앞 5자리가 경찰청 보호구역 API 의 sggCd 와 통하는지 전국 지점으로 확인한다.

실행(backend 폴더에서, README 의 SSL PATH 설정 후):
    .\.venv\Scripts\python.exe scripts\verify_sgg_codes.py

backend/.env 의 KAKAO_REST_API_KEY 와 PROTECTION_ZONE_SERVICE_KEY 를 쓴다. 키는 출력하지 않는다.
경찰청 보호구역 API 를 지점마다 1회 호출한다(개발계정 호출 한도에 유의).
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.adapters import parse_region  # noqa: E402
from app.config import Settings  # noqa: E402
from app.errors import ApiError  # noqa: E402
from app.upstream import Upstream  # noqa: E402

# (이름, 위도, 경도, 경찰청 API 로 이미 확인한 기대 sgg_cd 또는 None)
POINTS = [
    ("서울 종로구 광화문", 37.5729, 126.9794, "11110"),
    ("서울 중구 시청", 37.5665, 126.9780, "11140"),
    ("경기 수원시 장안구", 37.2999, 127.0099, "41111"),
    ("경기 수원시 영통구", 37.2597, 127.0463, "41117"),
    ("경기 성남시 분당구", 37.3595, 127.1052, None),
    ("강원 춘천시(개편: 42→51)", 37.8813, 127.7298, "51110"),
    ("강원 강릉시", 37.7519, 128.8761, None),
    ("전북 전주시 완산구(개편: 45→52)", 35.8242, 127.1480, "52111"),
    ("대구 군위군(편입: 47→27)", 36.2397, 128.5728, "27720"),
    ("대구 중구", 35.8714, 128.6014, None),
    ("세종", 36.4801, 127.2890, "36110"),
    ("제주 제주시", 33.4996, 126.5312, "50110"),
    ("제주 서귀포시", 33.2541, 126.5601, None),
    ("부산 해운대구", 35.1631, 129.1639, "26350"),
    ("인천 연수구", 37.4100, 126.6784, None),
    ("경남 창원시 성산구", 35.2270, 128.6811, None),
    ("울릉군", 37.4844, 130.9057, None),
    ("독도", 37.2417, 131.8647, None),
    ("[국외] 도쿄(지역 없음이 정상)", 35.6762, 139.6503, "NONE"),
    ("[바다] 서해 한가운데(지역 없음이 정상)", 36.0, 124.0, "NONE"),
]


async def main() -> int:
    settings = Settings()
    if settings.secret("kakao_rest_api_key") is None:
        print("KAKAO_REST_API_KEY 가 backend/.env 에 없습니다. 키를 넣은 뒤 다시 실행하세요.")
        return 2
    mismatches = 0
    async with httpx.AsyncClient(timeout=15) as client:
        up = Upstream(client, settings)
        print("%-34s %-7s %-22s %-10s %s" % ("지점", "sgg_cd", "Kakao 지역명", "기대값", "경찰청 API"))
        for name, lat, lon, expected in POINTS:
            try:
                region = parse_region(await up.kakao_region(lat, lon))
            except ApiError as e:
                print("%-34s Kakao 오류 %s" % (name, e.code))
                mismatches += 1
                continue
            if region is None:
                ok = expected == "NONE"
                print("%-34s %-7s %-22s %-10s %s" % (name, "-", "(지역 없음)", expected or "-", "정상" if ok else "예상과 다름"))
                mismatches += 0 if ok else 1
                continue
            try:
                items, _ = await up.protection_zone_page(region.sgg_cd, 1, 1)
                police = "%d건 이상(예: %s)" % (len(items), (items[0].get("roadNmAddr") or "")[:18]) if items else "데이터 없음(ERR_03): 코드 불일치 의심"
            except ApiError as e:
                police = "오류 " + e.code
            flags = []
            if expected and expected != "NONE" and region.sgg_cd != expected:
                flags.append("기대값 불일치")
            if expected == "NONE":
                flags.append("국외인데 지역이 나옴")
            if "ERR_03" in police:
                flags.append("경찰청 코드 불일치")
            mismatches += 1 if flags else 0
            print("%-34s %-7s %-22s %-10s %s %s" % (name, region.sgg_cd, (region.sido_name + " " + region.sgg_name)[:20], expected or "-", police, ("<== " + ", ".join(flags)) if flags else ""))
    print("\n결과: 불일치/오류 %d건 (0건이면 이 지점들에서 Kakao 코드 체계와 경찰청 sggCd 가 일치)" % mismatches)
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
