# Insight2Redraft — Frontend

React + TypeScript SPA (Vite) for the Insight2Redraft cross-league fantasy platform. Consumes the backend API under `backend/`.

## Stack
Vite, React, TypeScript, Tailwind CSS v4, shadcn/ui, React Router, TanStack Query. Tests: Vitest + React Testing Library + MSW. Lint: ESLint (flat config).

## Develop
```bash
npm install
npm run dev      # dev server (proxies /api -> http://localhost:8000)
npm test         # vitest
npm run build    # tsc -b && vite build
npm run lint     # eslint .
```

Set the API base via `VITE_API_BASE_URL` (see `.env.example`). In dev it defaults to `/api`, proxied to the backend.
