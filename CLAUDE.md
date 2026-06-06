# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server on http://localhost:3000 (works with zero env vars; serves mock data)
npm run build    # Production build (next build)
npm run start    # Serve the production build
npm run lint     # next lint
```

There is no test framework configured. "Verification" means a clean `npm run build` and exercising the route handlers manually (e.g. `/api/results`, `/api/trend`, `/api/results/county?name=Fresno`).

This is a Windows machine using PowerShell. See `AGENTS.md` for learned user/style preferences (banned design elements, preferred fonts, plain-CSS-only, hand-rolled SVG charts, no HEREDOC in PowerShell).

## Architecture

Next.js 15 App Router + React 19 + TypeScript. A single client dashboard (`app/page.tsx`) talks to four server route handlers under `app/api/`. All external/secret-bearing calls (feed fetch, OpenRouter, Vercel KV) live server-side. Path alias `@/*` maps to the repo root.

### Statewide results: a three-tier fallback chain

`resolveStatewideResults()` in [app/api/results/route.ts](app/api/results/route.ts) is the single source of truth for statewide data. It tries, in order:

1. **External feed** — if `RESULTS_FEED_URL` is set, via `fetchAndParseFeed` ([lib/adapters/feedAdapter.ts](lib/adapters/feedAdapter.ts)). The adapter handles both the official CA Secretary of State schema (array of races; finds the `governor`+`statewide` race, reads `candidates[].Name/Party/Votes/Percent`) and generic flat JSON.
2. **OpenRouter LLM** — if `OPENROUTER_API_KEY` (or `LLM_API_KEY`) is set, via `fetchLLMResults`, which uses `@openrouter/agent` with the web-search plugin (`plugins: [{ id: "web" }]`) and parses the model's JSON defensively (strips code fences, slices to `{...}` boundaries).
3. **Mock data** — `getMockStatewideResults()` from [lib/mockResults.ts](lib/mockResults.ts).

Any error in tier 1 or 2 degrades to mock and sets `fromError: true`. The `GET` handler caches successful results in module-level memory for 30s (`CACHE_TTL_MS`) but **never caches error-fallback results** (they set `Cache-Control: no-store` so the next request retries the live source). The `snapshot` cron imports `resolveStatewideResults` directly rather than making an HTTP self-call.

### Defensive parsing is centralized

[lib/parsing.ts](lib/parsing.ts) holds `parseParty` / `parseVotes` / `parsePct` / `findCandidate`. Every data source (feed, LLM) must route through these so coercion fixes (comma-stripping, `%`-stripping, clamping, name substring matching) apply everywhere at once. `MAX_CANDIDATES` (50) in [lib/constants.ts](lib/constants.ts) caps any external payload before render.

### County drill-down is always synthetic

`/api/results/county` ([app/api/results/county/route.ts](app/api/results/county/route.ts)) always returns seeded mock data from `getMockCountyResults`, even when statewide is live. County results are deterministic per county name (seeded RNG in `mockResults.ts`). `COUNTY_LIST` (58 counties) is the canonical allowlist.

### Gap-trend persistence has two independent paths

The "second-place gap" (Becerra pct minus Steyer pct) is tracked over time for the sparkline:

- **Server (preferred):** Vercel Cron hits `/api/snapshot` every 5 min (`vercel.json`), which computes the gap and `rpush`+`ltrim`s the last 500 points into Vercel KV under `KV_TREND_KEY`. `/api/trend` reads them back. Both routes no-op gracefully and report `kvEnabled: false` when KV env vars are absent. When `CRON_SECRET` is set, `/api/snapshot` requires `Authorization: Bearer <CRON_SECRET>`.
- **Client fallback:** when `kvEnabled` is false, `app/page.tsx` logs the gap to `localStorage` (`LOCAL_TREND_KEY`) per session and pre-seeds a realistic history from the baseline.

`KV_TREND_KEY` and `LOCAL_TREND_KEY` live in [lib/constants.ts](lib/constants.ts) so the server list key and client storage key cannot silently diverge.

### Shared domain constants

`BASELINE_GAP = 6.2` (election-night Becerra-over-Steyer gap) in [lib/mockResults.ts](lib/mockResults.ts) is imported by both the client (hero delta + sparkline baseline line) and is the conceptual anchor for the whole dashboard. The `ResultsPayload` / `Candidate` / `Party` types are also defined there and reused across server and client.

## Deployment notes

Vercel. `vercel.json` **must** keep `"framework": "nextjs"` (without it the build fails on a missing `public` dir). KV vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) are injected automatically when a Vercel KV store is linked.
