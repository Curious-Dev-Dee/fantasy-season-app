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
            const toggleRow = document.querySelector(".ed-toggle-row");
            if (toggleRow) toggleRow.style.display = "none";
            currentMode = "overall";
        } else {
            currentMode = "league";
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
        const [viewRes, playerRes, historyRes, rankHistoryRes] = await Promise.all([
            supabase.from("team_lab_view").select("*").eq("user_id", userId).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.rpc("get_team_lab_players", { p_user_id: userId, p_tournament_id: activeTournamentId }),
            supabase.from("user_match_points").select("match_id,total_points,created_at").eq("user_id", userId).order("created_at", { ascending: true }),
            supabase.from("leaderboard_view").select("rank").eq("user_id", userId).eq("tournament_id", activeTournamentId).maybeSingle(),
        ]);

        const d = viewRes.data, players = playerRes.data, history = historyRes.data || [];
        if (!d) {
            content.innerHTML = `<div class="ed-empty-state"><div class="ed-empty-icon"><i class="fas fa-info-circle"></i></div><p class="ed-empty-title">No data yet</p><p class="ed-empty-sub">This team hasn't played any matches yet</p></div>`;
            return;
        }

        // Derive total player count for percentile display
        const totalPlayers = allTeams.length;
        const teamRow = allTeams.find(t => t.user_id === userId);
        const avatarUrl = d.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(d.team_photo_url).data.publicUrl : null;

        content.innerHTML = "";

        // ── Key Insights card first — sets the tone ──
        content.appendChild(buildKeyInsights(d, players, teamRow, totalPlayers));
        content.appendChild(buildHero(d, teamRow, avatarUrl, userId, totalPlayers));
        content.appendChild(buildStrengthZone(d, players));
        content.appendChild(buildMomentumScore(d));
        content.appendChild(buildFormIndicator(d));
        content.appendChild(buildOverview(d));
        content.appendChild(buildMonetagAd());
        content.appendChild(buildScoreTrends(d, history));
        content.appendChild(buildRankJourney(d, totalPlayers));
        content.appendChild(buildBestWorst(d));
        content.appendChild(buildWorstMatchAutopsy(d));
        content.appendChild(buildStreaks(d));
        content.appendChild(buildSubsTrends(d));
        content.appendChild(buildCaptainStats(d));
        content.appendChild(buildBoosterROI(d));
        content.appendChild(buildH2H(d, userId));
        if (players) {
            content.appendChild(buildDeadWeight(players));
            content.appendChild(buildTransferIntelligence(players));
            content.appendChild(buildPlayerUsage(players, d));
            content.appendChild(buildTopScorers(players));
            content.appendChild(buildMostPicked(players));
            content.appendChild(buildByRole(players));
            content.appendChild(buildPlayerCategories(players));
        }
        content.appendChild(buildCompareSection(userId));
        content.appendChild(buildMonetagAd());
        content.appendChild(buildShareCard(d, teamRow));

    } catch (err) {
        console.error("Dugout load error:", err);
        content.innerHTML = `<div class="ed-empty-state"><div class="ed-empty-icon"><i class="fas fa-exclamation-triangle"></i></div><p class="ed-empty-title">Failed to load</p><p class="ed-empty-sub">Check your connection and try again</p></div>`;
    }
}

// ══════════════════════════════════════════════════
//  KEY INSIGHTS — auto-generated highlights card
// ══════════════════════════════════════════════════
function buildKeyInsights(d, players, teamRow, totalPlayers) {
    const sec  = createSection("fas fa-lightbulb", "gd", "Key Insights");
    const body = sec.querySelector(".ed-section-body");

    const avg         = Number(d.avg_score_per_match ?? 0);
    const last3       = Number(d.avg_score_last_3 ?? 0);
    const capRate     = Number(d.captain_success_rate ?? 0);
    const consistency = Number(d.consistency_score ?? 0);
    const bestStreak  = Number(d.best_streak ?? 0);
    const boostersRem = Number(d.boosters_remaining ?? 7);
    const matchCount  = Number(d.matches_played ?? 0);
    const rank        = teamRow ? (teamRow.rank || teamRow.rank_in_league || null) : null;

    const boosterHistory = d.booster_history || [];
    const boostersUsed   = boosterHistory.length;
    const boosterPtsTotal = boosterHistory.reduce((s, b) => s + (b.points || 0), 0);
    const boosterAvgDelta = boostersUsed > 0 && avg > 0
        ? Math.round((boosterPtsTotal / boostersUsed) - avg)
        : null;

    const pct = rank && totalPlayers > 1
        ? Math.round(((totalPlayers - rank) / (totalPlayers - 1)) * 100)
        : null;

    const insights = [];

    // Rank / percentile
    if (rank === 1) {
        insights.push({ emoji: "👑", text: "You are <strong>Rank #1</strong> — the best manager in this tournament right now!", type: "positive" });
    } else if (pct !== null && pct >= 80) {
        insights.push({ emoji: "🏆", text: `You are in the <strong>Top ${100 - pct}%</strong> of all ${totalPlayers} managers — elite territory.`, type: "positive" });
    }

    // Hot streak
    if (bestStreak >= 4) {
        insights.push({ emoji: "🔥", text: `Your best hot streak was <strong>${bestStreak} matches in a row</strong> scoring 250+ pts — incredibly consistent.`, type: "positive" });
    } else if (bestStreak >= 2) {
        insights.push({ emoji: "🔥", text: `Your best streak was <strong>${bestStreak} hot matches</strong> in a row with 250+ pts each.`, type: "positive" });
    }

    // Form trend
    if (avg > 0 && last3 > 0) {
        const delta = Math.round(last3 - avg);
        if (delta >= 20) {
            insights.push({ emoji: "📈", text: `You are on fire — last 3 match avg is <strong>+${delta} pts above</strong> your season average.`, type: "positive" });
        } else if (delta <= -20) {
            insights.push({ emoji: "📉", text: `Form has dipped — last 3 avg is <strong>${Math.abs(delta)} pts below</strong> your season average. Time to shake things up.`, type: "warning" });
        }
    }

    // Captain
    if (capRate >= 75) {
        insights.push({ emoji: "👑", text: `Elite captaincy — your captain beat the match average in <strong>${capRate}% of matches</strong>.`, type: "positive" });
    } else if (capRate > 0 && capRate < 45) {
        insights.push({ emoji: "⚠️", text: `Captain picks need work — only <strong>${capRate}% success rate</strong>. Your captain choice is costing you points.`, type: "warning" });
    }

    // Booster ROI
    if (boosterAvgDelta !== null && boostersUsed >= 2) {
        if (boosterAvgDelta >= 30) {
            insights.push({ emoji: "🚀", text: `Excellent booster timing — on average your boosters earned <strong>+${boosterAvgDelta} pts above your season avg</strong>.`, type: "positive" });
        } else if (boosterAvgDelta < 0) {
            insights.push({ emoji: "⚠️", text: `Boosters underperforming — on average they scored <strong>${Math.abs(boosterAvgDelta)} pts BELOW</strong> your season avg. Poor timing.`, type: "warning" });
        }
    }

    // Unused boosters
    if (boostersRem >= 4 && matchCount >= 6) {
        insights.push({ emoji: "⚠️", text: `You still have <strong>${boostersRem} boosters left</strong> after ${matchCount} matches — you are leaving big points on the table.`, type: "warning" });
    }

    // Consistency
    if (consistency >= 75) {
        insights.push({ emoji: "🎯", text: `Rock-solid consistency score of <strong>${consistency}/100</strong> — you show up every single match.`, type: "positive" });
    }

    // Cap at 5 insights
    const shown = insights.slice(0, 5);

    if (!shown.length) {
        body.innerHTML = '<div class="ed-no-data">Play more matches to unlock your key insights.</div>';
        return sec;
    }

    body.innerHTML = shown.map(i => `
        <div class="ed-insight-row ${i.type}">
            <span class="ed-insight-emoji">${i.emoji}</span>
            <span class="ed-insight-text">${i.text}</span>
        </div>
    `).join("");

    return sec;
}

// ══════════════════════════════════════════════════
//  HERO
// ══════════════════════════════════════════════════
function buildHero(d, teamRow, avatarUrl, userId, totalPlayers) {
    const wrap = document.createElement("div");
    wrap.className = "ed-team-hero";
    const avatar = document.createElement("div");
    avatar.className = "ed-team-avatar";
    if (avatarUrl) avatar.style.backgroundImage = `url('${avatarUrl}')`;

    const rank = teamRow ? (teamRow.rank || teamRow.rank_in_league || "--") : "--";

    // Percentile from total players + rank
    let pctBadge = "";
    if (rank !== "--" && totalPlayers > 1) {
        const pct = Math.round(((totalPlayers - rank) / (totalPlayers - 1)) * 100);
        pctBadge = `<div class="ed-percentile-badge">Top ${100 - pct}% of ${totalPlayers} managers</div>`;
    }

    // Trend arrow vs previous rank (if rank_journey available)
    let trendHtml = "";
    const journey = d.rank_journey || [];
    if (journey.length >= 2) {
        const sorted = [...journey].sort((a, b) => a.match_number - b.match_number);
        const lastTwo = sorted.slice(-2);
        const diff = lastTwo[0].rank - lastTwo[1].rank; // positive = rank improved
        if (diff > 0) trendHtml = `<div class="ed-rank-trend up">▲ ${diff} places this match</div>`;
        else if (diff < 0) trendHtml = `<div class="ed-rank-trend down">▼ ${Math.abs(diff)} places this match</div>`;
        else trendHtml = `<div class="ed-rank-trend neutral">→ No change</div>`;
    }

    const info = document.createElement("div");
    info.className = "ed-team-info";
    info.innerHTML = `
        <div class="ed-team-name">${d.team_name || "Anonymous"}</div>
        <div class="ed-team-rank">Rank #${rank}</div>
        ${trendHtml}
        ${pctBadge}`;

    const right = document.createElement("div");
    right.innerHTML = `<div class="ed-team-pts">${d.total_points || 0}</div><div class="ed-team-pts-label">Total pts</div>`;
    wrap.append(avatar, info, right);
    return wrap;
}

