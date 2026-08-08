# Frontend Theme & Design System (FE-1a) — Design

**Date:** 2026-08-08
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

Establish the frontend's visual language — the "design foundation" the public
pages (FE-1) and the bracket view (FE-2) build on. A **clean, modern-sporty**
look in **Broadcast Blue** (blue primary, amber accent, slate neutrals), shipped
in **light + dark** with a real theme toggle, a themed app shell, and the two
existing pages (seasons, login) re-skinned as proof. This is theme foundation
only — not the FE-1 public pages.

This is the first frontend design cycle after FE-0 (foundation/scaffold):

- **FE-0 (merged)** — scaffold, API client, auth, routing.
- **FE-1a (this spec)** — theme & design system.
- **FE-1 (later)** — public pages (season dashboard, leagues, owner profiles,
  hall of fame).
- **FE-2 (later)** — super-bracket view. **FE-3 (later)** — admin area.

## Decisions (settled during brainstorming)

- **Personality:** clean & modern-sporty (crisp, confident, broadcast-adjacent).
- **Brand:** **Broadcast Blue** — `primary` = blue-600, `accent` = amber-500
  (reserved for highlights: live, winners, mismatches — NOT general buttons),
  neutrals = **slate**. Chosen from a live side-by-side preview.
- **Mode:** **light + dark** with a user toggle (light / dark / system).

## Goals

- Brand tokens mapped onto the existing shadcn CSS variables, light + dark, in
  `oklch`.
- A `ThemeProvider` + `useTheme()` (light/dark/system, persisted, applies
  `.dark` on `<html>`, honors `prefers-color-scheme`) and a header toggle.
- A themed app shell (header with wordmark + nav + toggle, footer).
- The `SeasonsPage` and `LoginPage` re-skinned with the new tokens/components.
- A coherent, accessible categorical `--chart-1..5` palette for later viz.
- All gates green (`npm run build`, `npm test`, `npm run lint`).

## Non-Goals (this cycle)

- No FE-1 public pages (dashboard/leagues/owners/records) — those consume this.
- No new data/endpoints; no backend changes.
- No logo/illustration work beyond a text wordmark (a real logo can come later).
- No exhaustive component library — only the primitives the current two pages
  and the shell need (YAGNI); more get added as FE-1 pages demand them.

## Existing State (grounding)

- FE-0 shipped `frontend/` (Vite + React 19 + TS, Tailwind v4, shadcn/ui
  "radix-nova" style, React Router 7, TanStack Query, Vitest + RTL + MSW). See
  [[frontend-foundation]].
- `src/index.css` already defines the full shadcn token system in `oklch`
  (`background/foreground/primary/secondary/muted/accent/destructive/border/ring/
  card/popover`, `chart-1..5`, sidebar tokens), a light `:root` block and a
  `.dark` block, the `@custom-variant dark` variant, Geist Variable font, and a
  radius scale — currently **all neutral gray, no brand color**.
- Pages exist but are minimal: `PublicLayout` (bare header + Outlet),
  `SeasonsPage` (plain `<ul>`), `LoginPage` (unstyled form). shadcn base
  components present: `button`, `input`, `card`, `table`.
- No dark-mode toggle yet (the `.dark` class is defined but nothing applies it).

## Brand Tokens (`src/index.css`)

Overwrite the color values in the `:root` (light) and `.dark` blocks — keep the
`@theme inline` var mappings, Geist, and the radius scale. Values in `oklch` to
match the file.

- **primary** (light): blue-600 ≈ `oklch(0.55 0.22 264)`; **dark**: a slightly
  lighter/brighter blue for contrast on dark surfaces. `--primary-foreground`
  white in both.
- **accent**: amber-500 ≈ `oklch(0.80 0.16 82)` with a dark, readable
  `--accent-foreground` (near-black in light). Reserved for highlights.
- **ring** = primary.
- **neutrals** → slate: `--background`/`--foreground`/`--card`/`--popover`/
  `--muted`/`--secondary`/`--border`/`--input` shift from chroma-0 gray to a
  slight cool (slate) hue, light + dark (dark background a deep slate, not pure
  black).
- **destructive**: keep the existing red (a distinct hue from the amber accent).
- **chart-1..5**: a categorical palette (blue + amber + a teal/green + a
  violet + a slate) chosen for distinctness and WCAG-legible contrast in both
  modes. **Use the dataviz skill** to select/validate these (accessible
  categorical colors, colorblind-safe ordering).

