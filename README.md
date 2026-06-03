# California 2026 Governor Primary Live Tracker

A production-grade, high-density "situation room" election results dashboard tracking the **California 2026 Governor top-two "jungle" primary** (held June 2, 2026). 

The dashboard is designed as a dark, high-contrast data terminal for investigative newsrooms. It focuses heavily on the high-stakes second-place battle between **Xavier Becerra (D)** and **Tom Steyer (D)**, as they compete with Republican **Steve Hilton** for a general election runoff slot.

---

## ⚡ Features

1. **Situational Masthead**: Real-time status with a pulsing live indicator, local fetch timestamp, and key metadata (primary/general dates, reporting percentage, and data source).
2. **Statewide 2nd-Place Battle Hero**: High-impact visualization of the Xavier Becerra vs. Tom Steyer gap, showing who leads for second place and the delta vs. the election-night baseline (`BASELINE_GAP = 6.2%`).
3. **Gap Sparkline**: Hand-rolled inline SVG sparkline rendering the gap over time with a dashed baseline reference line.
4. **Standings List**: Staggered fade-in candidate list. The top two candidates are visually promoted with an amber accent border and an "ADVANCES" badge.
5. **Party Split Cards**: Combined Democratic vs. Republican vote share and candidate counts to analyze splitting dynamics.
6. **County Drill-Down**: Interactive dropdown allowing users to view results for any of California's 58 counties. The hero section remains statewide to maintain situational awareness.
7. **Robust Refresh Controls**: Manual refresh button and an optional 3-minute auto-refresh toggle.
8. **Graceful Degradation**: Out-of-the-box functionality with zero configuration, degrading gracefully if external feeds or Vercel KV are unavailable.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router) + React 19 + TypeScript
- **Styling**: Plain CSS with CSS Custom Properties (zero external UI libraries or Tailwind config overhead)
- **Database**: Vercel KV (Upstash Redis) for trend persistence
- **Deployment**: Optimized for Vercel with zero code changes

---

## 📂 Project Structure

```
├── app/
│   ├── api/
│   │   ├── results/
│   │   │   ├── route.ts         # Statewide results API (Feed -> LLM -> Mock)
│   │   │   └── county/
│   │   │       └── route.ts     # Synthesized county-level results API
│   │   ├── snapshot/
│   │   │   └── route.ts         # 5-minute Vercel Cron to log gap to KV
│   │   └── trend/
│   │       └── route.ts         # Fetches gap history from Vercel KV
│   ├── global.css               # Hand-written situation room styles
│   ├── layout.tsx               # Root layout with overlays (film grain, scanlines)
│   └── page.tsx                 # Main dashboard client component
├── lib/
│   ├── adapters/
│   │   ├── feedAdapter.ts       # Swappable, defensive external feed parser
│   │   └── index.ts             # Adapter router
│   └── mockResults.ts           # Realistic statewide & 58-county mock data
├── vercel.json                  # Vercel cron configuration (5-minute interval)
├── .env.example                 # Example environment variables
└── README.md                    # Documentation
```

---

## ⚙️ Data Layer & Fallback Chain

The `/api/results` endpoint resolves results using a robust fallback chain:

```
[RESULTS_FEED_URL is set] ──► Fetch & parse via lib/adapters/feedAdapter.ts
         │ (fails or unset)
         ▼
[OPENROUTER_API_KEY is set] ──► Server-side OpenRouter web search & defensive parse
         │ (fails or unset)
         ▼
[Default Fallback] ───────────► Serve high-fidelity mock data (lib/mockResults.ts)
```

To avoid hammering external feeds, results are cached in-memory on the serverless instance with a **30-second revalidation window**.

---

## 📊 Gap Trend (Sparkline) Persistence

The second-place gap trend is logged over time to provide a historical sparkline:
- **Vercel KV (Preferred)**: A Vercel cron job pings `/api/snapshot` every 5 minutes. This endpoint computes the current gap and appends it to a capped list (last 500 points) in Vercel KV.
- **Local Fallback**: If Vercel KV environment variables are absent, the server reports `kvEnabled: false`. The client gracefully degrades to logging the gap to `localStorage` per session. On first load, the client pre-populates the local trend with realistic historical points starting from the `6.2%` baseline to ensure a beautiful sparkline immediately.

---

## 🎨 Design Specification: "Wire Desk"

The interface is customized to look like a high-density, dark-mode terminal found in an investigative newsroom:
- **Color Palette**: Strict usage of dark grays (`--ink`, `--panel`), warm off-whites (`--text`), and a single amber accent (`--amber`) for signaling. Democratic candidates use `--dem` (blue) and Republican candidates use `--gop` (red).
- **Atmosphere**: A very subtle horizontal scanline pattern and a faint film grain overlay (using a lightweight, base64-encoded SVG noise filter) are applied globally.
- **Typography**: Display elements and masthead use **Archivo** (800/900, uppercase, tight tracking). All data, numbers, labels, and votes use **IBM Plex Mono** with tabular numerals to ensure columns align perfectly.
- **Motion**: Horizontal progress bars animate their width on render. Candidate rows stagger their entry. Respects `prefers-reduced-motion` by disabling all animations.

---

## 🚀 Getting Started

### 1. Local Development

Clone the repository and install dependencies:

```bash
npm install
npm run dev
```

The application will start immediately on `http://localhost:3000` using the high-fidelity mock data. No environment variables are required for local development.

### 2. Wiring a Real Feed

To connect a real election feed, set the `RESULTS_FEED_URL` environment variable:

```bash
RESULTS_FEED_URL="https://api.example.com/elections/ca-governor-2026"
```

The swappable parser in `lib/adapters/feedAdapter.ts` handles mapping, type coercion, and defensive parsing (e.g., stripping commas from vote counts, cleaning percentages).

### 3. Enabling OpenRouter LLM Fallback

If you don't have a structured feed but want to fetch live results via OpenRouter with web search, configure the OpenRouter environment variables:

```bash
OPENROUTER_API_KEY="your-openrouter-api-key"
LLM_MODEL="google/gemini-3.1-flash-lite"
```

The server-side route handler will instruct OpenRouter to search for the latest results, return a precise JSON schema, and parse it defensively (stripping code fences, slicing JSON boundaries).

### 4. Setting up Vercel KV & Cron

To enable persistent gap tracking across all users:
1. Create a **Vercel KV** database in your Vercel dashboard.
2. Link the KV database to your project (this automatically injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. Deploy the project. The cron job defined in `vercel.json` will automatically trigger `/api/snapshot` every 5 minutes to record the gap.

---

## 📝 Disclaimers

- **Data Lag**: Numbers are pulled from a live feed and may lag or vary by outlet. Verify against the official California Secretary of State results at [https://electionresults.sos.ca.gov](https://electionresults.sos.ca.gov) before publishing.
- **Late Ballots**: California counts mail-in and provisional ballots postmarked by Election Day for days to weeks. Late-counted ballots historically skew younger and more progressive, meaning the gap between Xavier Becerra and Tom Steyer can move significantly after election night.
