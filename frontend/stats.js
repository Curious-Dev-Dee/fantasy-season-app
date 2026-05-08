import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

/* ─── DOM REFS ────────────────────────────────────────────────────── */
const searchInput    = document.getElementById("playerSearch");
const teamFilter     = document.getElementById("teamFilter");
const matchFilter    = document.getElementById("matchFilter");
const roleFilter     = document.getElementById("roleFilter");
const statsContainer = document.getElementById("statsContainer");
const statsSub       = document.querySelector(".stats-sub");

/* ─── STATE ───────────────────────────────────────────────────────── */
let isLoading    = false;
let pendingLoad  = false;
let allPlayers   = [];
let ownershipMap = new Map();
let totalFantasyTeams = 0;
let liveMatchIds = new Set();

/* ─── INIT ────────────────────────────────────────────────────────── */
async function initStats() {
    try { await authReady; } catch (_) { return; }

    // Count total fantasy teams for ownership %
    const [teamsRes, matchesRes, ownershipRes, totalTeamsRes] = await Promise.all([
        supabase.from("real_teams").select("short_code").order("short_code"),
        supabase
            .from("matches")
            .select("id, match_number, is_locked, points_processed, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .or("points_processed.eq.true,is_locked.eq.true")
            .order("match_number", { ascending: false }),
        supabase.from("user_fantasy_team_players").select("player_id"),
        supabase.from("user_fantasy_teams").select("id", { count: "exact", head: true }),
    ]);

    if (teamsRes.data) {
        teamsRes.data.forEach(t => {
            const opt = document.createElement("option");
            opt.value = t.short_code;
            opt.textContent = t.short_code;
            teamFilter.appendChild(opt);
        });
    }

    if (matchesRes.data) {
        matchesRes.data.forEach(m => {
            // Mark live: locked but points not yet processed
            const isLive = m.is_locked && !m.points_processed;
            if (isLive) liveMatchIds.add(m.id);

            const opt = document.createElement("option");
            opt.value = m.id;
            opt.dataset.live = isLive ? "true" : "false";
            opt.textContent = `${isLive ? "🔴 LIVE — " : ""}M${m.match_number}: ${m.team_a?.short_code || "?"} vs ${m.team_b?.short_code || "?"}`;
            matchFilter.appendChild(opt);
        });
    }

    if (ownershipRes.data) {
        ownershipRes.data.forEach(r => {
            ownershipMap.set(r.player_id, (ownershipMap.get(r.player_id) || 0) + 1);
        });
    }

    totalFantasyTeams = totalTeamsRes.count || 27;

    await loadPlayerStats();
}

/* ─── LOAD ────────────────────────────────────────────────────────── */
async function loadPlayerStats() {
    if (isLoading) { pendingLoad = true; return; }
    isLoading   = true;
    pendingLoad = false;
    setFiltersDisabled(true);
    document.getElementById("skeletonScreen")?.classList.remove("hidden");
    statsContainer.innerHTML = "";

    const searchTerm = searchInput.value.toLowerCase().trim();
    const team       = teamFilter.value;
    const matchId    = matchFilter.value;
    const role       = roleFilter.value;
    const isLiveMatch = matchId && liveMatchIds.has(matchId);

    try {
        let query = supabase
            .from("player_match_stats")
            .select(`
                *,
                player:players!inner(
                    name, role, photo_url, category,
                    team:real_teams!inner(short_code)
                ),
                match:matches!inner(
                    match_number, is_locked, points_processed,
                    team_a:real_teams!team_a_id(short_code),
                    team_b:real_teams!team_b_id(short_code)
                )
            `);

        if (team)    query = query.eq("player.team.short_code", team);
        if (matchId) query = query.eq("match_id", matchId);
        else {
            // Show all: points processed OR (locked AND not processed = live)
            query = query.or("match.points_processed.eq.true,and(match.is_locked.eq.true,match.points_processed.eq.false)");
        }

        const { data: stats, error } = await query.order("fantasy_points", { ascending: false });

        if (error || !stats) {
            statsContainer.appendChild(buildEmptyState("No data available."));
            updateSubtitle(0, 0, false);
            return;
        }

        /* ── AGGREGATE ──────────────────────────────────────────── */
        const playerAgg = {};
        const matchAgg  = {};
        const teamAgg   = {};
        const roleAgg   = { BAT: 0, BOWL: 0, AR: 0, WK: 0 };
        const catAgg    = { none: 0, overseas: 0, uncapped: 0 };

        stats.forEach(row => {
            const pid      = row.player_id;
            const pts      = row.fantasy_points || 0;
            const pRole    = (row.player?.role || "BAT").toUpperCase();
            const pCat     = (row.player?.category || "none").toLowerCase();
            const pTeam    = row.player?.team?.short_code || "TBA";
            const mNum     = row.match?.match_number || 0;
            const rowLive  = row.match?.is_locked && !row.match?.points_processed;

            /* player */
            if (!playerAgg[pid]) {
                playerAgg[pid] = {
                    id: pid,
                    name: row.player?.name || "Unknown",
                    role: row.player?.role || "—",
                    team: pTeam,
                    photo: row.player?.photo_url || null,
                    category: pCat,
                    totalPoints: 0, matchesPlayed: 0,
                    totalRuns: 0, totalWickets: 0,
                    totalCatches: 0, totalFours: 0, totalSixes: 0,
                    highestScore: 0, lowestScore: Infinity,
                    fiftyPlusScores: 0, centuryPlusScores: 0,
                    matches: [],
                    hasLiveData: false,
                };
            }
            const p = playerAgg[pid];
            p.totalPoints    += pts;
            p.matchesPlayed  += 1;
            p.totalRuns      += row.runs    || 0;
            p.totalWickets   += row.wickets || 0;
            p.totalCatches   += row.catches || 0;
            p.totalFours     += row.fours   || 0;
            p.totalSixes     += row.sixes   || 0;
            if (pts > p.highestScore) p.highestScore = pts;
            if (pts < p.lowestScore)  p.lowestScore  = pts;
            if (pts >= 50)  p.fiftyPlusScores++;
            if (pts >= 100) p.centuryPlusScores++;
            if (rowLive) p.hasLiveData = true;
            p.matches.push({ ...row, matchNumber: mNum, isLive: rowLive });

            /* match */
            if (!matchAgg[mNum]) matchAgg[mNum] = {
                matchNumber: mNum, totalPts: 0, isLive: rowLive,
                label: `M${mNum}: ${row.match?.team_a?.short_code || "?"} vs ${row.match?.team_b?.short_code || "?"}`
            };
            matchAgg[mNum].totalPts += pts;

            /* team */
            if (!teamAgg[pTeam]) teamAgg[pTeam] = { team: pTeam, totalPts: 0 };
            teamAgg[pTeam].totalPts += pts;

            /* role */
            if (roleAgg[pRole] !== undefined) roleAgg[pRole] += pts;
            else roleAgg["BAT"] += pts;

            /* category */
            if (catAgg[pCat] !== undefined) catAgg[pCat] += pts;
            else catAgg["none"] += pts;
        });

        Object.values(playerAgg).forEach(p => {
            if (p.lowestScore === Infinity) p.lowestScore = p.highestScore;
        });

        allPlayers = Object.values(playerAgg).sort((a, b) => b.totalPoints - a.totalPoints);

        let filtered = allPlayers;
        if (role)       filtered = filtered.filter(p => p.role.toUpperCase() === role);
        if (searchTerm) filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));

        const isFiltering = !!(searchTerm || team || matchId || role);
        renderStatsDashboard(filtered, isFiltering, matchAgg, teamAgg, roleAgg, catAgg, isLiveMatch);

    } finally {
        isLoading = false;
        document.getElementById("skeletonScreen")?.classList.add("hidden");
        setFiltersDisabled(false);
        if (pendingLoad) loadPlayerStats();
    }
}

