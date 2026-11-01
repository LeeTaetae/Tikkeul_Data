# 챗봇 어시스턴트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면에 챗봇 버튼을 추가해, 타이핑·음성으로 묻고 텍스트·TTS로 답하는 Q&A 어시스턴트를 만든다. 실시간 질문(위험구간·정체·보호구역)은 Claude가 기존 백엔드 API를 툴로 호출해 실제 데이터로 답하고, 일반 질문은 바로 답한다.

**Architecture:** 백엔드에 `/api/chat` 엔드포인트를 추가한다. `ChatService`가 Claude(`claude-haiku-5-5`)에 3개 툴(주변 돌발상황·주의운전구간·보호구역)을 등록하고, 수동 에이전틱 루프(manual loop, 베타 의존성 없음)로 호출을 처리한다. 프런트엔드는 이 엔드포인트를 호출하는 챗봇 패널을 홈 화면에 추가하고, 음성 입력은 `expo-speech-recognition`, 음성 출력은 기존 `expo-speech`를 재사용한다.

**Tech Stack:** FastAPI, Pydantic, `anthropic` Python SDK(AsyncAnthropic, 수동 tool-use 루프) / React Native, Expo Router, `expo-speech-recognition`(신규), `expo-speech`(기존)

**Spec:** `docs/superpowers/specs/2026-11-01-chatbot-assistant-design.md`

## Global Constraints

- 모델: `claude-haiku-5-5` (비용 최소화, 이미 사용자에게 확인받음)
- 안전 가드레일: 시스템 프롬프트에 "모르면 모른다, 사고·위험을 확정적으로 말하지 않는다" 반드시 포함 (CLAUDE.md 보안 규칙)
- 인증키 누락 시 기존 패턴(`NOT_CONFIGURED`, 503)과 동일하게 처리 — 하드코딩 금지, `.env`에만
- 비동기 테스트는 `pytest-asyncio` 없이 `asyncio.run()`으로 실행 (기존 `test_navigation.py` 관례)
- 백엔드 의존성은 `backend/requirements.txt`에 정확한 버전으로 고정 (Python 3.9.13 기준 실제 설치된 버전)
- 프런트엔드 테스트는 Node 내장 테스트 러너(`node --test`)로 순수 로직만 검증 — 네이티브 모듈을 쓰는 훅 자체는 기존 관례상 단위 테스트 대상이 아님 (예: `useAnnounceOnApproach.ts`)
- 새 i18n 키는 `ko.ts`/`en.ts`/`zh.ts` 세 파일 모두에 추가 (`i18n-coverage.test.mjs`가 키 누락을 검사함)

## Review Focus

- GPS 위치가 없는데(웹 데모 폴백, 권한 거부) 실시간 질문을 하면 → 좌표 없이 임의로 답하지 않고 "위치 정보가 없다"고만 답해야 한다
- 백엔드에 `ANTHROPIC_API_KEY`가 설정되지 않은 팀원 로컬 환경에서 챗봇을 누르면 → 앱이 죽지 않고 기존 `NOT_CONFIGURED` 오류와 동일하게 처리돼야 한다
- 좌표가 한국 영토 밖(보호구역 조회가 `REGION_NOT_FOUND`)이면 → 전체 응답이 깨지지 않고 해당 툴만 안전한 메시지로 답해야 한다
- Claude가 툴을 계속 반복 호출하며 끝내지 않으면 → 요청이 무한정 걸리지 않고 정해진 횟수 뒤에는 끊어야 한다
- 대화가 길어질수록 매 요청마다 전체 히스토리를 다시 보내 비용이 커지면 → 히스토리를 일정 개수로 잘라서 보내야 한다

---

### Task 1: 백엔드 ChatService (Claude 툴 호출 에이전틱 루프)

**Files:**
- Create: `backend/app/chat/__init__.py`
- Create: `backend/app/chat/models.py`
- Create: `backend/app/chat/service.py`
- Test: `backend/tests/test_chat_service.py`
- Modify: `backend/requirements.txt` (append `anthropic==<설치된 버전>`)

