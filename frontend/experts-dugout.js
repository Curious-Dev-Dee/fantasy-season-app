import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

let currentUserId      = null;
let activeTournamentId = null;
let currentMode        = "overall";
let currentLeagueId    = null;
let allTeams           = [];
let selectedUserId     = null;
let rank1UserId        = null;

async function boot() {
    try {
        const user = await authReady;
        currentUserId = user.id;
        await init();
    } catch (err) { console.warn("Auth failed:", err.message); }
}
boot();

async function init() {
    document.body.classList.add("loading-state");
    try {
        const { data: activeT } = await supabase.from("active_tournament").select("*").maybeSingle();
        if (!activeT) { revealApp(); return; }
        activeTournamentId = activeT.id;

        const { data: member } = await supabase.from("league_members").select("league_id").eq("user_id", currentUserId).maybeSingle();
        currentLeagueId = member?.league_id || null;

        if (!currentLeagueId) {
    // User has no league — hide the toggle row completely
    const toggleRow = document.querySelector(".ed-toggle-row");
    if (toggleRow) toggleRow.style.display = "none";
    // Stay in overall mode (default)
    currentMode = "overall";
} else {
    // User has a league — default to league mode
    currentMode = "league";
    // Update button active states to reflect league being selected
    const overallBtn = document.getElementById("toggleOverall");
    const leagueBtn  = document.getElementById("toggleLeague");
    if (overallBtn) overallBtn.classList.remove("active");
    if (leagueBtn)  leagueBtn.classList.add("active");
}

setupListeners();
setupInfoPanel();
await loadTeamList();

        const sel = document.getElementById("teamSelector");
        if (sel && currentUserId) {
            sel.value = currentUserId;
            if (sel.value === currentUserId) await loadDugout(currentUserId);
        }
    } catch (err) { console.error("Init error:", err); }
    finally { revealApp(); }
}

function revealApp() {
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
}

function setupListeners() {
    document.getElementById("toggleOverall")?.addEventListener("click", async () => {
        if (currentMode === "overall") return;
        currentMode = "overall";
        document.getElementById("toggleOverall").classList.add("active");
        document.getElementById("toggleLeague").classList.remove("active");
        await loadTeamList();
    });
    document.getElementById("toggleLeague")?.addEventListener("click", async () => {
        if (currentMode === "league" || !currentLeagueId) return;
        currentMode = "league";
        document.getElementById("toggleLeague").classList.add("active");
        document.getElementById("toggleOverall").classList.remove("active");
        await loadTeamList();
    });
    document.getElementById("teamSelector")?.addEventListener("change", async e => {
        const uid = e.target.value;
        if (!uid) { showEmptyState(); return; }
        selectedUserId = uid;
        await loadDugout(uid);
    });
}

async function loadTeamList() {
    const sel = document.getElementById("teamSelector");
    if (!sel) return;
    sel.innerHTML = '<option value="">Select a team...</option>';
    try {
        let data = [];
        if (currentMode === "overall") {
            const { data: lb } = await supabase.from("leaderboard_view").select("user_id,team_name,total_points,rank").eq("tournament_id", activeTournamentId).order("total_points", { ascending: false });
            data = lb || [];
        } else {
            const { data: lb } = await supabase.from("private_league_leaderboard").select("user_id,team_name,total_points,rank_in_league").eq("league_id", currentLeagueId).order("total_points", { ascending: false });
            data = lb || [];
        }
        allTeams = data;
        rank1UserId = data[0]?.user_id || null;
        data.forEach(row => {
            const opt = document.createElement("option");
            opt.value = row.user_id;
            const pts = row.total_points > 0 ? ` · ${row.total_points} pts` : "";
            opt.textContent = `${row.team_name || "Anonymous"}${pts}`;
            if (row.user_id === currentUserId) opt.textContent = "★ " + opt.textContent + " (You)";
            sel.appendChild(opt);
        });
        if (selectedUserId) { sel.value = selectedUserId; if (!sel.value) selectedUserId = null; }
    } catch (err) { console.error("Team list error:", err); }
}

async function loadDugout(userId) {
    const content = document.getElementById("dugoutContent");
    if (!content) return;
    content.innerHTML = buildSkeleton();
    try {
        const [viewRes, playerRes, historyRes] = await Promise.all([
            supabase.from("team_lab_view").select("*").eq("user_id", userId).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.rpc("get_team_lab_players", { p_user_id: userId, p_tournament_id: activeTournamentId }),
            supabase.from("user_match_points").select("match_id,total_points,created_at").eq("user_id", userId).order("created_at", { ascending: true }),
        ]);

        const d = viewRes.data, players = playerRes.data, history = historyRes.data || [];
        if (!d) { content.innerHTML = `<div class="ed-empty-state"><div class="ed-empty-icon"><i class="fas fa-info-circle"></i></div><p class="ed-empty-title">No data yet</p><p class="ed-empty-sub">This team hasn't played any matches yet</p></div>`; return; }

        const teamRow   = allTeams.find(t => t.user_id === userId);
        const avatarUrl = d.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(d.team_photo_url).data.publicUrl : null;

        content.innerHTML = "";
        content.appendChild(buildHero(d, teamRow, avatarUrl, userId));
        content.appendChild(buildFormIndicator(d));
        content.appendChild(buildOverview(d));
        content.appendChild(buildScoreTrends(d, history));
        content.appendChild(buildRankJourney(d));
        content.appendChild(buildSubsTrends(d));
        content.appendChild(buildBestWorst(d));
        content.appendChild(buildStreaks(d));
        content.appendChild(buildCaptainStats(d));
        content.appendChild(buildBoosterROI(d));
        content.appendChild(buildH2H(d, userId));
if (players) { content.appendChild(buildTopScorers(players)); content.appendChild(buildMostPicked(players)); content.appendChild(buildByRole(players)); content.appendChild(buildPlayerCategories(players)); }
        content.appendChild(buildCompareSection(userId));
        content.appendChild(buildStrengthZone(d, players));
        content.appendChild(buildShareCard(d, teamRow));
    } catch (err) {
        console.error("Dugout load error:", err);
        content.innerHTML = `<div class="ed-empty-state"><div class="ed-empty-icon"><i class="fas fa-exclamation-triangle"></i></div><p class="ed-empty-title">Failed to load</p><p class="ed-empty-sub">Check your connection and try again</p></div>`;
    }
}