function setFiltersDisabled(d) {
    teamFilter.disabled = matchFilter.disabled = roleFilter.disabled = d;
}

/* ─── RENDER DASHBOARD ────────────────────────────────────────────── */
function renderStatsDashboard(players, isFiltering, matchAgg, teamAgg, roleAgg, catAgg, isLiveMatch) {
    statsContainer.replaceChildren();

    if (!players.length) {
        statsContainer.appendChild(buildEmptyState("No players found."));
        updateSubtitle(0, 0, false);
        return;
    }

    const maxMatches = Math.max(...players.map(p => p.matchesPlayed));
    updateSubtitle(players.length, maxMatches, isLiveMatch);

    // Inject live banner if viewing a live match
    if (isLiveMatch) {
        statsContainer.appendChild(buildLiveBanner());
    }

    if (!isFiltering) {
        statsContainer.appendChild(buildSummaryBar(allPlayers, matchAgg, roleAgg));
        statsContainer.appendChild(buildFormReport(allPlayers));
        statsContainer.appendChild(buildAdSlot());
        statsContainer.appendChild(buildPlayerTiers(allPlayers));
        statsContainer.appendChild(buildTargetIntelligence(teamAgg, roleAgg, catAgg));
        statsContainer.appendChild(buildMatchHeatmap(matchAgg));
        statsContainer.appendChild(buildPointsShare(roleAgg, catAgg));
        statsContainer.appendChild(buildOwnershipSection(allPlayers));
        statsContainer.appendChild(buildAdSlot());

        const dirHeader = document.createElement("div");
        dirHeader.className = "st-dir-header";
        dirHeader.innerHTML = `<h3>Player Directory</h3><span class="dir-count">${players.length} players</span>`;
        statsContainer.appendChild(dirHeader);
    }

    players.forEach((player, idx) => statsContainer.appendChild(buildPlayerCard(player, idx + 1)));
    statsContainer.appendChild(buildAdSlot());
}

function updateSubtitle(playerCount, maxMatches, isLive) {
    if (statsSub) {
        statsSub.innerHTML = `
            <span>${playerCount} players</span>
            <span class="sub-dot">·</span>
            <span>${maxMatches} matches</span>
            ${isLive ? `<span class="sub-dot">·</span><span class="sub-live-badge">🔴 LIVE</span>` : ""}
        `;
    }
}

/* ════════════════════════════════════════════════════════════════════
   LIVE BANNER
════════════════════════════════════════════════════════════════════ */
function buildLiveBanner() {
    const banner = document.createElement("div");
    banner.className = "live-banner";
    banner.innerHTML = `
        <div class="live-pulse"></div>
        <div class="live-banner-text">
            <strong>Match In Progress</strong>
            <span>Points update live as the match progresses. Scores may change.</span>
        </div>
        <div class="live-banner-icon">⚡</div>
    `;
    return banner;
}

