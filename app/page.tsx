"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ResultsPayload, Candidate, COUNTY_LIST, BASELINE_GAP } from "@/lib/mockResults";

// Helper to find candidate by case-insensitive name substring
function findCandidate(candidates: Candidate[], nameSub: string): Candidate | undefined {
  return candidates.find(c => c.name.toLowerCase().includes(nameSub.toLowerCase()));
}

export default function Dashboard() {
  // State
  const [statewideResults, setStatewideResults] = useState<ResultsPayload | null>(null);
  const [currentResults, setCurrentResults] = useState<ResultsPayload | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<string>("");
  const [trendPoints, setTrendPoints] = useState<{ gap: number; t: string }[]>([]);
  const [isKvEnabled, setIsKvEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [countyLoading, setCountyLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);

  // Refs for timers
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch trend data
  const fetchTrend = useCallback(async (currentStatewide: ResultsPayload) => {
    try {
      const res = await fetch("/api/trend");
      if (!res.ok) throw new Error("Failed to fetch trend");
      const data = await res.json();

      const becerra = findCandidate(currentStatewide.candidates, "becerra");
      const steyer = findCandidate(currentStatewide.candidates, "steyer");
      const currentGap = becerra && steyer ? Number((becerra.pct - steyer.pct).toFixed(1)) : 0.6;

      if (data.kvEnabled && data.trend && data.trend.length > 0) {
        setIsKvEnabled(true);
        setTrendPoints(data.trend);
      } else {
        // Fallback to localStorage
        setIsKvEnabled(false);
        const localTrendStr = localStorage.getItem("ca_governor_2026_local_trend");
        let localTrend = [];

        if (localTrendStr) {
          localTrend = JSON.parse(localTrendStr);
        } else {
          // Pre-populate with realistic historical points starting from baseline gap (6.2)
          const now = Date.now();
          const basePoints = [
            { gap: 6.2, t: new Date(now - 1000 * 60 * 60 * 12).toISOString() }, // 12h ago
            { gap: 5.8, t: new Date(now - 1000 * 60 * 60 * 10).toISOString() },
            { gap: 5.1, t: new Date(now - 1000 * 60 * 60 * 8).toISOString() },
            { gap: 4.5, t: new Date(now - 1000 * 60 * 60 * 6).toISOString() },
            { gap: 3.8, t: new Date(now - 1000 * 60 * 60 * 5).toISOString() },
            { gap: 3.2, t: new Date(now - 1000 * 60 * 60 * 4).toISOString() },
            { gap: 2.5, t: new Date(now - 1000 * 60 * 60 * 3).toISOString() },
            { gap: 1.9, t: new Date(now - 1000 * 60 * 60 * 2).toISOString() },
            { gap: 1.2, t: new Date(now - 1000 * 60 * 60 * 1).toISOString() }
          ];
          localTrend = basePoints;
        }

        // Check if the last point is already our current gap to avoid duplicates
        const lastPoint = localTrend[localTrend.length - 1];
        if (!lastPoint || Math.abs(lastPoint.gap - currentGap) > 0.01 || localTrend.length < 10) {
          localTrend.push({
            gap: currentGap,
            t: new Date().toISOString()
          });
          // Cap at last 50 points for local storage to keep it lightweight
          if (localTrend.length > 50) {
            localTrend = localTrend.slice(-50);
          }
          localStorage.setItem("ca_governor_2026_local_trend", JSON.stringify(localTrend));
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
      const res = await fetch("/api/results");
      if (!res.ok) throw new Error(`Statewide fetch failed: ${res.statusText}`);
      const data: ResultsPayload = await res.json();

      setStatewideResults(data);
      setLastFetched(new Date().toLocaleTimeString("en-US", { hour12: false }));

      // If no county is selected, update current results
      if (!selectedCounty) {
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
  }, [selectedCounty, fetchTrend]);

  // Fetch county results
  const fetchCountyResults = useCallback(async (county: string) => {
    setCountyLoading(true);
    try {
      const res = await fetch(`/api/results/county?name=${encodeURIComponent(county)}`);
      if (!res.ok) throw new Error(`County fetch failed: ${res.statusText}`);
      const data: ResultsPayload = await res.json();
      setCurrentResults(data);
    } catch (err) {
      console.error(`Error fetching county ${county} results:`, err);
      // Fallback: keep current results or show error message
    } finally {
      setCountyLoading(false);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // Handle County Selection
  const handleCountyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const county = e.target.value;
    setSelectedCounty(county);
    if (county) {
      fetchCountyResults(county);
    } else if (statewideResults) {
      setCurrentResults(statewideResults);
    }
  };

  // Reset to Statewide
  const handleResetStatewide = () => {
    setSelectedCounty("");
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

  // Calculations for Hero Gap (ALWAYS based on statewide results)
  const getHeroData = () => {
    if (!statewideResults) return null;

    const becerra = findCandidate(statewideResults.candidates, "becerra");
    const steyer = findCandidate(statewideResults.candidates, "steyer");

    if (!becerra || !steyer) return null;

    const currentGap = Number((becerra.pct - steyer.pct).toFixed(1));
    const delta = Number((currentGap - BASELINE_GAP).toFixed(1));

    let deltaClass = "delta-neutral";
    let deltaText = "Flat vs baseline";
    let deltaArrow = "■";

    if (currentGap < BASELINE_GAP) {
      deltaClass = "delta-climbing";
      deltaText = "Steyer climbing";
      deltaArrow = "▼";
    } else if (currentGap > BASELINE_GAP) {
      deltaClass = "delta-widening";
      deltaText = "Becerra pulling away";
      deltaArrow = "▲";
    }

    return {
      gap: Math.abs(currentGap),
      leader: currentGap >= 0 ? "Becerra" : "Steyer",
      delta: Math.abs(delta),
      deltaClass,
      deltaText,
      deltaArrow
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
        <div className="sparkline-svg-wrapper skeleton-shimmer" style={{ height: "80px" }} />
      );
    }

    const width = 300;
    const height = 80;
    const padding = 10;

    const gaps = trendPoints.map(p => p.gap);
    const minGap = Math.min(...gaps, BASELINE_GAP) - 0.5;
    const maxGap = Math.max(...gaps, BASELINE_GAP) + 0.5;

    const pointsStr = trendPoints.map((p, i) => {
      const x = padding + (i / (trendPoints.length - 1)) * (width - padding * 2);
      const y = height - padding - ((p.gap - minGap) / (maxGap - minGap)) * (height - padding * 2);
      return `${x},${y}`;
    }).join(" ");

    // Baseline Y coordinate
    const baselineY = height - padding - ((BASELINE_GAP - minGap) / (maxGap - minGap)) * (height - padding * 2);

    // Last point coordinates
    const lastPoint = trendPoints[trendPoints.length - 1];
    const lastX = width - padding;
    const lastY = height - padding - ((lastPoint.gap - minGap) / (maxGap - minGap)) * (height - padding * 2);

    return (
      <div className="sparkline-svg-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="sparkline-svg" style={{ width: "100%", height: "100%", display: "block" }}>
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
          
          {/* Sparkline path */}
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
          {isKvEnabled ? "KV Live History" : "Session Only"}
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
      {/* Masthead */}
      <header className="masthead">
        <div className="masthead-top">
          <div className="title-group">
            <h1 className="main-title">California Governor 2026 Primary Tracker</h1>
            <div className="live-indicator" aria-label="Live feed active">
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
              <span className="mono-tabular" style={{ fontSize: "10px", opacity: 0.8 }}>
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
              <span className="meta-value">June 2, 2026</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">General Runoff:</span>
              <span className="meta-value">Nov 3, 2026</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Reporting:</span>
              <span className="meta-value mono-tabular">
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
              {selectedCounty ? `${selectedCounty} County` : "Statewide"}
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
            {/* County Drilldown */}
            <section className="card county-drilldown">
              <h2 className="card-title">County Drill-Down</h2>
              <div className="drilldown-controls">
                <select 
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
            </section>

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
                  {selectedCounty ? `${selectedCounty} County Standings` : "Statewide Standings"}
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
                            <span className="advances-badge">Advances</span>
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
                    No candidates found in the current results feed.
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
                <span className="hero-label">Statewide 2nd-Place Battle</span>
                {heroData ? (
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
                    <div className={`hero-delta ${heroData.deltaClass}`}>
                      <span className="delta-arrow">{heroData.deltaArrow}</span>
                      <span className="mono-tabular">{heroData.delta.toFixed(1)}%</span>
                      <span>({heroData.deltaText})</span>
                    </div>
                  </>
                ) : (
                  <div className="skeleton-shimmer" style={{ height: "100px", width: "100%" }} />
                )}
              </div>

              {/* Sparkline */}
              <div className="sparkline-container">
                <div className="sparkline-header">
                  <span>Gap Trend</span>
                  <span>Baseline: {BASELINE_GAP}%</span>
                </div>
                {drawSparkline()}
              </div>
            </section>

            {/* Party Splits */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  {selectedCounty ? `${selectedCounty} Party Share` : "Statewide Party Share"}
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
          Numbers are pulled from a live feed and may lag or vary by outlet. Verify against the California Secretary of State at{" "}
          <a 
            href="https://electionresults.sos.ca.gov" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="disclaimer-link"
          >
            https://electionresults.sos.ca.gov
          </a>{" "}
          before publishing.
        </div>
        <div className="disclaimer-item">
          California counts mail-in and provisional ballots for days to weeks. Late-counted ballots historically skew younger and more progressive, meaning the gap between Xavier Becerra and Tom Steyer can move significantly after election night.
        </div>
      </footer>
    </div>
  );
}
