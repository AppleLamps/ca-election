// Shared keys and limits used across API routes and the client.
// Centralized so the KV list key and the client-side localStorage key
// can never silently diverge.

export const KV_TREND_KEY = "ca_governor_2026_gap_trend";
export const LOCAL_TREND_KEY = "ca_governor_2026_local_trend";

// Per-race trend keys for the LA City Mayor race. Kept separate from the
// governor keys so the two races' trend histories can never collide.
export const KV_TREND_KEY_LA_MAYOR = "la_mayor_2026_gap_trend";
export const LOCAL_TREND_KEY_LA_MAYOR = "la_mayor_2026_local_trend";

// Defensive upper bound on how many candidates we will accept from any
// external source (feed, LLM) before slicing, so a malformed or hostile
// payload cannot blow up the render.
export const MAX_CANDIDATES = 50;
