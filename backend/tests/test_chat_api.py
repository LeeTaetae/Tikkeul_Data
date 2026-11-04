import httpx

from tests.conftest import make_settings


class FakeChatService:
    def __init__(self, reply_text="안녕하세요"):
        self.reply_text = reply_text
        self.calls = []

    async def reply(self, message, history, lat, lon, language="ko"):
        self.calls.append((message, history, lat, lon, language))
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
    assert fake.calls == [("위험구간 있어?", [], 37.5, 127.0, "ko")]


def test_chat_endpoint_without_key_returns_not_configured(make_client):
    client = make_client(_no_upstream_calls, make_settings(gemini_api_key=None))
    response = client.post("/api/chat", json={"message": "안녕", "history": []})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "NOT_CONFIGURED"


def test_chat_endpoint_rejects_oversized_message(make_client):
    client = make_client(_no_upstream_calls)
    client.app.state.chat_service = FakeChatService()
    response = client.post("/api/chat", json={"message": "a" * 501, "history": []})
    assert response.status_code == 422


def test_chat_endpoint_rejects_oversized_history(make_client):
    client = make_client(_no_upstream_calls)
    client.app.state.chat_service = FakeChatService()
    history = [{"role": "user", "text": "hi"} for _ in range(7)]
    response = client.post("/api/chat", json={"message": "안녕", "history": history})
    assert response.status_code == 422
