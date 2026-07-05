from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft"
    test_database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft_test"
    worker_interval_active: float = 180.0
    worker_interval_in_season: float = 1800.0
    worker_interval_idle: float = 21600.0
    worker_players_sync_hours: float = 24.0
    jwt_secret: str = "dev-insecure-change-me"
    access_token_expire_minutes: float = 720.0


settings = Settings()