/* ════════════════════════════════════════════════════════════════════
   SUMMARY BAR — quick season glance
════════════════════════════════════════════════════════════════════ */
function buildSummaryBar(players, matchAgg, roleAgg) {
    const totalMatches = Object.keys(matchAgg).length;
    const totalPts     = players.reduce((s, p) => s + p.totalPoints, 0);
    const topScorer    = players[0];
    const totalRuns    = players.reduce((s, p) => s + p.totalRuns, 0);
    const totalWickets = players.reduce((s, p) => s + p.totalWickets, 0);
    const liveCount    = Object.values(matchAgg).filter(m => m.isLive).length;

    const bar = document.createElement("div");
    bar.className = "st-summary-bar";
    bar.innerHTML = `
        <div class="st-summary-item">
            <span class="ss-icon">🏏</span>
            <div class="ss-data">
                <strong>${totalMatches}</strong>
                <small>Matches${liveCount ? ` <span class="ss-live-tag">${liveCount} live</span>` : ""}</small>
            </div>
        </div>
        <div class="st-summary-item">
            <span class="ss-icon">⭐</span>
            <div class="ss-data">
                <strong>${players.length}</strong>
                <small>Players Tracked</small>
            </div>
        </div>
        <div class="st-summary-item">
            <span class="ss-icon">🔥</span>
            <div class="ss-data">
                <strong>${topScorer?.name.split(" ").pop() || "—"}</strong>
                <small>Top Scorer · ${topScorer?.totalPoints || 0} pts</small>
            </div>
        </div>
        <div class="st-summary-item">
            <span class="ss-icon">🎯</span>
            <div class="ss-data">
                <strong>${totalRuns.toLocaleString()}</strong>
                <small>Total Runs</small>
            </div>
        </div>
        <div class="st-summary-item">
            <span class="ss-icon">🎳</span>
            <div class="ss-data">
                <strong>${totalWickets}</strong>
                <small>Total Wickets</small>
            </div>
        </div>
        <div class="st-summary-item">
            <span class="ss-icon">💎</span>
            <div class="ss-data">
                <strong>${totalPts.toLocaleString()}</strong>
                <small>Total Fantasy Pts</small>
            </div>
        </div>
    `;
    return bar;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION FACTORY
════════════════════════════════════════════════════════════════════ */
function createSection(icon, colorClass, title, subtitle) {
    const sec = document.createElement("div");
    sec.className = "st-section";
    sec.innerHTML = `
        <div class="st-section-header">
            <div class="st-section-icon ${colorClass}"><i class="${icon}"></i></div>
            <div class="st-section-titles">
                <h3 class="st-section-title">${title}</h3>
                ${subtitle ? `<p class="st-section-sub">${subtitle}</p>` : ""}
            </div>
        </div>
        <div class="st-section-body"></div>`;
    return sec;
}

/* ── 1. FORM REPORT ───────────────────────────────────────────────── */
function buildFormReport(players) {
    const sec  = createSection("fas fa-fire", "rd", "Form Report", "Last 3 matches vs season average");
    const body = sec.querySelector(".st-section-body");

    const withForm = players
        .filter(p => p.matchesPlayed >= 3)
        .map(p => {
            const sorted    = [...p.matches].sort((a, b) => b.matchNumber - a.matchNumber);
            const last3Avg  = sorted.slice(0, 3).reduce((s, m) => s + (m.fantasy_points || 0), 0) / 3;
            const seasonAvg = p.totalPoints / p.matchesPlayed;
            const delta     = last3Avg - seasonAvg;
            const ownership = Math.round(((ownershipMap.get(p.id) || 0) / totalFantasyTeams) * 100);
            return { ...p, last3Avg: Math.round(last3Avg), seasonAvg: Math.round(seasonAvg), delta: Math.round(delta), ownership };
        });

    const hot  = withForm.filter(p => p.delta >= 15).sort((a, b) => b.delta - a.delta).slice(0, 8);
    const cold = withForm.filter(p => p.delta <= -15).sort((a, b) => a.delta - b.delta).slice(0, 8);

    body.innerHTML = `
        <div class="st-form-grid">
            <div class="st-form-col">
                <div class="st-form-col-header hot-header">
                    <span>🔥 In Form — Trending Up</span>
                    <span class="st-form-col-count">${hot.length}</span>
                </div>
                <div class="st-form-cards">
                    ${hot.length ? hot.map(p => `
                        <div class="st-form-card hot">
                            <div class="sfc-top">
                                <div class="sfc-avatar ${avatarColorClass(p.role)}">${p.name.slice(0,2).toUpperCase()}</div>
                                <div class="sfc-info">
                                    <span class="sfc-name">${p.name}</span>
                                    <span class="sfc-meta">${p.team} · ${p.role}</span>
                                </div>
                                <div class="sfc-delta hot-delta">+${p.delta}</div>
                            </div>
                            <div class="sfc-stats">
                                <div class="sfc-stat"><small>Last 3 avg</small><strong>${p.last3Avg}</strong></div>
                                <div class="sfc-stat"><small>Season avg</small><strong>${p.seasonAvg}</strong></div>
                                <div class="sfc-stat"><small>Owned by</small><strong>${p.ownership}%</strong></div>
                            </div>
                        </div>`).join("")
                    : `<div class="st-no-data-card">Not enough data yet</div>`}
                </div>
            </div>
            <div class="st-form-col">
                <div class="st-form-col-header cold-header">
                    <span>❄️ Out of Form — Dropping</span>
                    <span class="st-form-col-count">${cold.length}</span>
                </div>
                <div class="st-form-cards">
                    ${cold.length ? cold.map(p => `
                        <div class="st-form-card cold">
                            <div class="sfc-top">
                                <div class="sfc-avatar ${avatarColorClass(p.role)}">${p.name.slice(0,2).toUpperCase()}</div>
                                <div class="sfc-info">
                                    <span class="sfc-name">${p.name}</span>
                                    <span class="sfc-meta">${p.team} · ${p.role}</span>
                                </div>
                                <div class="sfc-delta cold-delta">${p.delta}</div>
                            </div>
                            <div class="sfc-stats">
                                <div class="sfc-stat"><small>Last 3 avg</small><strong>${p.last3Avg}</strong></div>
                                <div class="sfc-stat"><small>Season avg</small><strong>${p.seasonAvg}</strong></div>
                                <div class="sfc-stat"><small>Owned by</small><strong>${p.ownership}%</strong></div>
                            </div>
                        </div>`).join("")
                    : `<div class="st-no-data-card">No dropping players found</div>`}
                </div>
            </div>
        </div>`;
    return sec;
}

/* ── 2. PLAYER TIERS ──────────────────────────────────────────────── */
function buildPlayerTiers(players) {
    const sec  = createSection("fas fa-layer-group", "pu", "Player Tiers", "AI-classified performance buckets");
    const body = sec.querySelector(".st-section-body");

    const tiers = {
        core:        { label: "🏆 Core",         desc: "Consistent high scorers. Must have.",         hint: "Safe pick every week",          color: "tier-core",   players: [] },
        differential:{ label: "⚡ Differential",  desc: "High ceiling, low ownership.",                hint: "Pick to gain rank",             color: "tier-diff",   players: [] },
        wonder:      { label: "✨ Wonder",         desc: "One massive game, rest average.",             hint: "Avoid as captain",              color: "tier-wonder", players: [] },
        flop:        { label: "💀 Avoid",          desc: "Consistently low scoring.",                   hint: "Bench or transfer out",         color: "tier-flop",   players: [] },
    };

    players.filter(p => p.matchesPlayed >= 3).forEach(p => {
        const avg            = p.totalPoints / p.matchesPlayed;
        const ownership      = ((ownershipMap.get(p.id) || 0) / totalFantasyTeams) * 100;
        const goodMatches    = p.matches.filter(m => (m.fantasy_points || 0) >= 50).length;
        const consistencyPct = (goodMatches / p.matchesPlayed) * 100;

        if (avg >= 60 && consistencyPct >= 50)             tiers.core.players.push({ ...p, avg: Math.round(avg), ownership: Math.round(ownership), consistencyPct: Math.round(consistencyPct) });
        else if (p.highestScore >= 100 && avg >= 35 && ownership < 50) tiers.differential.players.push({ ...p, avg: Math.round(avg), ownership: Math.round(ownership), consistencyPct: Math.round(consistencyPct) });
        else if (p.highestScore >= 100 && avg < 40)        tiers.wonder.players.push({ ...p, avg: Math.round(avg), ownership: Math.round(ownership), consistencyPct: Math.round(consistencyPct) });
        else if (avg < 25)                                  tiers.flop.players.push({ ...p, avg: Math.round(avg), ownership: Math.round(ownership), consistencyPct: Math.round(consistencyPct) });
    });

    body.innerHTML = `
        <div class="st-tiers-grid">
            ${Object.values(tiers).map(tier => `
                <div class="st-tier-block ${tier.color}">
                    <div class="st-tier-top">
                        <div class="st-tier-left">
                            <span class="st-tier-label">${tier.label}</span>
                            <span class="st-tier-hint">${tier.hint}</span>
                        </div>
                        <span class="st-tier-count">${tier.players.length}</span>
                    </div>
                    <p class="st-tier-desc">${tier.desc}</p>
                    <div class="st-tier-players">
                        ${tier.players.length
                            ? tier.players.slice(0, 10).map(p => `
                                <div class="st-tier-player">
                                    <div class="stp-avatar ${avatarColorClass(p.role)}">${p.name.slice(0,2).toUpperCase()}</div>
                                    <div class="stp-info">
                                        <span class="stp-name">${p.name}</span>
                                        <span class="stp-meta">${p.team}</span>
                                    </div>
                                    <div class="stp-stats">
                                        <span class="stp-avg">${p.avg} avg</span>
                                        <span class="stp-own">👥 ${p.ownership}%</span>
                                    </div>
                                </div>`).join("")
                            : `<div class="st-no-data-sm">None yet</div>`}
                    </div>
                </div>`).join("")}
        </div>`;
    return sec;
}

/* ── 3. TARGET INTELLIGENCE ───────────────────────────────────────── */
function buildTargetIntelligence(teamAgg, roleAgg, catAgg) {
    const sec  = createSection("fas fa-crosshairs", "gd", "Target Intelligence", "Where to focus your picks");
    const body = sec.querySelector(".st-section-body");

    const teams     = Object.values(teamAgg).sort((a, b) => b.totalPts - a.totalPts).slice(0, 6);
    const maxTeam   = teams[0]?.totalPts || 1;
    const roles     = Object.entries(roleAgg).sort((a, b) => b[1] - a[1]);
    const totalRole = Object.values(roleAgg).reduce((s, v) => s + v, 0) || 1;
    const cats      = Object.entries(catAgg).sort((a, b) => b[1] - a[1]);
    const totalCat  = Object.values(catAgg).reduce((s, v) => s + v, 0) || 1;

    const roleLabels = { BAT: "Batsmen", BOWL: "Bowlers", AR: "All-Rounders", WK: "Wicket-Keepers" };
    const roleIcons  = { BAT: "🏏", BOWL: "🎳", AR: "⚡", WK: "🧤" };
    const catLabels  = { none: "Indian", overseas: "Overseas", uncapped: "Uncapped" };
    const catIcons   = { none: "🇮🇳", overseas: "🌍", uncapped: "⭐" };
    const catColors  = { none: "#9AE000", overseas: "#38bdf8", uncapped: "#f59e0b" };
    const roleColors = { BAT: "#38bdf8", BOWL: "#f43f5e", AR: "#9AE000", WK: "#a78bfa" };
    const teamColors = ["#9AE000", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e", "#fb923c"];
    const medals     = ["🥇", "🥈", "🥉", "", "", ""];

    body.innerHTML = `
        <div class="st-intel-grid">
            <div class="st-intel-card wide">
                <div class="st-intel-title">🏟️ Best Teams to Target</div>
                <p class="st-intel-note">Total fantasy points earned by each team's players this season</p>
                <div class="st-bar-list">
                    ${teams.map((t, i) => `
                        <div class="st-bar-row">
                            <span class="st-bar-label">${medals[i] || ""} ${t.team}</span>
                            <div class="st-bar-track">
                                <div class="st-bar-fill" style="width:${Math.round((t.totalPts / maxTeam) * 100)}%;background:${teamColors[i]}"></div>
                                <span class="st-bar-inline-val">${t.totalPts} pts</span>
                            </div>
                        </div>`).join("")}
                </div>
            </div>
            <div class="st-intel-card">
                <div class="st-intel-title">🎭 Points by Role</div>
                <p class="st-intel-note">Which role generates the most fantasy value</p>
                <div class="st-role-bars">
                    ${roles.map(([role, pts]) => {
                        const pct = Math.round((pts / totalRole) * 100);
                        return `
                            <div class="st-role-row">
                                <div class="st-role-left">
                                    <span class="st-role-icon">${roleIcons[role] || "🏏"}</span>
                                    <span class="st-role-name">${roleLabels[role] || role}</span>
                                </div>
                                <div class="st-role-track">
                                    <div class="st-role-fill" style="width:${pct}%;background:${roleColors[role] || "#9AE000"}"></div>
                                </div>
                                <span class="st-role-pct" style="color:${roleColors[role] || "#9AE000"}">${pct}%</span>
                            </div>`;
                    }).join("")}
                </div>
            </div>
            <div class="st-intel-card">
                <div class="st-intel-title">🌍 Points by Category</div>
                <p class="st-intel-note">Overseas vs Indian vs Uncapped contribution</p>
                <div class="st-role-bars">
                    ${cats.map(([cat, pts]) => {
                        const pct = Math.round((pts / totalCat) * 100);
                        return `
                            <div class="st-role-row">
                                <div class="st-role-left">
                                    <span class="st-role-icon">${catIcons[cat] || "🌐"}</span>
                                    <span class="st-role-name">${catLabels[cat] || cat}</span>
                                </div>
                                <div class="st-role-track">
                                    <div class="st-role-fill" style="width:${pct}%;background:${catColors[cat] || "#9AE000"}"></div>
                                </div>
                                <span class="st-role-pct" style="color:${catColors[cat] || "#9AE000"}">${pct}%</span>
                            </div>`;
                    }).join("")}
                </div>
            </div>
        </div>`;
    return sec;
}

/* ── 4. MATCH HEATMAP ─────────────────────────────────────────────── */
function buildMatchHeatmap(matchAgg) {
    const sec  = createSection("fas fa-chart-column", "bl", "Match Heatmap", "Total fantasy points per match");
    const body = sec.querySelector(".st-section-body");

    const matches = Object.values(matchAgg).sort((a, b) => a.matchNumber - b.matchNumber);
    if (!matches.length) { body.innerHTML = `<p class="st-no-data">No match data yet.</p>`; return sec; }

    const maxPts = Math.max(...matches.map(m => m.totalPts));
    const minPts = Math.min(...matches.map(m => m.totalPts));
    const avg    = Math.round(matches.reduce((s, m) => s + m.totalPts, 0) / matches.length);

    body.innerHTML = `
        <div class="st-hm-meta">
            <div class="st-hm-stat"><span>📊</span><div><strong>${avg}</strong><small>Season Avg</small></div></div>
            <div class="st-hm-stat"><span>🔝</span><div><strong>${maxPts}</strong><small>Best Match</small></div></div>
            <div class="st-hm-stat"><span>📉</span><div><strong>${minPts}</strong><small>Lowest Match</small></div></div>
            <div class="st-hm-stat"><span>🏏</span><div><strong>${matches.length}</strong><small>Matches</small></div></div>
        </div>
        <div class="st-heatmap-wrap">
            <div class="st-heatmap-bars">
                ${matches.map(m => {
                    const pct   = Math.max(8, Math.round((m.totalPts / maxPts) * 100));
                    const isTop = m.totalPts === maxPts;
                    const isLow = m.totalPts === minPts;
                    const color = m.isLive ? "#f59e0b"
                        : isTop ? "#9AE000"
                        : isLow ? "#ef4444"
                        : m.totalPts >= avg ? "rgba(154,224,0,0.5)" : "rgba(148,163,184,0.2)";
                    return `
                        <div class="st-hm-col" title="${m.label}: ${m.totalPts} pts${m.isLive ? ' (LIVE)' : ''}">
                            <span class="st-hm-val">${m.isLive ? "⚡" : m.totalPts}</span>
                            <div class="st-hm-bar ${m.isLive ? 'live-bar' : ''}" style="height:${pct}%;background:${color}"></div>
                            <span class="st-hm-label">M${m.matchNumber}</span>
                        </div>`;
                }).join("")}
            </div>
            <div class="st-hm-avg-line" style="bottom:calc(${Math.round((avg / maxPts) * 100)}% + 28px)">
                <span>avg ${avg}</span>
            </div>
        </div>
        <div class="st-heatmap-legend">
            <span class="st-hl-item"><span class="st-hl-dot" style="background:#9AE000"></span>Best</span>
            <span class="st-hl-item"><span class="st-hl-dot" style="background:#ef4444"></span>Lowest</span>
            <span class="st-hl-item"><span class="st-hl-dot" style="background:rgba(154,224,0,0.5)"></span>Above avg</span>
            <span class="st-hl-item"><span class="st-hl-dot" style="background:#f59e0b"></span>🔴 Live</span>
        </div>`;
    return sec;
}

/* ── 5. POINTS SHARE ──────────────────────────────────────────────── */
function buildPointsShare(roleAgg, catAgg) {
    const sec  = createSection("fas fa-chart-pie", "pu", "Points Share", "Season contribution breakdown");
    const body = sec.querySelector(".st-section-body");

    const totalRole = Object.values(roleAgg).reduce((s, v) => s + v, 0) || 1;
    const totalCat  = Object.values(catAgg).reduce((s, v) => s + v, 0) || 1;

    const roleColors = { BAT: "#38bdf8", BOWL: "#f43f5e", AR: "#9AE000", WK: "#a78bfa" };
    const catColors  = { none: "#9AE000", overseas: "#38bdf8", uncapped: "#f59e0b" };
    const roleLabels = { BAT: "🏏 Batsmen", BOWL: "🎳 Bowlers", AR: "⚡ All-Rounders", WK: "🧤 Keepers" };
    const catLabels  = { none: "🇮🇳 Indian", overseas: "🌍 Overseas", uncapped: "⭐ Uncapped" };

    const buildSegBar = (agg, colors, total) =>
        Object.entries(agg).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `<div class="st-seg" style="width:${Math.round((v/total)*100)}%;background:${colors[k]||"#555"}" title="${k}: ${Math.round((v/total)*100)}%"></div>`)
            .join("");

    const buildLegend = (agg, labels, colors, total) =>
        Object.entries(agg).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => {
                const pct = Math.round((v / total) * 100);
                return `
                    <div class="st-ps-item">
                        <span class="st-ps-dot" style="background:${colors[k]||"#555"}"></span>
                        <span class="st-ps-name">${labels[k] || k}</span>
                        <div class="st-ps-right">
                            <span class="st-ps-pct" style="color:${colors[k]||"#fff"}">${pct}%</span>
                            <span class="st-ps-pts">${v.toLocaleString()} pts</span>
                        </div>
                    </div>`;
            }).join("");

    body.innerHTML = `
        <div class="st-ps-grid">
            <div class="st-ps-block">
                <div class="st-ps-title">By Role</div>
                <div class="st-ps-bar">${buildSegBar(roleAgg, roleColors, totalRole)}</div>
                <div class="st-ps-legend">${buildLegend(roleAgg, roleLabels, roleColors, totalRole)}</div>
            </div>
            <div class="st-ps-block">
                <div class="st-ps-title">By Category</div>
                <div class="st-ps-bar">${buildSegBar(catAgg, catColors, totalCat)}</div>
                <div class="st-ps-legend">${buildLegend(catAgg, catLabels, catColors, totalCat)}</div>
            </div>
        </div>`;
    return sec;
}

