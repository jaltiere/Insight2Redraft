# Frontend Theme & Design System (FE-1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the frontend a clean, modern-sporty Broadcast Blue theme in light + dark, with a real theme toggle, a themed app shell, and the seasons + login pages re-skinned — the design foundation FE-1's pages build on.

**Architecture:** Map the brand onto the existing shadcn `oklch` CSS-variable tokens in `src/index.css` (light `:root` + `.dark`), add a `--highlight` (amber) brand-accent token, and a validated categorical `--chart-1..5` palette. Add a `ThemeProvider`/`useTheme` (light/dark/system, persisted, toggles `.dark` on `<html>`) and header toggle. Upgrade `PublicLayout` and re-skin `SeasonsPage`/`LoginPage` with shadcn components. No backend changes.

**Tech Stack:** the FE-0 frontend (Vite 8, React 19, TS, Tailwind v4, shadcn/ui, React Router 7, TanStack Query, Vitest + RTL + MSW), lucide-react icons.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-frontend-theme-design.md`. Deviations need sign-off.
- **All commands run from `frontend/`.** Node 22 / npm 10. Tests are Vitest — no backend needed.
- Gate at the END of each task: `npm run build`, `npm test`, `npm run lint` all pass.
- Type-safe; no `any`. Keep the FE-0 infra (absolute `.env.test`, `jsdom.url`, type-only imports).
- **shadcn `--accent` stays neutral** (it's the component hover background) — the amber brand accent is a NEW `--highlight` token. Don't repurpose `--accent`.
- The chart palette values are **validated** (dataviz skill) — use them exactly; don't re-pick.
- Preserve behavior: the FE-0 auth flow and `useSeasons` query are unchanged; existing tests keep passing (update only for markup/label changes).
- Put React context objects in their OWN module (not co-exported with a component) to avoid the `react-refresh/only-export-components` lint (learned from FE-0).

## File Structure

- Modify: `src/index.css`, `src/main.tsx`, `src/layouts/PublicLayout.tsx`, `src/pages/SeasonsPage.tsx`, `src/pages/LoginPage.tsx`, `vitest.setup.ts`, `src/pages/SeasonsPage.test.tsx`, `src/auth/auth.test.tsx` (login markup)
- Create: `src/theme/theme-context.ts`, `src/theme/ThemeProvider.tsx`, `src/theme/useTheme.ts`, `src/components/theme-toggle.tsx`, `src/components/PageHeader.tsx`, `src/components/ui/badge.tsx` (shadcn add), `src/theme/theme.test.tsx`

---

### Task 1: Brand tokens + theme system (provider, toggle)

**Files:**
- Modify: `src/index.css`, `src/main.tsx`, `vitest.setup.ts`
- Create: `src/theme/theme-context.ts`, `src/theme/ThemeProvider.tsx`, `src/theme/useTheme.ts`, `src/components/theme-toggle.tsx`, `src/theme/theme.test.tsx`

**Interfaces produced:** brand `oklch` tokens (light + dark) with `--highlight` + validated `--chart-1..5`; `ThemeContext`/`Theme`; `ThemeProvider`; `useTheme() -> {theme, resolvedTheme, setTheme}`; `<ThemeToggle/>`.

- [ ] **Step 1: Apply the brand tokens in `src/index.css`**

Add two lines to the `@theme inline { … }` block (so `bg-highlight`/`text-highlight` work), right after the `--color-accent-foreground` line:

```css
    --color-highlight: var(--highlight);
    --color-highlight-foreground: var(--highlight-foreground);
