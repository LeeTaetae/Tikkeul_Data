from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.chat.models import ChatMessage
from app.chat.service import ChatService
from app.errors import api_error

router = APIRouter(prefix="/api/chat", tags=["chat"])

# 프런트엔드 trimHistory() 의 상한(6개)과 맞춘다. 인증 없는 공개 엔드포인트라 신뢰 경계에서 길이를 막아
# 과도한 토큰 사용(비용)과 지연을 막는다.
_MAX_HISTORY = 6
_MAX_MESSAGE_LENGTH = 500


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=_MAX_MESSAGE_LENGTH)
    history: List[ChatMessage] = Field(default_factory=list, max_length=_MAX_HISTORY)
    lat: Optional[float] = None
    lon: Optional[float] = None
    # 프런트 i18n 언어(ko/en/zh). 안 보내면(옛 클라이언트) 한국어로 답한다.
    language: Literal["ko", "en", "zh"] = "ko"


class ChatReply(BaseModel):
    reply: str


def get_chat_service(request: Request) -> Optional[ChatService]:
    return getattr(request.app.state, "chat_service", None)


@router.post("", response_model=ChatReply)
async def chat(body: ChatRequest, request: Request, chat_service: Optional[ChatService] = Depends(get_chat_service)) -> ChatReply:
    if chat_service is None:
        raise api_error("NOT_CONFIGURED")
    # 인증 없는 공개 엔드포인트라 IP당 호출 빈도를 막아 Gemini 비용 남용(DoS)을 막는다.
    client_ip = request.client.host if request.client else "unknown"
    if not request.app.state.chat_rate_limiter.try_attempt(client_ip):
        raise api_error("TOO_MANY_REQUESTS")
    reply = await chat_service.reply(body.message, body.history, body.lat, body.lon, body.language)
    return ChatReply(reply=reply)
