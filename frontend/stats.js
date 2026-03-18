import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

/* ─── DOM REFS ───────────────────────────────────────────────────────────── */
const searchInput    = document.getElementById("playerSearch");
const teamFilter     = document.getElementById("teamFilter");
const matchFilter    = document.getElementById("matchFilter");
const statsContainer = document.getElementById("statsContainer");
const loader         = document.getElementById("loadingOverlay");

/* ─── INIT ───────────────────────────────────────────────────────────────── */
async function initStats() {
    // BUG FIX: auth was completely missing on this page
    try { await authReady; } catch (_) { return; }

    const [teamsRes, matchesRes] = await Promise.all([
        supabase.from("real_teams").select("short_code").order("short_code"),
        supabase.from("matches")
            .select("id, match_number, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("points_processed", true)
            .order("match_number", { ascending: false }),
    ]);

    // Populate team filter
    if (teamsRes.data) {
        teamsRes.data.forEach(t => {
            const opt = document.createElement("option");
            opt.value = t.short_code;
            // textContent — short_code is a code string, safe
            opt.textContent = t.short_code;
            teamFilter.appendChild(opt);
        });
    }

    // Populate match filter
    if (matchesRes.data) {
        matchesRes.data.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            // textContent — match data from DB, avoid XSS via innerHTML
            opt.textContent = `M${m.match_number}: ${m.team_a?.short_code || "?"} vs ${m.team_b?.short_code || "?"}`;
            matchFilter.appendChild(opt);
        });
    }

    await loadPlayerStats();
}

/* ─── LOAD STATS ─────────────────────────────────────────────────────────── */
async function loadPlayerStats() {
    loader.style.display = "flex";
    statsContainer.innerHTML = "";

    const searchTerm = searchInput.value.toLowerCase().trim();
    const team       = teamFilter.value;
    const matchId    = matchFilter.value;

    let query = supabase
        .from("player_match_stats")
        .select(`
            *,
            player:players!inner(
                name,
                role,
                photo_url,
                team:real_teams!inner(short_code)
            ),
            match:matches!inner(match_number)
        `);

    if (team)    query = query.eq("player.team.short_code", team);
    if (matchId) query = query.eq("match_id", matchId);

    const { data: stats, error } = await query.order("fantasy_points", { ascending: false });

    if (error || !stats) {
        console.error("Stats error:", error);
        statsContainer.innerHTML = "";
        statsContainer.appendChild(buildEmptyState("No data available for this selection."));
        loader.style.display = "none";
        return;
    }

    const filtered = stats.filter(s =>
        !searchTerm || (s.player?.name || "").toLowerCase().includes(searchTerm)
    );

    renderStats(filtered);
    loader.style.display = "none";
}

/* ─── RENDER ─────────────────────────────────────────────────────────────── */
function renderStats(data) {
    statsContainer.replaceChildren();

    if (!data.length) {
        statsContainer.appendChild(buildEmptyState("No players found."));
        return;
    }

    // Group by player
    const grouped = {};
    data.forEach(row => {
        const id = row.player_id;
        if (!grouped[id]) {
            grouped[id] = {
                name:    row.player?.name    || "Unknown",
                role:    row.player?.role    || "—",
                team:    row.player?.team?.short_code || "TBA",
                photo:   row.player?.photo_url || null,
                matches: [],
            };
        }
        grouped[id].matches.push(row);
    });

    // Sort by total points desc
    const players = Object.values(grouped).sort((a, b) => {
        const sumA = a.matches.reduce((s, m) => s + (m.fantasy_points || 0), 0);
        const sumB = b.matches.reduce((s, m) => s + (m.fantasy_points || 0), 0);
        return sumB - sumA;
    });

    players.forEach(player => {
        statsContainer.appendChild(buildPlayerCard(player));
    });
}

/* ─── PLAYER CARD ────────────────────────────────────────────────────────── */
function buildPlayerCard(player) {
    const totalPts = player.matches.reduce((s, m) => s + (m.fantasy_points || 0), 0);
    const isElite  = totalPts > 300;

    const card     = document.createElement("div");
    card.className = `player-card ${isElite ? "elite-border" : ""}`;

    // Header row — toggles accordion
    const hdr      = document.createElement("div");
    hdr.className  = "player-header";
    hdr.setAttribute("role", "button");
    hdr.setAttribute("aria-expanded", "false");
    hdr.onclick    = () => {
        card.classList.toggle("active");
        hdr.setAttribute("aria-expanded", card.classList.contains("active") ? "true" : "false");
    };

    // Avatar
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "player-avatar-wrap";

    const avatar   = document.createElement("div");
    avatar.className = "player-avatar";

    if (player.photo) {
        const photoUrl = supabase.storage.from("player-photos").getPublicUrl(player.photo).data.publicUrl;
        avatar.style.backgroundImage = `url('${photoUrl}')`;
    }
    avatarWrap.appendChild(avatar);

    // Info
    const info     = document.createElement("div");
    info.className = "player-info";

    const nameRow  = document.createElement("div");
    nameRow.className = "player-name-row";

    const nameTxt  = document.createElement("span");
    nameTxt.className = "player-name";
    // textContent — player name from DB, no innerHTML
    nameTxt.textContent = player.name + (isElite ? " 🔥" : "");

    nameRow.appendChild(nameTxt);

    const meta     = document.createElement("div");
    meta.className = "player-meta-row";

    const teamBadge = document.createElement("span");
    teamBadge.className = `team-badge role-${player.role.toLowerCase()}`;
    teamBadge.textContent = player.team;

    const roleBadge = document.createElement("span");
    roleBadge.className = "role-badge";
    roleBadge.textContent = player.role;

    meta.append(teamBadge, roleBadge);
    info.append(nameRow, meta);

    // Score
    const score    = document.createElement("div");
    score.className = "player-score";

    const pts      = document.createElement("strong");
    pts.textContent = String(totalPts);

    const ptsLabel = document.createElement("small");
    ptsLabel.textContent = " pts";

    const arrow    = document.createElement("span");
    arrow.className = "dropdown-arrow";
    arrow.textContent = "▼";

    score.append(pts, ptsLabel, arrow);

    hdr.append(avatarWrap, info, score);

    // Match history (accordion body)
    const history  = document.createElement("div");
    history.className = "match-history";

    const histLabel = document.createElement("div");
    histLabel.className = "history-label";
    histLabel.textContent = "Match-by-Match Breakdown";
    history.appendChild(histLabel);

    player.matches.forEach(m => history.appendChild(buildHistoryRow(m)));

    card.append(hdr, history);
    return card;
}

