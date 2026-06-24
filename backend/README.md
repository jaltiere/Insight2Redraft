# Insight2Redraft — Backend

FastAPI + SQLAlchemy + Postgres backend for the cross-league fantasy platform.

## Local setup

1. Start Postgres and create databases (see plan prerequisite, or use your own):

   ```bash
   docker run --name i2r-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
     -p 5432:5432 -d postgres:16
   docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft;"
   docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft_test;"
   ```

2. Copy env and install deps:

   ```bash
   cp .env.example .env
   uv sync
   ```

3. Apply migrations and run:

   ```bash
   uv run alembic upgrade head
   uv run uvicorn app.main:app --reload
   ```

   Health check: http://localhost:8000/health

## Tests

```bash
uv run pytest -v
```

## Deployment (Railway)

- The service builds with Nixpacks (auto-detected from `pyproject.toml` + `uv.lock`).
- `railway.json` runs `alembic upgrade head` as the pre-deploy command, then starts uvicorn.
- Set `DATABASE_URL` in the Railway service to the provided Postgres plugin URL
  (use the `postgresql+psycopg://` driver prefix).