```

Replace the **`:root`** block's color values with (keep `--radius` and the sidebar lines; add `--highlight*`):

```css
:root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.208 0.042 265.75);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.208 0.042 265.75);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.208 0.042 265.75);
    --primary: #2563eb;
    --primary-foreground: oklch(0.984 0.003 247.86);
    --secondary: oklch(0.968 0.007 247.9);
    --secondary-foreground: oklch(0.208 0.042 265.75);
    --muted: oklch(0.968 0.007 247.9);
    --muted-foreground: oklch(0.554 0.041 257.4);
    --accent: oklch(0.968 0.007 247.9);
    --accent-foreground: oklch(0.208 0.042 265.75);
    --highlight: #f59e0b;
    --highlight-foreground: oklch(0.208 0.042 265.75);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.929 0.013 255.5);
    --input: oklch(0.929 0.013 255.5);
    --ring: #2563eb;
    --chart-1: #2563eb;
    --chart-2: #d97706;
    --chart-3: #0d9488;
    --chart-4: #8b5cf6;
    --chart-5: #f43f5e;
    --radius: 0.625rem;
    --sidebar: oklch(0.984 0.003 247.86);
    --sidebar-foreground: oklch(0.208 0.042 265.75);
    --sidebar-primary: #2563eb;
    --sidebar-primary-foreground: oklch(0.984 0.003 247.86);
    --sidebar-accent: oklch(0.968 0.007 247.9);
    --sidebar-accent-foreground: oklch(0.208 0.042 265.75);
    --sidebar-border: oklch(0.929 0.013 255.5);
    --sidebar-ring: #2563eb;
}
```

Replace the **`.dark`** block's color values with:

```css
.dark {
    --background: oklch(0.208 0.042 265.75);
    --foreground: oklch(0.984 0.003 247.86);
    --card: oklch(0.279 0.041 260);
    --card-foreground: oklch(0.984 0.003 247.86);
    --popover: oklch(0.279 0.041 260);
    --popover-foreground: oklch(0.984 0.003 247.86);
    --primary: #3b82f6;
    --primary-foreground: oklch(0.984 0.003 247.86);
    --secondary: oklch(0.279 0.041 260);
    --secondary-foreground: oklch(0.984 0.003 247.86);
    --muted: oklch(0.279 0.041 260);
    --muted-foreground: oklch(0.704 0.04 256.8);
    --accent: oklch(0.279 0.041 260);
    --accent-foreground: oklch(0.984 0.003 247.86);
    --highlight: #f59e0b;
    --highlight-foreground: oklch(0.208 0.042 265.75);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: #3b82f6;
    --chart-1: #3b82f6;
    --chart-2: #d97706;
    --chart-3: #0d9488;
    --chart-4: #8b5cf6;
    --chart-5: #f43f5e;
    --sidebar: oklch(0.279 0.041 260);
    --sidebar-foreground: oklch(0.984 0.003 247.86);
    --sidebar-primary: #3b82f6;
    --sidebar-primary-foreground: oklch(0.984 0.003 247.86);
    --sidebar-accent: oklch(0.279 0.041 260);
    --sidebar-accent-foreground: oklch(0.984 0.003 247.86);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: #3b82f6;
}
```

Leave `@import`, `@custom-variant`, the `@theme inline` radius lines, and the `@layer base` block unchanged.

- [ ] **Step 2: Add the matchMedia polyfill for tests**

jsdom has no `matchMedia`. In `vitest.setup.ts`, add `vi` to the existing `import { afterAll, afterEach, beforeAll } from "vitest";` line (→ `import { afterAll, afterEach, beforeAll, vi } from "vitest";`), then append this block (no new import — keeps eslint `import/first` happy):

```ts
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
```

- [ ] **Step 3: Write the failing theme tests**

Create `src/theme/theme.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span>theme:{theme}</span>
      <span>resolved:{resolvedTheme}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("light")}>light</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

