from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import geocode_router
from .routers import router as navigation_router

app = FastAPI(title="hybrid-navigation-poc")
# PoC: Expo Web 개발 서버(localhost:8081)에서만 호출하므로 폭넓게 허용하지 않는다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://127.0.0.1:8081"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(navigation_router)
app.include_router(geocode_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
