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

/* ─── INIT ────────────────────────────────────────────────────────── */
async function initStats() {
    try { await authReady; } catch (_) { return; }

    const [teamsRes, matchesRes, ownershipRes] = await Promise.all([
        supabase.from("real_teams").select("short_code").order("short_code"),
        supabase
            .from("matches")
            .select("id, match_number, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("points_processed", true)
            .order("match_number", { ascending: false }),
        supabase.from("user_fantasy_team_players").select("player_id"),
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
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = `M${m.match_number}: ${m.team_a?.short_code || "?"} vs ${m.team_b?.short_code || "?"}`;
            matchFilter.appendChild(opt);
        });
    }

    if (ownershipRes.data) {
        ownershipRes.data.forEach(r => {
            ownershipMap.set(r.player_id, (ownershipMap.get(r.player_id) || 0) + 1);
        });
    }

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
                    match_number,
                    team_a:real_teams!team_a_id(short_code),
                    team_b:real_teams!team_b_id(short_code)
                )
            `);

        if (team)    query = query.eq("player.team.short_code", team);
        if (matchId) query = query.eq("match_id", matchId);

        const { data: stats, error } = await query.order("fantasy_points", { ascending: false });

        if (error || !stats) {
            statsContainer.appendChild(buildEmptyState("No data available."));
            updateSubtitle(0, 0);
            return;
        }

        /* ── AGGREGATE ──────────────────────────────────────────── */
        const playerAgg = {};
        const matchAgg  = {};
        const teamAgg   = {};
        const roleAgg   = { BAT: 0, BOWL: 0, AR: 0, WK: 0 };
        const catAgg    = { none: 0, overseas: 0, uncapped: 0 };

        stats.forEach(row => {
            const pid   = row.player_id;
            const pts   = row.fantasy_points || 0;
            const pRole = (row.player?.role || "BAT").toUpperCase();
            const pCat  = (row.player?.category || "none").toLowerCase();
            const pTeam = row.player?.team?.short_code || "TBA";
            const mNum  = row.match?.match_number || 0;

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
                    highestScore: 0, lowestScore: Infinity,
                    matches: [],
                };
            }
            const p = playerAgg[pid];
            p.totalPoints   += pts;
            p.matchesPlayed += 1;
            p.totalRuns     += row.runs    || 0;
            p.totalWickets  += row.wickets || 0;
            if (pts > p.highestScore) p.highestScore = pts;
            if (pts < p.lowestScore)  p.lowestScore  = pts;
            p.matches.push({ ...row, matchNumber: mNum });

            /* match */
            if (!matchAgg[mNum]) matchAgg[mNum] = {
                matchNumber: mNum, totalPts: 0,
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
        renderStatsDashboard(filtered, isFiltering, matchAgg, teamAgg, roleAgg, catAgg);

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
function renderStatsDashboard(players, isFiltering, matchAgg, teamAgg, roleAgg, catAgg) {
    statsContainer.replaceChildren();
    if (!players.length) {
        statsContainer.appendChild(buildEmptyState("No players found."));
        updateSubtitle(0, 0);
        return;
    }
    updateSubtitle(players.length, Math.max(...players.map(p => p.matchesPlayed)));

    if (!isFiltering) {
        statsContainer.appendChild(buildFormReport(allPlayers));
        statsContainer.appendChild(buildAdSlot());
        statsContainer.appendChild(buildPlayerTiers(allPlayers));
        statsContainer.appendChild(buildTargetIntelligence(teamAgg, roleAgg, catAgg));
        statsContainer.appendChild(buildMatchHeatmap(matchAgg));
        statsContainer.appendChild(buildPointsShare(roleAgg, catAgg));
        statsContainer.appendChild(buildOwnershipSection(allPlayers));
        statsContainer.appendChild(buildAdSlot());

        const dirHeader = document.createElement("h3");
        dirHeader.className = "st-dir-header";
        dirHeader.textContent = "Player Directory";
        statsContainer.appendChild(dirHeader);
    }

    players.forEach((player, idx) => statsContainer.appendChild(buildPlayerCard(player, idx + 1)));
    statsContainer.appendChild(buildAdSlot());
}

function updateSubtitle(playerCount, maxMatches) {
    if (statsSub) statsSub.textContent = `${playerCount} players · ${maxMatches} matches played`;
}

/* ════════════════════════════════════════════════════════════════════
   ANALYTICS SECTIONS
════════════════════════════════════════════════════════════════════ */

function createSection(icon, colorClass, title) {
    const sec = document.createElement("div");
    sec.className = "st-section";
    sec.innerHTML = `
        <div class="st-section-header">
            <div class="st-section-icon ${colorClass}"><i class="${icon}"></i></div>
            <h3 class="st-section-title">${title}</h3>
        </div>
        <div class="st-section-body"></div>`;
    return sec;
}

/* ── 1. FORM REPORT ───────────────────────────────────────────────── */
function buildFormReport(players) {
    const sec  = createSection("fas fa-fire", "rd", "Form Report — Last 3 Matches");
    const body = sec.querySelector(".st-section-body");

    const withForm = players
        .filter(p => p.matchesPlayed >= 3)
        .map(p => {
            const sorted    = [...p.matches].sort((a, b) => b.matchNumber - a.matchNumber);
            const last3Avg  = sorted.slice(0, 3).reduce((s, m) => s + (m.fantasy_points || 0), 0) / 3;
            const seasonAvg = p.totalPoints / p.matchesPlayed;
            const delta     = last3Avg - seasonAvg;
            return { ...p, last3Avg: Math.round(last3Avg), seasonAvg: Math.round(seasonAvg), delta: Math.round(delta) };
        });

    const hot  = withForm.filter(p => p.delta >= 15).sort((a, b) => b.delta - a.delta).slice(0, 6);
    const cold = withForm.filter(p => p.delta <= -15).sort((a, b) => a.delta - b.delta).slice(0, 6);

    body.innerHTML = `
        <p class="st-form-note">Compared to season average. Based on last 3 matches played.</p>
        <div class="st-form-label hot-label">🔥 In Form — Trending Up</div>
        <div class="st-chip-row">${hot.length
            ? hot.map(p => `
                <div class="st-form-chip hot">
                    <span class="fc-name">${p.name}</span>
                    <span class="fc-team">${p.team} · ${p.role}</span>
                    <span class="fc-delta">+${p.delta} vs avg</span>
                    <span class="fc-avg">${p.last3Avg} pts/match</span>
                </div>`).join("")
            : `<p class="st-no-data">Not enough data yet</p>`}
        </div>
        <div class="st-form-label cold-label" style="margin-top:14px">❄️ Out of Form — Dropping</div>
        <div class="st-chip-row">${cold.length
            ? cold.map(p => `
                <div class="st-form-chip cold">
                    <span class="fc-name">${p.name}</span>
                    <span class="fc-team">${p.team} · ${p.role}</span>
                    <span class="fc-delta">${p.delta} vs avg</span>
                    <span class="fc-avg">${p.last3Avg} pts/match</span>
                </div>`).join("")
            : `<p class="st-no-data">No dropping players</p>`}
        </div>`;
    return sec;
}

/* ── 2. PLAYER TIERS ──────────────────────────────────────────────── */
function buildPlayerTiers(players) {
    const sec  = createSection("fas fa-layer-group", "pu", "Player Tiers");
    const body = sec.querySelector(".st-section-body");

    const tiers = {
        core:        { label: "🏆 Core Players",    desc: "Consistent high scorers — must have in your team",         color: "tier-core",   players: [] },
        differential:{ label: "⚡ Differentials",   desc: "High ceiling, low ownership — bold picks to gain rank",    color: "tier-diff",   players: [] },
        wonder:      { label: "✨ One-Time Wonders", desc: "One big score, rest average — risky captaincy",            color: "tier-wonder", players: [] },
        flop:        { label: "💀 Flops",            desc: "Consistently low scorers — avoid for now",                 color: "tier-flop",   players: [] },
    };

    players.filter(p => p.matchesPlayed >= 3).forEach(p => {
        const avg            = p.totalPoints / p.matchesPlayed;
        const ownership      = ((ownershipMap.get(p.id) || 0) / 27) * 100;
        const goodMatches    = p.matches.filter(m => (m.fantasy_points || 0) >= 50).length;
        const consistencyPct = (goodMatches / p.matchesPlayed) * 100;

        if (avg >= 60 && consistencyPct >= 50) {
            tiers.core.players.push(p);
        } else if (p.highestScore >= 100 && avg >= 35 && ownership < 50) {
            tiers.differential.players.push(p);
        } else if (p.highestScore >= 100 && avg < 40) {
            tiers.wonder.players.push(p);
        } else if (avg < 25) {
            tiers.flop.players.push(p);
        }
    });

    body.innerHTML = Object.values(tiers).map(tier => `
        <div class="st-tier-block ${tier.color}">
            <div class="st-tier-header">
                <span class="st-tier-label">${tier.label}</span>
                <span class="st-tier-count">${tier.players.length} players</span>
            </div>
            <p class="st-tier-desc">${tier.desc}</p>
            <div class="st-tier-chips">
                ${tier.players.length
                    ? tier.players.slice(0, 8).map(p => `
                        <span class="st-tier-chip">
                            ${p.name}
                            <small>${Math.round(p.totalPoints / p.matchesPlayed)} avg</small>
                        </span>`).join("")
                    : `<span class="st-no-data-sm">None yet</span>`}
            </div>
        </div>`).join("");
    return sec;
}

/* ── 3. TARGET INTELLIGENCE ───────────────────────────────────────── */
function buildTargetIntelligence(teamAgg, roleAgg, catAgg) {
    const sec  = createSection("fas fa-crosshairs", "gd", "Target Intelligence");
    const body = sec.querySelector(".st-section-body");

    const teams     = Object.values(teamAgg).sort((a, b) => b.totalPts - a.totalPts).slice(0, 5);
    const maxTeam   = teams[0]?.totalPts || 1;
    const roles     = Object.entries(roleAgg).sort((a, b) => b[1] - a[1]);
    const totalRole = Object.values(roleAgg).reduce((s, v) => s + v, 0) || 1;
    const cats      = Object.entries(catAgg).sort((a, b) => b[1] - a[1]);
    const totalCat  = Object.values(catAgg).reduce((s, v) => s + v, 0) || 1;

    const roleLabels = { BAT: "🏏 Batsmen", BOWL: "🎳 Bowlers", AR: "⚡ All-Rounders", WK: "🧤 Wicket-Keepers" };
    const catLabels  = { none: "🇮🇳 Indian", overseas: "🌍 Overseas", uncapped: "⭐ Uncapped" };
    const catColors  = { none: "#9AE000", overseas: "#38bdf8", uncapped: "#f59e0b" };
    const roleColors = { BAT: "#38bdf8", BOWL: "#f43f5e", AR: "#9AE000", WK: "#a78bfa" };
    const teamColors = ["#9AE000", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e"];

    body.innerHTML = `
        <div class="st-intel-grid">
            <div class="st-intel-card">
                <div class="st-intel-title">🏟️ Best Teams to Target</div>
                <div class="st-bar-list">
                    ${teams.map((t, i) => `
                        <div class="st-bar-row">
                            <span class="st-bar-label">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  "} ${t.team}</span>
                            <div class="st-bar-track">
                                <div class="st-bar-fill" style="width:${Math.round((t.totalPts / maxTeam) * 100)}%;background:${teamColors[i]}"></div>
                            </div>
                            <span class="st-bar-val">${t.totalPts}</span>
                        </div>`).join("")}
                </div>
                <p class="st-intel-note">Total fantasy points by each IPL team's players this season</p>
            </div>
            <div class="st-intel-card">
                <div class="st-intel-title">🎭 Points by Role</div>
                <div class="st-donut-bars">
                    ${roles.map(([role, pts]) => `
                        <div class="st-donut-row">
                            <span class="st-donut-label">${roleLabels[role] || role}</span>
                            <div class="st-donut-track">
                                <div class="st-donut-fill" style="width:${Math.round((pts / totalRole) * 100)}%;background:${roleColors[role] || "#9AE000"}"></div>
                            </div>
                            <span class="st-donut-pct">${Math.round((pts / totalRole) * 100)}%</span>
                        </div>`).join("")}
                </div>
            </div>
            <div class="st-intel-card">
                <div class="st-intel-title">🌍 Points by Category</div>
                <div class="st-donut-bars">
                    ${cats.map(([cat, pts]) => `
                        <div class="st-donut-row">
                            <span class="st-donut-label">${catLabels[cat] || cat}</span>
                            <div class="st-donut-track">
                                <div class="st-donut-fill" style="width:${Math.round((pts / totalCat) * 100)}%;background:${catColors[cat] || "#9AE000"}"></div>
                            </div>
                            <span class="st-donut-pct">${Math.round((pts / totalCat) * 100)}%</span>
                        </div>`).join("")}
                </div>
            </div>
        </div>`;
    return sec;
}

/* ── 4. MATCH HEATMAP ─────────────────────────────────────────────── */
function buildMatchHeatmap(matchAgg) {
    const sec  = createSection("fas fa-chart-column", "bl", "Match Heatmap — Which Matches Scored Most");
    const body = sec.querySelector(".st-section-body");

    const matches = Object.values(matchAgg).sort((a, b) => a.matchNumber - b.matchNumber);
    if (!matches.length) { body.innerHTML = `<p class="st-no-data">No match data yet.</p>`; return sec; }

    const maxPts = Math.max(...matches.map(m => m.totalPts));
    const minPts = Math.min(...matches.map(m => m.totalPts));
    const avg    = Math.round(matches.reduce((s, m) => s + m.totalPts, 0) / matches.length);

    body.innerHTML = `
        <p class="st-form-note">Total fantasy points scored across all players per match. Season avg: <strong style="color:var(--accent)">${avg} pts</strong></p>
        <div class="st-heatmap-wrap">
            <div class="st-heatmap-bars">
                ${matches.map(m => {
                    const pct   = Math.round((m.totalPts / maxPts) * 100);
                    const isTop = m.totalPts === maxPts;
                    const isLow = m.totalPts === minPts;
                    const color = isTop ? "#9AE000" : isLow ? "#ef4444" : m.totalPts >= avg ? "rgba(154,224,0,0.45)" : "rgba(148,163,184,0.25)";
                    return `
                        <div class="st-hm-col" title="${m.label}: ${m.totalPts} pts">
                            <span class="st-hm-val">${m.totalPts}</span>
                            <div class="st-hm-bar" style="height:${pct}%;background:${color}"></div>
                            <span class="st-hm-label">M${m.matchNumber}</span>
                        </div>`;
                }).join("")}
            </div>
            <div class="st-hm-avg-line" style="bottom:calc(${Math.round((avg / maxPts) * 100)}% + 20px)">
                <span>avg ${avg}</span>
            </div>
        </div>
        <div class="st-heatmap-legend">
            <span class="st-hl-item"><span class="st-hl-dot" style="background:#9AE000"></span>Highest match</span>
            <span class="st-hl-item"><span class="st-hl-dot" style="background:#ef4444"></span>Lowest match</span>
            <span class="st-hl-item"><span class="st-hl-dot" style="background:rgba(154,224,0,0.45)"></span>Above avg</span>
        </div>`;
    return sec;
}

/* ── 5. POINTS SHARE ──────────────────────────────────────────────── */
function buildPointsShare(roleAgg, catAgg) {
    const sec  = createSection("fas fa-chart-pie", "pu", "Points Share Breakdown");
    const body = sec.querySelector(".st-section-body");

    const totalRole = Object.values(roleAgg).reduce((s, v) => s + v, 0) || 1;
    const totalCat  = Object.values(catAgg).reduce((s, v) => s + v, 0) || 1;

    const roleColors = { BAT: "#38bdf8", BOWL: "#f43f5e", AR: "#9AE000", WK: "#a78bfa" };
    const catColors  = { none: "#9AE000", overseas: "#38bdf8", uncapped: "#f59e0b" };
    const roleLabels = { BAT: "🏏 Batsmen", BOWL: "🎳 Bowlers", AR: "⚡ All-Rounders", WK: "🧤 Wicket-Keepers" };
    const catLabels  = { none: "🇮🇳 Indian", overseas: "🌍 Overseas", uncapped: "⭐ Uncapped" };

    const buildBar = (agg, colors, total) =>
        Object.entries(agg).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `<div class="st-seg" style="width:${Math.round((v/total)*100)}%;background:${colors[k]||"#555"}"></div>`)
            .join("");

    const buildLegend = (agg, labels, colors, total) =>
        Object.entries(agg).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => {
                const pct = Math.round((v / total) * 100);
                return `
                    <div class="st-ps-row">
                        <span class="st-ps-dot" style="background:${colors[k]||"#555"}"></span>
                        <span class="st-ps-name">${labels[k] || k}</span>
                        <span class="st-ps-pct" style="color:${colors[k]||"#fff"}">${pct}%</span>
                        <span class="st-ps-pts">${v} pts</span>
                    </div>`;
            }).join("");

    body.innerHTML = `
        <div class="st-ps-block">
            <div class="st-ps-title">By Role</div>
            <div class="st-ps-bar">${buildBar(roleAgg, roleColors, totalRole)}</div>
            <div class="st-ps-legend">${buildLegend(roleAgg, roleLabels, roleColors, totalRole)}</div>
        </div>
        <div class="st-ps-block" style="margin-top:20px">
            <div class="st-ps-title">By Category</div>
            <div class="st-ps-bar">${buildBar(catAgg, catColors, totalCat)}</div>
            <div class="st-ps-legend">${buildLegend(catAgg, catLabels, catColors, totalCat)}</div>
        </div>`;
    return sec;
}

