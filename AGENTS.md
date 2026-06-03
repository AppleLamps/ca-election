## Learned User Preferences

- Prefer Next.js (App Router), TypeScript, and React for building production-ready, deployable dashboards.
- Prefer plain CSS or CSS Modules with CSS custom properties over Tailwind CSS or external component libraries (like shadcn or MUI).
- Prefer custom, hand-rolled inline SVG charts (such as sparklines) instead of pulling in external charting libraries.
- Prefer server-side route handlers under `/app/api/` for all data fetching and external API/LLM calls to protect secrets.
- Prefer OpenRouter integration using `@openrouter/agent` with `google/gemini-3.1-flash-lite` as the default model.
- Avoid using HEREDOC syntax in PowerShell environments as it is not supported.
- Banned design elements: purple/indigo colors, pastel/purple-to-blue gradients, and standard fonts (Inter, Roboto, Arial, system-ui).
- Preferred typography: Archivo for display/masthead (uppercase, tight tracking) and IBM Plex Mono for data, numbers, and labels.

## Learned Workspace Facts

- The workspace contains a live tracker for the California 2026 Governor top-two primary (held June 2, 2026).
- The official JSON election results feed from the California Secretary of State is located at `https://media.sos.ca.gov/media/governor.json`.
- The official SOS JSON feed is structured as an array of race objects, with statewide Governor results under `"raceTitle": "Governor - Statewide Results"`.
- The project uses Upstash Redis (Vercel KV) for persisting the gap trend (sparkline) data.
- The project is deployed to GitHub at `https://github.com/AppleLamps/ca-election.git`.
- The `vercel.json` configuration must explicitly specify `"framework": "nextjs"` to avoid Vercel build errors regarding a missing "public" directory.
- The primary focus of the dashboard is the second-place battle between Xavier Becerra (D) and Tom Steyer (D), with a default baseline gap of 6.2.