/* ── 6. OWNERSHIP ─────────────────────────────────────────────────── */
function buildOwnershipSection(players) {
    const sec  = createSection("fas fa-users", "gd", "Fantasy Ownership", "See who your rivals have picked");
    const body = sec.querySelector(".st-section-body");

    const withO = players
        .filter(p => p.matchesPlayed >= 2)
        .map(p => ({
            ...p,
            ownershipPct: Math.round(((ownershipMap.get(p.id) || 0) / totalFantasyTeams) * 100),
            avgPts: Math.round(p.totalPoints / p.matchesPlayed),
        }));

    const mostOwned     = [...withO].sort((a, b) => b.ownershipPct - a.ownershipPct).slice(0, 8);
    const differentials = [...withO]
        .filter(p => p.ownershipPct <= 30 && p.avgPts >= 40)
        .sort((a, b) => b.avgPts - a.avgPts)
        .slice(0, 8);

    const ownerRow = (p, isDiff) => `
        <div class="st-own-row">
            <div class="st-own-avatar ${avatarColorClass(p.role)}">${p.name.slice(0,2).toUpperCase()}</div>
            <div class="st-own-info">
                <span class="st-own-name">${p.name}</span>
                <span class="st-own-meta">${p.team} · ${p.role}</span>
            </div>
            <div class="st-own-mid">
                <div class="st-own-bar-wrap">
                    <div class="st-own-bar" style="width:${p.ownershipPct}%;background:${isDiff ? "#f59e0b" : "#9AE000"}"></div>
                </div>
                <span class="st-own-pct">${p.ownershipPct}%</span>
            </div>
            <div class="st-own-right">
                <span class="st-own-avg-pts">${p.avgPts}</span>
                <small>avg</small>
            </div>
        </div>`;

    body.innerHTML = `
        <div class="st-own-grid">
            <div class="st-own-block">
                <div class="st-own-title">👥 Most Picked</div>
                <p class="st-own-hint">Everyone has these — no rank advantage. Safe but predictable.</p>
                ${mostOwned.length ? mostOwned.map(p => ownerRow(p, false)).join("") : `<p class="st-no-data">No data yet</p>`}
            </div>
            <div class="st-own-block">
                <div class="st-own-title">💎 Differentials</div>
                <p class="st-own-hint">Low ownership but scoring well. These are your rank-up picks.</p>
                ${differentials.length ? differentials.map(p => ownerRow(p, true)).join("") : `<p class="st-no-data">No differentials found</p>`}
            </div>
        </div>`;
    return sec;
}

