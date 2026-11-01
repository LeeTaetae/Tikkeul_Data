import json
from typing import List, Optional

from google import genai
from google.genai import errors, types

from app.chat.models import ChatMessage
from app.errors import ApiError, api_error
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
    types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name="nearby_incidents",
            description="사용자의 현재 위치 주변 돌발상황(사고·공사·정체)을 실시간으로 조회한다.",
            parameters_json_schema={"type": "object", "properties": {}, "required": []},
        ),
        types.FunctionDeclaration(
            name="nearby_caution_zones",
            description="사용자의 현재 위치 주변 주의운전구간(사고잦은구간 등)을 실시간으로 조회한다.",
            parameters_json_schema={"type": "object", "properties": {}, "required": []},
        ),
        types.FunctionDeclaration(
            name="nearby_protection_zones",
            description="사용자의 현재 위치가 속한 지역의 어린이·노인·장애인 보호구역 등록 현황을 조회한다.",
            parameters_json_schema={"type": "object", "properties": {}, "required": []},
        ),
    ])
]

# shortcut: 반경을 고정 0.01도(~1.1km)로 둔다. 더 넓게/좁게 조절이 필요해지면 사용자 요청 거리(예: "5km 안")를 받아 가변으로 바꾼다.
_SPAN_DEG = 0.01
# shortcut: 모델이 툴을 계속 반복 호출해도 4회 뒤에는 끊는다. 실제로 이 한도에 걸리면 프롬프트를 다시 본다.
_MAX_TOOL_ITERATIONS = 4
_FALLBACK_REPLY = "답변을 만들지 못했어요. 다시 물어봐 주세요."
_NO_LOCATION = "위치 정보가 없어 확인할 수 없습니다."


class ChatService:
    def __init__(self, client: genai.Client, service: TrafficService, model: str = "gemini-flash-latest"):
        self._client = client
        self._service = service
        self._model = model

    async def reply(self, message: str, history: List[ChatMessage], lat: Optional[float], lon: Optional[float]) -> str:
        # Gemini 는 "assistant" 가 아니라 "model" 역할을 쓴다.
        contents = [
            types.Content(role="user" if h.role == "user" else "model", parts=[types.Part.from_text(text=h.text)])
            for h in history
        ] + [types.Content(role="user", parts=[types.Part.from_text(text=message)])]
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=TOOLS,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        response = None
        for _ in range(_MAX_TOOL_ITERATIONS):
            try:
                response = await self._client.aio.models.generate_content(model=self._model, contents=contents, config=config)
            except errors.APIError as exc:
                raise api_error("CHAT_UNAVAILABLE") from exc
            calls = response.function_calls or []
            if not calls:
                return (response.text or "").strip() or _FALLBACK_REPLY
            contents.append(response.candidates[0].content)
            result_parts = []
            for call in calls:
                result = await self._run_tool(call.name, lat, lon)
                result_parts.append(types.Part.from_function_response(name=call.name, response={"result": result}))
            contents.append(types.Content(role="user", parts=result_parts))
        return ((response.text or "").strip() if response else "") or _FALLBACK_REPLY

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
                return json.dumps(_summarize_protection_zones(items), ensure_ascii=False)
        except ApiError as exc:
            return f"조회할 수 없습니다: {exc.message}"
        return "알 수 없는 조회 요청입니다."


# 보호구역은 시군구 전체 단위(최대 수천 건)라, 다 그대로 넘기면 프롬프트 토큰이 커진다. 개수와 유형별 집계
# + 예시 몇 개만 준다.
def _summarize_protection_zones(items) -> dict:
    by_type: dict = {}
    for z in items:
        by_type[z.zone_type.value] = by_type.get(z.zone_type.value, 0) + 1
    return {"total": len(items), "by_type": by_type, "sample": [z.name for z in items[:5]]}
