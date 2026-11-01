from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.chat.models import ChatMessage
from app.chat.service import ChatService
from app.errors import api_error

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