// ══════════════════════════════════════════════════
//  FORM INDICATOR — dynamic thresholds
// ══════════════════════════════════════════════════
function buildFormIndicator(d) {
    const sec  = createSection("fas fa-fire", "rd", "Current Form");
    const body = sec.querySelector(".ed-section-body");
    const scores = d.last_5_scores || [];
    const avg    = d.avg_score_per_match || 0;
    if (!scores.length) { body.innerHTML = '<div class="ed-no-data">No matches played yet</div>'; return sec; }

    // Dynamic thresholds based on user's own rolling average
    const hotThreshold  = Math.max(avg * 1.15, 200); // 15% above avg or 200 min
    const goodThreshold = avg;
    const okThreshold   = avg * 0.75;

    const dots = scores.map(s => {
        let cls = "form-dot";
        let label = "";
        if (s >= hotThreshold)       { cls += " hot";  label = "🔥"; }
        else if (s >= goodThreshold) { cls += " good"; label = "✅"; }
        else if (s >= okThreshold)   { cls += " ok";   label = "🟡"; }
        else                         { cls += " bad";  label = "❌"; }
        return `<div class="form-dot-wrap">
            <div class="form-dot-label">${label}</div>
            <div class="${cls}"></div>
            <span class="form-dot-score">${s}</span>
        </div>`;
    }).join("");

    const recent    = scores.slice(0, 3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const delta     = Math.round(avgRecent - avg);
    const trend     = delta >= 0
        ? `📈 Last 3 avg is <strong>+${delta} pts</strong> above your season avg — improving!`
        : `📉 Last 3 avg is <strong>${Math.abs(delta)} pts</strong> below your season avg — declining.`;

    body.innerHTML = `
        <div class="ed-form-row">${dots}</div>
        <div class="ed-form-legend">
            <span class="fl-item">🔥 &gt;${Math.round(hotThreshold)} pts</span>
            <span class="fl-item">✅ Above avg (${Math.round(avg)})</span>
            <span class="fl-item">🟡 Near avg</span>
            <span class="fl-item">❌ Below avg</span>
        </div>
        <div class="ed-form-trend">${trend} · Newest first</div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  OVERVIEW — with transparent consistency formula
// ══════════════════════════════════════════════════
function buildOverview(d) {
    const sec  = createSection("fas fa-chart-bar", "green", "Season Overview");
    const body = sec.querySelector(".ed-section-body");
    const cc   = !d.consistency_score ? "wh" : d.consistency_score >= 70 ? "neon" : d.consistency_score >= 50 ? "gd" : "rd";

    // Explain what consistency means
    const consistencyExplain = d.consistency_score != null
        ? `Score variance + captain hit rate + sub efficiency`
        : "";

    body.innerHTML = `
        <div class="ed-stat-grid">
            <div class="ed-stat-cell"><span class="ed-stat-val">${d.matches_played || 0}</span><span class="ed-stat-lbl">Matches Played</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val gd">${d.boosters_remaining ?? 7}</span><span class="ed-stat-lbl">Boosters Left</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val bl">${d.subs_remaining === 999 ? "∞" : (d.subs_remaining ?? "--")}</span><span class="ed-stat-lbl">Subs Left</span></div>
        </div>
        <div class="ed-consistency-row">
            <div class="ed-consistency-header">
                <div>
                    <span class="ed-consistency-label">Consistency Score</span>
                    ${consistencyExplain ? `<div class="ed-consistency-formula">${consistencyExplain}</div>` : ""}
                </div>
                <span class="ed-consistency-val ${cc}">${d.consistency_score != null ? `${d.consistency_score}/100` : "Not enough data"}</span>
            </div>
            ${d.consistency_score != null ? `<div class="ed-consistency-bar"><div class="ed-consistency-fill" style="width:${d.consistency_score}%"></div></div>` : ""}
            ${d.consistency_score != null ? `
            <div class="ed-consistency-grade">
                ${d.consistency_score >= 70 ? "🎯 Rock solid — you show up every match." :
                  d.consistency_score >= 50 ? "📊 Average consistency — some big swings." :
                                              "⚠️ Very inconsistent — scores vary a lot."}
            </div>` : ""}
        </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  SCORE TRENDS — with better chart + tooltips
// ══════════════════════════════════════════════════
function buildScoreTrends(d, history) {
    const sec  = createSection("fas fa-chart-line", "green", "Score Trends");
    const body = sec.querySelector(".ed-section-body");
    body.innerHTML = `
        <div class="ed-stat-grid two-col" style="margin-bottom:10px">
            <div class="ed-stat-cell"><span class="ed-stat-val">${d.avg_score_per_match ?? 0}</span><span class="ed-stat-lbl">Season Avg / Match</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val wh">${d.total_points || 0}</span><span class="ed-stat-lbl">Total Points</span></div>
        </div>
        <div class="ed-trend-row">
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 3</span>
                <span class="ed-trend-val ${getTrendColor(d.avg_score_last_3, d.avg_score_per_match)}">${d.avg_score_last_3 ?? "--"}</span>
                <span class="ed-trend-sub">avg pts</span>
                ${makeTrendArrow(d.avg_score_last_3, d.avg_score_per_match)}
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 6</span>
                <span class="ed-trend-val ${getTrendColor(d.avg_score_last_6, d.avg_score_per_match)}">${d.avg_score_last_6 ?? "--"}</span>
                <span class="ed-trend-sub">avg pts</span>
                ${makeTrendArrow(d.avg_score_last_6, d.avg_score_per_match)}
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 10</span>
                <span class="ed-trend-val ${getTrendColor(d.avg_score_last_10, d.avg_score_per_match)}">${d.avg_score_last_10 ?? "--"}</span>
                <span class="ed-trend-sub">avg pts</span>
                ${makeTrendArrow(d.avg_score_last_10, d.avg_score_per_match)}
            </div>
        </div>
        <div style="margin-top:12px">
            <div class="ed-chart-label">Match-by-match scores · Tap a bar for details</div>
            <div class="ed-chart-wrap" style="position:relative">
                <canvas id="scoreChart"></canvas>
                <div id="scoreTooltip" class="ed-chart-tooltip hidden"></div>
            </div>
        </div>`;
    setTimeout(() => drawBarChart(history, d.avg_score_per_match), 50);
    return sec;
}

function getTrendColor(recent, season) {
    if (!recent || !season) return "";
    return recent >= season ? "neon" : "rd";
}

function makeTrendArrow(recent, season) {
    if (!recent || !season) return "";
    const delta = Math.round(recent - season);
    const sign = delta >= 0 ? "+" : "";
    const cls  = delta >= 0 ? "trend-up" : "trend-down";
    return `<span class="${cls}">${sign}${delta} vs avg</span>`;
}

function drawBarChart(history, avg) {
    const canvas = document.getElementById("scoreChart");
    if (!canvas) return;
    if (!history.length) { canvas.parentElement.innerHTML = '<div class="ed-chart-empty">No match data yet</div>'; return; }

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth || 300;
    const H   = 120;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const data = history.map(h => h.total_points || 0);
    const max  = Math.max(...data, 1);
    const pL = 4, pR = 4, pT = 12, pB = 22;
    const cW = W - pL - pR, cH = H - pT - pB;
    const bW = Math.max(6, Math.floor(cW / data.length) - 3);
    const gap = Math.max(2, Math.floor((cW - bW * data.length) / Math.max(data.length - 1, 1)));

    ctx.clearRect(0, 0, W, H);

    // Avg line
    if (avg) {
        const ay = pT + cH - Math.round((avg / max) * cH);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(154,224,0,0.35)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(pL, ay); ctx.lineTo(W - pR, ay); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(154,224,0,0.6)"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`avg ${avg}`, W - pR - 2, ay - 3);
    }

    // Store bar positions for tooltip
    canvas._barData = [];

    data.forEach((val, i) => {
        const bH = Math.max(3, Math.round((val / max) * cH));
        const x  = pL + i * (bW + gap);
        const y  = pT + cH - bH;
        const isHot = val >= (avg * 1.15 || 200);
        const isAboveAvg = val >= avg;
        ctx.fillStyle = isHot
            ? "#9AE000"
            : isAboveAvg
                ? "rgba(154,224,0,0.55)"
                : "rgba(154,224,0,0.18)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bW, bH, [3, 3, 0, 0]);
        else ctx.rect(x, y, bW, bH);
        ctx.fill();

        // Match label
        if (data.length <= 25) {
            ctx.fillStyle = "rgba(100,116,139,0.7)"; ctx.font = "600 7px sans-serif"; ctx.textAlign = "center";
            ctx.fillText(`M${i + 1}`, x + bW / 2, H - 4);
        }

        canvas._barData.push({ x, y, w: bW, h: bH, val, match: i + 1 });
    });

    // Tooltip on click/touch
    function showTooltipAt(clientX, clientY) {
        const rect  = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const cx = (clientX - rect.left) * scaleX;
        const tip = document.getElementById("scoreTooltip");
        if (!tip) return;
        const bar = canvas._barData.find(b => cx >= b.x && cx <= b.x + b.w);
        if (bar) {
            tip.textContent = `Match ${bar.match}: ${bar.val} pts`;
            tip.classList.remove("hidden");
            const tipLeft = Math.min((bar.x / W) * 100, 70);
            tip.style.left = `${tipLeft}%`;
            tip.style.top  = "0px";
        } else {
            tip.classList.add("hidden");
        }
    }

    canvas.addEventListener("click",      e => showTooltipAt(e.clientX, e.clientY));
    canvas.addEventListener("touchstart", e => { e.preventDefault(); showTooltipAt(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
}

// ══════════════════════════════════════════════════
//  RANK JOURNEY — with percentile line
// ══════════════════════════════════════════════════
function buildRankJourney(d, totalPlayers) {
    const sec  = createSection("fas fa-route", "bl", "Rank Journey");
    const body = sec.querySelector(".ed-section-body");
    const journey = d.rank_journey || [];

    if (!journey.length) { body.innerHTML = '<div class="ed-no-data">Not enough data yet</div>'; return sec; }

    const sorted = [...journey].sort((a, b) => a.match_number - b.match_number);

    if (sorted.length === 1) {
        const pct = totalPlayers > 1 ? Math.round(((totalPlayers - sorted[0].rank) / (totalPlayers - 1)) * 100) : null;
        body.innerHTML = `
            <div style="text-align:center;padding:14px 0">
                <div style="font-family:var(--font-display);font-size:28px;font-weight:900;color:var(--accent)">#${sorted[0].rank}</div>
                <div style="font-family:var(--font-body);font-size:11px;color:var(--text-faint);margin-top:4px">Rank after Match ${sorted[0].match_number}</div>
                ${pct !== null ? `<div style="font-family:var(--font-display);font-size:12px;color:var(--gold);margin-top:6px">Top ${100 - pct}% of ${totalPlayers} managers</div>` : ""}
                <div style="font-family:var(--font-body);font-size:10px;color:var(--text-faint);margin-top:8px;font-style:italic">Play more matches to see your rank journey</div>
            </div>`;
        return sec;
    }

    body.innerHTML = `<div class="ed-rank-journey-wrap"><canvas id="rankChart"></canvas></div>
        <div style="font-family:var(--font-body);font-size:10px;color:var(--text-faint);text-align:center;margin-top:6px;font-style:italic">
            Lower = better rank · 🟡 Gold = Rank 1 · Green line = your percentile
        </div>
        <div id="rankTooltip" class="ed-chart-tooltip hidden" style="margin-top:6px;position:relative"></div>`;

    setTimeout(() => {
        const canvas = document.getElementById("rankChart");
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const W   = canvas.offsetWidth || 300;
        const H   = 120;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        const ranks = sorted.map(r => r.rank);
        const minR  = Math.min(...ranks);
        const maxR  = Math.max(...ranks, totalPlayers > 0 ? totalPlayers : maxR);
        const range = Math.max(maxR - minR, 1);

        const pL = 32, pR = 10, pT = 14, pB = 24;
        const cW = W - pL - pR;
        const cH = H - pT - pB;

        ctx.clearRect(0, 0, W, H);

        // Grid
        [minR, Math.round((minR + maxR) / 2), maxR].forEach(r => {
            const y = pT + Math.round(((r - minR) / range) * cH);
            ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(W - pR, y); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = "rgba(100,116,139,0.7)"; ctx.font = "600 7px sans-serif"; ctx.textAlign = "right";
            ctx.fillText(`#${r}`, pL - 4, y + 3);
        });

        // Percentile annotation line (Top 25%, 50%, 75%)
        if (totalPlayers > 1) {
            const topQuartileRank = Math.ceil(totalPlayers * 0.25);
            const topQuartileY   = pT + Math.round(((topQuartileRank - minR) / range) * cH);
            if (topQuartileY > pT && topQuartileY < pT + cH) {
                ctx.strokeStyle = "rgba(245,158,11,0.2)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
                ctx.beginPath(); ctx.moveTo(pL, topQuartileY); ctx.lineTo(W - pR, topQuartileY); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = "rgba(245,158,11,0.5)"; ctx.font = "600 7px sans-serif"; ctx.textAlign = "left";
                ctx.fillText("Top 25%", pL + 2, topQuartileY - 3);
            }
        }

        // Line + fill
        ctx.beginPath();
        sorted.forEach((pt, i) => {
            const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
            const y = pT + Math.round(((pt.rank - minR) / range) * cH);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "rgba(154,224,0,0.7)"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();

        ctx.beginPath();
        sorted.forEach((pt, i) => {
            const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
            const y = pT + Math.round(((pt.rank - minR) / range) * cH);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.lineTo(pL + cW, pT + cH); ctx.lineTo(pL, pT + cH); ctx.closePath();
        const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
        grad.addColorStop(0, "rgba(154,224,0,0.12)"); grad.addColorStop(1, "rgba(154,224,0,0)");
        ctx.fillStyle = grad; ctx.fill();

        // Dots + labels + tap data
        canvas._rankData = [];
        sorted.forEach((pt, i) => {
            const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
            const y = pT + Math.round(((pt.rank - minR) / range) * cH);
            ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = pt.rank === 1 ? "#f59e0b" : "#9AE000"; ctx.fill();
            ctx.fillStyle = pt.rank === 1 ? "#f59e0b" : "rgba(154,224,0,0.9)";
            ctx.font = "700 8px sans-serif"; ctx.textAlign = "center";
            ctx.fillText(`#${pt.rank}`, x, y - 9);
            ctx.fillStyle = "rgba(100,116,139,0.7)"; ctx.font = "600 7px sans-serif";
            ctx.fillText(`M${pt.match_number}`, x, H - 5);

            // Percentile for this match
            const pctMatch = totalPlayers > 1 ? Math.round(((totalPlayers - pt.rank) / (totalPlayers - 1)) * 100) : null;
            canvas._rankData.push({ x, y, rank: pt.rank, match: pt.match_number, pct: pctMatch });
        });

        // Tap for tooltip
        canvas.addEventListener("click", e => {
            const rect = canvas.getBoundingClientRect();
            const cx = (e.clientX - rect.left) * (W / rect.width);
            const tip = document.getElementById("rankTooltip");
            if (!tip) return;
            const closest = canvas._rankData.reduce((best, pt) => Math.abs(pt.x - cx) < Math.abs(best.x - cx) ? pt : best);
            if (closest) {
                const pctStr = closest.pct !== null ? ` · Top ${100 - closest.pct}%` : "";
                tip.textContent = `Match ${closest.match}: Rank #${closest.rank}${pctStr}`;
                tip.classList.remove("hidden");
            }
        });

    }, 60);

    return sec;
}

// ══════════════════════════════════════════════════
//  BEST / WORST
// ══════════════════════════════════════════════════
function buildBestWorst(d) {
    const sec  = createSection("fas fa-trophy", "gd", "Best & Worst Match");
    const body = sec.querySelector(".ed-section-body");
    const avg  = d.avg_score_per_match || 0;

    const bestDelta  = avg > 0 ? Math.round((d.best_match_score  ?? 0) - avg) : null;
    const worstDelta = avg > 0 ? Math.round((d.worst_match_score ?? 0) - avg) : null;

    body.innerHTML = `<div class="ed-best-worst">
        <div class="ed-bw-cell best">
            <span class="ed-bw-icon">🏆</span>
            <span class="ed-bw-val">${d.best_match_score ?? 0}</span>
            <span class="ed-bw-lbl">Best Match</span>
            ${bestDelta !== null ? `<span class="ed-bw-delta positive">+${bestDelta} vs avg</span>` : ""}
        </div>
        <div class="ed-bw-cell worst">
            <span class="ed-bw-icon">📉</span>
            <span class="ed-bw-val">${d.worst_match_score ?? 0}</span>
            <span class="ed-bw-lbl">Worst Match</span>
            ${worstDelta !== null ? `<span class="ed-bw-delta negative">${worstDelta} vs avg</span>` : ""}
        </div>
    </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  WORST MATCH AUTOPSY — NEW SECTION
// ══════════════════════════════════════════════════
function buildWorstMatchAutopsy(d) {
    const sec  = createSection("fas fa-microscope", "rd", "Worst Match Autopsy");
    const body = sec.querySelector(".ed-section-body");

    const autopsy = d.worst_match_autopsy || null;

    if (!autopsy) {
        body.innerHTML = '<div class="ed-no-data">No autopsy data available yet — need match-level breakdown from your database.</div>';
        return sec;
    }

    // autopsy shape: { match_number, score, captain_pts, players_played, total_players, non_playing_avg }
    const { match_number, score, captain_pts, players_played, total_players, non_playing_avg } = autopsy;
    const captainGrade = captain_pts >= 60 ? "✅ Good" : captain_pts >= 30 ? "🟡 Average" : "❌ Poor";

    body.innerHTML = `
        <div class="ed-autopsy-header">
            <span class="ed-autopsy-badge">Match ${match_number}</span>
            <span class="ed-autopsy-score">${score} pts</span>
        </div>
        <div class="ed-autopsy-grid">
            <div class="ed-autopsy-cell">
                <span class="ed-autopsy-icon">👑</span>
                <div>
                    <div class="ed-autopsy-val">${captain_pts ?? "--"} pts</div>
                    <div class="ed-autopsy-lbl">Captain scored · ${captainGrade}</div>
                </div>
            </div>
            <div class="ed-autopsy-cell">
                <span class="ed-autopsy-icon">⚽</span>
                <div>
                    <div class="ed-autopsy-val">${players_played ?? "--"} / ${total_players ?? 11}</div>
                    <div class="ed-autopsy-lbl">Players actually played</div>
                </div>
            </div>
            ${non_playing_avg != null ? `
            <div class="ed-autopsy-cell">
                <span class="ed-autopsy-icon">💤</span>
                <div>
                    <div class="ed-autopsy-val">${non_playing_avg} pts avg</div>
                    <div class="ed-autopsy-lbl">Avg pts from non-playing players</div>
                </div>
            </div>` : ""}
        </div>
        <div class="ed-autopsy-verdict">
            ${players_played < 8 ? "⚠️ Too many non-playing players hurt your score." :
              captain_pts < 30   ? "⚠️ Poor captain pick was the main culprit." :
                                   "📊 Just a bad day — all factors were against you."}
        </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  STREAKS
// ══════════════════════════════════════════════════
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
            <div class="ed-streak-sub">150 pts or below in a row</div>
        </div>
    </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  SUBS — improved with profitability metric
// ══════════════════════════════════════════════════
function buildSubsTrends(d) {
    const sec  = createSection("fas fa-exchange-alt", "bl", "Subs Analysis");
    const body = sec.querySelector(".ed-section-body");

    const totalSubs   = Number(d.total_subs_used ?? 0);
    const matchCount  = Number(d.matches_played ?? 0);
    const avgPerMatch = matchCount > 0 ? (totalSubs / matchCount).toFixed(1) : "--";

    // Sub efficiency: avg pts of subbed-in vs subbed-out players
    const subEfficiency = d.sub_efficiency || null;
    let efficiencyHtml = "";
    if (subEfficiency) {
        const { avg_pts_subbed_in, avg_pts_subbed_out } = subEfficiency;
        const delta = Math.round((avg_pts_subbed_in ?? 0) - (avg_pts_subbed_out ?? 0));
        const cls   = delta >= 0 ? "neon" : "rd";
        const sign  = delta >= 0 ? "+" : "";
        efficiencyHtml = `
            <div class="ed-sub-efficiency">
                <div class="ed-sub-eff-title">Sub Profitability</div>
                <div class="ed-sub-eff-row">
                    <div class="ed-sub-eff-cell">
                        <span class="ed-sub-eff-val">${avg_pts_subbed_in ?? "--"}</span>
                        <span class="ed-sub-eff-lbl">Avg pts (subbed IN)</span>
                    </div>
                    <div class="ed-sub-eff-vs">vs</div>
                    <div class="ed-sub-eff-cell">
                        <span class="ed-sub-eff-val">${avg_pts_subbed_out ?? "--"}</span>
                        <span class="ed-sub-eff-lbl">Avg pts (subbed OUT)</span>
                    </div>
                </div>
                <div class="ed-sub-eff-verdict">
                    Net: <span class="ed-stat-val ${cls}" style="font-size:14px">${sign}${delta} pts per sub</span>
                    ${delta >= 0
                        ? " — your subs are profitable ✅"
                        : " — dropping better players than you're bringing in ⚠️"}
                </div>
            </div>`;
    } else {
        efficiencyHtml = `<div class="ed-sub-eff-note">Sub profitability data needs match-level sub tracking in your DB.</div>`;
    }

    body.innerHTML = `
        <div class="ed-stat-grid two-col" style="margin-bottom:10px">
            <div class="ed-stat-cell"><span class="ed-stat-val bl">${avgPerMatch}</span><span class="ed-stat-lbl">Avg Subs / Match</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val wh">${totalSubs}</span><span class="ed-stat-lbl">Total Subs Used</span></div>
        </div>
        <div class="ed-trend-row">
            <div class="ed-trend-cell"><span class="ed-trend-label">Last 3</span><span class="ed-trend-val">${d.avg_subs_last_3 ?? "--"}</span><span class="ed-trend-sub">avg subs</span></div>
            <div class="ed-trend-cell"><span class="ed-trend-label">Last 6</span><span class="ed-trend-val">${d.avg_subs_last_6 ?? "--"}</span><span class="ed-trend-sub">avg subs</span></div>
            <div class="ed-trend-cell"><span class="ed-trend-label">Last 10</span><span class="ed-trend-val">${d.avg_subs_last_10 ?? "--"}</span><span class="ed-trend-sub">avg subs</span></div>
        </div>
        ${efficiencyHtml}`;

    return sec;
}

// ══════════════════════════════════════════════════
//  CAPTAIN — with pick frequency breakdown
// ══════════════════════════════════════════════════
function buildCaptainStats(d) {
    const sec  = createSection("fas fa-crown", "gd", "Captain Performance");
    const body = sec.querySelector(".ed-section-body");

    const rate  = d.captain_success_rate;
    const color = rate == null ? "#64748b" : rate >= 70 ? "#9AE000" : rate >= 50 ? "#f59e0b" : "#ef4444";
    const label = rate == null ? "Not enough data" : rate >= 70 ? "Excellent captaincy!" : rate >= 50 ? "Good captaincy" : "Room to improve";

    // Captain frequency data (if available from DB)
    const captainPicks = d.captain_picks || []; // [{name, times_captain, total_pts_as_captain}]
    let captainPicksHtml = "";
    if (captainPicks.length) {
        captainPicksHtml = `
            <div class="ed-captain-picks">
                <div class="ed-captain-picks-title">Your Captain Choices</div>
                ${captainPicks.slice(0, 5).map(p => {
                    const avgPts = p.times_captain > 0 ? Math.round(p.total_pts_as_captain / p.times_captain) : 0;
                    return `<div class="ed-captain-pick-row">
                        <span class="ed-captain-pick-name">${p.name}</span>
                        <span class="ed-captain-pick-times">${p.times_captain}× captain</span>
                        <span class="ed-captain-pick-pts">${avgPts} avg pts</span>
                    </div>`;
                }).join("")}
            </div>`;
    }

    body.innerHTML = `<div class="ed-captain-wrap">
        <div class="ed-captain-circle" style="border-color:${color}">
            <span class="ed-captain-pct" style="color:${color}">${rate != null ? rate + "%" : "--"}</span>
            <span class="ed-captain-sub">success</span>
        </div>
        <div class="ed-captain-info">
            <div class="ed-captain-label" style="color:${color}">${label}</div>
            <div class="ed-captain-desc">Your captain scored above the match average in ${rate != null ? rate + "%" : "--"} of your matches</div>
        </div>
    </div>
    ${captainPicksHtml}`;
    return sec;
}

// ══════════════════════════════════════════════════
//  BOOSTER ROI — with baseline comparison
// ══════════════════════════════════════════════════
function buildBoosterROI(d) {
    const sec  = createSection("fas fa-rocket", "pu", "Booster ROI");
    const body = sec.querySelector(".ed-section-body");
    const history = d.booster_history || [];
    if (!history.length) { body.innerHTML = '<div class="ed-no-data">No boosters used yet</div>'; return sec; }

    const avg   = Number(d.avg_score_per_match ?? 0);
    const emoji = { TOTAL_2X:"🚀",INDIAN_2X:"🇮🇳",OVERSEAS_2X:"✈️",UNCAPPED_2X:"🧢",CAPTAIN_3X:"👑",MOM_2X:"🏆",FREE_11:"🆓" };
    const name  = { TOTAL_2X:"Total 2X",INDIAN_2X:"Indian 2X",OVERSEAS_2X:"Overseas 2X",UNCAPPED_2X:"Uncapped 2X",CAPTAIN_3X:"Captain 3X",MOM_2X:"MOM 2X",FREE_11:"Free 11" };
    const best  = [...history].sort((a, b) => b.points - a.points)[0];

    // Overall booster summary
    const totalBoosterPts = history.reduce((s, b) => s + (b.points || 0), 0);
    const avgBoosterPts   = Math.round(totalBoosterPts / history.length);
    const avgDelta        = avg > 0 ? Math.round(avgBoosterPts - avg) : null;
    const deltaStr        = avgDelta !== null
        ? (avgDelta >= 0 ? `<span class="neon-text">+${avgDelta} above your season avg</span>` : `<span class="red-text">${avgDelta} below your season avg ⚠️</span>`)
        : "";

    const rows = history.map(b => {
        const isBest = b.match_number === best.match_number;
        const delta  = avg > 0 ? Math.round(b.points - avg) : null;
        const deltaHtml = delta !== null
            ? `<span class="ed-booster-delta ${delta >= 0 ? "pos" : "neg"}">${delta >= 0 ? "+" : ""}${delta}</span>`
            : "";
        return `<div class="ed-booster-row${isBest ? " best-booster" : ""}">
            <span class="ed-booster-emoji">${emoji[b.booster] || "⚡"}</span>
            <div class="ed-booster-info">
                <span class="ed-booster-name">${name[b.booster] || b.booster}</span>
                <span class="ed-booster-match">Match ${b.match_number}</span>
            </div>
            <div class="ed-booster-right">
                <div class="ed-booster-pts${isBest ? " best" : ""}">${b.points}<span class="ed-booster-ptsl">pts</span></div>
                ${deltaHtml}
            </div>
        </div>`;
    }).join("");

    body.innerHTML = `
        <div class="ed-booster-summary">
            <div class="ed-booster-sum-stat">
                <span class="ed-stat-val pu">${history.length}</span>
                <span class="ed-stat-lbl">Used</span>
            </div>
            <div class="ed-booster-sum-stat">
                <span class="ed-stat-val wh">${avgBoosterPts}</span>
                <span class="ed-stat-lbl">Avg pts</span>
            </div>
            <div class="ed-booster-sum-stat" style="flex:2;text-align:left;padding-left:8px">
                <span class="ed-stat-lbl">vs your season avg: ${deltaStr}</span>
            </div>
        </div>
        <div class="ed-booster-best-tag">Best: ${emoji[best.booster] || "⚡"} ${name[best.booster] || best.booster} → ${best.points} pts in M${best.match_number}</div>
        <div class="ed-booster-list">${rows}</div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  H2H — vs current Rank 1 (with scope note)
// ══════════════════════════════════════════════════
function buildH2H(d, userId) {
    const sec  = createSection("fas fa-swords", "rd", "Head to Head vs Rank 1");
    const body = sec.querySelector(".ed-section-body");
    if (!rank1UserId || rank1UserId === userId) { body.innerHTML = '<div class="ed-no-data">You ARE rank 1! Nothing to compare.</div>'; return sec; }

    const wins   = Number(d.h2h_wins_vs_rank1 || 0);
    const total  = Number(d.matches_played || 0);
    const losses = Math.max(0, total - wins);
    const pct    = total > 0 ? Math.round((wins / total) * 100) : 0;

    // Rank 1 team name
    const rank1Team = allTeams.find(t => t.user_id === rank1UserId);
    const rank1Name = rank1Team?.team_name || "Rank 1";

    body.innerHTML = `
        <div class="ed-h2h-scope-note">⚠️ Compared against <strong>${rank1Name}</strong> — today's Rank 1. Match-level rank comparison not yet available.</div>
        <div class="ed-h2h-row">
            <div class="ed-h2h-side win"><div class="ed-h2h-val">${wins}</div><div class="ed-h2h-lbl">You Won</div></div>
            <div class="ed-h2h-vs">VS<br><span style="font-size:9px;color:#475569">${rank1Name}</span></div>
            <div class="ed-h2h-side loss"><div class="ed-h2h-val">${losses}</div><div class="ed-h2h-lbl">They Won</div></div>
        </div>
        <div class="ed-h2h-bar"><div class="ed-h2h-fill" style="width:${pct}%"></div></div>
        <div class="ed-h2h-note">You beat rank 1 in ${pct}% of individual matches</div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  DEAD WEIGHT — with urgency labels
// ══════════════════════════════════════════════════
function buildDeadWeight(players) {
    const sec  = createSection("fas fa-skull", "rd", "Dead Weight Alert");
    const body = sec.querySelector(".ed-section-body");

    const allPlayers = [
        ...(players.top_scorers   || []),
        ...(players.most_picked   || []),
        ...(players.top_wk || []), ...(players.top_bat || []),
        ...(players.top_ar || []), ...(players.top_bowl || []),
        ...(players.top_indian || []), ...(players.top_overseas || []), ...(players.top_uncapped || []),
    ];
    const seen = new Set();
    const unique = allPlayers.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; });

    const dead = unique.filter(p => (p.matches_in_team >= 2) && (p.matches_played === 0 || p.total_points_earned <= 0));

    if (!dead.length) {
        body.innerHTML = `<div class="ed-dw-clean"><div class="ed-dw-clean-icon">✅</div><div class="ed-dw-clean-text">No dead weight found!</div><div class="ed-dw-clean-sub">Every regular pick contributed points.</div></div>`;
        return sec;
    }

    const rows = dead.map(p => {
        // Urgency: 🔴 if 5+ matches with 0 pts, 🟡 if 2-4 matches
        const urgency = p.matches_in_team >= 5 ? "🔴 Critical" : p.matches_in_team >= 3 ? "🟡 Watch" : "⚪ Minor";
        return `<div class="ed-dw-row">
            <div class="ed-dw-left">
                <span class="ed-dw-icon">💀</span>
                <div class="ed-dw-info">
                    <span class="ed-dw-name">${p.name}</span>
                    <span class="ed-dw-meta">${p.role} · picked ${p.matches_in_team}× · played ${p.matches_played}×</span>
                    <span class="ed-dw-urgency">${urgency} — consider subbing out</span>
                </div>
            </div>
            <div class="ed-dw-pts ${p.total_points_earned <= 0 ? "neg" : ""}">${p.total_points_earned} pts</div>
        </div>`;
    }).join("");

    body.innerHTML = `
        <div class="ed-dw-warning"><i class="fas fa-triangle-exclamation"></i> ${dead.length} player${dead.length > 1 ? "s" : ""} took up squad slots without contributing</div>
        <div class="ed-dw-list">${rows}</div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  TRANSFER INTELLIGENCE — NEW SECTION
// ══════════════════════════════════════════════════
function buildTransferIntelligence(players) {
    const sec  = createSection("fas fa-arrows-rotate", "pu", "Transfer Intelligence");
    const body = sec.querySelector(".ed-section-body");

    const transfers = players.transfer_history || null;

    if (!transfers) {
        body.innerHTML = `<div class="ed-no-data">Transfer tracking needs match-level sub data in your DB. Shows best/worst sub decisions.</div>`;
        return sec;
    }

    const { best_transfer, worst_transfer } = transfers;

    body.innerHTML = `
        <div class="ed-transfer-grid">
            ${best_transfer ? `
            <div class="ed-transfer-card best">
                <div class="ed-transfer-header">🏆 Best Transfer</div>
                <div class="ed-transfer-body">
                    <div class="ed-transfer-arrow">
                        <span class="ed-transfer-out">${best_transfer.out}</span>
                        <span class="ed-transfer-direction">→ IN →</span>
                        <span class="ed-transfer-in">${best_transfer.in}</span>
                    </div>
                    <div class="ed-transfer-gain">
                        +${best_transfer.pts_gained} pts gained (M${best_transfer.match_number})
                    </div>
                </div>
            </div>` : ""}
            ${worst_transfer ? `
            <div class="ed-transfer-card worst">
                <div class="ed-transfer-header">💸 Worst Transfer</div>
                <div class="ed-transfer-body">
                    <div class="ed-transfer-arrow">
                        <span class="ed-transfer-out">${worst_transfer.out}</span>
                        <span class="ed-transfer-direction">→ OUT →</span>
                        <span class="ed-transfer-in">${worst_transfer.in}</span>
                    </div>
                    <div class="ed-transfer-loss">
                        ${worst_transfer.pts_lost} pts lost (M${worst_transfer.match_number})
                    </div>
                </div>
            </div>` : ""}
        </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  PLAYER USAGE
// ══════════════════════════════════════════════════
function buildPlayerUsage(players, d) {
    const sec  = createSection("fas fa-users-line", "pu", "Player Usage");
    const body = sec.querySelector(".ed-section-body");
    const u = players.player_usage || {};
    const uniquePlayers    = u.unique_players_appeared   ?? "--";
    const totalAppearances = u.total_appearances         ?? "--";
    const avgPerMatch      = u.avg_appearances_per_match ?? "--";
    const avgPtsPerAppear  = u.avg_pts_per_appearance    ?? "--";
    body.innerHTML = `
        <div class="ed-stat-grid two-col" style="margin-bottom:10px">
            <div class="ed-stat-cell"><span class="ed-stat-val pu">${uniquePlayers}</span><span class="ed-stat-lbl">Unique Players Used</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val wh">${totalAppearances}</span><span class="ed-stat-lbl">Total Appearances</span></div>
        </div>
        <div class="ed-stat-grid two-col" style="margin-bottom:12px">
            <div class="ed-stat-cell"><span class="ed-stat-val bl">${avgPerMatch}</span><span class="ed-stat-lbl">Avg per Match</span></div>
            <div class="ed-stat-cell"><span class="ed-stat-val gd">${avgPtsPerAppear}</span><span class="ed-stat-lbl">Avg Pts / Appearance</span></div>
        </div>
        <div style="background:var(--bg-card-alt);border:1px solid var(--border-subtle);border-radius:10px;padding:10px 12px;">
            <div style="font-family:var(--font-body);font-size:11px;color:var(--text-faint);line-height:1.7">
                <i class="fas fa-circle-info" style="color:var(--accent);margin-right:5px"></i>
                <strong style="color:var(--text-dim)">${uniquePlayers} players</strong> took the field across the season —
                <strong style="color:var(--text-dim)">${totalAppearances} total appearances</strong>,
                averaging <strong style="color:var(--text-dim)">${avgPerMatch} per match</strong>
                and earning <strong style="color:var(--gold)">${avgPtsPerAppear} pts each time</strong>.
            </div>
        </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  TOP SCORERS
// ══════════════════════════════════════════════════
function buildTopScorers(players) {
    const sec  = createSection("fas fa-star", "gd", "Top Point Earners");
    const body = sec.querySelector(".ed-section-body");
    const list = players.top_scorers || [];
    if (!list.length) { body.innerHTML = '<div class="ed-no-data">No match data yet</div>'; return sec; }
    const c = document.createElement("div"); c.className = "ed-player-list";
    list.forEach((p, i) => c.appendChild(buildPlayerCard(p, i + 1)));
    body.appendChild(c); return sec;
}

// ══════════════════════════════════════════════════
//  MOST PICKED
// ══════════════════════════════════════════════════
function buildMostPicked(players) {
    const sec  = createSection("fas fa-heart", "pu", "Most Loyal Players");
    const body = sec.querySelector(".ed-section-body");
    const list = players.most_picked || [];
    if (!list.length) { body.innerHTML = '<div class="ed-no-data">No match data yet</div>'; return sec; }
    const c = document.createElement("div"); c.className = "ed-player-list";
    list.forEach((p, i) => {
        const card = document.createElement("div");
        card.className = "ed-player-card";
        const rankEl = document.createElement("div");
        rankEl.className = `ed-player-rank r${i + 1}`;
        rankEl.textContent = i + 1;
        const info = document.createElement("div");
        info.className = "ed-player-info";
        info.innerHTML = `<span class="ed-player-name">${p.name || "Unknown"}</span><span class="ed-player-meta">${p.role || ""} · played ${p.matches_played || 0} matches</span>`;
        const right = document.createElement("div");
        right.style.textAlign = "right";
        right.innerHTML = `<span class="ed-player-pts">${p.total_points_earned || 0}</span><span class="ed-player-pts-lbl">pts earned</span>`;
        card.append(rankEl, info, right); c.appendChild(card);
    });
    body.appendChild(c); return sec;
}

// ══════════════════════════════════════════════════
//  BY ROLE
// ══════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════
//  PLAYER CATEGORIES — with tournament avg comparison
// ══════════════════════════════════════════════════
function buildPlayerCategories(players) {
    const sec  = createSection("fas fa-flag", "green", "Player Categories");
    const body = sec.querySelector(".ed-section-body");

    const breakdown   = players.category_breakdown || [];
    const totalPts    = breakdown.reduce((a, b) => a + (b.total_points || 0), 0);

    const catColors = { indian: "#9AE000", overseas: "#7cc4ff", uncapped: "#f59e0b" };
    const catLabels = { indian: "Indian",  overseas: "Overseas", uncapped: "Uncapped" };
    const catIcons  = { indian: "🇮🇳",    overseas: "✈️",       uncapped: "🧢" };

    // Tournament averages (if provided from DB)
    const tournamentCatAvg = players.tournament_category_avg || null;
    // Shape: { indian: 40, overseas: 42, uncapped: 18 } (% of total pts)

    let barHtml = "";
    if (breakdown.length && totalPts > 0) {
        const bars = breakdown.map(cat => {
            const pct = Math.round((cat.total_points / totalPts) * 100);
            return `<div class="ed-cat-bar-seg" style="width:${pct}%;background:${catColors[cat.category] || "#64748b"}" title="${catLabels[cat.category]}: ${pct}%"></div>`;
        }).join("");
        barHtml = `<div class="ed-cat-breakdown"><div class="ed-cat-breakdown-label">Points share by category</div><div class="ed-cat-bar">${bars}</div></div>`;
    }

    let summaryHtml = "";
    if (breakdown.length) {
        const rows = breakdown.map(cat => {
            const pct      = totalPts > 0 ? Math.round((cat.total_points / totalPts) * 100) : 0;
            const color    = catColors[cat.category] || "#64748b";
            const icon     = catIcons[cat.category]  || "";
            const label    = catLabels[cat.category] || cat.category;
            const numPlayers = cat.total_players ?? cat.total_picks ?? "--";

            // Tournament avg comparison
            const tourAvg = tournamentCatAvg?.[cat.category] ?? null;
            const deltaHtml = tourAvg !== null
                ? (() => {
                    const d = pct - tourAvg;
                    const sign = d >= 0 ? "+" : "";
                    const cls  = d >= 0 ? "neon-text" : "red-text";
                    return `<span class="${cls}" style="font-size:9px">${sign}${d}% vs tourney avg</span>`;
                  })()
                : "";

            return `<div class="ed-cat-row">
                <div class="ed-cat-row-left">
                    <span class="ed-cat-dot" style="background:${color}"></span>
                    <span class="ed-cat-name">${icon} ${label}</span>
                </div>
                <div class="ed-cat-row-right">
                    <div class="ed-cat-pill"><span class="ed-cat-pill-val">${numPlayers}</span><span class="ed-cat-pill-lbl">players</span></div>
                    <div class="ed-cat-pill"><span class="ed-cat-pill-val" style="color:${color}">${cat.total_points}</span><span class="ed-cat-pill-lbl">pts</span></div>
                    <div class="ed-cat-pill">
                        <span class="ed-cat-pill-val" style="color:${color}">${pct}%</span>
                        <span class="ed-cat-pill-lbl">share</span>
                        ${deltaHtml}
                    </div>
                </div>
            </div>`;
        }).join("");
        summaryHtml = `<div class="ed-cat-summary">${rows}</div>`;
    }

    const tabs     = document.createElement("div"); tabs.className = "ed-role-tabs";
    const listWrap = document.createElement("div"); listWrap.className = "ed-player-list";
    const summaryWrap = document.createElement("div"); summaryWrap.id = "uncappedSummaryWrap";

    const tabList = [
        { key: "top_indian",   label: "🇮🇳 Indian"  },
        { key: "top_overseas", label: "✈️ Overseas" },
        { key: "top_uncapped", label: "🧢 Uncapped" },
    ];
    let activeKey = "top_indian";

    function renderCategoryTab(key) {
        listWrap.innerHTML = ""; summaryWrap.innerHTML = "";
        if (key === "top_uncapped") {
            const us = players.uncapped_summary;
            if (us) {
                summaryWrap.innerHTML = `<div class="ed-uncapped-summary">
                    <div class="ed-uncapped-stat"><span class="ed-uncapped-val">${us.total_picks || 0}</span><span class="ed-uncapped-lbl">Total Picks</span></div>
                    <div class="ed-uncapped-divider"></div>
                    <div class="ed-uncapped-stat"><span class="ed-uncapped-val gold">${us.total_points || 0}</span><span class="ed-uncapped-lbl">Total pts</span></div>
                    <div class="ed-uncapped-divider"></div>
                    <div class="ed-uncapped-stat"><span class="ed-uncapped-val">${us.avg_points_per_pick || 0}</span><span class="ed-uncapped-lbl">Avg/pick</span></div>
                    <div class="ed-uncapped-divider"></div>
                    <div class="ed-uncapped-stat"><span class="ed-uncapped-val">${us.matches_with_uncapped || 0}</span><span class="ed-uncapped-lbl">Matches used</span></div>
                </div>`;
            }
        }
        const list = players[key] || [];
        if (!list.length) { listWrap.innerHTML = '<div class="ed-no-data">No data for this category yet</div>'; return; }
        list.forEach((p, i) => listWrap.appendChild(buildPlayerCard(p, i + 1)));
    }

    tabList.forEach(t => {
        const btn = document.createElement("button");
        btn.className = "ed-role-tab" + (t.key === activeKey ? " active" : "");
        btn.textContent = t.label;
        btn.onclick = () => { tabs.querySelectorAll(".ed-role-tab").forEach(b => b.classList.remove("active")); btn.classList.add("active"); activeKey = t.key; renderCategoryTab(t.key); };
        tabs.appendChild(btn);
    });

    renderCategoryTab("top_indian");
    body.innerHTML = barHtml + summaryHtml;
    body.appendChild(tabs); body.appendChild(summaryWrap); body.appendChild(listWrap);
    return sec;
}

// ══════════════════════════════════════════════════
//  COMPARE — with overall verdict
// ══════════════════════════════════════════════════
function buildCompareSection(userId) {
    const sec  = createSection("fas fa-code-compare", "pu", "Compare with Another Team");
    const body = sec.querySelector(".ed-section-body");
    const opts = allTeams.filter(t => t.user_id !== userId).map(t =>
        `<option value="${t.user_id}">${t.team_name || "Anonymous"}${t.total_points > 0 ? " · "+t.total_points+" pts" : ""}</option>`
    ).join("");
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

async function loadCompare(uid1, uid2) {
    const result = document.getElementById("compareResult");
    if (!result) return;
    result.innerHTML = '<div class="ed-no-data">Loading...</div>';
    try {
        const [r1, r2, p1, p2] = await Promise.all([
            supabase.from("team_lab_view").select("team_name,total_points,avg_score_per_match,best_match_score,worst_match_score,matches_played,captain_success_rate,consistency_score,total_subs_used,boosters_remaining,booster_history").eq("user_id", uid1).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.from("team_lab_view").select("team_name,total_points,avg_score_per_match,best_match_score,worst_match_score,matches_played,captain_success_rate,consistency_score,total_subs_used,boosters_remaining,booster_history").eq("user_id", uid2).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.rpc("get_team_lab_players", { p_user_id: uid1, p_tournament_id: activeTournamentId }),
            supabase.rpc("get_team_lab_players", { p_user_id: uid2, p_tournament_id: activeTournamentId }),
        ]);

        const a = r1.data, b = r2.data, pa = p1.data, pb = p2.data;
        if (!a || !b) { result.innerHTML = '<div class="ed-no-data">Could not load comparison</div>'; return; }

        const aBoosters    = 7 - (a.boosters_remaining ?? 7);
        const bBoosters    = 7 - (b.boosters_remaining ?? 7);
        const aBoosterHist = a.booster_history || [];
        const bBoosterHist = b.booster_history || [];
        const aBoosterPts  = aBoosterHist.reduce((s, x) => s + (x.points || 0), 0);
        const bBoosterPts  = bBoosterHist.reduce((s, x) => s + (x.points || 0), 0);
        const aAvgPerBoost = aBoosters > 0 ? Math.round(aBoosterPts / aBoosters) : "--";
        const bAvgPerBoost = bBoosters > 0 ? Math.round(bBoosterPts / bBoosters) : "--";
        const aAvgPerSub   = a.total_subs_used > 0 ? Math.round(a.total_points / a.total_subs_used) : "--";
        const bAvgPerSub   = b.total_subs_used > 0 ? Math.round(b.total_points / b.total_subs_used) : "--";
        const aUnique      = pa?.player_usage?.unique_players_appeared ?? "--";
        const bUnique      = pb?.player_usage?.unique_players_appeared ?? "--";
        const aAvgAppear   = pa?.player_usage?.avg_pts_per_appearance  ?? "--";
        const bAvgAppear   = pb?.player_usage?.avg_pts_per_appearance  ?? "--";

        // Count wins per team
        const allStats = [
            [a.total_points, b.total_points, true],
            [a.avg_score_per_match, b.avg_score_per_match, true],
            [a.best_match_score, b.best_match_score, true],
            [a.worst_match_score, b.worst_match_score, true],
            [a.consistency_score, b.consistency_score, true],
            [a.captain_success_rate, b.captain_success_rate, true],
            [a.total_subs_used, b.total_subs_used, false],
            [aAvgPerSub, bAvgPerSub, true],
            [aBoosters, bBoosters, false],
            [aBoosterPts, bBoosterPts, true],
            [aAvgPerBoost, bAvgPerBoost, true],
            [aUnique, bUnique, true],
            [aAvgAppear, bAvgAppear, true],
        ];

        let aWins = 0, bWins = 0;
        allStats.forEach(([v1, v2, higherBetter]) => {
            const n1 = parseFloat(v1), n2 = parseFloat(v2);
            if (isNaN(n1) || isNaN(n2) || n1 === n2) return;
            if (higherBetter ? n1 > n2 : n1 < n2) aWins++; else bWins++;
        });

        const verdictColor = aWins > bWins ? "var(--accent)" : bWins > aWins ? "var(--red)" : "var(--text-faint)";
        const verdictText  = aWins > bWins
            ? `${a.team_name || "Team A"} leads <strong>${aWins}–${bWins}</strong>`
            : bWins > aWins
                ? `${b.team_name || "Team B"} leads <strong>${bWins}–${aWins}</strong>`
                : `Dead heat — <strong>${aWins}–${bWins}</strong> tie`;

        const row = (label, v1, v2, higherIsBetter = true) => {
            const n1 = parseFloat(v1), n2 = parseFloat(v2);
            let w1 = false, w2 = false;
            if (!isNaN(n1) && !isNaN(n2)) {
                if (higherIsBetter) { w1 = n1 >= n2; w2 = n2 >= n1; } else { w1 = n1 <= n2; w2 = n2 <= n1; }
            }
            return `<div class="ed-cmp-row"><div class="ed-cmp-val${w1?" win":""}">${v1??"--"}</div><div class="ed-cmp-label">${label}</div><div class="ed-cmp-val${w2?" win":""}">${v2??"--"}</div></div>`;
        };
        const section = label => `<div class="ed-cmp-section-label">${label}</div>`;

        result.innerHTML = `
            <div class="ed-cmp-verdict" style="border-color:${verdictColor}">
                <span style="color:${verdictColor}">${verdictText}</span>
                <span class="ed-cmp-verdict-sub">across ${allStats.length} stat categories</span>
            </div>
            <div class="ed-cmp-header">
                <div class="ed-cmp-team">${a.team_name || "Team A"}</div>
                <div class="ed-cmp-vs">VS</div>
                <div class="ed-cmp-team">${b.team_name || "Team B"}</div>
            </div>
            ${section("📊 Season")}
            ${row("Total Points", a.total_points, b.total_points)}
            ${row("Matches Played", a.matches_played, b.matches_played)}
            ${row("Avg / Match", a.avg_score_per_match, b.avg_score_per_match)}
            ${row("Best Match", a.best_match_score, b.best_match_score)}
            ${row("Worst Match", a.worst_match_score, b.worst_match_score)}
            ${row("Consistency", a.consistency_score, b.consistency_score)}
            ${section("👑 Captaincy")}
            ${row("Captain Success %", a.captain_success_rate, b.captain_success_rate)}
            ${section("🔄 Subs")}
            ${row("Total Subs Used", a.total_subs_used, b.total_subs_used, false)}
            ${row("Pts / Sub", aAvgPerSub, bAvgPerSub)}
            ${section("🚀 Boosters")}
            ${row("Boosters Used", aBoosters, bBoosters, false)}
            ${row("Total Booster Pts", aBoosterPts, bBoosterPts)}
            ${row("Avg Pts / Booster", aAvgPerBoost, bAvgPerBoost)}
            ${section("👥 Players")}
            ${row("Unique Players", aUnique, bUnique)}
            ${row("Avg Pts / Appearance", aAvgAppear, bAvgAppear)}
        `;

    } catch (err) {
        console.error("Compare error:", err);
        result.innerHTML = '<div class="ed-no-data">Failed to load comparison</div>';
    }
}

// ══════════════════════════════════════════════════
//  MOMENTUM SCORE — with transparent formula
// ══════════════════════════════════════════════════
function buildMomentumScore(d) {
    const sec  = createSection("fas fa-bolt-lightning", "green", "Momentum Score");
    const body = sec.querySelector(".ed-section-body");

    const avg         = Number(d.avg_score_per_match ?? 0);
    const last3       = Number(d.avg_score_last_3    ?? 0);
    const last6       = Number(d.avg_score_last_6    ?? 0);
    const consistency = Number(d.consistency_score   ?? 0);
    const matchCount  = Number(d.matches_played      ?? 0);

    if (matchCount < 3 || !avg) {
        body.innerHTML = '<div class="ed-no-data">Play at least 3 matches to see your momentum score</div>';
        return sec;
    }

    let formScore = 20;
    if (last3 > 0 && last6 > 0) {
        const trendPct = ((last3 - last6) / last6) * 100;
        if      (trendPct >= 20)  formScore = 40;
        else if (trendPct >= 10)  formScore = 35;
        else if (trendPct >= 0)   formScore = 28;
        else if (trendPct >= -10) formScore = 15;
        else                      formScore = 5;
    }
    const consistencyScore = Math.round((consistency / 100) * 30);
    let recentScore = 15;
    if (last3 > 0 && avg > 0) {
        const pct = ((last3 - avg) / avg) * 100;
        if      (pct >= 20)  recentScore = 30;
        else if (pct >= 10)  recentScore = 25;
        else if (pct >= 0)   recentScore = 18;
        else if (pct >= -10) recentScore = 10;
        else                 recentScore = 3;
    }
    const total = Math.min(100, formScore + consistencyScore + recentScore);

    let grade, gradeColor, gradeDesc, gradeEmoji;
    if      (total >= 80) { grade = "A+"; gradeColor = "#9AE000"; gradeDesc = "Unstoppable right now";     gradeEmoji = "🚀"; }
    else if (total >= 65) { grade = "A";  gradeColor = "#9AE000"; gradeDesc = "Strong upward momentum";    gradeEmoji = "📈"; }
    else if (total >= 50) { grade = "B";  gradeColor = "#f59e0b"; gradeDesc = "Steady — holding your own"; gradeEmoji = "➡️"; }
    else if (total >= 35) { grade = "C";  gradeColor = "#fb923c"; gradeDesc = "Losing ground recently";    gradeEmoji = "📉"; }
    else                  { grade = "D";  gradeColor = "#ef4444"; gradeDesc = "Form has dropped sharply";  gradeEmoji = "🥶"; }

    const bar = (label, score, max, color, explain) => `
        <div class="ed-momentum-bar-row">
            <div class="ed-momentum-bar-label">${label}</div>
            <div class="ed-momentum-bar-track"><div class="ed-momentum-bar-fill" style="width:${Math.round((score/max)*100)}%;background:${color}"></div></div>
            <div class="ed-momentum-bar-val">${score}/${max}</div>
        </div>
        <div class="ed-momentum-bar-explain">${explain}</div>`;

    body.innerHTML = `
        <div class="ed-momentum-wrap">
            <div class="ed-momentum-circle" style="border-color:${gradeColor}">
                <div class="ed-momentum-grade" style="color:${gradeColor}">${grade}</div>
                <div class="ed-momentum-total" style="color:${gradeColor}">${total}/100</div>
            </div>
            <div class="ed-momentum-info">
                <div class="ed-momentum-emoji">${gradeEmoji}</div>
                <div class="ed-momentum-desc" style="color:${gradeColor}">${gradeDesc}</div>
                <div class="ed-momentum-sub">Formula: Form Trend (40) + Consistency (30) + Recent vs Avg (30)</div>
            </div>
        </div>
        <div class="ed-momentum-bars">
            ${bar("Form Trend",   formScore,        40, gradeColor, `Last 3 avg vs last 6 avg — are you trending up or down?`)}
            ${bar("Consistency",  consistencyScore, 30, gradeColor, `Your consistency score ${consistency}/100 converted to 30-pt scale`)}
            ${bar("Recent Form",  recentScore,      30, gradeColor, `Last 3 avg (${last3}) vs season avg (${avg})`)}
        </div>`;
    return sec;
}

// ══════════════════════════════════════════════════
//  STRONG & WEAK ZONES
// ══════════════════════════════════════════════════
function buildStrengthZone(d, players) {
    const sec  = createSection("fas fa-shield-halved", "green", "Strong & Weak Zones");
    const body = sec.querySelector(".ed-section-body");

    const strengths = [], weaknesses = [];
    const avg         = Number(d.avg_score_per_match  ?? 0);
    const last3       = Number(d.avg_score_last_3     ?? 0);
    const capRate     = Number(d.captain_success_rate ?? 0);
    const consistency = Number(d.consistency_score    ?? 0);
    const bestStreak  = Number(d.best_streak          ?? 0);
    const worstStreak = Number(d.worst_streak         ?? 0);
    const worstMatch  = Number(d.worst_match_score    ?? 0);
    const boostersRem = Number(d.boosters_remaining   ?? 7);
    const matchCount  = Number(d.matches_played       ?? 0);
    const boosterHistory = d.booster_history || [];
    const bestBoosterPts = boosterHistory.length ? Math.max(...boosterHistory.map(b => b.points || 0)) : 0;
    const breakdown   = players?.category_breakdown || [];
    const totalCatPts = breakdown.reduce((a, b) => a + (b.total_points || 0), 0);
    const indianPct   = totalCatPts > 0 ? (breakdown.find(c => c.category === "indian")?.total_points || 0) / totalCatPts * 100 : 0;
    const overseasPct = totalCatPts > 0 ? (breakdown.find(c => c.category === "overseas")?.total_points || 0) / totalCatPts * 100 : 0;

    if (capRate >= 70)                         strengths.push({ icon:"👑", title:"Elite Captaincy",       desc:`Your captain beat the avg in ${capRate}% of matches.` });
    if (consistency >= 70)                     strengths.push({ icon:"🎯", title:"Rock Solid",             desc:`Consistency ${consistency}/100 — you deliver every match.` });
    if (avg > 0 && last3 > avg)                strengths.push({ icon:"🔥", title:"Red Hot Form",           desc:`Last 3 avg (${last3}) is above season avg (${avg}).` });
    if (bestStreak >= 3)                        strengths.push({ icon:"💥", title:"Explosive Scorer",       desc:`${bestStreak} matches in a row scoring 250+ pts.` });
    if (indianPct > 55)                        strengths.push({ icon:"🇮🇳", title:"Strong Indian Core",    desc:`${indianPct.toFixed(0)}% of points from Indian players.` });
    if (worstMatch > 150 && matchCount >= 3)   strengths.push({ icon:"🛡️", title:"No Bad Days",           desc:`Worst match was still ${worstMatch} pts — high floor.` });
    if (bestBoosterPts > 0 && avg > 0 && bestBoosterPts > avg * 1.3) strengths.push({ icon:"🚀", title:"Booster Master", desc:`Best booster scored ${bestBoosterPts} pts — well above avg.` });

    if (capRate > 0 && capRate < 50)           weaknesses.push({ icon:"👎", title:"Poor Captain Picks",    desc:`Only ${capRate}% success rate. Your captain pick is costing you.` });
    if (consistency > 0 && consistency < 50)   weaknesses.push({ icon:"📉", title:"Very Inconsistent",     desc:`Score of ${consistency}/100 — big swings match to match.` });
    if (avg > 0 && last3 > 0 && last3 < avg * 0.8) weaknesses.push({ icon:"❄️", title:"Dropping Form",   desc:`Last 3 avg (${last3}) is well below season avg (${avg}).` });
    if (worstStreak >= 3)                       weaknesses.push({ icon:"🥶", title:"Cold Spells Problem",   desc:`${worstStreak} matches in a row scoring 150 or below.` });
    if (avg > 0 && worstMatch < avg * 0.4 && matchCount >= 3) weaknesses.push({ icon:"💣", title:"Crashes Hard", desc:`Worst match (${worstMatch}) is extremely low vs your avg.` });
    if (boostersRem > 4 && matchCount > 5)     weaknesses.push({ icon:"⚠️", title:"Underusing Boosters",   desc:`${boostersRem} boosters left after ${matchCount} matches.` });
    if (overseasPct > 55 && matchCount >= 3)   weaknesses.push({ icon:"✈️", title:"Overseas Dependent",    desc:`${overseasPct.toFixed(0)}% from overseas — risky dependency.` });

    const topS = strengths.slice(0, 3), topW = weaknesses.slice(0, 3);
    if (!topS.length && !topW.length) { body.innerHTML = '<div class="ed-no-data">Not enough data yet to analyse zones</div>'; return sec; }

    const buildItems = list => list.map(i => `<div class="ed-zone-item"><span class="ed-zone-icon">${i.icon}</span><div class="ed-zone-info"><div class="ed-zone-title">${i.title}</div><div class="ed-zone-desc">${i.desc}</div></div></div>`).join("");

    body.innerHTML = `
        ${topS.length ? `<div class="ed-zone-block strong"><div class="ed-zone-header"><i class="fas fa-circle-check"></i> Strong Zone</div>${buildItems(topS)}</div>` : ""}
        ${topW.length ? `<div class="ed-zone-block weak" style="${topS.length?"margin-top:10px":""}"><div class="ed-zone-header"><i class="fas fa-circle-exclamation"></i> Weak Zone</div>${buildItems(topW)}</div>` : ""}`;
    return sec;
}

// ══════════════════════════════════════════════════
//  SHARE CARD
// ══════════════════════════════════════════════════
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
    if (navigator.share) { try { await navigator.share({ title: "My Cricket Experts Stats", text }); } catch (_) {} }
    else { await navigator.clipboard.writeText(text); showToast("Stats copied to clipboard!", "success"); }
};

// ══════════════════════════════════════════════════
//  AD
// ══════════════════════════════════════════════════
function buildMonetagAd() {
    const wrap = document.createElement("div");
    wrap.className = "ed-section";
    wrap.style.cssText = "margin: 12px 0; padding: 0;";
    const body = document.createElement("div");
    body.className = "ed-section-body";
    body.style.cssText = "display:flex; justify-content:center; align-items:center; padding: 10px 0; min-height: 60px;";
    const holder = document.createElement("div");
    holder.style.cssText = "width:100%; text-align:center;";
    if (!document.querySelector('script[data-zone="225656"]')) {
        const s = document.createElement("script");
        s.src = "https://quge5.com/88/tag.min.js"; s.async = true;
        s.setAttribute("data-zone", "225656"); s.setAttribute("data-cfasync", "false");
        holder.appendChild(s);
    }
    body.appendChild(holder); wrap.appendChild(body); return wrap;
}

// ══════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════
function buildPlayerCard(p, rank) {
    const card = document.createElement("div");
    card.className = "ed-player-card";
    const rankEl = document.createElement("div");
    rankEl.className = `ed-player-rank r${rank}`;
    rankEl.textContent = rank;
    const info = document.createElement("div");
    info.className = "ed-player-info";
    info.innerHTML = `<span class="ed-player-name">${p.name || "Unknown"}</span><span class="ed-player-meta">${p.role || ""} · played ${p.matches_played || p.matches_in_team || 0} matches</span>`;
    const right = document.createElement("div");
    right.style.textAlign = "right";
    right.innerHTML = `<span class="ed-player-pts">${p.total_points_earned || 0}</span><span class="ed-player-pts-lbl">pts earned</span>`;
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

function setupInfoPanel() {
    const btn = document.getElementById("infoBtn"), overlay = document.getElementById("infoOverlay"), close = document.getElementById("infoClose");
    btn?.addEventListener("click", () => overlay?.classList.remove("hidden"));
    close?.addEventListener("click", () => overlay?.classList.add("hidden"));
    overlay?.addEventListener("click", e => { if (e.target === overlay) overlay.classList.add("hidden"); });
}