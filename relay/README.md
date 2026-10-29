# relay (ITS 중계 서버)

Render 에서는 ITS(`openapi.its.go.kr:9443`)에 연결되지 않는다(Render 와 Vercel 서울 리전 모두 TCP 시간 초과, 한국 가정용 IP 는 연결됨).
그래서 **한국 PC 가 대신 호출**하고, Render 는 이 서버를 `ITS_BASE_URL` 로 부른다. 파싱·캐시·응답 스키마는 `backend/` 가 그대로 맡는다.

```
Render FastAPI --https--> Cloudflare Tunnel --> 이 서버(127.0.0.1:8787) --> ITS:9443
```

개발·시연용이다. PC 가 꺼지거나 절전에 들어가면 중단되고, Quick Tunnel 은 켤 때마다 URL 이 바뀐다.

## 동작

- `GET /{eventInfo|posIncidentInfo|trafficInfo|bypassFCastInfo}?<ITS 쿼리>` 만 처리한다. 그 밖의 경로·메서드는 404/405.
- 인증은 `X-Relay-Token` 헤더(`RELAY_TOKEN` 과 같아야 함). 틀리면 이유 없이 404. 쿼리·경로로 보낸 토큰은 인정하지 않는다.
- 호출자가 보낸 `apiKey` 는 버리고, 이 PC 의 `relay/.env` 키로 바꿔서 ITS 에 보낸다.
- ITS 응답 본문·상태 코드는 그대로 돌려준다. ITS 연결 실패는 504/502 JSON.
- `127.0.0.1` 에만 바인딩. 토큰·키·쿼리(좌표)는 로그에 남기지 않는다.

## 실행 (저장소 루트에서)

```bash
# 1) 최초 1회: relay/.env 를 만든다(.env.example 참고). RELAY_TOKEN 은 24자 이상 무작위 문자열.
# 2) 중계 서버
backend/.venv/Scripts/python relay/its_relay.py
# 3) Quick Tunnel (다른 터미널). 출력된 https://<무작위>.trycloudflare.com 이 중계 주소다.
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

테스트: `cd relay && ../backend/.venv/Scripts/python -m pytest` (네트워크·실제 키 사용 안 함)

## Render 연동 (backend 쪽)

`backend/` 는 `ITS_RELAY_URL` 이 설정되면 이 서버를 거쳐 ITS 를 호출한다(설정이 없으면 ITS 로 직접 호출).

- Render 환경변수: `ITS_RELAY_URL=https://<터널 주소>`(끝에 `/` 없이), `ITS_RELAY_TOKEN=<relay/.env 의 RELAY_TOKEN>`.
- 이 모드에서 backend 는 ITS 키를 보내지 않고 `X-Relay-Token` 헤더로만 인증한다. Render 의 `ITS_*_API_KEY` 는 지우지 않고 그대로 둔다(되돌릴 때 필요).
- Quick Tunnel 은 URL 이 바뀔 때마다 `ITS_RELAY_URL` 을 고치고 서비스를 다시 시작해야 한다.
- 되돌리기: Render 에서 `ITS_RELAY_URL`(과 `ITS_RELAY_TOKEN`)을 지우면 직접 호출로 돌아간다. 단, Render 에서는 ITS 직접 호출이 연결되지 않으므로 돌발정보·주의운전구간 등은 다시 504 가 된다.

## 보안

- `relay/.env` 는 `.gitignore`(`.env`) 로 제외된다. `.env.example` 에는 변수명만 있다.
- 토큰이 새면 `relay/.env` 의 `RELAY_TOKEN` 을 바꾸고 중계를 다시 시작한 뒤 Render 값도 바꾼다.
- 터널 주소는 토큰 없이는 404 만 돌려주지만, 주소 자체도 공개하지 않는다.
