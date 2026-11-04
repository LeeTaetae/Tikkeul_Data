import asyncio
import json
from types import SimpleNamespace

from google.genai import errors

from app.chat.models import ChatMessage
from app.chat.service import ChatService


class FakeCall:
    def __init__(self, name):
        self.name = name


class FakeResponse:
    def __init__(self, function_calls, text):
        self.function_calls = function_calls
        self.text = text
        self.candidates = [SimpleNamespace(content="<model-turn>")]


class FakeModels:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


class FakeAio:
    def __init__(self, responses):
        self.models = FakeModels(responses)


class FakeClient:
    def __init__(self, responses):
        self.aio = FakeAio(responses)

    @property
    def calls(self):
        return self.aio.models.calls


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


def _tool_result(fake_client, call_index):
    """두 번째 이후 generate_content 호출에 실린 함수 응답(결과 문자열)을 꺼낸다."""
    contents = fake_client.calls[call_index]["contents"]
    return contents[-1].parts[0].function_response.response["result"]


def test_general_question_answers_without_tool_call():
    client = FakeClient([FakeResponse([], "보호구역은 ...")])
    fake_service = FakeTrafficService()
    svc = ChatService(client, fake_service)
    reply = asyncio.run(svc.reply("보호구역이 뭐야?", [], None, None))
    assert reply == "보호구역은 ..."
    assert fake_service.incidents_calls == []


def test_language_defaults_to_korean_instruction():
    client = FakeClient([FakeResponse([], "ok")])
    svc = ChatService(client, FakeTrafficService())
    asyncio.run(svc.reply("hi", [], None, None))
    assert "한국어로 답하세요" in client.calls[0]["config"].system_instruction


def test_language_en_adds_english_instruction():
    client = FakeClient([FakeResponse([], "ok")])
    svc = ChatService(client, FakeTrafficService())
    asyncio.run(svc.reply("hi", [], None, None, "en"))
    assert "Respond to the user in English" in client.calls[0]["config"].system_instruction


def test_language_zh_adds_chinese_instruction():
    client = FakeClient([FakeResponse([], "ok")])
    svc = ChatService(client, FakeTrafficService())
    asyncio.run(svc.reply("hi", [], None, None, "zh"))
    assert "请用中文回答" in client.calls[0]["config"].system_instruction


def test_realtime_question_calls_incidents_tool():
    client = FakeClient([
        FakeResponse([FakeCall("nearby_incidents")], None),
        FakeResponse([], "근처에 공사가 있어요."),
    ])
    fake_service = FakeTrafficService()
    svc = ChatService(client, fake_service)
    reply = asyncio.run(svc.reply("지금 이 길 위험구간 있어?", [], 37.5, 127.0))
    assert reply == "근처에 공사가 있어요."
    assert len(fake_service.incidents_calls) == 1
    bbox = fake_service.incidents_calls[0]
    assert round(bbox.min_lat, 2) == 37.49 and round(bbox.max_lat, 2) == 37.51


def test_missing_location_skips_service_call():
    client = FakeClient([
        FakeResponse([FakeCall("nearby_incidents")], None),
        FakeResponse([], "위치가 필요해요."),
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
        FakeResponse([FakeCall("nearby_protection_zones")], None),
        FakeResponse([], "국내 위치가 아니에요."),
    ])
    svc = ChatService(client, RaisingService())
    reply = asyncio.run(svc.reply("보호구역 있어?", [], 1.0, 1.0))
    assert reply == "국내 위치가 아니에요."


def test_nearby_protection_zones_summarizes_instead_of_dumping_everything():
    zones = (
        [SimpleNamespace(name=f"어린이보호구역{i}", zone_type=SimpleNamespace(value="child")) for i in range(3)]
        + [SimpleNamespace(name="노인보호구역1", zone_type=SimpleNamespace(value="senior"))]
    )

    class ZonedService(FakeTrafficService):
        async def region(self, lat, lon):
            return SimpleNamespace(sgg_cd="41135")

        async def protection_zones(self, sgg_cd, include_geometry=False):
            return zones, None

    client = FakeClient([
        FakeResponse([FakeCall("nearby_protection_zones")], None),
        FakeResponse([], "어린이보호구역 3곳, 노인보호구역 1곳이 있어요."),
    ])
    svc = ChatService(client, ZonedService())
    reply = asyncio.run(svc.reply("보호구역 있어?", [], 37.5, 127.0))
    assert reply == "어린이보호구역 3곳, 노인보호구역 1곳이 있어요."

    payload = json.loads(_tool_result(client, 1))
    assert payload["total"] == 4
    assert payload["by_type"] == {"child": 3, "senior": 1}
    assert len(payload["sample"]) <= 5


def test_gives_up_after_max_tool_iterations():
    responses = [FakeResponse([FakeCall("nearby_incidents")], None) for _ in range(10)]
    client = FakeClient(responses)
    svc = ChatService(client, FakeTrafficService())
    reply = asyncio.run(svc.reply("위험구간?", [], 37.5, 127.0))
    assert reply == "답변을 만들지 못했어요. 다시 물어봐 주세요."
    assert len(client.calls) == 4


class FailingModels:
    async def generate_content(self, **kwargs):
        raise errors.APIError(503, {"error": {"message": "unavailable"}})


class FailingAio:
    def __init__(self):
        self.models = FailingModels()


class FailingClient:
    def __init__(self):
        self.aio = FailingAio()


def test_gemini_api_error_becomes_chat_unavailable():
    from app.errors import ApiError

    svc = ChatService(FailingClient(), FakeTrafficService())
    try:
        asyncio.run(svc.reply("안녕", [], None, None))
        assert False, "should have raised"
    except ApiError as exc:
        assert exc.code == "CHAT_UNAVAILABLE"
