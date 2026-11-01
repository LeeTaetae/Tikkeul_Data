import json
from typing import List, Optional

import anthropic

from app.chat.models import ChatMessage
from app.errors import ApiError
from app.geo import BBox
from app.service import TrafficService

SYSTEM_PROMPT = (
    "당신은 교통안전 보조 앱 '티끌모아Data'의 챗봇입니다. "
    "사용자의 현재 위치 주변 위험구간·정체·보호구역 질문에는 제공된 툴을 호출해 실제 데이터로 답하세요. "
    "데이터가 없거나 모르면 모른다고 답하세요. "
    "사고나 위험을 확정적으로 말하지 말고 '위험 가능성이 있습니다', '주의하세요' 식으로만 표현하세요. "
    "답변은 2~3문장으로 짧게 하세요."
)

TOOLS = [
    {"name": "nearby_incidents", "description": "사용자의 현재 위치 주변 돌발상황(사고·공사·정체)을 실시간으로 조회한다.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "nearby_caution_zones", "description": "사용자의 현재 위치 주변 주의운전구간(사고잦은구간 등)을 실시간으로 조회한다.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "nearby_protection_zones", "description": "사용자의 현재 위치가 속한 지역의 어린이·노인·장애인 보호구역 등록 현황을 조회한다.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
]

# shortcut: 반경을 고정 0.01도(~1.1km)로 둔다. 더 넓게/좁게 조절이 필요해지면 사용자 요청 거리(예: "5km 안")를 받아 가변으로 바꾼다.
_SPAN_DEG = 0.01
# shortcut: 모델이 툴을 계속 반복 호출해도 4회 뒤에는 끊는다. 실제로 이 한도에 걸리면 프롬프트를 다시 본다.
_MAX_TOOL_ITERATIONS = 4
_FALLBACK_REPLY = "답변을 만들지 못했어요. 다시 물어봐 주세요."
_NO_LOCATION = "위치 정보가 없어 확인할 수 없습니다."


class ChatService:
    def __init__(self, client: anthropic.AsyncAnthropic, service: TrafficService, model: str = "claude-haiku-5-5"):
        self._client = client
        self._service = service
        self._model = model

    async def reply(self, message: str, history: List[ChatMessage], lat: Optional[float], lon: Optional[float]) -> str:
        messages = [{"role": h.role, "content": h.text} for h in history] + [{"role": "user", "content": message}]
        response = None
        for _ in range(_MAX_TOOL_ITERATIONS):
            response = await self._client.messages.create(
                model=self._model, max_tokens=1024, system=SYSTEM_PROMPT, tools=TOOLS, messages=messages,
            )
            if response.stop_reason != "tool_use":
                return _extract_text(response) or _FALLBACK_REPLY
            messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                result = await self._run_tool(block.name, lat, lon)
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
            messages.append({"role": "user", "content": tool_results})
        return (_extract_text(response) if response else "") or _FALLBACK_REPLY

    async def _run_tool(self, name: str, lat: Optional[float], lon: Optional[float]) -> str:
        if lat is None or lon is None:
            return _NO_LOCATION
        bbox = BBox(lon - _SPAN_DEG, lon + _SPAN_DEG, lat - _SPAN_DEG, lat + _SPAN_DEG)
        try:
            if name == "nearby_incidents":
                items, _ = await self._service.incidents(bbox)
                return json.dumps([{"kind": i.kind.value, "message": i.message} for i in items], ensure_ascii=False)
            if name == "nearby_caution_zones":
                items, _ = await self._service.caution_zones(bbox)
                return json.dumps([{"kind": c.kind.value, "message": c.message} for c in items], ensure_ascii=False)
            if name == "nearby_protection_zones":
                region = await self._service.region(lat, lon)
                items, _ = await self._service.protection_zones(region.sgg_cd, False)
                return json.dumps([{"name": z.name, "zone_type": z.zone_type.value} for z in items], ensure_ascii=False)
        except ApiError as exc:
            return f"조회할 수 없습니다: {exc.message}"
        return "알 수 없는 조회 요청입니다."


def _extract_text(response) -> str:
    return next((b.text for b in response.content if b.type == "text"), "")