**Interfaces:**
- Consumes: `app.service.TrafficService`의 `async incidents(bbox) -> (items, meta)`, `async caution_zones(bbox) -> (items, meta)`, `async region(lat, lon) -> Region`, `async protection_zones(sgg_cd, include_geometry) -> (items, meta)`; `app.geo.BBox(min_lon, max_lon, min_lat, max_lat)`; `app.errors.api_error`
- Produces: `ChatMessage(role: Literal["user","assistant"], text: str)`, `ChatService(client: anthropic.AsyncAnthropic, service: TrafficService, model: str = "claude-haiku-5-5")` with `async def reply(message: str, history: list[ChatMessage], lat: Optional[float], lon: Optional[float]) -> str` — Task 2 constructs and calls this.

- [ ] **Step 1: `pip install anthropic`로 설치하고 실제 설치된 버전을 확인한다**

Run: `cd backend && .venv/bin/pip install anthropic && .venv/bin/pip show anthropic | grep Version`
Expected: 버전 출력됨 (Python 3.9.13과 충돌 없이 설치 성공)

- [ ] **Step 2: `backend/requirements.txt`에 정확한 버전 고정**

`anthropic==<Step 1에서 확인한 버전>`을 기존 줄 형식(ASCII만)에 맞춰 추가.

- [ ] **Step 3: `backend/app/chat/models.py`에 `ChatMessage` 정의**

```python
from typing import Literal
from pydantic import BaseModel

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str
```

- [ ] **Step 4: 실패하는 테스트 작성 — 일반 질문(툴 호출 없음)**

```python
# backend/tests/test_chat_service.py
import asyncio
from app.chat.models import ChatMessage
from app.chat.service import ChatService

class FakeResponse:
    def __init__(self, content, stop_reason):
        self.content = content
        self.stop_reason = stop_reason

class TextBlock:
    type = "text"
    def __init__(self, text):
        self.text = text

class ToolUseBlock:
    type = "tool_use"
    def __init__(self, id, name, input):
        self.id, self.name, self.input = id, name, input

class FakeMessages:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)

class FakeClient:
    def __init__(self, responses):
        self.messages = FakeMessages(responses)

class FakeTrafficService:
    def __init__(self):
        self.incidents_calls = []
    async def incidents(self, bbox):
        self.incidents_calls.append(bbox)
        return [], None
    async def caution_zones(self, bbox):
        return [], None
    async def region(self, lat, lon):
        raise NotImplementedError
    async def protection_zones(self, sgg_cd, include_geometry=False):
        return [], None

def test_general_question_answers_without_tool_call():
    client = FakeClient([FakeResponse([TextBlock("보호구역은 ...")], "end_turn")])
    fake_service = FakeTrafficService()
    svc = ChatService(client, fake_service)
    reply = asyncio.run(svc.reply("보호구역이 뭐야?", [], None, None))
    assert reply == "보호구역은 ..."
    assert fake_service.incidents_calls == []
```

- [ ] **Step 5: 테스트 실행해서 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat_service.py -v`
Expected: FAIL (`ModuleNotFoundError: app.chat.service` 등)

- [ ] **Step 6: `backend/app/chat/service.py`에 `ChatService` 구현**

```python
import json
from typing import List, Optional

import anthropic

from app.config import Settings
from app.errors import ApiError
from app.geo import BBox
from app.chat.models import ChatMessage
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
```

- [ ] **Step 7: 테스트 실행해서 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat_service.py -v`
Expected: PASS

- [ ] **Step 8: 실시간 질문(툴 호출) 테스트 추가 — `nearby_incidents` 호출, bbox 계산, 2차 응답 반환**

```python
def test_realtime_question_calls_incidents_tool():
    client = FakeClient([
        FakeResponse([ToolUseBlock("t1", "nearby_incidents", {})], "tool_use"),
        FakeResponse([TextBlock("근처에 공사가 있어요.")], "end_turn"),
    ])
    fake_service = FakeTrafficService()
    svc = ChatService(client, fake_service)
    reply = asyncio.run(svc.reply("지금 이 길 위험구간 있어?", [], 37.5, 127.0))
    assert reply == "근처에 공사가 있어요."
    assert len(fake_service.incidents_calls) == 1
    bbox = fake_service.incidents_calls[0]
    assert round(bbox.min_lat, 2) == 37.49 and round(bbox.max_lat, 2) == 37.51
```

- [ ] **Step 9: 위치 없음 / REGION_NOT_FOUND / 무한루프 가드 테스트 추가 (Review Focus)**