/* ── 6. OWNERSHIP ─────────────────────────────────────────────────── */
function buildOwnershipSection(players) {
    const sec  = createSection("fas fa-users", "gd", "Fantasy Ownership");
    const body = sec.querySelector(".st-section-body");

    const total = 27;
    const withO = players
        .filter(p => p.matchesPlayed >= 2)
        .map(p => ({
            ...p,
            ownershipPct: Math.round(((ownershipMap.get(p.id) || 0) / total) * 100),
            avgPts: Math.round(p.totalPoints / p.matchesPlayed),
        }));

    const mostOwned    = [...withO].sort((a, b) => b.ownershipPct - a.ownershipPct).slice(0, 5);
    const differentials = [...withO]
        .filter(p => p.ownershipPct <= 30 && p.avgPts >= 40)
        .sort((a, b) => b.avgPts - a.avgPts)
        .slice(0, 5);

    const row = (p, isDiff) => `
        <div class="st-own-row">
            <div class="st-own-info">
                <span class="st-own-name">${p.name}</span>
                <span class="st-own-meta">${p.team} · ${p.role}</span>
            </div>
            <div class="st-own-bar-wrap">
                <div class="st-own-bar" style="width:${p.ownershipPct}%;background:${isDiff ? "#f59e0b" : "#9AE000"}"></div>
            </div>
            <span class="st-own-pct">${p.ownershipPct}%</span>
            <span class="st-own-avg">${p.avgPts} avg</span>
        </div>`;

    body.innerHTML = `
        <div class="st-own-block">
            <div class="st-own-title">👥 Most Owned — Everyone Has These</div>
            <p class="st-form-note">Safe picks but give no rank advantage since everyone has them.</p>
            ${mostOwned.length ? mostOwned.map(p => row(p, false)).join("") : `<p class="st-no-data">No data yet</p>`}
        </div>
        <div class="st-own-block" style="margin-top:16px">
            <div class="st-own-title">⚡ Differentials — Hidden Gems</div>
            <p class="st-form-note">Low ownership but scoring well. Pick these to jump ranks.</p>
            ${differentials.length ? differentials.map(p => row(p, true)).join("") : `<p class="st-no-data">No differentials found yet</p>`}
        </div>`;
    return sec;
}