/* ════════════════════════════════════════════════════════════════════
   PLAYER CARD
════════════════════════════════════════════════════════════════════ */
function buildPlayerCard(player, rank) {
    const avg        = Math.round(player.totalPoints / player.matchesPlayed);
    const isElite    = avg >= 60;
    const sorted     = [...player.matches].sort((a, b) => b.matchNumber - a.matchNumber);
    const last3Avg   = sorted.slice(0, 3).reduce((s, m) => s + (m.fantasy_points || 0), 0) / Math.min(3, sorted.length);
    const isHot      = player.matchesPlayed >= 3 && last3Avg >= avg * 1.2;
    const isCold     = player.matchesPlayed >= 3 && last3Avg <= avg * 0.75;
    const formTag    = isHot ? "🔥" : isCold ? "❄️" : "";
    const ownPct     = Math.round(((ownershipMap.get(player.id) || 0) / totalFantasyTeams) * 100);
    const consistPct = Math.round((player.fiftyPlusScores / player.matchesPlayed) * 100);

    const card = document.createElement("div");
    card.className = `player-card ${isElite ? "elite-border" : ""} ${player.hasLiveData ? "live-border" : ""}`;

    const hdr = document.createElement("div");
    hdr.className = "player-header";
    hdr.setAttribute("role", "button");
    hdr.setAttribute("aria-expanded", "false");
    hdr.onclick = () => {
        card.classList.toggle("active");
        hdr.setAttribute("aria-expanded", card.classList.contains("active") ? "true" : "false");
    };

    /* avatar */
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "player-avatar-wrap";
    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    if (player.photo) {
        const { data } = supabase.storage.from("player-photos").getPublicUrl(player.photo);
        avatar.style.backgroundImage = `url('${data.publicUrl}')`;
    } else {
        avatar.textContent = player.name.slice(0, 2).toUpperCase();
        avatar.classList.add("avatar-initials", avatarColorClass(player.role));
    }
    if (player.hasLiveData) {
        const liveDot = document.createElement("div");
        liveDot.className = "player-live-dot";
        avatarWrap.appendChild(liveDot);
    }
    avatarWrap.appendChild(avatar);

    /* info */
    const info    = document.createElement("div");
    info.className = "player-info";

    const nameRow = document.createElement("div");
    nameRow.className = "player-name-row";
    const rankEl  = document.createElement("span");
    rankEl.className = "player-rank";
    rankEl.textContent = `#${rank}`;
    const nameTxt = document.createElement("span");
    nameTxt.className = "player-name";
    nameTxt.textContent = player.name;
    if (formTag) {
        const tag = document.createElement("span");
        tag.className = "player-form-tag";
        tag.textContent = formTag;
        nameTxt.appendChild(tag);
    }
    nameRow.append(rankEl, nameTxt);

    const meta = document.createElement("div");
    meta.className = "player-meta-row";
    meta.innerHTML = `
        <span class="team-badge tb-${player.team.toLowerCase()}">${player.team}</span>
        <span class="role-badge role-${player.role.toLowerCase()}">${player.role}</span>
        <span class="match-count">⚔️ ${player.matchesPlayed}M</span>
        <span class="own-badge">👥 ${ownPct}%</span>
        ${player.hasLiveData ? `<span class="live-tag-sm">🔴 LIVE</span>` : ""}`;
    info.append(nameRow, meta);

    /* quick stats row */
    const quickStats = document.createElement("div");
    quickStats.className = "player-quick-stats";
    quickStats.innerHTML = `
        <div class="pqs-item">
            <strong>${player.totalRuns}</strong>
            <small>runs</small>
        </div>
        <div class="pqs-divider"></div>
        <div class="pqs-item">
            <strong>${player.totalWickets}</strong>
            <small>wkts</small>
        </div>
        <div class="pqs-divider"></div>
        <div class="pqs-item">
            <strong>${player.totalCatches}</strong>
            <small>catches</small>
        </div>
        <div class="pqs-divider"></div>
        <div class="pqs-item">
            <strong>${consistPct}%</strong>
            <small>50+ rate</small>
        </div>
    `;

    /* score */
    const score = document.createElement("div");
    score.className = "player-score";
    score.innerHTML = `
        <div class="score-main"><strong>${player.totalPoints}</strong><small>pts</small></div>
        <div class="score-avg ${isElite ? "elite-avg" : ""}">${avg} avg</div>
        <div class="score-high">Best: ${player.highestScore}</div>
        <span class="dropdown-arrow">▼</span>`;

    hdr.append(avatarWrap, info, score);

    /* expanded detail */
    const detail = document.createElement("div");
    detail.className = "player-detail";

    // Stats summary strip
    const strip = document.createElement("div");
    strip.className = "player-stats-strip";
    strip.innerHTML = `
        <div class="pss-item">
            <span class="pss-icon">🏏</span>
            <strong>${player.totalRuns}</strong>
            <small>Total Runs</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">🎳</span>
            <strong>${player.totalWickets}</strong>
            <small>Wickets</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">🧤</span>
            <strong>${player.totalCatches}</strong>
            <small>Catches</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">4️⃣</span>
            <strong>${player.totalFours}</strong>
            <small>Fours</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">6️⃣</span>
            <strong>${player.totalSixes}</strong>
            <small>Sixes</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">🌟</span>
            <strong>${player.centuryPlusScores}</strong>
            <small>100+ Games</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">⬆️</span>
            <strong>${player.highestScore}</strong>
            <small>Best Score</small>
        </div>
        <div class="pss-item">
            <span class="pss-icon">⬇️</span>
            <strong>${player.lowestScore}</strong>
            <small>Worst Score</small>
        </div>
    `;
    detail.appendChild(strip);

    // Ownership insight
    const ownInsight = document.createElement("div");
    ownInsight.className = "player-own-insight";
    const ownColor  = ownPct >= 70 ? "#ef4444" : ownPct >= 40 ? "#f59e0b" : "#9AE000";
    const ownLabel  = ownPct >= 70 ? "Very Popular — Everyone has this player" : ownPct >= 40 ? "Popular — Common pick in most teams" : "Low Owned — Great differential pick";
    ownInsight.innerHTML = `
        <div class="poi-left">
            <span class="poi-icon">👥</span>
            <div>
                <strong>${ownPct}% ownership</strong>
                <small>${ownLabel}</small>
            </div>
        </div>
        <div class="poi-bar-wrap">
            <div class="poi-bar" style="width:${ownPct}%;background:${ownColor}"></div>
        </div>
    `;
    detail.appendChild(ownInsight);

    // Sparkline
    detail.appendChild(buildSparkline(sorted.slice(0, 8).reverse()));

    // Match history label
    const histLabel = document.createElement("div");
    histLabel.className = "history-label";
    histLabel.textContent = "Match-by-Match Breakdown";
    detail.appendChild(histLabel);

    [...player.matches].sort((a, b) => a.matchNumber - b.matchNumber)
        .forEach(m => detail.appendChild(buildHistoryRow(m)));

    card.append(hdr, detail);
    return card;
}

