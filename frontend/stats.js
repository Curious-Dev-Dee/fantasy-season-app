import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

/* ─── DOM REFS ───────────────────────────────────────────────────────────── */
const searchInput    = document.getElementById("playerSearch");
const teamFilter     = document.getElementById("teamFilter");
const matchFilter    = document.getElementById("matchFilter");
const statsContainer = document.getElementById("statsContainer");
const loader         = document.getElementById("loadingOverlay");
const statsSub       = document.querySelector(".stats-sub");

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let isLoading = false;
let pendingLoad = false;

/* ─── INIT ───────────────────────────────────────────────────────────────── */
async function initStats() {
    try { await authReady; } catch (_) { return; }

    const [teamsRes, matchesRes] = await Promise.all([
        supabase.from("real_teams").select("short_code").order("short_code"),
        supabase.from("matches")
            .select("id, match_number, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("points_processed", true)
            .order("match_number", { ascending: false }),
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

    await loadPlayerStats();
}

/* ─── LOAD STATS ───────────────────────────────────────────────────────── */
async function loadPlayerStats() {
    if (isLoading) {
        pendingLoad = true;
        return;
    }

    isLoading = true;
    pendingLoad = false;

    setFiltersDisabled(true);
    loader.style.display = "flex";
    statsContainer.innerHTML = "";

    const searchTerm = searchInput.value.toLowerCase().trim();
    const team       = teamFilter.value;
    const matchId    = matchFilter.value;

    try {
        let query = supabase
            .from("player_match_stats")
            .select(`
                *,
                player:players!inner(
                    name, role, photo_url, category,
                    team:real_teams!inner(short_code)
                ),
                match:matches!inner(match_number)
            `);

        if (team)    query = query.eq("player.team.short_code", team);
        if (matchId) query = query.eq("match_id", matchId);

        const { data: stats, error } = await query.order("fantasy_points", { ascending: false });

        if (error || !stats) {
            statsContainer.appendChild(buildEmptyState("No data available for this selection."));
            updateSubtitle(0, 0);
            return;
        }

        // AGGREGATE DATA FOR INSIGHTS
        const playerAgg = {};
        stats.forEach(row => {
            const pid = row.player_id;
            if (!playerAgg[pid]) {
                playerAgg[pid] = {
                    id: pid,
                    name: row.player?.name || "Unknown",
                    role: row.player?.role || "—",
                    team: row.player?.team?.short_code || "TBA",
                    photo: row.player?.photo_url || null,
                    category: row.player?.category || "none",
                    totalPoints: 0,
                    matchesPlayed: 0,
                    totalRuns: 0,
                    totalWickets: 0,
                    totalSixes: 0,
                    highestScore: 0,
                    matches: []
                };
            }
            const p = playerAgg[pid];
            p.totalPoints += (row.fantasy_points || 0);
            p.matchesPlayed += 1;
            p.totalRuns += (row.runs || 0);
            p.totalWickets += (row.wickets || 0);
            p.totalSixes += (row.sixes || 0);
            if ((row.fantasy_points || 0) > p.highestScore) p.highestScore = row.fantasy_points;
            p.matches.push(row);
        });

        let allPlayers = Object.values(playerAgg).sort((a, b) => b.totalPoints - a.totalPoints);
        
        // Filter by Search Term
        const filteredPlayers = allPlayers.filter(p => !searchTerm || p.name.toLowerCase().includes(searchTerm));

        renderStatsDashboard(filteredPlayers, searchTerm !== "");

    } finally {
        isLoading = false;
        loader.style.display = "none";
        setFiltersDisabled(false);
        if (pendingLoad) loadPlayerStats();
    }
}

function setFiltersDisabled(disabled) {
    teamFilter.disabled  = disabled;
    matchFilter.disabled = disabled;
}

/* ─── RENDER DASHBOARD ─────────────────────────────────────────────────── */
function renderStatsDashboard(players, isSearching) {
    statsContainer.replaceChildren();

    if (!players.length) {
        statsContainer.appendChild(buildEmptyState("No players found."));
        updateSubtitle(0, 0);
        return;
    }

    updateSubtitle(players.length, Math.max(...players.map(p => p.matchesPlayed)));

    // Only show Insights if we aren't actively searching for a specific name
    if (!isSearching) {
        statsContainer.appendChild(buildTopPerformers(players));
        statsContainer.appendChild(buildStatLeaders(players));
        
        const dirHeader = document.createElement("h3");
        dirHeader.className = "st-dir-header";
        dirHeader.textContent = "Player Directory";
        statsContainer.appendChild(dirHeader);
    }

    // Always show the Player Directory accordion list at the bottom
    players.forEach((player, idx) => {
        statsContainer.appendChild(buildPlayerCard(player, idx + 1));
    });
}

function updateSubtitle(playerCount, maxMatches) {
    if (!statsSub) return;
    statsSub.textContent = `${playerCount} players tracked · Up to ${maxMatches} matches played`;
}

/* ─── INSIGHT SECTIONS ─────────────────────────────────────────────────── */
function createSection(iconClass, iconColor, title) {
    const sec = document.createElement("div");
    sec.className = "st-section";
    sec.innerHTML = `
        <div class="st-section-header">
            <div class="st-section-icon ${iconColor}"><i class="${iconClass}"></i></div>
            <h3 class="st-section-title">${title}</h3>
        </div>
        <div class="st-section-body"></div>`;
    return sec;
}

function buildTopPerformers(players) {
    const sec = createSection("fas fa-star", "gd", "Top Fantasy Earners");
    const body = sec.querySelector(".st-section-body");
    
    const top3 = players.slice(0, 3);
    const list = document.createElement("div");
    list.className = "st-player-list";
    
    top3.forEach((p, i) => {
        list.innerHTML += `
            <div class="st-player-card">
                <div class="st-player-rank r${i + 1}">${i + 1}</div>
                <div class="st-player-info">
                    <span class="st-player-name">${p.name}</span>
                    <span class="st-player-meta">${p.role} · ${p.team}</span>
                </div>
                <div style="text-align:right;">
                    <span class="st-player-pts">${p.totalPoints}</span>
                    <span class="st-player-pts-lbl">pts</span>
                </div>
            </div>`;
    });
    
    body.appendChild(list);
    return sec;
}

function buildStatLeaders(players) {
    const sec = createSection("fas fa-chart-pie", "pu", "Tournament Leaders");
    const body = sec.querySelector(".st-section-body");

    const topRuns = [...players].sort((a, b) => b.totalRuns - a.totalRuns)[0];
    const topWickets = [...players].sort((a, b) => b.totalWickets - a.totalWickets)[0];
    const topSixes = [...players].sort((a, b) => b.totalSixes - a.totalSixes)[0];
    const bestMatch = [...players].sort((a, b) => b.highestScore - a.highestScore)[0];

    body.innerHTML = `
        <div class="st-stat-grid">
            <div class="st-stat-cell">
                <span class="st-stat-icon">🏏</span>
                <span class="st-stat-val">${topRuns?.totalRuns || 0}</span>
                <span class="st-stat-lbl">Most Runs</span>
                <span class="st-stat-sub">${topRuns?.name || "—"}</span>
            </div>
            <div class="st-stat-cell">
                <span class="st-stat-icon">🎳</span>
                <span class="st-stat-val">${topWickets?.totalWickets || 0}</span>
                <span class="st-stat-lbl">Most Wickets</span>
                <span class="st-stat-sub">${topWickets?.name || "—"}</span>
            </div>
            <div class="st-stat-cell">
                <span class="st-stat-icon">🎯</span>
                <span class="st-stat-val">${topSixes?.totalSixes || 0}</span>
                <span class="st-stat-lbl">Most Sixes</span>
                <span class="st-stat-sub">${topSixes?.name || "—"}</span>
            </div>
            <div class="st-stat-cell">
                <span class="st-stat-icon">🔥</span>
                <span class="st-stat-val">${bestMatch?.highestScore || 0} pts</span>
                <span class="st-stat-lbl">Best Single Match</span>
                <span class="st-stat-sub">${bestMatch?.name || "—"}</span>
            </div>
        </div>`;
    return sec;
}

/* ─── PLAYER DIRECTORY CARD ────────────────────────────────────────────── */
function buildPlayerCard(player, rank) {
    const isElite = player.totalPoints > 300;
    const card = document.createElement("div");
    card.className = `player-card ${isElite ? "elite-border" : ""}`;

    const hdr = document.createElement("div");
    hdr.className = "player-header";
    hdr.setAttribute("role", "button");
    hdr.onclick = () => {
        card.classList.toggle("active");
        hdr.setAttribute("aria-expanded", card.classList.contains("active") ? "true" : "false");
    };

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "player-avatar-wrap";
    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    if (player.photo) {
        const photoUrl = supabase.storage.from("player-photos").getPublicUrl(player.photo).data.publicUrl;
        avatar.style.backgroundImage = `url('${photoUrl}')`;
    }
    avatarWrap.appendChild(avatar);

    const info = document.createElement("div");
    info.className = "player-info";

    const nameRow = document.createElement("div");
    nameRow.className = "player-name-row";
    
    const rankEl = document.createElement("span");
    rankEl.className = "player-rank";
    rankEl.textContent = `#${rank}`;
    
    const nameTxt = document.createElement("span");
    nameTxt.className = "player-name";
    nameTxt.textContent = player.name + (isElite ? " 🔥" : "");
    nameRow.append(rankEl, nameTxt);

    const meta = document.createElement("div");
    meta.className = "player-meta-row";
    const teamBadge = document.createElement("span");
    teamBadge.className = `team-badge role-${player.role.toLowerCase()}`;
    teamBadge.textContent = player.team;
    const roleBadge = document.createElement("span");
    roleBadge.className = "role-badge";
    roleBadge.textContent = player.role;
    const matchCountBadge = document.createElement("span");
    matchCountBadge.className = "match-count";
    matchCountBadge.textContent = `${player.matchesPlayed}M`;

    meta.append(teamBadge, roleBadge, matchCountBadge);
    info.append(nameRow, meta);

    const score = document.createElement("div");
    score.className = "player-score";
    const pts = document.createElement("strong");
    pts.textContent = String(player.totalPoints);
    const ptsLabel = document.createElement("small");
    ptsLabel.textContent = "pts";
    const arrow = document.createElement("span");
    arrow.className = "dropdown-arrow";
    arrow.textContent = "▼";
    score.append(pts, ptsLabel, arrow);

    hdr.append(avatarWrap, info, score);

    const history = document.createElement("div");
    history.className = "match-history";
    const histLabel = document.createElement("div");
    histLabel.className = "history-label";
    histLabel.textContent = "Match-by-Match Breakdown";
    history.appendChild(histLabel);

    const sortedMatches = [...player.matches].sort((a, b) =>
        (a.match?.match_number || 0) - (b.match?.match_number || 0)
    );
    sortedMatches.forEach(m => history.appendChild(buildHistoryRow(m)));

    card.append(hdr, history);
    return card;
}

/* ─── HISTORY ROW ──────────────────────────────────────────────────────── */
function buildHistoryRow(m) {
    const isBigGame = m.fantasy_points >= 100;
    const row = document.createElement("div");
    row.className = `history-item ${isBigGame ? "big-game" : ""}`;

    const top = document.createElement("div");
    top.className = "h-top";
    const matchNum = document.createElement("span");
    matchNum.textContent = `Match ${m.match?.match_number || "#"}`;
    const pts = document.createElement("span");
    pts.className = "h-pts";
    pts.textContent = `${isBigGame ? "🌟 " : ""}+${m.fantasy_points} pts`;
    top.append(matchNum, pts);

    const chips = document.createElement("div");
    chips.className = "detailed-stat-grid";

    const tags = buildStatChips(m);
    tags.length ? tags.forEach(t => chips.appendChild(t)) : chips.appendChild(buildChip("Played", "empty"));

    row.append(top, chips);
    return row;
}

/* ─── STAT CHIPS ───────────────────────────────────────────────────────── */
function buildStatChips(m) {
    const chips = [];
    if (m.runs > 0) chips.push(buildChip(`🏏 ${m.runs}${m.balls ? ` (${m.balls}b)` : ""}`, "bat"));
    if (m.fours > 0 || m.sixes > 0) chips.push(buildChip(`🎯 ${m.fours || 0}×4 ${m.sixes || 0}×6`, "boundary"));
    if (m.sr_points && m.sr_points !== 0) chips.push(buildChip(`⚡ SR ${m.sr_points > 0 ? "+" : ""}${m.sr_points}`, "bonus"));
    if (m.milestone_points > 0) chips.push(buildChip(`🏆 +${m.milestone_points}`, "bonus"));
    if (m.duck_penalty && m.duck_penalty < 0) chips.push(buildChip(`🦆 Duck ${m.duck_penalty}`, "penalty"));
    if (m.wickets > 0)  chips.push(buildChip(`🎳 ${m.wickets}W`, "bowl"));
    if (m.maidens > 0)  chips.push(buildChip(`🧱 ${m.maidens} Maiden${m.maidens > 1 ? "s" : ""}`, "bowl"));
    if (m.er_points && m.er_points !== 0) chips.push(buildChip(`📉 Econ ${m.er_points > 0 ? "+" : ""}${m.er_points}`, "bonus"));
    if (m.catches > 0) chips.push(buildChip(`🧤 ${m.catches}C`, "field"));
    if (m.stumpings > 0) chips.push(buildChip(`🏃 ${m.stumpings}St`, "field"));
    
    const totalRunouts = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (totalRunouts > 0) chips.push(buildChip(`🎯 ${totalRunouts}RO`, "field"));
    if (m.is_player_of_match) chips.push(buildChip("🏆 POM +20", "gold"));

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
    const p = document.createElement("p");
    p.textContent = text;
    wrap.appendChild(p);
    return wrap;
}

/* ─── EVENT LISTENERS ──────────────────────────────────────────────────── */
let searchTimeout;
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadPlayerStats(), 400);
});

teamFilter.addEventListener("change",  () => loadPlayerStats());
matchFilter.addEventListener("change", () => loadPlayerStats());

initStats();