```python
def test_missing_location_skips_service_call():
    client = FakeClient([
        FakeResponse([ToolUseBlock("t1", "nearby_incidents", {})], "tool_use"),
        FakeResponse([TextBlock("위치가 필요해요.")], "end_turn"),
    ])
    fake_service = FakeTrafficService()
    svc = ChatService(client, fake_service)
    reply = asyncio.run(svc.reply("위험구간 있어?", [], None, None))
    assert reply == "위치가 필요해요."
    assert fake_service.incidents_calls == []

def test_region_not_found_does_not_crash():
    from app.errors import api_error

    class RaisingService(FakeTrafficService):
        async def region(self, lat, lon):
            raise api_error("REGION_NOT_FOUND")

    client = FakeClient([
        FakeResponse([ToolUseBlock("t1", "nearby_protection_zones", {})], "tool_use"),
        FakeResponse([TextBlock("국내 위치가 아니에요.")], "end_turn"),
    ])
    svc = ChatService(client, RaisingService())
    reply = asyncio.run(svc.reply("보호구역 있어?", [], 1.0, 1.0))
    assert reply == "국내 위치가 아니에요."

def test_gives_up_after_max_tool_iterations():
    responses = [FakeResponse([ToolUseBlock("t1", "nearby_incidents", {})], "tool_use") for _ in range(10)]
    client = FakeClient(responses)
    svc = ChatService(client, FakeTrafficService())
    reply = asyncio.run(svc.reply("위험구간?", [], 37.5, 127.0))
    assert reply == "답변을 만들지 못했어요. 다시 물어봐 주세요."
    assert len(client.messages.calls) == 4
```

- [ ] **Step 10: 테스트 실행해서 전체 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat_service.py -v`
Expected: PASS (6 tests)

- [ ] **Step 11: Commit**

```bash
git add backend/app/chat backend/tests/test_chat_service.py backend/requirements.txt
git commit -m "feat: Claude 툴 호출 기반 ChatService 추가"
```

---

### Task 2: 백엔드 `/api/chat` 라우터 및 설정 연동

**Files:**
- Modify: `backend/app/config.py` (`anthropic_api_key: Optional[SecretStr] = None` 추가)
- Modify: `backend/app/errors.py` (`CHAT_UNAVAILABLE` 코드 추가)
- Create: `backend/app/chat/router.py`
- Modify: `backend/app/main.py` (lifespan에서 `app.state.chat_service` 생성, `_KEY_NAMES`에 `anthropic_api_key` 추가, 라우터 등록)
- Modify: `backend/tests/fixtures.py` (`KEYS`에 `anthropic_api_key` 추가)
- Test: `backend/tests/test_chat_api.py`

**Interfaces:**
- Consumes: Task 1의 `ChatService.reply(message, history, lat, lon) -> str`, `app.chat.models.ChatMessage`
- Produces: `POST /api/chat` — 요청 `{message: str, history: [{role,text}], lat?: float, lon?: float}` → 응답 `{reply: str}` (200) / `{error:{code:"NOT_CONFIGURED",...}}` (503, 키 없음)

- [ ] **Step 1: `backend/app/config.py`에 설정 추가**

`its_traffic_api_key` 바로 아래 같은 스타일로 `anthropic_api_key: Optional[SecretStr] = None` 추가.

- [ ] **Step 2: `backend/app/errors.py`에 에러 코드 추가**

`_ERRORS` 딕셔너리에 `"CHAT_UNAVAILABLE": (503, "챗봇 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."),` 추가.

- [ ] **Step 3: `backend/tests/fixtures.py`의 `KEYS`에 추가**

`"anthropic_api_key": "SECRET-ANTHROPIC-KEY",` 추가.

- [ ] **Step 4: 실패하는 테스트 작성 — `/api/chat` 엔드포인트**

```python
# backend/tests/test_chat_api.py
import httpx

from tests.conftest import make_settings


class FakeChatService:
    def __init__(self, reply_text="안녕하세요"):
        self.reply_text = reply_text
        self.calls = []
    async def reply(self, message, history, lat, lon):
        self.calls.append((message, history, lat, lon))
        return self.reply_text


def _no_upstream_calls(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={})


