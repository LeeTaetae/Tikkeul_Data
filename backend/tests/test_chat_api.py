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
