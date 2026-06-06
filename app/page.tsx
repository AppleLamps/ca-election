"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ResultsPayload, COUNTY_LIST } from "@/lib/mockResults";
import { RACES, RACE_IDS, RaceId, DEFAULT_RACE, getRace } from "@/lib/races";
import { runoffGap, analyzeStatewide } from "@/lib/projection";
import { parseReportingFraction } from "@/lib/parsing";

type TrendPoint = {
  gap: number;
  t: string;
  ci95?: number;
  projectedGap?: number;
};

export default function Dashboard() {
  // Which race is shown. Drives the title, candidate set, baseline, trend keys,
  // and which API the fetches hit.
  const [activeRace, setActiveRace] = useState<RaceId>(DEFAULT_RACE);
  const race = RACES[activeRace];

  // State
  const [statewideResults, setStatewideResults] = useState<ResultsPayload | null>(null);
  const [currentResults, setCurrentResults] = useState<ResultsPayload | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<string>("");
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [isKvEnabled, setIsKvEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [countyLoading, setCountyLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [countyError, setCountyError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);

  // Refs for timers
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track the selected county without making fetchResults depend on it. This
  // keeps the statewide fetch callback stable so selecting a county does not
  // re-trigger the mount effect (which would refetch statewide and flash the
  // whole dashboard to skeletons).
  const selectedCountyRef = useRef<string>("");
  useEffect(() => {
    selectedCountyRef.current = selectedCounty;
  }, [selectedCounty]);

  // Same pattern for the active race: the fetch callbacks read the ref so they
  // stay stable, and the race-switch effect updates it before refetching.
  const activeRaceRef = useRef<RaceId>(DEFAULT_RACE);

  // Fetch trend data
  const fetchTrend = useCallback(async (currentStatewide: ResultsPayload) => {
    try {
      const raceId = activeRaceRef.current;
      const localKey = getRace(raceId).localTrendKey;
      const res = await fetch(`/api/trend?race=${raceId}`);
      if (!res.ok) throw new Error("Failed to fetch trend");
      const data = await res.json();

      // Gap = margin holding the second runoff slot (2nd place minus 3rd place).
      // Candidates arrive sorted by votes descending, so this is derived from the
      // standings, not tied to any specific candidate name. Same source of truth
      // the server uses (runoffGap), and the per-point statistical fields come
      // from analyzeStatewide so the local fallback matches the KV series shape.
      const gapInfo = runoffGap(currentStatewide.candidates);
      const analysis = analyzeStatewide(
        currentStatewide.candidates,
        parseReportingFraction(currentStatewide.pctReporting)
      );
      const currentGap = gapInfo ? Number(gapInfo.gap.toFixed(2)) : 0;

      if (data.kvEnabled && data.trend && data.trend.length > 0) {
        setIsKvEnabled(true);
        setTrendPoints(data.trend as TrendPoint[]);
      } else {
        // Fallback to localStorage (per-race key)
        setIsKvEnabled(false);
        const localTrendStr = localStorage.getItem(localKey);
        let localTrend: TrendPoint[] = [];

        if (localTrendStr) {
          try {
            const parsed = JSON.parse(localTrendStr);
            if (Array.isArray(parsed)) localTrend = parsed;
          } catch {
            // Corrupted value: ignore and rebuild from baseline below.
            localTrend = [];
          }
        }

        // Append only real, observed gaps. No synthetic history: the chart stays
        // in its empty state until 2+ genuine snapshots have accumulated. The CI
        // and projected gap are stored per point so the local series renders the
        // same band and projection line as the KV series (point projection only;
        // the Kalman smoothing lives server-side).
        const lastPoint = localTrend[localTrend.length - 1];
        if (!lastPoint || Math.abs(lastPoint.gap - currentGap) > 0.01) {
          localTrend.push({
            gap: currentGap,
            t: new Date().toISOString(),
            ci95: analysis ? Number(analysis.ci95.toFixed(2)) : undefined,
            projectedGap: analysis ? Number(analysis.projectedGap.toFixed(2)) : undefined
          });
          // Cap at last 50 points for local storage to keep it lightweight
          if (localTrend.length > 50) {
            localTrend = localTrend.slice(-50);
          }
          localStorage.setItem(localKey, JSON.stringify(localTrend));
        }

        setTrendPoints(localTrend);
      }
    } catch (err) {
      console.error("Error loading trend data:", err);
      setIsKvEnabled(false);
    }
  }, []);

  // Fetch results
  const fetchResults = useCallback(async (isManual = false) => {
    if (!isManual) setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/results?race=${activeRaceRef.current}`);
      if (!res.ok) throw new Error(`Statewide fetch failed: ${res.statusText}`);
      const data: ResultsPayload = await res.json();

      setStatewideResults(data);
      setLastFetched(new Date().toLocaleTimeString("en-US", { hour12: false }));

      // If no county is selected, update current results
      if (!selectedCountyRef.current) {
        setCurrentResults(data);
      }

      // Load trend data using the fresh statewide results
      await fetchTrend(data);
    } catch (err) {
      console.error("Error fetching results:", err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [fetchTrend]);

  // Fetch county results
  const fetchCountyResults = useCallback(async (county: string) => {
    setCountyLoading(true);
    setCountyError(null);
    try {
      const res = await fetch(`/api/results/county?name=${encodeURIComponent(county)}`);
      if (!res.ok) throw new Error(`County fetch failed: ${res.statusText}`);
      const data: ResultsPayload = await res.json();
      setCurrentResults(data);
    } catch (err) {
      console.error(`Error fetching county ${county} results:`, err);
      // Non-blocking: surface a notice and keep the previously shown results.
      setCountyError(`Could not load ${county}. Showing the previous view.`);
    } finally {
      setCountyLoading(false);
    }
  }, []);

  // Initial load and on race switch: sync the ref, then refetch for the race.
  useEffect(() => {
    activeRaceRef.current = activeRace;
    fetchResults();
  }, [activeRace, fetchResults]);

  // Switch races: reset county/view state and let the effect above refetch.
  const handleRaceChange = (id: RaceId) => {
    if (id === activeRace) return;
    setSelectedCounty("");
    selectedCountyRef.current = "";
    setCountyError(null);
    setStatewideResults(null);
    setCurrentResults(null);
    setTrendPoints([]);
    setLoading(true);
    setActiveRace(id);
  };

  // Handle County Selection
  const handleCountyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const county = e.target.value;
    setSelectedCounty(county);
    if (county) {
      fetchCountyResults(county);
    } else if (statewideResults) {
      setCountyError(null);
      setCurrentResults(statewideResults);
    }
  };

  // Reset to Statewide
  const handleResetStatewide = () => {
    setSelectedCounty("");
    setCountyError(null);
    if (statewideResults) {
      setCurrentResults(statewideResults);
    }
  };

  // Handle Auto-Refresh
  useEffect(() => {
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(() => {
        fetchResults(true);
      }, 180000); // 3 minutes
    } else {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [autoRefresh, fetchResults]);

  // Calculations for Hero Gap. ALWAYS based on statewide results, and derived
  // from the standings (2nd place vs 3rd place) rather than hardcoded names, so
  // it works regardless of which candidates lead. Returns null when the battle
  // cannot be computed (fewer than three candidates); the loading skeleton is
  // gated separately on statewideResults being null.
  const getHeroData = () => {
    if (!statewideResults) return null;

    const gapInfo = runoffGap(statewideResults.candidates);
    if (!gapInfo) return null;

    // Prefer the server-computed statistical summary; fall back to recomputing
    // on the client if an older payload omits it.
    const projection =
      statewideResults.projection ||
      analyzeStatewide(
        statewideResults.candidates,
        parseReportingFraction(statewideResults.pctReporting)
      );

    // Margin holding the second runoff slot. Standings are sorted descending,
    // so this is non-negative.
    const currentGap = gapInfo.gap;
    const delta = Number((currentGap - race.baselineGap).toFixed(1));

    let deltaClass = "delta-neutral";
    let deltaText = "Flat vs baseline";
    let deltaArrow = "=";

    if (currentGap < race.baselineGap) {
      deltaClass = "delta-climbing";
      deltaText = `${gapInfo.thirdName} closing`;
      deltaArrow = "▼";
    } else if (currentGap > race.baselineGap) {
      deltaClass = "delta-widening";
      deltaText = `${gapInfo.secondName} pulling away`;
      deltaArrow = "▲";
    }

    // Margin-of-safety class keyed off the label for color treatment.
    const label = projection?.label ?? "";
    const safetyClass =
      label === "Safe" ? "safety-safe" : label === "Lean" ? "safety-lean" : "safety-tossup";

    return {
      gap: Math.abs(currentGap),
      leader: gapInfo.secondName,
      delta: Math.abs(delta),
      deltaClass,
      deltaText,
      deltaArrow,
      ci95: projection?.ci95,
      z: projection?.z,
      safetyLabel: label,
      safetyClass,
      projectedGap: projection?.projectedGap
    };
  };

  // Calculations for Party Split (based on currently viewed results)
  const getPartySplit = () => {
    if (!currentResults) return null;

    const demCandidates = currentResults.candidates.filter(c => c.party === "D");
    const gopCandidates = currentResults.candidates.filter(c => c.party === "R");

    const demPct = Number(demCandidates.reduce((sum, c) => sum + c.pct, 0).toFixed(1));
    const gopPct = Number(gopCandidates.reduce((sum, c) => sum + c.pct, 0).toFixed(1));

    return {
      demPct,
      gopPct,
      demCount: demCandidates.length,
      gopCount: gopCandidates.length
    };
  };

  // Draw SVG Sparkline
  const drawSparkline = () => {
    if (trendPoints.length < 2) {
      return (
        <div className="sparkline-svg-wrapper sparkline-empty">
          <span>Collecting live data...</span>
        </div>
      );
    }

    const width = 300;
    const height = 80;
    const padding = 10;

    // Build the value range from everything we draw: observed gaps, the CI band
    // extremes, the projected gaps, and the baseline reference line.
    const values: number[] = [race.baselineGap];
    for (const p of trendPoints) {
      values.push(p.gap);
      if (p.ci95 !== undefined) {
        values.push(p.gap + p.ci95, p.gap - p.ci95);
      }
      if (p.projectedGap !== undefined) {
        values.push(p.projectedGap);
      }
    }
    const minGap = Math.min(...values) - 0.5;
    const maxGap = Math.max(...values) + 0.5;
    const span = maxGap - minGap || 1;

    const xOf = (i: number) =>
      padding + (i / (trendPoints.length - 1)) * (width - padding * 2);
    const yOf = (v: number) =>
      height - padding - ((v - minGap) / span) * (height - padding * 2);

    const pointsStr = trendPoints.map((p, i) => `${xOf(i)},${yOf(p.gap)}`).join(" ");

    // 95% confidence band: top edge left-to-right, then bottom edge back. Where a
    // point lacks a CI (legacy data) the band collapses to the observed line.
    const hasBand = trendPoints.some(p => p.ci95 !== undefined);
    const bandTop = trendPoints.map((p, i) => `${xOf(i)},${yOf(p.gap + (p.ci95 ?? 0))}`);
    const bandBottom = trendPoints
      .map((p, i) => `${xOf(i)},${yOf(p.gap - (p.ci95 ?? 0))}`)
      .reverse();
    const bandStr = [...bandTop, ...bandBottom].join(" ");

    // Projected (Kalman) line: only the points that carry a projection.
    const projPoints = trendPoints
      .map((p, i) => (p.projectedGap !== undefined ? `${xOf(i)},${yOf(p.projectedGap)}` : null))
      .filter((s): s is string => s !== null);

    // Baseline Y coordinate
    const baselineY = yOf(race.baselineGap);

    // Last point coordinates
    const lastPoint = trendPoints[trendPoints.length - 1];
    const lastX = xOf(trendPoints.length - 1);
    const lastY = yOf(lastPoint.gap);

    const firstGap = trendPoints[0].gap;
    const direction =
      lastPoint.gap > firstGap ? "widening" : lastPoint.gap < firstGap ? "narrowing" : "flat";
    const projText =
      lastPoint.projectedGap !== undefined
        ? ` Projected final margin ${lastPoint.projectedGap.toFixed(1)} percent.`
        : "";
    const ciText =
      lastPoint.ci95 !== undefined
        ? ` 95 percent interval plus or minus ${lastPoint.ci95.toFixed(1)} points.`
        : "";
    const chartLabel = `Runoff-margin trend, ${direction}. Current margin ${lastPoint.gap.toFixed(
      1
    )} percent against an election-night baseline of ${race.baselineGap} percent.${ciText}${projText}`;

    return (
      <div className="sparkline-svg-wrapper">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="sparkline-svg"
          style={{ width: "100%", height: "100%", display: "block" }}
          role="img"
          aria-label={chartLabel}
        >
          <title>{chartLabel}</title>

          {/* 95% confidence band */}
          {hasBand && (
            <polygon points={bandStr} fill="var(--amber)" fillOpacity="0.15" stroke="none" />
          )}

          {/* Baseline reference line */}
          <line
            x1={padding}
            y1={baselineY}
            x2={width - padding}
            y2={baselineY}
            stroke="var(--faint)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />

          {/* Projected final-margin line (dashed) */}
          {projPoints.length >= 2 && (
            <polyline
              fill="none"
              stroke="var(--amber)"
              strokeWidth="1.5"
              strokeOpacity="0.7"
              strokeDasharray="4,3"
              points={projPoints.join(" ")}
            />
          )}

          {/* Observed sparkline path */}
          <polyline
            fill="none"
            stroke="var(--amber)"
            strokeWidth="2"
            points={pointsStr}
          />

          {/* Emphasized last point */}
          <circle
            cx={lastX}
            cy={lastY}
            r="4"
            fill="var(--amber)"
            stroke="var(--panel)"
            strokeWidth="1.5"
          />
        </svg>
        <span className="sparkline-label">
          {isKvEnabled ? "Live history" : "This session only"}
        </span>
      </div>
    );
  };

  const heroData = getHeroData();
  const partySplit = getPartySplit();
  const topTwo = currentResults?.candidates.slice(0, 2) || [];
  const leaderPct = currentResults?.candidates[0]?.pct || 1;

  return (
    <div className="container">
      {/* Race tabs */}
      <nav className="race-tabs" role="tablist" aria-label="Select race">
        {RACE_IDS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === activeRace}
            className={`race-tab ${id === activeRace ? "active" : ""}`}
            onClick={() => handleRaceChange(id)}
          >
            {RACES[id].tabLabel}
          </button>
        ))}
      </nav>

      {/* Masthead */}
      <header className="masthead">
        <div className="masthead-top">
          <div className="title-group">
            <h1 className="main-title">{race.title}</h1>
            <div className="live-indicator" aria-hidden="true">
              <div className="live-dot" />
              <span>Live</span>
            </div>
          </div>

          {/* Refresh Controls */}
          <div className="refresh-controls">
            <button
              className="refresh-button"
              onClick={() => fetchResults(true)}
              disabled={loading || countyLoading}
              aria-label="Refresh results now"
            >
              <span>Refresh Now</span>
              <span
                className="mono-tabular"
                style={{ fontSize: "10px", opacity: 0.8 }}
                aria-live="polite"
              >
                {loading || countyLoading ? "..." : `[${lastFetched || "00:00:00"}]`}
              </span>
            </button>
            <label className="toggle-container">
              <input
                type="checkbox"
                className="toggle-input"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                aria-label="Toggle auto-refresh every 3 minutes"
              />
              <span>Auto-Refresh (3m)</span>
            </label>
          </div>
        </div>

        <div className="meta-row">
          <div className="meta-group">
            <div className="meta-item">
              <span className="meta-label">Primary Date:</span>
              <span className="meta-value">{race.primaryDate}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">General Runoff:</span>
              <span className="meta-value">{race.runoffDate}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Reporting:</span>
              <span className="meta-value mono-tabular" aria-live="polite">
                {loading ? "..." : currentResults?.pctReporting || "0%"}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Source:</span>
              <span className="meta-value">
                {loading ? "..." : currentResults?.source || "Unknown"}
              </span>
            </div>
          </div>
          <div className="meta-item">
            <span className="meta-label">View:</span>
            <span className="meta-value" style={{ color: "var(--amber)", fontWeight: "bold", textTransform: "uppercase" }}>
              {selectedCounty ? `${selectedCounty} County` : race.regionLabel}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      {error ? (
        <div className="error-card" role="alert">
          <h2 className="error-title">System Error</h2>
          <p className="error-msg">{error}</p>
          <button className="retry-button" onClick={() => fetchResults()}>
            Retry Connection
          </button>
        </div>
      ) : (
        <main className="dashboard-grid">
          {/* Left Column: Standings & Drilldown */}
          <div className="column-left">
            {/* County Drilldown (governor only) */}
            {race.drilldownEnabled && (
              <section className="card county-drilldown">
                <h2 className="card-title">County Drill-Down</h2>
                <label htmlFor="county-select" className="control-label">
                  View results by county
                </label>
                <div className="drilldown-controls">
                  <select
                    id="county-select"
                    className="county-select"
                    value={selectedCounty}
                    onChange={handleCountyChange}
                    disabled={loading}
                    aria-label="Select a California county to view results"
                  >
                    <option value="">-- Select County (Statewide) --</option>
                    {COUNTY_LIST.map(county => (
                      <option key={county} value={county}>
                        {county}
                      </option>
                    ))}
                  </select>
                  <button
                    className="reset-button"
                    onClick={handleResetStatewide}
                    disabled={!selectedCounty || loading}
                  >
                    Reset to Statewide
                  </button>
                </div>
                {countyError && (
                  <p className="county-notice" role="alert">
                    {countyError}
                  </p>
                )}
              </section>
            )}

            {/* Top Two Banner */}
            {currentResults && (
              <div className="advances-banner" aria-live="polite">
                <span>
                  Top Two: <span className="banner-accent">{topTwo[0]?.name || "N/A"} ({topTwo[0]?.party || ""})</span> and <span className="banner-accent">{topTwo[1]?.name || "N/A"} ({topTwo[1]?.party || ""})</span> currently advance to the November general election.
                </span>
              </div>
            )}

            {/* Standings List */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  {selectedCounty ? `${selectedCounty} County Standings` : `${race.regionLabel} Standings`}
                </h2>
                <span className="mono-tabular" style={{ fontSize: "11px", color: "var(--faint)" }}>
                  {currentResults?.note}
                </span>
              </div>

              <div className="standings-list">
                {loading || countyLoading ? (
                  Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="skeleton-row skeleton-shimmer" />
                  ))
                ) : currentResults && currentResults.candidates.length > 0 ? (
                  currentResults.candidates.map((candidate, index) => {
                    const isPromoted = index < 2;
                    const barWidth = leaderPct > 0 ? `${(candidate.pct / leaderPct) * 100}%` : "0%";
                    const animationDelay = `${index * 50}ms`;

                    return (
                      <div
                        key={candidate.name}
                        className={`candidate-row ${isPromoted ? "promoted" : ""}`}
                        style={{ animationDelay }}
                      >
                        <div className="rank-col mono-tabular">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="name-col">
                          <span className={`party-chip party-${candidate.party}`}>
                            {candidate.party}
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {candidate.name}
                          </span>
                          {isPromoted && (
                            <span className="advances-badge">
                              Advances<span className="sr-only"> to the November runoff</span>
                            </span>
                          )}
                        </div>
                        <div className="bar-col" aria-hidden="true">
                          <div
                            className={`vote-bar vote-bar-${candidate.party}`}
                            style={{ width: barWidth }}
                          />
                        </div>
                        <div className="pct-col mono-tabular">
                          {candidate.pct.toFixed(1)}%
                        </div>
                        <div className="votes-col mono-tabular candidate-votes-col">
                          {candidate.votes.toLocaleString()}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
                    No results reported yet for this view.
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Hero Gap & Party Splits */}
          <div className="column-right">
            {/* Hero Card: Second-Place Battle */}
            <section className="card hero-card" aria-live="polite">
              <div className="hero-stats">
                <span className="hero-label">{race.heroLabel}</span>
                {!statewideResults ? (
                  <div className="skeleton-shimmer" style={{ height: "100px", width: "100%" }} />
                ) : heroData ? (
                  <>
                    <span className="hero-leader">
                      {heroData.leader} Leads for 2nd
                    </span>
                    <div className="hero-value-wrapper">
                      <span className="hero-value mono-tabular">
                        {heroData.gap.toFixed(1)}
                      </span>
                      <span className="hero-unit">%</span>
                    </div>
                    {heroData.ci95 !== undefined && heroData.safetyLabel && (
                      <div className={`hero-margin ${heroData.safetyClass}`}>
                        <span className="margin-ci mono-tabular">
                          &plusmn;{heroData.ci95.toFixed(1)}%
                        </span>
                        <span className="margin-label">{heroData.safetyLabel}</span>
                        {heroData.z !== undefined && Number.isFinite(heroData.z) && (
                          <span className="margin-z mono-tabular">
                            Z {heroData.z.toFixed(1)}
                          </span>
                        )}
                      </div>
                    )}
                    {heroData.projectedGap !== undefined && (
                      <div className="hero-projection mono-tabular">
                        Projected final: {heroData.projectedGap.toFixed(1)}%
                      </div>
                    )}
                    <div className={`hero-delta ${heroData.deltaClass}`}>
                      <span className="delta-arrow" aria-hidden="true">{heroData.deltaArrow}</span>
                      <span className="mono-tabular">{heroData.delta.toFixed(1)}%</span>
                      <span>({heroData.deltaText})</span>
                    </div>
                  </>
                ) : (
                  <div className="hero-empty">Awaiting results</div>
                )}
              </div>

              {/* Sparkline */}
              <div className="sparkline-container">
                <div className="sparkline-header">
                  <span>Runoff Margin Trend</span>
                  <span>Election-night baseline: {race.baselineGap}%</span>
                </div>
                {drawSparkline()}
              </div>
            </section>

            {/* Party Splits */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  {selectedCounty ? `${selectedCounty} Party Share` : `${race.regionLabel} Party Share`}
                </h2>
              </div>

              {loading || countyLoading ? (
                <div className="skeleton-shimmer" style={{ height: "110px", width: "100%" }} />
              ) : partySplit ? (
                <div className="split-cards">
                  <div className="split-card dem">
                    <span className="split-label">Democratic Share</span>
                    <span className="split-value mono-tabular">{partySplit.demPct}%</span>
                    <span className="split-sub">{partySplit.demCount} Candidates</span>
                  </div>
                  <div className="split-card gop">
                    <span className="split-label">Republican Share</span>
                    <span className="split-value mono-tabular">{partySplit.gopPct}%</span>
                    <span className="split-sub">{partySplit.gopCount} Candidates</span>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </main>
      )}

      {/* Footer Disclaimers */}
      <footer className="footer-disclaimers">
        <div className="disclaimer-item">
          Numbers are pulled from a live feed and may lag or vary by outlet. Verify against the {race.verifyLabel} at{" "}
          <a
            href={race.verifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="disclaimer-link"
          >
            {race.verifyUrl}
          </a>{" "}
          before publishing.
        </div>
        <div className="disclaimer-item">
          California counts mail-in and provisional ballots for days to weeks. Late-counted ballots historically skew younger and more progressive, so the margin for the second runoff slot can move significantly after election night.
        </div>
      </footer>
    </div>
  );
}