def test_chat_endpoint_returns_reply(make_client):
    client = make_client(_no_upstream_calls)
    fake = FakeChatService("근처에 공사가 있어요.")
    client.app.state.chat_service = fake
    response = client.post("/api/chat", json={"message": "위험구간 있어?", "history": [], "lat": 37.5, "lon": 127.0})
    assert response.status_code == 200
    assert response.json() == {"reply": "근처에 공사가 있어요."}
    assert fake.calls == [("위험구간 있어?", [], 37.5, 127.0)]

def test_chat_endpoint_without_key_returns_not_configured(make_client):
    client = make_client(_no_upstream_calls, make_settings(anthropic_api_key=None))
    response = client.post("/api/chat", json={"message": "안녕", "history": []})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "NOT_CONFIGURED"
```

- [ ] **Step 5: 테스트 실행해서 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat_api.py -v`
Expected: FAIL (`/api/chat` 404 등)

- [ ] **Step 6: `backend/app/chat/router.py` 구현**

```python
from typing import List, Optional

from fastapi import APIRouter, Depends, Request

from app.chat.models import ChatMessage
from app.chat.service import ChatService
from app.errors import api_error
from pydantic import BaseModel

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    lat: Optional[float] = None
    lon: Optional[float] = None


class ChatReply(BaseModel):
    reply: str


def get_chat_service(request: Request) -> Optional[ChatService]:
    return getattr(request.app.state, "chat_service", None)


@router.post("", response_model=ChatReply)
async def chat(body: ChatRequest, chat_service: Optional[ChatService] = Depends(get_chat_service)) -> ChatReply:
    if chat_service is None:
        raise api_error("NOT_CONFIGURED")
    reply = await chat_service.reply(body.message, body.history, body.lat, body.lon)
    return ChatReply(reply=reply)
```

- [ ] **Step 7: `backend/app/main.py`에 연동**

`_KEY_NAMES` 리스트에 `"anthropic_api_key"` 추가. lifespan 안, `app.state.service` 생성 다음 줄에:

```python
import anthropic
...
anthropic_key = settings.secret("anthropic_api_key")
app.state.chat_service = ChatService(anthropic.AsyncAnthropic(api_key=anthropic_key), app.state.service) if anthropic_key else None
```

`from app.chat.router import router as chat_router`, `from app.chat.service import ChatService` 임포트 추가. `app.include_router(chat_router)` 추가(`app.include_router(favorites_router)` 다음 줄).

- [ ] **Step 8: 테스트 실행해서 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat_api.py -v`
Expected: PASS

- [ ] **Step 9: 전체 백엔드 테스트 회귀 확인**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: 기존 테스트 모두 PASS (새 설정 키 추가가 기존 테스트를 깨지 않아야 함)

- [ ] **Step 10: Commit**

```bash
git add backend/app/config.py backend/app/errors.py backend/app/chat/router.py backend/app/main.py backend/tests/fixtures.py backend/tests/test_chat_api.py
git commit -m "feat: /api/chat 엔드포인트 연동"
```

---

### Task 3: 프런트엔드 대화 로직 (API 클라이언트 + 훅)

**Files:**
- Create: `frontend/src/lib/chat/conversation.ts`
- Create: `frontend/src/lib/chat/api.ts`
- Create: `frontend/src/lib/chat/useChatAssistant.ts`
- Test: `frontend/tests/chat-conversation.test.mjs`
- Modify: `frontend/package.json` (`expo-speech-recognition` 추가)
- Modify: `frontend/app.json` (plugins 배열에 `expo-speech-recognition` 추가)

**Interfaces:**
- Consumes: `frontend/src/lib/api/client.ts`의 `createApiClient`; `frontend/src/lib/location/getCurrentLocation.ts`의 `getCurrentLocation(): Promise<{lat, lng}>`; `frontend/src/lib/speechVoice.ts`의 `resolveVoiceId(language)`; `expo-speech`의 `Speech.speak`; `expo-speech-recognition`의 `ExpoSpeechRecognitionModule`, `useSpeechRecognitionEvent`
- Produces: `ChatTurn = {role: 'user'|'assistant', text: string}`; `buildRequestBody(message, history, origin)`; `trimHistory(history, max)`; `chatApi.send(body) -> Promise<{reply: string}>`; `useChatAssistant()` 훅이 `{messages, sending, listening, send(text), startListening(), stopListening()}`를 반환 — Task 4의 UI가 이것만 사용

- [ ] **Step 1: `frontend/package.json`에 의존성 추가**

Run: `cd frontend && npx expo install expo-speech-recognition`
Expected: `package.json`에 `expo-speech-recognition` 버전이 추가됨

- [ ] **Step 2: `frontend/app.json` plugins에 추가**

`"expo-dev-client"` 항목 근처에, 기존 `expo-location` 항목처럼 한국어 설명을 넣어 추가:

```json
[
  "expo-speech-recognition",
  {
    "microphonePermission": "챗봇에게 음성으로 질문하기 위해 마이크를 사용합니다.",
    "speechRecognitionPermission": "음성 질문을 글자로 바꾸기 위해 음성 인식을 사용합니다."
  }
]
```

- [ ] **Step 3: 실패하는 테스트 작성 — 순수 로직(`conversation.ts`)**

```js
// frontend/tests/chat-conversation.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequestBody, trimHistory } from '../src/lib/chat/conversation.ts';

