import asyncio

import anthropic
import httpx

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


def test_nearby_protection_zones_summarizes_instead_of_dumping_everything():
    import json
    from types import SimpleNamespace

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
        FakeResponse([ToolUseBlock("t1", "nearby_protection_zones", {})], "tool_use"),
        FakeResponse([TextBlock("어린이보호구역 3곳, 노인보호구역 1곳이 있어요.")], "end_turn"),
    ])
    svc = ChatService(client, ZonedService())
    reply = asyncio.run(svc.reply("보호구역 있어?", [], 37.5, 127.0))
    assert reply == "어린이보호구역 3곳, 노인보호구역 1곳이 있어요."

    tool_result = client.messages.calls[1]["messages"][-1]["content"][0]["content"]
    payload = json.loads(tool_result)
    assert payload["total"] == 4
    assert payload["by_type"] == {"child": 3, "senior": 1}
    assert len(payload["sample"]) <= 5


def test_gives_up_after_max_tool_iterations():
    responses = [FakeResponse([ToolUseBlock("t1", "nearby_incidents", {})], "tool_use") for _ in range(10)]
    client = FakeClient(responses)
    svc = ChatService(client, FakeTrafficService())
    reply = asyncio.run(svc.reply("위험구간?", [], 37.5, 127.0))
    assert reply == "답변을 만들지 못했어요. 다시 물어봐 주세요."
    assert len(client.messages.calls) == 4


class FailingMessages:
    async def create(self, **kwargs):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))


class FailingClient:
    def __init__(self):
        self.messages = FailingMessages()


def test_anthropic_api_error_becomes_chat_unavailable():
    from app.errors import ApiError

    svc = ChatService(FailingClient(), FakeTrafficService())
    try:
        asyncio.run(svc.reply("안녕", [], None, None))
        assert False, "should have raised"
    except ApiError as exc:
        assert exc.code == "CHAT_UNAVAILABLE"