/* ── SPARKLINE ────────────────────────────────────────────────────── */
function buildSparkline(matches) {
    const wrap = document.createElement("div");
    wrap.className = "st-sparkline";
    if (!matches.length) return wrap;
    const pts = matches.map(m => m.fantasy_points || 0);
    const max = Math.max(...pts, 1);
    const avg = pts.reduce((s, v) => s + v, 0) / pts.length;
    wrap.innerHTML = `
        <div class="sp-bars">
            ${pts.map((v, i) => {
                const h    = Math.max(4, Math.round((v / max) * 52));
                const hot  = v >= avg * 1.2 && v >= 80;
                const bad  = v < 20;
                const live = matches[i]?.isLive;
                return `<div class="sp-bar ${hot ? "sp-hot" : bad ? "sp-bad" : ""} ${live ? "sp-live" : ""}" style="height:${h}px" title="${v} pts${live ? ' (live)' : ''}">
                    ${live ? '<span class="sp-live-pip"></span>' : ''}
                </div>`;
            }).join("")}
        </div>
        <div class="sp-label">Last ${pts.length} matches · avg <strong>${Math.round(avg)}</strong> pts/match</div>`;
    return wrap;
}

/* ── HISTORY ROW ──────────────────────────────────────────────────── */
function buildHistoryRow(m) {
    const pts      = m.fantasy_points || 0;
    const isBig    = pts >= 100;
    const isLive   = m.isLive;
    const row      = document.createElement("div");
    row.className  = `history-item ${isBig ? "big-game" : ""} ${isLive ? "live-match-row" : ""}`;

    const top = document.createElement("div");
    top.className = "h-top";
    top.innerHTML = `
        <span class="h-match">Match ${m.matchNumber || "#"} ${isLive ? '<span class="h-live-tag">🔴 LIVE</span>' : ''}</span>
        <span class="h-pts">${isBig ? "🌟 " : ""}+${pts} pts</span>`;

    const chips = document.createElement("div");
    chips.className = "detailed-stat-grid";
    const tags = buildStatChips(m);
    tags.length ? tags.forEach(t => chips.appendChild(t)) : chips.appendChild(buildChip("Played", "empty"));

    row.append(top, chips);
    return row;
}