test('trimHistory는 최근 N개만 남긴다', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `${i}` }));
  const trimmed = trimHistory(history, 6);
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[0].text, '4');
  assert.equal(trimmed[5].text, '9');
});

test('buildRequestBody는 위치가 있으면 lat/lon을 포함한다', () => {
  const body = buildRequestBody('질문', [], { lat: 37.5, lng: 127.0 });
  assert.deepEqual(body, { message: '질문', history: [], lat: 37.5, lon: 127.0 });
});

test('buildRequestBody는 위치가 없으면 lat/lon을 생략한다', () => {
  const body = buildRequestBody('질문', [], null);
  assert.deepEqual(body, { message: '질문', history: [] });
});
```

- [ ] **Step 4: 테스트 실행해서 실패 확인**

Run: `cd frontend && npm test 2>&1 | grep -A5 chat-conversation`
Expected: FAIL (모듈 없음)

- [ ] **Step 5: `frontend/src/lib/chat/conversation.ts` 구현**

```ts
import type { RoutePoint } from '../../map/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

// shortcut: 최근 6개(3턴)만 보낸다. 더 긴 맥락이 필요해지면 서버 쪽 요약(compaction)으로 올려야 한다.
export function trimHistory(history: ChatTurn[], max = 6): ChatTurn[] {
  return history.slice(-max);
}

export function buildRequestBody(message: string, history: ChatTurn[], origin: RoutePoint | null) {
  return {
    message,
    history: trimHistory(history),
    ...(origin ? { lat: origin.lat, lon: origin.lng } : {}),
  };
}
```

- [ ] **Step 6: 테스트 실행해서 통과 확인**

Run: `cd frontend && npm test 2>&1 | grep -A5 chat-conversation`
Expected: PASS (3 tests)

- [ ] **Step 7: `frontend/src/lib/chat/api.ts` 구현**

```ts
import { createApiClient, type RequestOptions } from '../api/client';
import { API_BASE_URL } from '../config';
import type { ChatTurn } from './conversation';

const client = createApiClient({ baseUrl: API_BASE_URL });

export const chatApi = {
  send: (body: { message: string; history: ChatTurn[]; lat?: number; lon?: number }, options?: RequestOptions) =>
    client.post<{ reply: string }>('/api/chat', body, options),
};
```

- [ ] **Step 8: `frontend/src/lib/chat/useChatAssistant.ts` 구현**

`buildRequestBody`로 요청을 만들고 `chatApi.send`를 호출해 `messages`에 user/assistant 턴을 추가하는 훅. 응답을 받으면 `resolveVoiceId` + `Speech.speak`로 읽어준다. `ExpoSpeechRecognitionModule.requestPermissionsAsync()` → `start({lang, interimResults:false, continuous:false})`로 듣기 시작, `useSpeechRecognitionEvent('result', ...)`에서 최종 transcript를 받으면 그 텍스트로 바로 `send()`를 호출한다(핸즈프리). `getCurrentLocation()`으로 매 전송 시 현재 위치를 가져온다. 정확한 타입은 Step 1~7의 시그니처를 따른다. 네이티브 모듈을 직접 쓰는 훅이라 이 파일 자체는 단위 테스트하지 않는다(Global Constraints 참고).

- [ ] **Step 9: 타입체크**

Run: `cd frontend && npm run typecheck`
Expected: 오류 없음

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/app.json frontend/src/lib/chat frontend/tests/chat-conversation.test.mjs
git commit -m "feat: 챗봇 대화 로직(API 클라이언트·훅) 추가"
```

