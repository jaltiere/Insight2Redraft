# Running Insight2Redraft locally

Two services: the **backend** (FastAPI, port `8000`) and the **frontend** (Vite
dev server, port `5173`). The frontend proxies `/api/*` to the backend, so start
the backend first.

## Prerequisites

- **Backend:** [`uv`](https://docs.astral.sh/uv/), Docker (for Postgres).
- **Frontend:** Node + npm.

## 1. Backend (FastAPI) — port 8000

Run from `backend/`. First-time setup:

```bash
# Postgres (skip if you already have one running on :5432)
docker run --name i2r-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  -p 5432:5432 -d postgres:16
docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft;"
docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft_test;"

cp .env.example .env      # then edit .env if your DB URL differs
uv sync                   # install deps
uv run alembic upgrade head
```

Start the API (auto-reload on change):

```bash
uv run uvicorn app.main:app --reload
```

- API: http://localhost:8000
- Health check: http://localhost:8000/health
- Interactive API docs: http://localhost:8000/docs

On later runs you only need `docker start i2r-pg` (if stopped) and the
`uvicorn` command — setup steps are one-time.

### Optional: the sync worker

The background worker (Sleeper sync + live playoff scores) is a separate process.
It's **not** needed to browse the app; start it only when you want live/sync data:

```bash
uv run python -m app.worker
```

### Backend tests

```bash
uv run pytest -v
```

## 2. Frontend (Vite + React) — port 5173

Run from `frontend/`. First-time setup:

```bash
npm install
cp .env.example .env       # sets VITE_API_BASE_URL=/api (the dev proxy target)
```

Start the dev server:

```bash
npm run dev
```

- App: http://localhost:5173

The dev server proxies `/api/*` → `http://localhost:8000` (stripping the `/api`
prefix), so no CORS config is needed — just have the backend running.

### Backend on a different port

If `:8000` is taken (e.g. another app is using it), run the backend on another
port and point the proxy at it via `API_PROXY_TARGET`:

```bash
# backend
uv run uvicorn app.main:app --reload --port 8123

# frontend (proxy target override; default stays :8000)
API_PROXY_TARGET=http://localhost:8123 npm run dev
```

> **WSL / `/mnt/*` drives:** Vite's file watching is unreliable on Windows-mounted
> drives. If edits don't hot-reload, start with polling:
> ```bash
> CHOKIDAR_USEPOLLING=true npm run dev
> ```
> or just restart the dev server after edits.

### Frontend checks

```bash
npm test            # Vitest (no backend needed — uses MSW mocks)
npm run build       # tsc + vite build
npm run lint        # ESLint
```

## Quick start (already set up)

```bash
# terminal 1 — backend
cd backend && uv run uvicorn app.main:app --reload

# terminal 2 — frontend
cd frontend && npm run dev
```

Then open http://localhost:5173. (Data-backed pages will show loading/empty
states until the database is seeded and, for live scores, the worker is running.)
