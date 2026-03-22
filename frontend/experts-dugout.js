import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentUserId      = null;
let activeTournamentId = null;
let currentMode        = "overall"; // "overall" | "league"
let currentLeagueId    = null;
let allTeams           = [];
let selectedUserId     = null;
let chartInstance      = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function boot() {
    try {
        const user = await authReady;
        currentUserId = user.id;
        await init();
    } catch (err) {
        console.warn("Auth failed:", err.message);
    }
}

boot();

async function init() {
    document.body.classList.add("loading-state");

    try {
        const { data: activeT } = await supabase
            .from("active_tournament").select("*").maybeSingle();
        if (!activeT) { revealApp(); return; }
        activeTournamentId = activeT.id;

        // Get user's league if any
        const { data: member } = await supabase
            .from("league_members")
            .select("league_id")
            .eq("user_id", currentUserId)
            .maybeSingle();
        currentLeagueId = member?.league_id || null;

        // If no league, disable league toggle
        if (!currentLeagueId) {
            const leagueBtn = document.getElementById("toggleLeague");
            if (leagueBtn) {
                leagueBtn.disabled = true;
                leagueBtn.style.opacity = "0.4";
                leagueBtn.title = "You are not in a private league";
            }
        }

        setupListeners();
        await loadTeamList();

        // Auto-select own team
        const sel = document.getElementById("teamSelector");
        if (sel && currentUserId) {
            sel.value = currentUserId;
            if (sel.value === currentUserId) {
                await loadDugout(currentUserId);
            }
        }

    } catch (err) {
        console.error("Dugout init error:", err);
    } finally {
        revealApp();
    }
}

function revealApp() {
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
}

// ─── LISTENERS ────────────────────────────────────────────────────────────────
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
        if (!uid) {
            showEmptyState();
            return;
        }
        selectedUserId = uid;
        await loadDugout(uid);
    });
}

// ─── LOAD TEAM LIST ───────────────────────────────────────────────────────────
async function loadTeamList() {
    const sel = document.getElementById("teamSelector");
    if (!sel) return;

    sel.innerHTML = '<option value="">Select a team...</option>';

    try {
        let data = [];

        if (currentMode === "overall") {
            const { data: lb } = await supabase
                .from("leaderboard_view")
                .select("user_id, team_name, total_points, rank")
                .eq("tournament_id", activeTournamentId)
                .order("total_points", { ascending: false });
            data = lb || [];
        } else {
            const { data: lb } = await supabase
                .from("private_league_leaderboard")
                .select("user_id, team_name, total_points, rank_in_league")
                .eq("league_id", currentLeagueId)
                .order("total_points", { ascending: false });
            data = lb || [];
        }

        allTeams = data;

        data.forEach(row => {
            const opt = document.createElement("option");
            opt.value = row.user_id;
            const pts = row.total_points > 0 ? ` · ${row.total_points} pts` : "";
            opt.textContent = `${row.team_name || "Anonymous"}${pts}`;
            if (row.user_id === currentUserId) {
                opt.textContent = "★ " + opt.textContent + " (You)";
            }
            sel.appendChild(opt);
        });

        // Re-select if previously selected
        if (selectedUserId) {
            sel.value = selectedUserId;
            if (!sel.value) selectedUserId = null;
        }

    } catch (err) {
        console.error("Team list error:", err);
    }
}

