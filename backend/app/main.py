from fastapi import FastAPI

from app.api.auth import router as auth_router


def create_app() -> FastAPI:
    app = FastAPI(title="Insight2Redraft API")
    app.include_router(auth_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