function buildHero(d, teamRow, avatarUrl, userId) {
    const wrap = document.createElement("div");
    wrap.className = "ed-team-hero";
    const avatar = document.createElement("div");
    avatar.className = "ed-team-avatar";
    if (avatarUrl) avatar.style.backgroundImage = `url('${avatarUrl}')`;
    const rank = teamRow ? (teamRow.rank || teamRow.rank_in_league || "--") : "--";
    const pct  = d.percentile != null ? `Top ${(100 - d.percentile).toFixed(1)}%` : "";
    const info = document.createElement("div");
    info.className = "ed-team-info";
    info.innerHTML = `<div class="ed-team-name">${d.team_name || "Anonymous"}</div><div class="ed-team-rank">Rank #${rank}</div>${pct ? `<div class="ed-percentile-badge">${pct} of all managers</div>` : ""}`;
    const right = document.createElement("div");
    right.innerHTML = `<div class="ed-team-pts">${d.total_points || 0}</div><div class="ed-team-pts-label">Total pts</div>`;
    wrap.append(avatar, info, right);
    return wrap;
}

function buildFormIndicator(d) {
    const sec  = createSection("fas fa-fire", "rd", "Current Form");
    const body = sec.querySelector(".ed-section-body");
    const scores = d.last_5_scores || [];
    const avg    = d.avg_score_per_match || 0;
    if (!scores.length) { body.innerHTML = '<div class="ed-no-data">No matches played yet</div>'; return sec; }
    const dots = scores.map(s => {
        let cls = "form-dot";
        if (s >= 250)             cls += " hot";
        else if (s >= avg)        cls += " good";
        else if (s >= avg * 0.7)  cls += " ok";
        else                      cls += " bad";
        return `<div class="form-dot-wrap"><div class="${cls}"></div><span class="form-dot-score">${s}</span></div>`;
    }).join("");
    const recent = scores.slice(0, 3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const trend = avgRecent >= avg ? "📈 Improving form" : "📉 Declining form";
    body.innerHTML = `
        <div class="ed-form-row">${dots}</div>
        <div class="ed-form-legend">
            <span class="fl-item"><span class="form-dot hot sm"></span>250+ pts</span>
            <span class="fl-item"><span class="form-dot good sm"></span>Above avg</span>
            <span class="fl-item"><span class="form-dot ok sm"></span>Near avg</span>
            <span class="fl-item"><span class="form-dot bad sm"></span>Below avg</span>
        </div>
        <div class="ed-form-trend">${trend} · Last 5 matches shown newest first</div>`;
    return sec;
}

function buildOverview(d) {
    const sec  = createSection("fas fa-chart-bar", "green", "Season Overview");
    const body = sec.querySelector(".ed-section-body");
    const cc   = !d.consistency_score ? "wh" : d.consistency_score >= 70 ? "neon" : d.consistency_score >= 50 ? "gd" : "rd";
    body.innerHTML = `
        <div class="ed-stat-grid">
            <div class="ed-stat-cell"><span class="ed-stat-val">${d.matches_played || 0}</span><span class="ed-stat-lbl">Matches Played</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val gd">${d.boosters_remaining ?? 7}</span><span class="ed-stat-lbl">Boosters Left</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val bl">${d.subs_remaining === 999 ? "∞" : (d.subs_remaining ?? "--")}</span><span class="ed-stat-lbl">Subs Left</span></div>
        </div>
        <div class="ed-consistency-row">
            <div class="ed-consistency-header">
                <span class="ed-consistency-label">Consistency Score</span>
                <span class="ed-consistency-val ${cc}">${d.consistency_score != null ? `${d.consistency_score}/100` : "Not enough data"}</span>
            </div>
            ${d.consistency_score != null ? `<div class="ed-consistency-bar"><div class="ed-consistency-fill" style="width:${d.consistency_score}%"></div></div>` : ""}
        </div>`;
    return sec;
}

function buildScoreTrends(d, history) {
    const sec  = createSection("fas fa-chart-line", "green", "Score Trends");
    const body = sec.querySelector(".ed-section-body");
    body.innerHTML = `
        <div class="ed-stat-grid two-col" style="margin-bottom:10px">
            <div class="ed-stat-cell"><span class="ed-stat-val">${d.avg_score_per_match ?? 0}</span><span class="ed-stat-lbl">Avg per Match</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val wh">${d.total_points || 0}</span><span class="ed-stat-lbl">Total Points</span></div>
        </div>
        <div class="ed-trend-row">
            <div class="ed-trend-cell"><span class="ed-trend-label">Last 3</span><span class="ed-trend-val">${d.avg_score_last_3 ?? "--"}</span><span class="ed-trend-sub">avg pts</span></div>
            <div class="ed-trend-cell"><span class="ed-trend-label">Last 6</span><span class="ed-trend-val">${d.avg_score_last_6 ?? "--"}</span><span class="ed-trend-sub">avg pts</span></div>
            <div class="ed-trend-cell"><span class="ed-trend-label">Last 10</span><span class="ed-trend-val">${d.avg_score_last_10 ?? "--"}</span><span class="ed-trend-sub">avg pts</span></div>
        </div>
        <div style="margin-top:12px">
            <div class="ed-chart-label">Match by match score</div>
            <div class="ed-chart-wrap"><canvas id="scoreChart"></canvas></div>
        </div>`;
    setTimeout(() => drawBarChart(history, d.avg_score_per_match), 50);
    return sec;
}

function drawBarChart(history, avg) {
    const canvas = document.getElementById("scoreChart");
    if (!canvas) return;
    if (!history.length) { canvas.parentElement.innerHTML = '<div class="ed-chart-empty">No match data yet</div>'; return; }
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth || 300;
    const H   = 100;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const data = history.map(h => h.total_points || 0);
    const max  = Math.max(...data, 1);
    const pL = 4, pR = 4, pT = 8, pB = 18;
    const cW = W - pL - pR, cH = H - pT - pB;
    const bW = Math.max(4, Math.floor(cW / data.length) - 2);
    const gap = Math.floor((cW - bW * data.length) / Math.max(data.length - 1, 1));
    ctx.clearRect(0, 0, W, H);
    if (avg) {
        const ay = pT + cH - Math.round((avg / max) * cH);
        ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(154,224,0,0.3)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pL, ay); ctx.lineTo(W - pR, ay); ctx.stroke(); ctx.setLineDash([]);
    }
    data.forEach((val, i) => {
        const bH = Math.max(2, Math.round((val / max) * cH));
        const x  = pL + i * (bW + gap);
        const y  = pT + cH - bH;
        ctx.fillStyle = val >= 250 ? "#9AE000" : val >= (avg || 0) ? "rgba(154,224,0,0.5)" : "rgba(154,224,0,0.2)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bW, bH, 2); else ctx.rect(x, y, bW, bH);
        ctx.fill();
        if (data.length <= 20) {
            ctx.fillStyle = "rgba(100,116,139,0.7)"; ctx.font = "600 7px sans-serif"; ctx.textAlign = "center";
            ctx.fillText(`M${i + 1}`, x + bW / 2, H - 4);
        }
    });
}

