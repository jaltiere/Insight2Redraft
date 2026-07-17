import os

from fastapi import FastAPI

from app.api.admin.seasons import router as admin_seasons_router
from app.api.auth import router as auth_router
from app.api.leagues import router as leagues_router
from app.api.owners import router as owners_router
from app.api.seasons import router as seasons_router
from app.config import settings


_INSECURE_JWT_SECRET_DEFAULT = "dev-insecure-change-me"


def create_app() -> FastAPI:
    # Fail loudly if jwt_secret is still the dev default in production
    if os.environ.get("ENVIRONMENT") == "production":
        if settings.jwt_secret == _INSECURE_JWT_SECRET_DEFAULT:
            raise RuntimeError(
                "JWT_SECRET environment variable must be set to a secure value in production. "
                "The current jwt_secret is the insecure dev default. "
                "Please set the JWT_SECRET environment variable before starting the app."
            )
    app = FastAPI(title="Insight2Redraft API")
    app.include_router(auth_router)
    app.include_router(seasons_router)
    app.include_router(leagues_router)
    app.include_router(owners_router)
    app.include_router(admin_seasons_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