// ─── LOAD DUGOUT ──────────────────────────────────────────────────────────────
async function loadDugout(userId) {
    const content = document.getElementById("dugoutContent");
    if (!content) return;

    // Show skeleton
    content.innerHTML = buildSkeleton();

    try {
        // Parallel fetch — view data + RPC player data + match history
        const [viewRes, playerRes, historyRes] = await Promise.all([
            supabase
                .from("team_lab_view")
                .select("*")
                .eq("user_id", userId)
                .eq("tournament_id", activeTournamentId)
                .maybeSingle(),
            supabase.rpc("get_team_lab_players", {
                p_user_id:       userId,
                p_tournament_id: activeTournamentId,
            }),
            supabase
                .from("user_match_points")
                .select("match_id, total_points, created_at")
                .eq("user_id", userId)
                .eq("tournament_id", activeTournamentId)
                .order("created_at", { ascending: true }),
        ]);

        const d       = viewRes.data;
        const players = playerRes.data;
        const history = historyRes.data || [];

        if (!d) {
            content.innerHTML = `<div class="ed-empty-state">
                <div class="ed-empty-icon"><i class="fas fa-info-circle"></i></div>
                <p class="ed-empty-title">No data yet</p>
                <p class="ed-empty-sub">This team hasn't played any matches yet</p>
            </div>`;
            return;
        }

        // Get team info for hero
        const teamRow = allTeams.find(t => t.user_id === userId);
        const avatarUrl = d.team_photo_url
            ? supabase.storage.from("team-avatars").getPublicUrl(d.team_photo_url).data.publicUrl
            : null;

        content.innerHTML = "";

        // Build all sections
        content.appendChild(buildHero(d, teamRow, avatarUrl));
        content.appendChild(buildOverview(d));
        content.appendChild(buildScoreTrends(d, history));
        content.appendChild(buildSubsTrends(d));
        content.appendChild(buildBestWorst(d));

        if (players) {
            content.appendChild(buildTopScorers(players));
            content.appendChild(buildMostPicked(players));
            content.appendChild(buildByRole(players));
        }

    } catch (err) {
        console.error("Dugout load error:", err);
        content.innerHTML = `<div class="ed-empty-state">
            <div class="ed-empty-icon"><i class="fas fa-exclamation-triangle"></i></div>
            <p class="ed-empty-title">Failed to load</p>
            <p class="ed-empty-sub">Check your connection and try again</p>
        </div>`;
    }
}

// ─── BUILDERS ─────────────────────────────────────────────────────────────────

function buildHero(d, teamRow, avatarUrl) {
    const wrap = document.createElement("div");
    wrap.className = "ed-team-hero";

    const avatar = document.createElement("div");
    avatar.className = "ed-team-avatar";
    if (avatarUrl) avatar.style.backgroundImage = `url('${avatarUrl}')`;

    const info = document.createElement("div");
    info.className = "ed-team-info";

    const rank = teamRow
        ? (teamRow.rank || teamRow.rank_in_league || "--")
        : "--";

    info.innerHTML = `
        <div class="ed-team-name">${d.team_name || "Anonymous"}</div>
        <div class="ed-team-rank">Rank #${rank}</div>`;

    const right = document.createElement("div");
    right.innerHTML = `
        <div class="ed-team-pts">${d.total_points || 0}</div>
        <div class="ed-team-pts-label">Total pts</div>`;

    wrap.append(avatar, info, right);
    return wrap;
}

function buildOverview(d) {
    const sec = createSection("fas fa-chart-bar", "green", "Season Overview");
    const body = sec.querySelector(".ed-section-body");

    body.innerHTML = `
        <div class="ed-stat-grid">
            <div class="ed-stat-cell">
                <span class="ed-stat-val">${d.matches_played || 0}</span>
                <span class="ed-stat-lbl">Matches Played</span>
            </div>
            <div class="ed-stat-cell">
                <span class="ed-stat-val gold">${d.boosters_remaining ?? 7}</span>
                <span class="ed-stat-lbl">Boosters Left</span>
            </div>
            <div class="ed-stat-cell">
                <span class="ed-stat-val blue">${d.subs_remaining === 999 ? "∞" : (d.subs_remaining ?? "--")}</span>
                <span class="ed-stat-lbl">Subs Left</span>
            </div>
        </div>`;
    return sec;
}

function buildScoreTrends(d, history) {
    const sec = createSection("fas fa-chart-line", "green", "Score Trends");
    const body = sec.querySelector(".ed-section-body");

    const avg = d.avg_score_per_match ?? 0;
    const l3  = d.avg_score_last_3 ?? "--";
    const l6  = d.avg_score_last_6 ?? "--";
    const l10 = d.avg_score_last_10 ?? "--";

    body.innerHTML = `
        <div class="ed-stat-grid two-col" style="margin-bottom:12px">
            <div class="ed-stat-cell">
                <span class="ed-stat-val">${avg}</span>
                <span class="ed-stat-lbl">Avg per Match</span>
            </div>
            <div class="ed-stat-cell">
                <span class="ed-stat-val white">${d.total_points || 0}</span>
                <span class="ed-stat-lbl">Total Points</span>
            </div>
        </div>
        <div class="ed-trend-row">
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 3</span>
                <span class="ed-trend-val">${l3}</span>
                <span class="ed-trend-sub">avg pts</span>
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 6</span>
                <span class="ed-trend-val">${l6}</span>
                <span class="ed-trend-sub">avg pts</span>
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 10</span>
                <span class="ed-trend-val">${l10}</span>
                <span class="ed-trend-sub">avg pts</span>
            </div>
        </div>
        <div style="margin-top:14px">
            <div style="font-family:var(--font-display);font-size:9px;font-weight:900;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Match by Match Score</div>
            <div class="ed-chart-wrap">
                <canvas id="scoreChart"></canvas>
            </div>
        </div>`;

    // Draw chart after DOM insertion using setTimeout
    setTimeout(() => drawChart(history), 50);

    return sec;
}