---

### Task 4: 홈 화면 UI 연동 (버튼 + 패널 + i18n)

**Files:**
- Create: `frontend/src/components/chat/ChatAssistantPanel.tsx`
- Modify: `frontend/app/index.tsx` (버튼 추가, 패널 상태·렌더링)
- Modify: `frontend/src/i18n/locales/ko.ts`, `en.ts`, `zh.ts` (`chat` 네임스페이스 추가)

**Interfaces:**
- Consumes: Task 3의 `useChatAssistant()`; `frontend/src/components/ui/{RoundButton,BottomSheet}`; `lucide-react-native`의 `MessageCircle`, `Mic`, `Send`, `X`
- Produces: 홈 화면에 보이는 챗봇 버튼과 패널 (이후 작업에서 참조할 인터페이스 없음 — 최종 UI)

- [ ] **Step 1: i18n 키 추가**

`ko.ts`에 (다른 네임스페이스와 같은 위치에) 추가:

```ts
chat: {
  openLabel: '챗봇에게 물어보기',
  closeLabel: '챗봇 닫기',
  title: '티끌모아 챗봇',
  placeholder: '무엇이든 물어보세요',
  send: '보내기',
  mic: '음성으로 묻기',
  listening: '듣고 있어요…',
  sending: '답변 중…',
  error: '답변을 받지 못했어요. 다시 시도해 주세요.',
},
```

`en.ts`/`zh.ts`에 동일 키를 영어/중국어로 번역해 추가.

- [ ] **Step 2: `frontend/src/components/chat/ChatAssistantPanel.tsx` 구현**

`BottomSheet(draggable=false)` 안에 메시지 목록(`ScrollView` + 말풍선 `Text`), 하단에 `TextInput` + 보내기 `RoundButton`(아이콘 `Send`) + 마이크 `RoundButton`(아이콘 `Mic`, `listening`이면 `variant="brand"`), 상단에 닫기 `RoundButton`(아이콘 `X`). `useChatAssistant()`가 반환하는 `messages/sending/listening/send/startListening/stopListening`만 사용. `windowHeight`/`bottomInset`은 `index.tsx`가 다른 시트에 쓰는 것과 같은 값을 props로 받는다.

- [ ] **Step 3: `frontend/app/index.tsx`에 버튼과 패널 연동**

945번째 줄 `fabWrap` 안, 기존 `RoundButton`(`Crosshair`, `map.myLocation`) 바로 아래에:

```tsx
<RoundButton icon={MessageCircle} label={t('chat.openLabel')} onPress={() => { onResetSearch(); setChatOpen(true); }} />
```

`MessageCircle`을 15~32번째 줄의 lucide import 목록에 추가. 컴포넌트 최상단에 `const [chatOpen, setChatOpen] = useState(false);` 추가. 기존 시트 분기(`nearbyCategory ? ... : pickedPoint ? ...`) 체인 끝에 `: chatOpen ? (<BottomSheet key="chat" {...sheetProps} draggable={false}><ChatAssistantPanel onClose={() => setChatOpen(false)} windowHeight={windowHeight} bottomInset={bottomInset} /></BottomSheet>) : null` 추가.

- [ ] **Step 4: 웹에서 수동 확인**

Run: `cd frontend && npm run web`
Expected: 홈 화면에 "내 위치로 이동" 버튼 아래 챗봇 버튼이 보이고, 누르면 패널이 열리며, 질문을 타이핑해 보내면 답이 온다(백엔드에 `ANTHROPIC_API_KEY` 없으면 `chat.error` 메시지가 보이는 것도 정상). 닫기 버튼으로 패널이 닫힌다.

- [ ] **Step 5: 타입체크 + 프런트엔드 전체 테스트 회귀 확인**

Run: `cd frontend && npm run typecheck && npm test`
Expected: 오류 없음, 기존 테스트 모두 PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat frontend/app/index.tsx frontend/src/i18n/locales
git commit -m "feat: 홈 화면에 챗봇 버튼·패널 연동"
```