test("defaults to system and resolves to light (matchMedia stub matches=false)", () => {
  renderProbe();
  expect(screen.getByText("theme:system")).toBeInTheDocument();
  expect(screen.getByText("resolved:light")).toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("setTheme('dark') adds the .dark class and persists", async () => {
  renderProbe();
  await userEvent.click(screen.getByRole("button", { name: "dark" }));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("i2r_theme")).toBe("dark");
});

test("setTheme('light') removes the .dark class", async () => {
  renderProbe();
  await userEvent.click(screen.getByRole("button", { name: "dark" }));
  await userEvent.click(screen.getByRole("button", { name: "light" }));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("applies a stored preference on mount", () => {
  localStorage.setItem("i2r_theme", "dark");
  renderProbe();
  expect(screen.getByText("theme:dark")).toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- theme`
Expected: FAIL — `Cannot find module '@/theme/ThemeProvider'`.

- [ ] **Step 5: Implement the theme context, provider, and hook**

Create `src/theme/theme-context.ts` (context in its own module — no component co-export):

```ts
import { createContext } from "react";

export type Theme = "light" | "dark" | "system";

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
```

Create `src/theme/ThemeProvider.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ThemeContext } from "@/theme/theme-context";
import type { Theme } from "@/theme/theme-context";

const KEY = "i2r_theme";
const mediaQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme | null) ?? "system",
  );
  const [systemDark, setSystemDark] = useState(() => mediaQuery().matches);

  useEffect(() => {
    const mq = mediaQuery();
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(KEY, next);
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

Create `src/theme/useTheme.ts`:

```ts
import { useContext } from "react";
import { ThemeContext } from "@/theme/theme-context";

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
```

- [ ] **Step 6: Run the theme tests**

Run: `npm test -- theme`
Expected: 4 passing.

- [ ] **Step 7: Implement the toggle + wire the provider**

Create `src/components/theme-toggle.tsx`:

```tsx
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/theme/useTheme";
import type { Theme } from "@/theme/theme-context";

const ORDER: Theme[] = ["light", "dark", "system"];
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      onClick={() => setTheme(next)}
    >
      <Icon className="size-4" />
    </Button>
  );
}
```

Wrap the app in `ThemeProvider` in `src/main.tsx` (outermost, around `QueryClientProvider`):

```tsx
import { ThemeProvider } from "@/theme/ThemeProvider";
```
```tsx
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
```

- [ ] **Step 8: Gates**

Run: `npm test` (all pass — theme + FE-0 suite), `npm run build`, `npm run lint`.
Expected: all green. Then visually spot-check via the dev server if available (`npm run dev`, toggle light/dark).

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "feat(frontend): Broadcast Blue theme tokens + light/dark theme system"
```

---

### Task 2: App shell + re-skinned pages + primitives

**Files:**
- Create: `src/components/ui/badge.tsx` (shadcn add), `src/components/PageHeader.tsx`
- Modify: `src/layouts/PublicLayout.tsx`, `src/pages/SeasonsPage.tsx`, `src/pages/LoginPage.tsx`, `src/pages/SeasonsPage.test.tsx`, `src/auth/auth.test.tsx`

**Interfaces:** consumes `ThemeToggle`, shadcn `Button`/`Input`/`Card`/`Table`/`Badge`, `PageHeader`; produces the themed `PublicLayout`, re-skinned `SeasonsPage`/`LoginPage`.

- [ ] **Step 1: Add the Badge component**

```bash
npx shadcn@latest add badge
```

(Lands `src/components/ui/badge.tsx`. If the CLI prompts, accept defaults.)

- [ ] **Step 2: Create `PageHeader`**

Create `src/components/PageHeader.tsx`:

```tsx
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Theme the app shell (`PublicLayout`)**

Overwrite `src/layouts/PublicLayout.tsx`:

```tsx
import { Link, NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { to: "/", label: "Seasons", end: true },
  { to: "/leagues", label: "Leagues" },
  { to: "/bracket", label: "Bracket" },
  { to: "/records", label: "Records" },
];

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold tracking-tight">
              <span className="text-primary">Insight</span>2Redraft
            </Link>
            <nav className="hidden items-center gap-4 text-sm sm:flex">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          Insight2Redraft — cross-league fantasy, one bracket.
        </div>
      </footer>
    </div>
  );
}
```

(The `/leagues`, `/bracket`, `/records` routes don't exist yet — the NavLinks resolve as they ship in FE-1/FE-2; that's fine.)

- [ ] **Step 4: Re-skin `SeasonsPage` (update its test first)**

Update `src/pages/SeasonsPage.test.tsx` — keep the behavioral assertions, adapt to the new markup (the year still renders as text; the error copy is preserved):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { SeasonsPage } from "./SeasonsPage";
import { server } from "@/test/server";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeasonsPage />
    </QueryClientProvider>,
  );
}

test("renders seasons from the API", async () => {
  renderPage();
  expect(await screen.findByText("2024")).toBeInTheDocument();
  expect(screen.getByText("2023")).toBeInTheDocument();
});

test("shows an error state when the request fails", async () => {
  server.use(http.get("/api/seasons", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
  renderPage();
  expect(await screen.findByText(/couldn't load seasons/i)).toBeInTheDocument();
});
```

Overwrite `src/pages/SeasonsPage.tsx`:

```tsx
import { useSeasons } from "@/features/useSeasons";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import type { SeasonStatus } from "@/types/api";

const STATUS_LABEL: Record<SeasonStatus, string> = {
  setup: "Setup",
  regular: "Regular season",
  playoffs: "Playoffs",
  complete: "Complete",
};

function StatusBadge({ status }: { status: SeasonStatus }) {
  const variant = status === "playoffs" ? "default" : status === "complete" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

export function SeasonsPage() {
  const { data, isPending, isError } = useSeasons();

  return (
    <div>
      <PageHeader title="Seasons" description="Every season across the leagues." />
      {isPending && <p className="text-muted-foreground">Loading seasons…</p>}
      {isError && <p className="text-destructive">Couldn't load seasons.</p>}
      {data && (
        <div className="divide-y rounded-lg border">
          {data.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-lg font-semibold tabular-nums">{s.year}</span>
              <StatusBadge status={s.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Re-skin `LoginPage` (keep labels + button + error for the existing tests)**

Overwrite `src/pages/LoginPage.tsx`:

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(isApiError(err) ? err.detail : "Login failed");
    }
  }

  return (
    <Card className="mx-auto mt-12 max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit">Sign in</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

(The `htmlFor`/`id` pairing keeps `getByLabelText(/email/i)` / `/password/i` working in the existing `auth.test.tsx`; the button text "Sign in" and the `role="alert"` error are preserved, so no change to `auth.test.tsx` is required. If lint/build flags anything in that test, adjust minimally.)

- [ ] **Step 6: Gates**

Run: `npm test`
Expected: all pass (theme 4 + api-client 3 + seasons 2 + auth 3 + smoke 1 = 13).

Run: `npm run build && npm run lint`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): themed app shell + re-skinned seasons/login pages"
```

---

## Verification (whole branch)

- From `frontend/`: `npm test` (all green), `npm run build`, `npm run lint`.
- Manual smoke (`npm run dev`): the header shows the brand wordmark + nav + theme toggle; toggling cycles light → dark → system and the whole app recolors (blue primary, slate neutrals); the seasons page renders as a card list with status badges (or its error state without the backend); `/login` is a centered card. Refreshing keeps the chosen theme (localStorage). Look at both light and dark.