function drawChart(history) {
    const canvas = document.getElementById("scoreChart");
    if (!canvas) return;

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    if (!history.length) {
        const wrap = canvas.parentElement;
        wrap.innerHTML = '<div class="ed-chart-empty">No match data yet</div>';
        return;
    }

    const labels = history.map((_, i) => `M${i + 1}`);
    const data   = history.map(h => h.total_points || 0);
    const max    = Math.max(...data);

    const ctx = canvas.getContext("2d");

    // Manual bar chart — no library needed
    const dpr  = window.devicePixelRatio || 1;
    const W    = canvas.offsetWidth  || 300;
    const H    = canvas.offsetHeight || 120;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const padL = 4, padR = 4, padT = 10, padB = 20;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const barCount = data.length;
    const barW = Math.max(4, Math.floor(chartW / barCount) - 2);
    const gap  = Math.floor((chartW - barW * barCount) / Math.max(barCount - 1, 1));

    ctx.clearRect(0, 0, W, H);

    data.forEach((val, i) => {
        const barH = max > 0 ? Math.round((val / max) * chartH) : 2;
        const x = padL + i * (barW + gap);
        const y = padT + chartH - barH;

        // Bar
        const isHigh = val === max;
        ctx.fillStyle = isHigh ? "#9AE000" : "rgba(154,224,0,0.35)";
        ctx.beginPath();
        ctx.roundRect?.(x, y, barW, barH, 2) || ctx.rect(x, y, barW, barH);
        ctx.fill();

        // Label
        if (barCount <= 20) {
            ctx.fillStyle = "rgba(100,116,139,0.8)";
            ctx.font = `700 8px sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(labels[i], x + barW / 2, H - 4);
        }
    });
}

function buildSubsTrends(d) {
    const sec = createSection("fas fa-exchange-alt", "blue", "Subs Analysis");
    const body = sec.querySelector(".ed-section-body");

    const total = d.total_subs_used ?? 0;
    const l3    = d.avg_subs_last_3 ?? "--";
    const l6    = d.avg_subs_last_6 ?? "--";
    const l10   = d.avg_subs_last_10 ?? "--";

    body.innerHTML = `
        <div class="ed-stat-cell" style="margin-bottom:10px;background:var(--bg-card-alt);border:1px solid var(--border-subtle);border-radius:var(--card-radius-sm);padding:12px;text-align:center">
            <span class="ed-stat-val blue">${total}</span>
            <span class="ed-stat-lbl">Total Subs Used</span>
        </div>
        <div class="ed-trend-row">
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 3</span>
                <span class="ed-trend-val">${l3}</span>
                <span class="ed-trend-sub">avg subs</span>
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 6</span>
                <span class="ed-trend-val">${l6}</span>
                <span class="ed-trend-sub">avg subs</span>
            </div>
            <div class="ed-trend-cell">
                <span class="ed-trend-label">Last 10</span>
                <span class="ed-trend-val">${l10}</span>
                <span class="ed-trend-sub">avg subs</span>
            </div>
        </div>`;
    return sec;
}

function buildBestWorst(d) {
    const sec = createSection("fas fa-trophy", "gold", "Best & Worst Match");
    const body = sec.querySelector(".ed-section-body");

    body.innerHTML = `
        <div class="ed-best-worst">
            <div class="ed-bw-cell best">
                <span class="ed-bw-icon">🏆</span>
                <span class="ed-bw-val">${d.best_match_score ?? 0}</span>
                <span class="ed-bw-lbl">Best Match</span>
            </div>
            <div class="ed-bw-cell worst">
                <span class="ed-bw-icon">📉</span>
                <span class="ed-bw-val">${d.worst_match_score ?? 0}</span>
                <span class="ed-bw-lbl">Worst Match</span>
            </div>
        </div>`;
    return sec;
}

function buildTopScorers(players) {
    const sec = createSection("fas fa-star", "gold", "Top Point Earners");
    const body = sec.querySelector(".ed-section-body");

    const list = players.top_scorers || [];
    if (!list.length) {
        body.innerHTML = '<div class="ed-no-data">No match data yet</div>';
        return sec;
    }

    const container = document.createElement("div");
    container.className = "ed-player-list";

    list.forEach((p, i) => {
        container.appendChild(buildPlayerCard(p, i + 1));
    });

    body.appendChild(container);
    return sec;
}

function buildMostPicked(players) {
    const sec = createSection("fas fa-heart", "purple", "Most Loyal Players");
    const body = sec.querySelector(".ed-section-body");

    const list = players.most_picked || [];
    if (!list.length) {
        body.innerHTML = '<div class="ed-no-data">No match data yet</div>';
        return sec;
    }

    const container = document.createElement("div");
    container.className = "ed-player-list";

    list.forEach((p, i) => {
        container.appendChild(buildPlayerCard(p, i + 1, true));
    });

    body.appendChild(container);
    return sec;
}

function buildByRole(players) {
    const sec = createSection("fas fa-users", "blue", "Top by Role");
    const body = sec.querySelector(".ed-section-body");

    const roles = [
        { key: "top_wk",   label: "WK",   icon: "🧤" },
        { key: "top_bat",  label: "BAT",  icon: "🏏" },
        { key: "top_ar",   label: "AR",   icon: "⚡" },
        { key: "top_bowl", label: "BOWL", icon: "🎳" },
    ];

    // Role tabs
    const tabs = document.createElement("div");
    tabs.className = "ed-role-tabs";

    const listWrap = document.createElement("div");
    listWrap.className = "ed-player-list";

    let activeRole = "top_wk";

    function renderRole(key) {
        listWrap.innerHTML = "";
        const list = players[key] || [];
        if (!list.length) {
            listWrap.innerHTML = '<div class="ed-no-data">No data for this role yet</div>';
            return;
        }
        list.forEach((p, i) => {
            listWrap.appendChild(buildPlayerCard(p, i + 1));
        });
    }

    roles.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "ed-role-tab" + (r.key === activeRole ? " active" : "");
        btn.textContent = `${r.icon} ${r.label}`;
        btn.onclick = () => {
            tabs.querySelectorAll(".ed-role-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeRole = r.key;
            renderRole(r.key);
        };
        tabs.appendChild(btn);
    });

    renderRole(activeRole);

    body.appendChild(tabs);
    body.appendChild(listWrap);
    return sec;
}

function buildPlayerCard(p, rank, showMatches = false) {
    const card = document.createElement("div");
    card.className = "ed-player-card";

    const rankEl = document.createElement("div");
    rankEl.className = `ed-player-rank r${rank}`;
    rankEl.textContent = rank;

    const info = document.createElement("div");
    info.className = "ed-player-info";

    const name = document.createElement("span");
    name.className = "ed-player-name";
    name.textContent = p.name || "Unknown";

    const meta = document.createElement("span");
    meta.className = "ed-player-meta";

    if (showMatches) {
        meta.textContent = `${p.matches_in_team || 0} matches in team`;
    } else {
        meta.textContent = `${p.role || ""} · ${p.matches_in_team || 0} matches`;
    }

    info.append(name, meta);

    const right = document.createElement("div");
    right.style.textAlign = "right";
    right.innerHTML = `
        <span class="ed-player-pts">${p.total_points_earned || 0}</span>
        <span class="ed-player-pts-lbl">pts earned</span>`;

    card.append(rankEl, info, right);
    return card;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function createSection(iconClass, iconColor, title) {
    const sec = document.createElement("div");
    sec.className = "ed-section";

    sec.innerHTML = `
        <div class="ed-section-header">
            <div class="ed-section-icon ${iconColor}">
                <i class="${iconClass}"></i>
            </div>
            <h3 class="ed-section-title">${title}</h3>
        </div>
        <div class="ed-section-body"></div>`;

    return sec;
}

function showEmptyState() {
    const content = document.getElementById("dugoutContent");
    if (!content) return;
    content.innerHTML = `
        <div class="ed-empty-state" id="emptyState">
            <div class="ed-empty-icon"><i class="fas fa-flask"></i></div>
            <p class="ed-empty-title">Pick a team to analyse</p>
            <p class="ed-empty-sub">Select from the dropdown above to see full team intelligence</p>
        </div>`;
}

function buildSkeleton() {
    return `
        <div class="ed-skeleton" style="height:90px;margin-bottom:14px"></div>
        <div class="ed-skeleton" style="height:120px;margin-bottom:14px"></div>
        <div class="ed-skeleton" style="height:200px;margin-bottom:14px"></div>
        <div class="ed-skeleton" style="height:140px;margin-bottom:14px"></div>
        <div class="ed-skeleton" style="height:160px"></div>`;
}