/* ─── HISTORY ROW ────────────────────────────────────────────────────────── */
function buildHistoryRow(m) {
    const isBigGame = m.fantasy_points >= 100;

    const row      = document.createElement("div");
    row.className  = `history-item ${isBigGame ? "big-game" : ""}`;

    // Top: match number + points
    const top      = document.createElement("div");
    top.className  = "h-top";

    const matchNum = document.createElement("span");
    matchNum.textContent = `Match ${m.match?.match_number || "#"}`;

    const pts      = document.createElement("span");
    pts.className  = "h-pts";
    pts.textContent = `${isBigGame ? "🌟 " : ""}+${m.fantasy_points} pts`;

    top.append(matchNum, pts);

    // Stat chips grid
    const chips    = document.createElement("div");
    chips.className = "detailed-stat-grid";

    const tags = buildStatChips(m);
    if (tags.length) {
        tags.forEach(t => chips.appendChild(t));
    } else {
        chips.appendChild(buildChip("Played", "empty"));
    }

    row.append(top, chips);
    return row;
}

/* ─── STAT CHIPS ─────────────────────────────────────────────────────────── */
function buildStatChips(m) {
    const chips = [];

    // Batting
    if (m.runs > 0) {
        const ballsText = m.balls ? ` (${m.balls}b)` : "";
        chips.push(buildChip(`🏏 ${m.runs} Runs${ballsText}`, "bat"));
    }
    if (m.fours > 0 || m.sixes > 0) {
        chips.push(buildChip(`🎯 ${m.fours || 0}×4  ${m.sixes || 0}×6`, "boundary"));
    }
    if (m.sr_points && m.sr_points !== 0) {
        chips.push(buildChip(`⚡ SR ${m.sr_points > 0 ? "+" : ""}${m.sr_points}`, "bonus"));
    }
    if (m.milestone_points > 0) {
        chips.push(buildChip(`🏆 Milestone +${m.milestone_points}`, "bonus"));
    }
    if (m.duck_penalty && m.duck_penalty < 0) {
        chips.push(buildChip(`🦆 Duck ${m.duck_penalty}`, "penalty"));
    }

    // Bowling
    if (m.wickets > 0)  chips.push(buildChip(`🎳 ${m.wickets} Wkt${m.wickets > 1 ? "s" : ""}`, "bowl"));
    if (m.maidens > 0)  chips.push(buildChip(`🧱 ${m.maidens} Maiden${m.maidens > 1 ? "s" : ""}`, "bowl"));
    if (m.er_points && m.er_points !== 0) {
        chips.push(buildChip(`📉 Econ ${m.er_points > 0 ? "+" : ""}${m.er_points}`, "bonus"));
    }

    // Fielding
    if (m.catches   > 0) chips.push(buildChip(`🧤 ${m.catches} Catch${m.catches > 1 ? "es" : ""}`, "field"));
    if (m.stumpings > 0) chips.push(buildChip(`🏃 ${m.stumpings} Stumping${m.stumpings > 1 ? "s" : ""}`, "field"));

    // BUG FIX: was m.run_outs — correct columns are runouts_direct + runouts_assisted
    const totalRunouts = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (totalRunouts > 0) chips.push(buildChip(`🎯 ${totalRunouts} Run Out${totalRunouts > 1 ? "s" : ""}`, "field"));

    // Awards
    if (m.is_player_of_match) chips.push(buildChip("🏆 POM +20", "gold"));

    return chips;
}

function buildChip(text, type) {
    const chip       = document.createElement("span");
    chip.className   = `stat-tag ${type}`;
    chip.textContent = text;
    return chip;
}

function buildEmptyState(text) {
    const wrap     = document.createElement("div");
    wrap.className = "empty-state";

    const p        = document.createElement("p");
    p.textContent  = text;

    wrap.appendChild(p);
    return wrap;
}

/* ─── EVENT LISTENERS ────────────────────────────────────────────────────── */
let searchTimeout;
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    // 400ms debounce — don't hit DB on every keystroke
    searchTimeout = setTimeout(() => loadPlayerStats(), 400);
});

teamFilter.addEventListener("change",  () => loadPlayerStats());
matchFilter.addEventListener("change", () => loadPlayerStats());

initStats();