function buildRankJourney(d) {
    const sec  = createSection("fas fa-route", "bl", "Rank Journey");
    const body = sec.querySelector(".ed-section-body");
    const journey = d.rank_journey || [];

    if (!journey.length) {
        body.innerHTML = '<div class="ed-no-data">Not enough data yet</div>';
        return sec;
    }

    const sorted = [...journey].sort((a, b) => a.match_number - b.match_number);

    // If only one match, we can't draw a line — show a simple message instead
    if (sorted.length === 1) {
        body.innerHTML = `
            <div style="text-align:center;padding:14px 0">
                <div style="font-family:var(--font-display);font-size:28px;font-weight:900;color:var(--accent)">#${sorted[0].rank}</div>
                <div style="font-family:var(--font-body);font-size:11px;color:var(--text-faint);margin-top:4px">Rank after Match ${sorted[0].match_number}</div>
                <div style="font-family:var(--font-body);font-size:10px;color:var(--text-faint);margin-top:8px;font-style:italic">Play more matches to see your rank journey</div>
            </div>`;
        return sec;
    }

    body.innerHTML = `<div class="ed-rank-journey-wrap"><canvas id="rankChart"></canvas></div>
        <div style="font-family:var(--font-body);font-size:10px;color:var(--text-faint);text-align:center;margin-top:6px;font-style:italic">
            Lower on chart = better rank · Gold dot = Rank 1
        </div>`;

    setTimeout(() => {
        const canvas = document.getElementById("rankChart");
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const W   = canvas.offsetWidth || 300;
        const H   = 110;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        const ranks = sorted.map(r => r.rank);
        const minR  = Math.min(...ranks);   // best rank (lowest number)
        const maxR  = Math.max(...ranks);   // worst rank (highest number)
        const range = Math.max(maxR - minR, 1); // avoid divide by zero

        const pL = 28, pR = 10, pT = 12, pB = 22;
        const cW = W - pL - pR;
        const cH = H - pT - pB;

        ctx.clearRect(0, 0, W, H);

        // ── Grid lines (3 levels) ──
        const gridRanks = minR === maxR
            ? [minR]
            : [minR, Math.round((minR + maxR) / 2), maxR];

        gridRanks.forEach(r => {
            // Rank 1 (best) = top of chart (y = pT)
            // Worst rank    = bottom of chart (y = pT + cH)
            const y = pT + Math.round(((r - minR) / range) * cH);
            ctx.strokeStyle = "rgba(255,255,255,0.04)";
            ctx.lineWidth   = 0.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(pL, y);
            ctx.lineTo(W - pR, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle  = "rgba(100,116,139,0.7)";
            ctx.font       = "600 7px sans-serif";
            ctx.textAlign  = "right";
            ctx.fillText(`#${r}`, pL - 4, y + 3);
        });

        // ── Line ──
        ctx.beginPath();
        sorted.forEach((pt, i) => {
            const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
            const y = pT + Math.round(((pt.rank - minR) / range) * cH);
            if (i === 0) ctx.moveTo(x, y);
            else         ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "rgba(154,224,0,0.6)";
        ctx.lineWidth   = 2;
        ctx.lineJoin    = "round";
        ctx.stroke();

        // ── Fill under line ──
        ctx.beginPath();
        sorted.forEach((pt, i) => {
            const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
            const y = pT + Math.round(((pt.rank - minR) / range) * cH);
            if (i === 0) ctx.moveTo(x, y);
            else         ctx.lineTo(x, y);
        });
        const lastX = pL + cW;
        const firstX = pL;
        const bottomY = pT + cH;
        ctx.lineTo(lastX, bottomY);
        ctx.lineTo(firstX, bottomY);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
        grad.addColorStop(0,   "rgba(154,224,0,0.15)");
        grad.addColorStop(1,   "rgba(154,224,0,0)");
        ctx.fillStyle = grad;
        ctx.fill();

        // ── Dots + labels ──
        sorted.forEach((pt, i) => {
            const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
            const y = pT + Math.round(((pt.rank - minR) / range) * cH);

            // Dot
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = pt.rank === 1 ? "#f59e0b" : "#9AE000";
            ctx.fill();

            // Rank label above dot
            ctx.fillStyle  = pt.rank === 1 ? "#f59e0b" : "rgba(154,224,0,0.9)";
            ctx.font       = "700 8px sans-serif";
            ctx.textAlign  = "center";
            ctx.fillText(`#${pt.rank}`, x, y - 8);

            // Match label below chart
            ctx.fillStyle = "rgba(100,116,139,0.7)";
            ctx.font      = "600 7px sans-serif";
            ctx.fillText(`M${pt.match_number}`, x, H - 5);
        });

    }, 60);

    return sec;
}

function buildSubsTrends(d) {
    const sec  = createSection("fas fa-exchange-alt", "bl", "Subs Analysis");
    const body = sec.querySelector(".ed-section-body");

    // Calculate avg subs per match from existing data
    const totalSubs   = Number(d.total_subs_used ?? 0);
    const matchCount  = Number(d.matches_played ?? 0);
    const avgPerMatch = matchCount > 0
        ? (totalSubs / matchCount).toFixed(1)
        : "--";

    body.innerHTML = `
        <div class="ed-stat-grid two-col" style="margin-bottom:10px">
            <div class="ed-stat-cell">
                <span class="ed-stat-val bl">${avgPerMatch}</span>
                <span class="ed-stat-lbl">Avg Subs / Match</span>
            </div>
            <div class="ed-stat-cell">
                <span class="ed-stat-val wh">${totalSubs}</span>
                <span class="ed-stat-lbl">Total Subs Used</span>
            </div>
        </div>
        <div class="ed-trend-row">
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 3</span>
                <span class="ed-trend-val">${d.avg_subs_last_3 ?? "--"}</span>
                <span class="ed-trend-sub">avg subs</span>
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 6</span>
                <span class="ed-trend-val">${d.avg_subs_last_6 ?? "--"}</span>
                <span class="ed-trend-sub">avg subs</span>
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 10</span>
                <span class="ed-trend-val">${d.avg_subs_last_10 ?? "--"}</span>
                <span class="ed-trend-sub">avg subs</span>
            </div>
        </div>`;

    return sec;
}

function buildBestWorst(d) {
    const sec  = createSection("fas fa-trophy", "gd", "Best & Worst Match");
    const body = sec.querySelector(".ed-section-body");
    body.innerHTML = `<div class="ed-best-worst">
        <div class="ed-bw-cell best"><span class="ed-bw-icon">🏆</span><span class="ed-bw-val">${d.best_match_score ?? 0}</span><span class="ed-bw-lbl">Best Match</span></div>
        <div class="ed-bw-cell worst"><span class="ed-bw-icon">📉</span><span class="ed-bw-val">${d.worst_match_score ?? 0}</span><span class="ed-bw-lbl">Worst Match</span></div>
    </div>`;
    return sec;
}

function buildStreaks(d) {
    const sec  = createSection("fas fa-bolt", "gd", "Streaks");
    const body = sec.querySelector(".ed-section-body");
    body.innerHTML = `<div class="ed-streak-grid">
        <div class="ed-streak-cell hot">
            <div class="ed-streak-icon">🔥</div>
            <div class="ed-streak-val">${d.best_streak || 0}</div>
            <div class="ed-streak-lbl">Best Streak</div>
            <div class="ed-streak-sub">250+ pts in a row</div>
        </div>
        <div class="ed-streak-cell cold">
            <div class="ed-streak-icon">🥶</div>
            <div class="ed-streak-val">${d.worst_streak || 0}</div>
            <div class="ed-streak-lbl">Worst Streak</div>
            <div class="ed-streak-sub">Below 100 pts in a row</div>
        </div>
    </div>`;
    return sec;
}

function buildCaptainStats(d) {
    const sec  = createSection("fas fa-crown", "gd", "Captain Performance");
    const body = sec.querySelector(".ed-section-body");
    const rate  = d.captain_success_rate;
    const color = rate == null ? "#64748b" : rate >= 70 ? "#9AE000" : rate >= 50 ? "#f59e0b" : "#ef4444";
    const label = rate == null ? "Not enough data" : rate >= 70 ? "Excellent captaincy!" : rate >= 50 ? "Good captaincy" : "Room to improve";
    body.innerHTML = `<div class="ed-captain-wrap">
        <div class="ed-captain-circle" style="border-color:${color}">
            <span class="ed-captain-pct" style="color:${color}">${rate != null ? rate + "%" : "--"}</span>
            <span class="ed-captain-sub">success</span>
        </div>
        <div class="ed-captain-info">
            <div class="ed-captain-label" style="color:${color}">${label}</div>
            <div class="ed-captain-desc">Captain scored above match average in ${rate != null ? rate + "%" : "--"} of matches</div>
        </div>
    </div>`;
    return sec;
}

function buildBoosterROI(d) {
    const sec  = createSection("fas fa-rocket", "pu", "Booster ROI");
    const body = sec.querySelector(".ed-section-body");
    const history = d.booster_history || [];
    if (!history.length) { body.innerHTML = '<div class="ed-no-data">No boosters used yet</div>'; return sec; }
    const emoji = { TOTAL_2X:"🚀",INDIAN_2X:"🇮🇳",OVERSEAS_2X:"✈️",UNCAPPED_2X:"🧢",CAPTAIN_3X:"👑",MOM_2X:"🏆",FREE_11:"🆓" };
    const name  = { TOTAL_2X:"Total 2X",INDIAN_2X:"Indian 2X",OVERSEAS_2X:"Overseas 2X",UNCAPPED_2X:"Uncapped 2X",CAPTAIN_3X:"Captain 3X",MOM_2X:"MOM 2X",FREE_11:"Free 11" };
    const best  = [...history].sort((a, b) => b.points - a.points)[0];
    const rows  = history.map(b => {
        const isBest = b.match_number === best.match_number;
        return `<div class="ed-booster-row${isBest ? " best-booster" : ""}">
            <span class="ed-booster-emoji">${emoji[b.booster] || "⚡"}</span>
            <div class="ed-booster-info"><span class="ed-booster-name">${name[b.booster] || b.booster}</span><span class="ed-booster-match">Match ${b.match_number}</span></div>
            <div class="ed-booster-pts${isBest ? " best" : ""}">${b.points}<span class="ed-booster-ptsl">pts</span></div>
        </div>`;
    }).join("");
    body.innerHTML = `<div class="ed-booster-best-tag">Best: ${emoji[best.booster] || "⚡"} ${name[best.booster] || best.booster} → ${best.points} pts in M${best.match_number}</div><div class="ed-booster-list">${rows}</div>`;
    return sec;
}

function buildH2H(d, userId) {
    const sec  = createSection("fas fa-swords", "rd", "Head to Head vs Rank 1");
    const body = sec.querySelector(".ed-section-body");
    if (!rank1UserId || rank1UserId === userId) { body.innerHTML = '<div class="ed-no-data">You ARE rank 1! Nothing to compare.</div>'; return sec; }
    const wins   = Number(d.h2h_wins_vs_rank1 || 0);
    const total  = Number(d.matches_played || 0);
    const losses = Math.max(0, total - wins);
    const pct    = total > 0 ? Math.round((wins / total) * 100) : 0;
    body.innerHTML = `
        <div class="ed-h2h-row">
            <div class="ed-h2h-side win"><div class="ed-h2h-val">${wins}</div><div class="ed-h2h-lbl">You Won</div></div>
            <div class="ed-h2h-vs">VS<br><span style="font-size:9px;color:#475569">Rank 1</span></div>
            <div class="ed-h2h-side loss"><div class="ed-h2h-val">${losses}</div><div class="ed-h2h-lbl">Rank 1 Won</div></div>
        </div>
        <div class="ed-h2h-bar"><div class="ed-h2h-fill" style="width:${pct}%"></div></div>
        <div class="ed-h2h-note">You beat rank 1 in ${pct}% of matches</div>`;
    return sec;
}

function buildTopScorers(players) {
    const sec  = createSection("fas fa-star", "gd", "Top Point Earners");
    const body = sec.querySelector(".ed-section-body");
    const list = players.top_scorers || [];
    if (!list.length) { body.innerHTML = '<div class="ed-no-data">No match data yet</div>'; return sec; }
    const c = document.createElement("div"); c.className = "ed-player-list";
    list.forEach((p, i) => c.appendChild(buildPlayerCard(p, i + 1)));
    body.appendChild(c); return sec;
}

function buildMostPicked(players) {
    const sec  = createSection("fas fa-heart", "pu", "Most Loyal Players");
    const body = sec.querySelector(".ed-section-body");
    const list = players.most_picked || [];
    if (!list.length) { body.innerHTML = '<div class="ed-no-data">No match data yet</div>'; return sec; }
    const c = document.createElement("div"); c.className = "ed-player-list";
    list.forEach((p, i) => c.appendChild(buildPlayerCard(p, i + 1, true)));
    body.appendChild(c); return sec;
}

function buildByRole(players) {
    const sec  = createSection("fas fa-users", "bl", "Top by Role");
    const body = sec.querySelector(".ed-section-body");
    const roles = [{key:"top_wk",label:"WK",icon:"🧤"},{key:"top_bat",label:"BAT",icon:"🏏"},{key:"top_ar",label:"AR",icon:"⚡"},{key:"top_bowl",label:"BOWL",icon:"🎳"}];
    const tabs = document.createElement("div"); tabs.className = "ed-role-tabs";
    const listWrap = document.createElement("div"); listWrap.className = "ed-player-list";
    let active = "top_wk";
    function renderRole(key) {
        listWrap.innerHTML = "";
        const list = players[key] || [];
        if (!list.length) { listWrap.innerHTML = '<div class="ed-no-data">No data for this role yet</div>'; return; }
        list.forEach((p, i) => listWrap.appendChild(buildPlayerCard(p, i + 1)));
    }
    roles.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "ed-role-tab" + (r.key === active ? " active" : "");
        btn.textContent = `${r.icon} ${r.label}`;
        btn.onclick = () => { tabs.querySelectorAll(".ed-role-tab").forEach(b => b.classList.remove("active")); btn.classList.add("active"); active = r.key; renderRole(r.key); };
        tabs.appendChild(btn);
    });
    renderRole(active); body.appendChild(tabs); body.appendChild(listWrap); return sec;
}

function buildCompareSection(userId) {
    const sec  = createSection("fas fa-code-compare", "pu", "Compare with Another Team");
    const body = sec.querySelector(".ed-section-body");
    const opts = allTeams.filter(t => t.user_id !== userId).map(t => `<option value="${t.user_id}">${t.team_name || "Anonymous"}${t.total_points > 0 ? " · "+t.total_points+" pts" : ""}</option>`).join("");
    body.innerHTML = `
        <div class="ed-compare-select-wrap" style="position:relative;margin-bottom:10px">
            <select id="compareSelector" class="ed-select" style="padding-left:14px"><option value="">Pick a team to compare...</option>${opts}</select>
        </div>
        <div id="compareResult"></div>`;
    setTimeout(() => {
        document.getElementById("compareSelector")?.addEventListener("change", async e => {
            const cUid = e.target.value;
            if (!cUid) { document.getElementById("compareResult").innerHTML = ""; return; }
            await loadCompare(userId, cUid);
        });
    }, 100);
    return sec;
}

function buildPlayerCategories(players) {
    const sec  = createSection("fas fa-flag", "green", "Player Categories");
    const body = sec.querySelector(".ed-section-body");

    const breakdown   = players.category_breakdown || [];
    const totalPts    = breakdown.reduce((a, b) => a + (b.total_points || 0), 0);

    const catColors = { indian: "#9AE000", overseas: "#7cc4ff", uncapped: "#f59e0b" };
    const catLabels = { indian: "Indian",  overseas: "Overseas", uncapped: "Uncapped" };
    const catIcons  = { indian: "🇮🇳",    overseas: "✈️",       uncapped: "🧢" };

    // ── Points share bar ──────────────────────────
    let barHtml = "";
    if (breakdown.length && totalPts > 0) {
        const bars = breakdown.map(cat => {
            const pct   = Math.round((cat.total_points / totalPts) * 100);
            const color = catColors[cat.category] || "#64748b";
            return `<div class="ed-cat-bar-seg" style="width:${pct}%;background:${color}" title="${catLabels[cat.category]}: ${pct}%"></div>`;
        }).join("");

        barHtml = `
            <div class="ed-cat-breakdown">
                <div class="ed-cat-breakdown-label">Points share by category</div>
                <div class="ed-cat-bar">${bars}</div>
            </div>`;
    }

    // ── Category summary rows ─────────────────────
    // Shows: Icon + Name | X players | Y pts | Z%
    let summaryHtml = "";
    if (breakdown.length) {
        const rows = breakdown.map(cat => {
            const pct     = totalPts > 0 ? Math.round((cat.total_points / totalPts) * 100) : 0;
            const color   = catColors[cat.category] || "#64748b";
            const icon    = catIcons[cat.category]  || "";
            const label   = catLabels[cat.category] || cat.category;
            const players = cat.total_players ?? cat.total_picks ?? "--";
            return `
                <div class="ed-cat-row">
                    <div class="ed-cat-row-left">
                        <span class="ed-cat-dot" style="background:${color}"></span>
                        <span class="ed-cat-name">${icon} ${label}</span>
                    </div>
                    <div class="ed-cat-row-right">
                        <div class="ed-cat-pill">
                            <span class="ed-cat-pill-val">${players}</span>
                            <span class="ed-cat-pill-lbl">players</span>
                        </div>
                        <div class="ed-cat-pill">
                            <span class="ed-cat-pill-val" style="color:${color}">${cat.total_points}</span>
                            <span class="ed-cat-pill-lbl">pts</span>
                        </div>
                        <div class="ed-cat-pill">
                            <span class="ed-cat-pill-val" style="color:${color}">${pct}%</span>
                            <span class="ed-cat-pill-lbl">share</span>
                        </div>
                    </div>
                </div>`;
        }).join("");

        summaryHtml = `<div class="ed-cat-summary">${rows}</div>`;
    }

    // ── Player tabs (Indian / Overseas / Uncapped) ─
    const tabs    = document.createElement("div");
    tabs.className = "ed-role-tabs";

    const listWrap    = document.createElement("div");
    listWrap.className = "ed-player-list";

    const summaryWrap = document.createElement("div");
    summaryWrap.id    = "uncappedSummaryWrap";

    const tabList = [
        { key: "top_indian",   label: "🇮🇳 Indian"  },
        { key: "top_overseas", label: "✈️ Overseas" },
        { key: "top_uncapped", label: "🧢 Uncapped" },
    ];

    let activeKey = "top_indian";

    function renderCategoryTab(key) {
        listWrap.innerHTML    = "";
        summaryWrap.innerHTML = "";

        if (key === "top_uncapped") {
            const us = players.uncapped_summary;
            if (us) {
                summaryWrap.innerHTML = `
                    <div class="ed-uncapped-summary">
                        <div class="ed-uncapped-stat">
                            <span class="ed-uncapped-val">${us.total_picks || 0}</span>
                            <span class="ed-uncapped-lbl">Total Picks</span>
                        </div>
                        <div class="ed-uncapped-divider"></div>
                        <div class="ed-uncapped-stat">
                            <span class="ed-uncapped-val gold">${us.total_points || 0}</span>
                            <span class="ed-uncapped-lbl">Total pts</span>
                        </div>
                        <div class="ed-uncapped-divider"></div>
                        <div class="ed-uncapped-stat">
                            <span class="ed-uncapped-val">${us.avg_points_per_pick || 0}</span>
                            <span class="ed-uncapped-lbl">Avg/pick</span>
                        </div>
                        <div class="ed-uncapped-divider"></div>
                        <div class="ed-uncapped-stat">
                            <span class="ed-uncapped-val">${us.matches_with_uncapped || 0}</span>
                            <span class="ed-uncapped-lbl">Matches used</span>
                        </div>
                    </div>`;
            }
        }

        const list = players[key] || [];
        if (!list.length) {
            listWrap.innerHTML = '<div class="ed-no-data">No data for this category yet</div>';
            return;
        }
        list.forEach((p, i) => listWrap.appendChild(buildPlayerCard(p, i + 1)));
    }

    tabList.forEach(t => {
        const btn = document.createElement("button");
        btn.className = "ed-role-tab" + (t.key === activeKey ? " active" : "");
        btn.textContent = t.label;
        btn.onclick = () => {
            tabs.querySelectorAll(".ed-role-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeKey = t.key;
            renderCategoryTab(t.key);
        };
        tabs.appendChild(btn);
    });

    renderCategoryTab("top_indian");

    // ── Assemble ──────────────────────────────────
    body.innerHTML = barHtml + summaryHtml;
    body.appendChild(tabs);
    body.appendChild(summaryWrap);
    body.appendChild(listWrap);

    return sec;
}

async function loadCompare(uid1, uid2) {
    const result = document.getElementById("compareResult");
    if (!result) return;
    result.innerHTML = '<div class="ed-no-data">Loading...</div>';
    try {
        const [r1, r2] = await Promise.all([
            supabase.from("team_lab_view").select("team_name,total_points,avg_score_per_match,best_match_score,matches_played,captain_success_rate,consistency_score").eq("user_id", uid1).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.from("team_lab_view").select("team_name,total_points,avg_score_per_match,best_match_score,matches_played,captain_success_rate,consistency_score").eq("user_id", uid2).eq("tournament_id", activeTournamentId).maybeSingle(),
        ]);
        const a = r1.data, b = r2.data;
        if (!a || !b) { result.innerHTML = '<div class="ed-no-data">Could not load comparison</div>'; return; }
        const row = (label, v1, v2) => {
            const w1 = (v1 ?? 0) >= (v2 ?? 0);
            return `<div class="ed-cmp-row"><div class="ed-cmp-val${w1?" win":""}">${v1??'--'}</div><div class="ed-cmp-label">${label}</div><div class="ed-cmp-val${!w1?" win":""}">${v2??'--'}</div></div>`;
        };
        result.innerHTML = `
            <div class="ed-cmp-header"><div class="ed-cmp-team">${a.team_name||"Team A"}</div><div class="ed-cmp-vs">VS</div><div class="ed-cmp-team">${b.team_name||"Team B"}</div></div>
            ${row("Total pts",a.total_points,b.total_points)}
            ${row("Avg/match",a.avg_score_per_match,b.avg_score_per_match)}
            ${row("Best match",a.best_match_score,b.best_match_score)}
            ${row("Matches",a.matches_played,b.matches_played)}
            ${row("Captain %",a.captain_success_rate,b.captain_success_rate)}
            ${row("Consistency",a.consistency_score,b.consistency_score)}`;
    } catch (err) { result.innerHTML = '<div class="ed-no-data">Failed to load comparison</div>'; }
}

function buildShareCard(d, teamRow) {
    const sec  = createSection("fas fa-share-alt", "green", "Share Your Stats");
    const body = sec.querySelector(".ed-section-body");
    const rank = teamRow ? (teamRow.rank || teamRow.rank_in_league || "--") : "--";
    const pct  = d.percentile != null ? `Top ${(100 - d.percentile).toFixed(1)}%` : "";
    body.innerHTML = `
        <div class="ed-share-card" id="shareCardEl">
            <div class="ed-share-top"><div class="ed-share-title">Cricket Experts</div><div class="ed-share-subtitle">Experts Dugout</div></div>
            <div class="ed-share-team">${d.team_name || "My Team"}</div>
            <div class="ed-share-stats">
                <div class="ed-share-stat"><span class="ed-share-val">${d.total_points||0}</span><span class="ed-share-lbl">Total pts</span></div>
                <div class="ed-share-stat"><span class="ed-share-val">#${rank}</span><span class="ed-share-lbl">Rank</span></div>
                <div class="ed-share-stat"><span class="ed-share-val">${d.avg_score_per_match||0}</span><span class="ed-share-lbl">Avg/match</span></div>
            </div>
            ${pct?`<div class="ed-share-pct">${pct} of all managers</div>`:""}
            <div class="ed-share-tagline">cricket-experts.app</div>
        </div>
        <button class="ed-share-btn" onclick="shareStats()"><i class="fas fa-share-alt"></i> Share My Stats</button>`;
    return sec;
}

window.shareStats = async () => {
    const card = document.getElementById("shareCardEl");
    if (!card) return;
    const text = card.innerText.replace(/\n+/g, " · ");
    if (navigator.share) {
        try { await navigator.share({ title: "My Cricket Experts Stats", text }); } catch (_) {}
    } else {
        await navigator.clipboard.writeText(text);
        showToast("Stats copied to clipboard!", "success");
    }
};

function buildPlayerCard(p, rank, showMatches = false) {
    const card = document.createElement("div");
    card.className = "ed-player-card";
    const rankEl = document.createElement("div");
    rankEl.className = `ed-player-rank r${rank}`;
    rankEl.textContent = rank;
    const info = document.createElement("div");
    info.className = "ed-player-info";
    info.innerHTML = `<span class="ed-player-name">${p.name||"Unknown"}</span><span class="ed-player-meta">${showMatches?`${p.matches_in_team||0} matches in team`:`${p.role||""} · ${p.matches_in_team||0} matches`}</span>`;
    const right = document.createElement("div");
    right.style.textAlign = "right";
    right.innerHTML = `<span class="ed-player-pts">${p.total_points_earned||0}</span><span class="ed-player-pts-lbl">pts earned</span>`;
    card.append(rankEl, info, right);
    return card;
}

function createSection(iconClass, iconColor, title) {
    const sec = document.createElement("div");
    sec.className = "ed-section";
    sec.innerHTML = `<div class="ed-section-header"><div class="ed-section-icon ${iconColor}"><i class="${iconClass}"></i></div><h3 class="ed-section-title">${title}</h3></div><div class="ed-section-body"></div>`;
    return sec;
}

function showEmptyState() {
    const content = document.getElementById("dugoutContent");
    if (!content) return;
    content.innerHTML = `<div class="ed-empty-state"><div class="ed-empty-icon"><i class="fas fa-magnifying-glass-chart"></i></div><p class="ed-empty-title">Pick a team to analyse</p><p class="ed-empty-sub">Select from the dropdown above</p></div>`;
}

function buildSkeleton() {
    return [90,120,200,140,160].map(h => `<div class="ed-skeleton" style="height:${h}px;margin-bottom:14px"></div>`).join("");
}

function showToast(msg, type = "success") {
    const c = document.getElementById("toastContainer");
    if (!c) return;
    const t = document.createElement("div");
    t.className = `toast ${type}`; t.textContent = msg; c.appendChild(t);
    setTimeout(() => { t.classList.add("fade-out"); t.addEventListener("transitionend", () => t.remove(), { once: true }); }, 3000);
}

function buildStrengthZone(d, players) {
    const sec  = createSection("fas fa-shield-halved", "green", "Strong & Weak Zones");
    const body = sec.querySelector(".ed-section-body");

    const strengths = [];
    const weaknesses = [];

    const avg         = Number(d.avg_score_per_match  ?? 0);
    const last3       = Number(d.avg_score_last_3     ?? 0);
    const capRate     = Number(d.captain_success_rate ?? 0);
    const consistency = Number(d.consistency_score    ?? 0);
    const bestStreak  = Number(d.best_streak          ?? 0);
    const worstStreak = Number(d.worst_streak         ?? 0);
    const worstMatch  = Number(d.worst_match_score    ?? 0);
    const boostersRem = Number(d.boosters_remaining   ?? 7);
    const matchCount  = Number(d.matches_played       ?? 0);

    // ── Booster best score ──
    const boosterHistory = d.booster_history || [];
    const bestBoosterPts = boosterHistory.length
        ? Math.max(...boosterHistory.map(b => b.points || 0))
        : 0;

    // ── Category breakdown for Indian/Overseas split ──
    const breakdown   = players?.category_breakdown || [];
    const totalCatPts = breakdown.reduce((a, b) => a + (b.total_points || 0), 0);
    const indianPct   = totalCatPts > 0
        ? (breakdown.find(c => c.category === "indian")?.total_points || 0) / totalCatPts * 100
        : 0;
    const overseasPct = totalCatPts > 0
        ? (breakdown.find(c => c.category === "overseas")?.total_points || 0) / totalCatPts * 100
        : 0;

    // ════════════════════════════════
    //  STRENGTH CHECKS
    // ════════════════════════════════

    if (capRate >= 70) {
        strengths.push({
            icon: "👑",
            title: "Elite Captaincy",
            desc: `Your captain outperformed the match average in ${capRate}% of matches.`
        });
    }

    if (consistency >= 70) {
        strengths.push({
            icon: "🎯",
            title: "Rock Solid Consistency",
            desc: `Consistency score of ${consistency}/100 — you deliver match after match.`
        });
    }

    if (avg > 0 && last3 > avg) {
        strengths.push({
            icon: "🔥",
            title: "Red Hot Form",
            desc: `Your last 3 match average (${last3} pts) is above your season average (${avg} pts).`
        });
    }

    if (bestStreak >= 3) {
        strengths.push({
            icon: "💥",
            title: "Explosive Scorer",
            desc: `You scored 250+ pts in ${bestStreak} matches in a row — a powerful streak.`
        });
    }

    if (indianPct > 55) {
        strengths.push({
            icon: "🇮🇳",
            title: "Strong Indian Core",
            desc: `${indianPct.toFixed(0)}% of your points come from Indian players — a reliable base.`
        });
    }

    if (worstMatch > 150 && matchCount >= 3) {
        strengths.push({
            icon: "🛡️",
            title: "No Bad Days",
            desc: `Even your worst match scored ${worstMatch} pts — your floor is impressively high.`
        });
    }

    if (bestBoosterPts > 0 && avg > 0 && bestBoosterPts > avg * 1.3) {
        strengths.push({
            icon: "🚀",
            title: "Booster Timing Master",
            desc: `Your best booster match scored ${bestBoosterPts} pts — well above your season average.`
        });
    }

    // ════════════════════════════════
    //  WEAKNESS CHECKS
    // ════════════════════════════════

    if (capRate > 0 && capRate < 50) {
        weaknesses.push({
            icon: "👎",
            title: "Poor Captaincy Choices",
            desc: `Your captain only beat the match average ${capRate}% of the time. Reconsider your captain picks.`
        });
    }

    if (consistency > 0 && consistency < 50) {
        weaknesses.push({
            icon: "📉",
            title: "Very Inconsistent",
            desc: `Consistency score of ${consistency}/100 — your scores swing wildly match to match.`
        });
    }

    if (avg > 0 && last3 > 0 && last3 < avg * 0.8) {
        weaknesses.push({
            icon: "❄️",
            title: "Dropping Form",
            desc: `Your last 3 avg (${last3} pts) is significantly below your season average (${avg} pts).`
        });
    }

    if (worstStreak >= 3) {
        weaknesses.push({
            icon: "🥶",
            title: "Cold Spells Problem",
            desc: `You scored below 100 pts in ${worstStreak} matches in a row — a dangerous pattern.`
        });
    }

    if (avg > 0 && worstMatch < avg * 0.4 && matchCount >= 3) {
        weaknesses.push({
            icon: "💣",
            title: "Crashes Hard",
            desc: `Your worst match (${worstMatch} pts) is extremely low compared to your average — you have big dips.`
        });
    }

    if (boostersRem > 4 && matchCount > 5) {
        weaknesses.push({
            icon: "⚠️",
            title: "Underusing Boosters",
            desc: `You still have ${boostersRem} boosters left after ${matchCount} matches — you are leaving points on the table.`
        });
    }

    if (overseasPct > 55 && matchCount >= 3) {
        weaknesses.push({
            icon: "✈️",
            title: "Overseas Dependent",
            desc: `${overseasPct.toFixed(0)}% of your points come from overseas players — risky if they have a bad run.`
        });
    }

    // ── Cap at 3 each ──
    const topStrengths = strengths.slice(0, 3);
    const topWeaknesses = weaknesses.slice(0, 3);

    // ── Handle no data case ──
    if (!topStrengths.length && !topWeaknesses.length) {
        body.innerHTML = '<div class="ed-no-data">Not enough match data yet to analyse zones</div>';
        return sec;
    }

    // ── Build HTML ──
    const buildZoneItems = (list) => list.map(item => `
        <div class="ed-zone-item">
            <span class="ed-zone-icon">${item.icon}</span>
            <div class="ed-zone-info">
                <div class="ed-zone-title">${item.title}</div>
                <div class="ed-zone-desc">${item.desc}</div>
            </div>
        </div>
    `).join("");

    body.innerHTML = `
        ${topStrengths.length ? `
        <div class="ed-zone-block strong">
            <div class="ed-zone-header">
                <i class="fas fa-circle-check"></i> Strong Zone
            </div>
            ${buildZoneItems(topStrengths)}
        </div>` : ""}

        ${topWeaknesses.length ? `
        <div class="ed-zone-block weak" style="${topStrengths.length ? 'margin-top:10px' : ''}">
            <div class="ed-zone-header">
                <i class="fas fa-circle-exclamation"></i> Weak Zone
            </div>
            ${buildZoneItems(topWeaknesses)}
        </div>` : ""}
    `;

    return sec;
}

function setupInfoPanel() {
    const btn     = document.getElementById("infoBtn");
    const overlay = document.getElementById("infoOverlay");
    const close   = document.getElementById("infoClose");

    btn?.addEventListener("click", () => {
        overlay?.classList.remove("hidden");
    });

    close?.addEventListener("click", () => {
        overlay?.classList.add("hidden");
    });

    overlay?.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.add("hidden");
    });
}