## Theme Toggle

- `src/theme/ThemeProvider.tsx`: context holding `theme: "light" | "dark" |
  "system"`; on change, persists to `localStorage` (key `i2r_theme`) and sets
  the `.dark` class on `document.documentElement` (resolving "system" via
  `matchMedia("(prefers-color-scheme: dark)")`, and subscribing to changes while
  in system mode). Applies the stored/default theme on load (default "system").
- `useTheme() -> { theme, resolvedTheme, setTheme }`.
- A header toggle control (a small button cycling light→dark→system, or a
  dropdown) using a lucide icon (sun/moon/monitor).

## App Shell

Upgrade `PublicLayout`:
- A header: wordmark ("Insight2Redraft") linking home, a top-nav with
  placeholders (Seasons, Leagues, Bracket, Records — routes that resolve as they
  ship; inert/`#` until then), and the theme toggle at the right. Styled with
  brand tokens (subtle border, brand-colored wordmark or a small mark).
- A constrained content container (`max-w`, padding) wrapping `<Outlet/>`.
- A simple footer (site name + a muted tagline).
Mobile: the nav collapses gracefully (a simple stacked/hidden treatment; a full
mobile menu can come later).

## Re-skin the two existing pages

- `SeasonsPage`: a `PageHeader` ("Seasons") + the list rendered as a shadcn
  `Card`/`Table` (year, a **status Badge** colored by season status), with clean
  loading and error states (skeleton/spinner + a styled error). Behavior and the
  `useSeasons` query are unchanged.
- `LoginPage`: a centered shadcn `Card` with the form (Input components,
  labeled), the primary "Sign in" button, and the error in a styled alert.
  Behavior (login flow) unchanged.

## Shared Primitives (only what's needed)

- `Badge` (shadcn add or a small local component) — status pills (season status,
  LIVE).
- `PageHeader` — a title (+ optional description/actions) block for page tops.
Add more (skeletons, empty states, a `DataTable` wrapper) as FE-1 pages need
them.

## Testing Strategy

Vitest + RTL (+ MSW where a page fetches). No live backend.

- **ThemeProvider**: defaults to system and resolves via the media query;
  `setTheme("dark")` adds `.dark` to `<html>` and persists to `localStorage`;
  `setTheme("light")` removes it; a stored preference is applied on mount; while
  in "system", a media-query change flips `resolvedTheme`.
- **Header toggle**: clicking cycles the theme and updates the DOM class.
- **Re-skinned pages**: `SeasonsPage` still renders seasons + shows the status
  badge, loading, and error states (MSW-mocked); `LoginPage` still submits and
  shows the error on bad credentials (existing behavior preserved — the FE-0
  auth tests must keep passing, updated only for markup/label changes).
- **Contrast sanity**: the chart palette + primary/accent pass a basic contrast
  check (documented, per the dataviz skill).
- Gates: `npm run build`, `npm test`, `npm run lint` all pass.

## Files

- Modify: `src/index.css` (brand tokens), `src/layouts/PublicLayout.tsx`,
  `src/pages/SeasonsPage.tsx`, `src/pages/LoginPage.tsx`, `src/main.tsx` (wrap in
  `ThemeProvider`), and the existing page/auth tests as needed for markup.
- Create: `src/theme/ThemeProvider.tsx`, `src/theme/useTheme.ts`,
  `src/components/theme-toggle.tsx`, `src/components/PageHeader.tsx`, a `Badge`
  component (via shadcn add or local), and their tests
  (`src/theme/theme.test.tsx`, toggle/page tests).

## Constraints

- All frontend commands from `frontend/`. Node 22 / npm 10.
- Type-safe; no `any`. Keep the FE-0 test infra (absolute `.env.test`,
  `jsdom.url`, type-only imports).
- No flash of the wrong theme on load where avoidable (apply the class early;
  acceptable minor FOUC is fine for FE-1a — a blocking pre-hydration script can
  come later if needed).
- Accessibility: the toggle is keyboard-operable and labeled; color is not the
  only signal (status also has text).
- Known good baseline: FE-0's `npm test` (9/9), build, lint all green — keep them
  green.