/* ════════════════════════════════════════════════════════════════════
   PLAYER DIRECTORY CARD
════════════════════════════════════════════════════════════════════ */
function buildPlayerCard(player, rank) {
    const avg       = Math.round(player.totalPoints / player.matchesPlayed);
    const isElite   = avg >= 60;
    const sorted    = [...player.matches].sort((a, b) => b.matchNumber - a.matchNumber);
    const last3Avg  = sorted.slice(0, 3).reduce((s, m) => s + (m.fantasy_points || 0), 0) / Math.min(3, sorted.length);
    const formEmoji = player.matchesPlayed >= 3
        ? (last3Avg >= avg * 1.2 ? " 🔥" : last3Avg <= avg * 0.75 ? " ❄️" : "")
        : "";

    const card = document.createElement("div");
    card.className = `player-card ${isElite ? "elite-border" : ""}`;

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
        avatar.classList.add("avatar-initials");
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
    nameTxt.textContent = player.name + formEmoji;
    nameRow.append(rankEl, nameTxt);

    const meta = document.createElement("div");
    meta.className = "player-meta-row";
    const ownPct = Math.round(((ownershipMap.get(player.id) || 0) / 27) * 100);
    meta.innerHTML = `
        <span class="team-badge">${player.team}</span>
        <span class="role-badge">${player.role}</span>
        <span class="match-count">${player.matchesPlayed}M</span>
        <span class="own-badge">👥 ${ownPct}%</span>`;
    info.append(nameRow, meta);

    /* score */
    const score = document.createElement("div");
    score.className = "player-score";
    score.innerHTML = `
        <div class="score-main"><strong>${player.totalPoints}</strong><small>pts</small></div>
        <div class="score-avg">${avg} avg</div>
        <span class="dropdown-arrow">▼</span>`;

    hdr.append(avatarWrap, info, score);

    /* sparkline + history */
    const history = document.createElement("div");
    history.className = "match-history";
    const histLabel = document.createElement("div");
    histLabel.className = "history-label";
    histLabel.textContent = "Match-by-Match Breakdown";
    history.appendChild(buildSparkline(sorted.slice(0, 8).reverse()));
    history.appendChild(histLabel);
    [...player.matches].sort((a, b) => a.matchNumber - b.matchNumber)
        .forEach(m => history.appendChild(buildHistoryRow(m)));

    card.append(hdr, history);
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
            ${pts.map(v => {
                const h   = Math.max(4, Math.round((v / max) * 48));
                const hot = v >= avg * 1.2 && v >= 80;
                const bad = v < 20;
                return `<div class="sp-bar ${hot ? "sp-hot" : bad ? "sp-bad" : ""}" style="height:${h}px" title="${v} pts"></div>`;
            }).join("")}
        </div>
        <div class="sp-label">Last ${pts.length} matches · avg ${Math.round(avg)} pts</div>`;
    return wrap;
}

/* ── HISTORY ROW ──────────────────────────────────────────────────── */
function buildHistoryRow(m) {
    const pts      = m.fantasy_points || 0;
    const isBig    = pts >= 100;
    const row      = document.createElement("div");
    row.className  = `history-item ${isBig ? "big-game" : ""}`;

    const top = document.createElement("div");
    top.className = "h-top";
    top.innerHTML = `
        <span>Match ${m.matchNumber || "#"}</span>
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
    wrap.innerHTML = `<p>${text}</p>`;
    return wrap;
}

function buildAdSlot() {
    const wrap = document.createElement("div");
    wrap.className = "st-section";
    wrap.style.cssText = "margin:4px 0;padding:0;background:transparent;border:none;box-shadow:none;";
    const holder = document.createElement("div");
    holder.style.cssText = "width:100%;text-align:center;min-height:60px;display:flex;align-items:center;justify-content:center;";
    if (!document.querySelector('script[data-zone="225656"]')) {
        const s = document.createElement("script");
        s.src = "https://quge5.com/88/tag.min.js";
        s.async = true;
        s.setAttribute("data-zone", "225656");
        s.setAttribute("data-cfasync", "false");
        holder.appendChild(s);
    }
    wrap.appendChild(holder);
    return wrap;
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