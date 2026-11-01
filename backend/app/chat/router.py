from typing import List, Optional

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