/* ── STAT CHIPS ───────────────────────────────────────────────────── */
function buildStatChips(m) {
    const chips = [];
    if (m.runs > 0)                chips.push(buildChip(`🏏 ${m.runs}${m.balls ? ` (${m.balls}b)` : ""}`, "bat"));
    if (m.fours > 0 || m.sixes > 0) chips.push(buildChip(`🎯 ${m.fours || 0}×4  ${m.sixes || 0}×6`, "boundary"));
    if (m.sr_points && m.sr_points !== 0) chips.push(buildChip(`⚡ SR ${m.sr_points > 0 ? "+" : ""}${m.sr_points}`, "bonus"));
    if (m.milestone_points > 0)    chips.push(buildChip(`🏆 +${m.milestone_points} milestone`, "bonus"));
    if (m.boundary_points > 0)     chips.push(buildChip(`💥 +${m.boundary_points} boundary`, "bonus"));
    if (m.duck_penalty && m.duck_penalty < 0) chips.push(buildChip(`🦆 Duck ${m.duck_penalty}`, "penalty"));
    if (m.is_out)                   chips.push(buildChip(`❌ Out`, "penalty"));
    if (m.wickets > 0)              chips.push(buildChip(`🎳 ${m.wickets}W`, "bowl"));
    if (m.maidens > 0)              chips.push(buildChip(`🧱 ${m.maidens} Maiden${m.maidens > 1 ? "s" : ""}`, "bowl"));
    if (m.er_points && m.er_points !== 0) chips.push(buildChip(`📉 Econ ${m.er_points > 0 ? "+" : ""}${m.er_points}`, "bonus"));
    if (m.catches > 0)              chips.push(buildChip(`🧤 ${m.catches} Catch${m.catches > 1 ? "es" : ""}`, "field"));
    if (m.stumpings > 0)            chips.push(buildChip(`🏃 ${m.stumpings} Stumping${m.stumpings > 1 ? "s" : ""}`, "field"));
    const ro = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (ro > 0)                     chips.push(buildChip(`🎯 ${ro} Run Out`, "field"));
    if (m.is_player_of_match)       chips.push(buildChip("🏆 POM +20", "gold"));
    return chips;
}

function buildChip(text, type) {
    const chip = document.createElement("span");
    chip.className = `stat-tag ${type}`;
    chip.textContent = text;
    return chip;
}

function buildEmptyState(text) {
    const wrap = document.createElement("div");
    wrap.className = "empty-state";
    wrap.innerHTML = `<div class="es-icon">🏏</div><p>${text}</p>`;
    return wrap;
}

function buildAdSlot() {
    const d = document.createElement("div");
    d.className = "ad-slot";
    return d;
}

/* ── HELPERS ──────────────────────────────────────────────────────── */
function avatarColorClass(role) {
    const map = { BAT: "av-bat", BOWL: "av-bowl", AR: "av-ar", WK: "av-wk" };
    return map[(role || "").toUpperCase()] || "av-bat";
}

/* ─── EVENT LISTENERS ─────────────────────────────────────────────── */
let searchTimeout;
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadPlayerStats(), 400);
});
teamFilter.addEventListener("change",  () => loadPlayerStats());
matchFilter.addEventListener("change", () => loadPlayerStats());
roleFilter.addEventListener("change",  () => loadPlayerStats());

initStats();