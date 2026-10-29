"""행정안전부 '과속방지턱정보' CSV(공공데이터포털, data.go.kr)를 로컬 SQLite 로 가져온다.

원본 CSV(전국 14만 건, ~37MB)는 Git 에 올리지 않는다. 이 스크립트로 한 번만 가져와서
backend/data/speed_bumps.db 를 만들고, 백엔드는 이 DB를 시도명·시군구명으로 조회한다.
원본 CSV 인코딩은 CP949(EUC-KR)다.

실행(backend 폴더에서):
    .venv/bin/python scripts/import_speed_bumps.py <CSV 경로> [--out data/speed_bumps.db]
"""
import argparse
import csv
import sqlite3
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# CSV 컬럼명 -> 저장할 (컬럼, 변환함수). 좌표는 CSV 에 이미 WGS84라 변환이 필요 없다.
_COLUMNS: Dict[str, Tuple[str, type]] = {
    "시도명": ("sido", str),
    "시군구명": ("sigungu", str),
    "도로명": ("road_name", str),
    "소재지도로명주소": ("road_address", str),
    "소재지지번주소": ("jibun_address", str),
    "설치장소": ("install_place", str),
    "과속방지턱높이": ("height_cm", float),
    "과속방지턱폭": ("width_cm", float),
    "과속방지턱연장": ("length_m", float),
    "WGS84위도": ("lat", float),
    "WGS84경도": ("lng", float),
}


_STORED_NAMES = [stored for stored, _ in _COLUMNS.values()]
_LAT_IDX, _LNG_IDX = _STORED_NAMES.index("lat"), _STORED_NAMES.index("lng")


def _row_values(row: dict) -> Optional[tuple]:
    values: List[object] = []
    for csv_col, (_, cast) in _COLUMNS.items():
        raw = (row.get(csv_col) or "").strip()
        if cast is float:
            if not raw:
                values.append(None)
                continue
            try:
                values.append(cast(raw))
            except ValueError:
                return None  # 숫자여야 할 값이 깨져 있으면 이 행은 버린다.
        else:
            values.append(raw)
    if values[_LAT_IDX] is None or values[_LNG_IDX] is None:
        return None  # 좌표 없는 행은 지도에 못 띄우니 버린다.
    return tuple(values)


def import_csv(csv_path: Path, out_path: Path) -> Tuple[int, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()  # 재실행 시 깨끗이 새로 만든다.

    stored_columns = [stored for stored, _ in _COLUMNS.values()]
    conn = sqlite3.connect(out_path)
    conn.execute(f"CREATE TABLE speed_bumps (id INTEGER PRIMARY KEY, {', '.join(stored_columns)})")

    inserted = skipped = 0
    batch: List[tuple] = []
    placeholders = ", ".join("?" for _ in stored_columns)
    with csv_path.open(encoding="cp949", newline="") as f:
        for row in csv.DictReader(f):
            values = _row_values(row)
            if values is None:
                skipped += 1
                continue
            batch.append(values)
            if len(batch) >= 5000:
                conn.executemany(f"INSERT INTO speed_bumps ({', '.join(stored_columns)}) VALUES ({placeholders})", batch)
                inserted += len(batch)
                batch.clear()
    if batch:
        conn.executemany(f"INSERT INTO speed_bumps ({', '.join(stored_columns)}) VALUES ({placeholders})", batch)
        inserted += len(batch)

    conn.execute("CREATE INDEX idx_speed_bumps_region ON speed_bumps (sido, sigungu)")
    conn.execute("CREATE INDEX idx_speed_bumps_latlng ON speed_bumps (lat, lng)")
    conn.commit()
    conn.close()
    return inserted, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="행정안전부 과속방지턱정보 CSV 경로")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "speed_bumps.db")
    args = parser.parse_args()

    if not args.csv_path.exists():
        print(f"CSV 파일을 찾을 수 없습니다: {args.csv_path}")
        return 2

    inserted, skipped = import_csv(args.csv_path, args.out)
    size_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"완료: {inserted}건 적재, {skipped}건 제외(좌표·숫자값 깨짐) -> {args.out} ({size_mb:.1f}MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
