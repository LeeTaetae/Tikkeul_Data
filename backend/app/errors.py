from typing import Dict, Tuple


class ApiError(Exception):
    """프런트엔드로 내보내는 오류. 메시지에 URL·키·좌표를 넣지 않는다."""

    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(code)
        self.code = code
        self.message = message
        self.status_code = status_code


_ERRORS: Dict[str, Tuple[int, str]] = {
    "NOT_CONFIGURED": (503, "서버에 이 API의 인증키가 설정되지 않았습니다."),
    "UPSTREAM_AUTH": (502, "공공 API 인증에 실패했습니다. 서버의 인증키 설정을 확인해야 합니다."),
    "UPSTREAM_RATE_LIMIT": (503, "공공 API 사용량 제한에 도달했습니다. 잠시 후 다시 시도해 주세요."),
    "UPSTREAM_TIMEOUT": (504, "공공 API 응답이 지연되고 있습니다."),
    "UPSTREAM_UNAVAILABLE": (503, "공공 API에 연결하지 못했습니다."),
    "UPSTREAM_BAD_REQUEST": (502, "공공 API가 요청을 거부했습니다."),
    "UPSTREAM_BAD_RESPONSE": (502, "공공 API 응답을 해석하지 못했습니다."),
    "UPSTREAM_ERROR": (502, "공공 API가 오류를 반환했습니다."),
    "REGION_NOT_FOUND": (404, "이 좌표의 시군구를 확인할 수 없습니다. 국내 위치가 아닐 수 있습니다."),
    "INVALID_CREDENTIALS": (401, "이메일 또는 비밀번호가 올바르지 않습니다."),
    "EMAIL_TAKEN": (409, "이미 가입된 이메일입니다."),
    "UNAUTHORIZED": (401, "로그인이 필요합니다."),
    "EMAIL_ALREADY_VERIFIED": (409, "이미 인증된 이메일입니다."),
    "EMAIL_SEND_FAILED": (502, "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요."),
    "TOO_MANY_REQUESTS": (429, "잠시 후에 다시 시도해 주세요."),
    "INVALID_CODE": (400, "인증번호가 올바르지 않거나 만료됐습니다."),
    "EMAIL_NOT_VERIFIED": (400, "이메일 인증을 먼저 완료해 주세요."),
    "FAVORITE_NOT_FOUND": (404, "즐겨찾기를 찾을 수 없습니다."),
    "FAVORITE_KIND_TAKEN": (409, "집/회사는 하나만 등록할 수 있습니다. 기존 항목을 수정해 주세요."),
    "CHAT_UNAVAILABLE": (503, "챗봇 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."),
    "SOCIAL_LOGIN_FAILED": (502, "소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."),
}


def api_error(code: str) -> ApiError:
    status_code, message = _ERRORS[code]
    return ApiError(code, message, status_code)
