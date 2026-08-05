import os

from fastapi import FastAPI

from app.api.admin.accounts import router as admin_accounts_router
from app.api.admin.bracket import router as admin_bracket_router
from app.api.admin.leagues import router as admin_leagues_router
from app.api.admin.mapping import router as admin_mapping_router
from app.api.admin.owners import router as admin_owners_router
from app.api.admin.seasons import router as admin_seasons_router
from app.api.admin.sync import router as admin_sync_router
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
    app.include_router(admin_leagues_router)
    app.include_router(admin_owners_router)
    app.include_router(admin_mapping_router)
    app.include_router(admin_sync_router)
    app.include_router(admin_accounts_router)
    app.include_router(admin_bracket_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
