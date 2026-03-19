import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

/* ─── CONSTANTS ──────────────────────────────────────────────────────────── */
const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };

/* ─── MODULE STATE ───────────────────────────────────────────────────────── */
let currentUserId       = null;
let currentTournamentId = null;
let currentMatchId      = null;

/* ─── INIT ───────────────────────────────────────────────────────────────── */
async function init() {
    try {
        const user = await authReady;
        currentUserId = user.id;
    } catch (_) { return; }

    const { data: activeTourney } = await supabase
        .from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    const hash = location.hash || "#predict";
    switchTab(hash.slice(1));

    await Promise.allSettled([
        loadPredictionCard(),
        loadPostMatchSummary(),
        loadPodiums(),
    ]);
}

init();

/* ─── TAB SYSTEM ─────────────────────────────────────────────────────────── */
window.switchTab = function(tab) {
    document.querySelectorAll(".fun-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.toggle("hidden", panel.id !== `panel-${tab}`);
    });
    location.hash = tab;
    if (tab === "allstars") loadAllStarsPanel();
    if (tab === "daily")    loadDailyPanel();
};

/* ─── TOAST ──────────────────────────────────────────────────────────────── */
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast       = document.createElement("div");
    toast.className   = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity   = "0";
        toast.style.transform = "translateX(120%)";
        toast.style.transition = "all 0.4s ease";
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

/* ─── CUSTOM CONFIRM ─────────────────────────────────────────────────────── */
function showConfirm(title, message) {
    return new Promise(resolve => {
        const overlay   = document.getElementById("funConfirmOverlay");
        const titleEl   = document.getElementById("funConfirmTitle");
        const textEl    = document.getElementById("funConfirmText");
        const btnOk     = document.getElementById("funConfirmOk");
        const btnCancel = document.getElementById("funConfirmCancel");
        if (!overlay) return resolve(false);
        titleEl.textContent = title;
        textEl.textContent  = message;
        overlay.classList.remove("hidden");
        const cleanup = () => overlay.classList.add("hidden");
        btnOk.onclick     = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
}

/* ─── PANEL SPINNER ──────────────────────────────────────────────────────── */
function showPanelSpinner(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.innerHTML = `<div class="panel-spinner"></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOTTOM SHEET — shared scout/detail view
═══════════════════════════════════════════════════════════════════════════ */

function openBottomSheet(contentFn) {
    // Remove any existing sheet
    document.getElementById("funBottomSheet")?.remove();

    const overlay       = document.createElement("div");
    overlay.id          = "funBottomSheet";
    overlay.className   = "fun-sheet-overlay";
    overlay.onclick     = (e) => { if (e.target === overlay) closeBottomSheet(); };

    const sheet         = document.createElement("div");
    sheet.className     = "fun-sheet";

    const handle        = document.createElement("div");
    handle.className    = "fun-sheet-handle";

    const closeBtn      = document.createElement("button");
    closeBtn.className  = "fun-sheet-close";
    closeBtn.textContent = "✕";
    closeBtn.onclick    = closeBottomSheet;

    const body          = document.createElement("div");
    body.className      = "fun-sheet-body";
    body.innerHTML      = `<div class="sheet-spinner"></div>`;

    sheet.append(handle, closeBtn, body);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add("open"));

    // Populate content async
    contentFn(body);
}

function closeBottomSheet() {
    const overlay = document.getElementById("funBottomSheet");
    if (!overlay) return;
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 320);
}

/* ─── Player detail sheet ─────────────────────────────────────────────── */
async function openPlayerDetail(playerId, matchId) {
    openBottomSheet(async (body) => {
        const { data: stats } = await supabase
            .from("player_match_stats")
            .select(`
                *,
                player:players!inner(name, role, photo_url, team:real_teams!inner(short_code))
            `)
            .eq("player_id", playerId)
            .eq("match_id", matchId)
            .maybeSingle();

        body.innerHTML = "";

        if (!stats) {
            const p = document.createElement("p");
            p.className   = "sheet-empty";
            p.textContent = "No stats found for this player.";
            body.appendChild(p);
            return;
        }

        const p = stats.player;
        const photo = p?.photo_url
            ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl
            : "images/default-avatar.png";

        // Header
        const hdr       = document.createElement("div");
        hdr.className   = "sheet-player-hdr";

        const av        = document.createElement("div");
        av.className    = "sheet-avatar";
        av.style.backgroundImage = `url('${photo}')`;

        const info      = document.createElement("div");
        const nameEl    = document.createElement("div");
        nameEl.className   = "sheet-player-name";
        nameEl.textContent = p?.name || "Unknown";

        const metaEl    = document.createElement("div");
        metaEl.className   = "sheet-player-meta";
        metaEl.textContent = `${p?.role || "—"} · ${p?.team?.short_code || "TBA"}`;

        const ptsEl     = document.createElement("div");
        ptsEl.className   = "sheet-player-pts";
        ptsEl.textContent = `${stats.fantasy_points} pts this match`;

        info.append(nameEl, metaEl, ptsEl);
        hdr.append(av, info);
        body.appendChild(hdr);

        // Stat chips
        const chipsWrap     = document.createElement("div");
        chipsWrap.className = "sheet-chips-wrap";

        const chipsLabel       = document.createElement("p");
        chipsLabel.className   = "sheet-section-label";
        chipsLabel.textContent = "Points Breakdown";
        chipsWrap.appendChild(chipsLabel);

        const grid       = document.createElement("div");
        grid.className   = "sheet-chips-grid";

        const chips = buildStatChips(stats);
        if (chips.length) {
            chips.forEach(c => grid.appendChild(c));
        } else {
            const c       = document.createElement("span");
            c.className   = "stat-tag empty";
            c.textContent = "Played — no scorable actions";
            grid.appendChild(c);
        }

        chipsWrap.appendChild(grid);
        body.appendChild(chipsWrap);
    });
}

/* ─── Team scout sheet ────────────────────────────────────────────────── */
async function openTeamScout(userId, matchId) {
    openBottomSheet(async (body) => {
        // FIX: Split into three separate queries.
        // The original single nested query failed because:
        // 1. total_points lives in user_match_points, not user_match_teams
        // 2. player_match_stats has no FK to user_match_team_players —
        //    Supabase cannot join them and silently returns null for every player
        const [teamRes, ptsRes, statsRes] = await Promise.all([
            // Query 1: team header + player IDs + player details
            supabase
                .from("user_match_teams")
                .select(`
                    id,
                    captain_id,
                    vice_captain_id,
                    user_profiles(team_name, team_photo_url),
                    user_match_team_players(
                        player_id,
                        players(id, name, role, photo_url, team:real_teams!inner(short_code))
                    )
                `)
                .eq("user_id", userId)
                .eq("match_id", matchId)
                .maybeSingle(),

            // Query 2: match points for this user (separate table)
            supabase
                .from("user_match_points")
                .select("total_points")
                .eq("user_id", userId)
                .eq("match_id", matchId)
                .maybeSingle(),

            // Query 3: all player stats for this match — we index by player_id
            supabase
                .from("player_match_stats")
                .select("player_id, fantasy_points, is_player_of_match")
                .eq("match_id", matchId),
        ]);

        body.innerHTML = "";

        const team = teamRes.data;
        if (!team) {
            const p       = document.createElement("p");
            p.className   = "sheet-empty";
            p.textContent = "This user didn't have a team for this match.";
            body.appendChild(p);
            return;
        }

        // Build a lookup map: player_id → stats
        const statsMap = {};
        (statsRes.data || []).forEach(s => { statsMap[s.player_id] = s; });

        const totalPoints = ptsRes.data?.total_points || 0;
        const profile     = team.user_profiles;
        const photo       = profile?.team_photo_url
            ? supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url).data.publicUrl
            : "images/default-avatar.png";

        // Team header
        const hdr       = document.createElement("div");
        hdr.className   = "sheet-team-hdr";

        const av        = document.createElement("div");
        av.className    = "sheet-team-avatar";
        av.style.backgroundImage = `url('${photo}')`;

        const info      = document.createElement("div");
        const nameEl    = document.createElement("div");
        nameEl.className   = "sheet-player-name";
        nameEl.textContent = profile?.team_name || "Expert";

        const ptsEl     = document.createElement("div");
        ptsEl.className   = "sheet-player-pts";
        ptsEl.textContent = `${totalPoints} pts this match`;

        info.append(nameEl, ptsEl);
        hdr.append(av, info);
        body.appendChild(hdr);

        // Build player list — merge team players with stats map
        const players = (team.user_match_team_players || [])
            .map(r => {
                const s = statsMap[r.player_id] || {};
                return {
                    ...r.players,
                    pts:   s.fantasy_points || 0,
                    isC:   r.player_id === team.captain_id,
                    isVC:  r.player_id === team.vice_captain_id,
                    isPOM: s.is_player_of_match || false,
                };
            })
            .sort((a, b) => (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) || (b.pts - a.pts));

        const label       = document.createElement("p");
        label.className   = "sheet-section-label";
        label.textContent = "Locked Team";
        body.appendChild(label);

        players.forEach(p => {
            const row       = document.createElement("div");
            row.className   = "sheet-player-row";

            const av2 = document.createElement("div");
            av2.className = "sheet-row-avatar";
            if (p.photo_url) {
                const photoUrl = supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl;
                av2.style.backgroundImage = `url('${photoUrl}')`;
            }

            const info2     = document.createElement("div");
            info2.className = "sheet-row-info";

            const nameRow   = document.createElement("div");
            nameRow.className = "sheet-row-name-row";

            const nm        = document.createElement("span");
            nm.className    = "sheet-row-name";
            nm.textContent  = p.name || "Unknown";

            if (p.isC || p.isVC) {
                const badge       = document.createElement("span");
                badge.className   = `sheet-role-badge ${p.isC ? "c" : "vc"}`;
                badge.textContent = p.isC ? "C" : "VC";
                nameRow.append(nm, badge);
            } else {
                nameRow.appendChild(nm);
            }

            const meta      = document.createElement("span");
            meta.className  = "sheet-row-meta";
            meta.textContent = `${p.role} · ${p.team?.short_code || "TBA"}`;

            info2.append(nameRow, meta);

            const pts2      = document.createElement("div");
            pts2.className  = "sheet-row-pts";
            pts2.textContent = `${p.isPOM ? "🌟 " : ""}${p.pts} pts`;
            if (p.isPOM) pts2.style.color = "var(--fun-cyan)";

            row.append(av2, info2, pts2);
            body.appendChild(row);
        });
    });
}

/* ─── Stat chips (shared with stats page pattern) ─────────────────────── */
function buildStatChips(m) {
    const chips = [];
    const chip  = (txt, cls) => {
        const el       = document.createElement("span");
        el.className   = `stat-tag ${cls}`;
        el.textContent = txt;
        return el;
    };

    if (m.runs > 0)         chips.push(chip(`🏏 ${m.runs}${m.balls ? ` (${m.balls}b)` : ""}`, "bat"));
    if (m.fours > 0 || m.sixes > 0) chips.push(chip(`🎯 ${m.fours||0}×4 ${m.sixes||0}×6`, "boundary"));
    if (m.sr_points)        chips.push(chip(`⚡ SR ${m.sr_points > 0 ? "+" : ""}${m.sr_points}`, "bonus"));
    if (m.milestone_points > 0) chips.push(chip(`🏆 +${m.milestone_points}`, "bonus"));
    if (m.duck_penalty < 0) chips.push(chip(`🦆 Duck ${m.duck_penalty}`, "penalty"));
    if (m.wickets > 0)      chips.push(chip(`🎳 ${m.wickets}W`, "bowl"));
    if (m.maidens > 0)      chips.push(chip(`🧱 ${m.maidens} Maiden${m.maidens > 1 ? "s" : ""}`, "bowl"));
    if (m.er_points)        chips.push(chip(`📉 Econ ${m.er_points > 0 ? "+" : ""}${m.er_points}`, "bonus"));
    if (m.catches > 0)      chips.push(chip(`🧤 ${m.catches}C`, "field"));
    if (m.stumpings > 0)    chips.push(chip(`🏃 ${m.stumpings}St`, "field"));
    const ro = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (ro > 0)             chips.push(chip(`🎯 ${ro}RO`, "field"));
    if (m.is_player_of_match) chips.push(chip("🏆 POM +20", "gold"));

    return chips;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PREDICT PANEL
═══════════════════════════════════════════════════════════════════════════ */

async function loadPredictionCard() {
    // Fetch user's star count + streak + recent winners in parallel
const [pointsRes, streakRes, winnersRes] = await Promise.allSettled([        supabase.from("user_tournament_points")
            .select("prediction_stars")
            .eq("user_id", currentUserId)
            .eq("tournament_id", currentTournamentId)
            .maybeSingle(),
        supabase.from("user_predictions")
            .select("is_correct")
            .eq("user_id", currentUserId)
            .order("created_at", { ascending: false })
            .limit(20),
        supabase.from("user_tournament_points")
            .select("prediction_stars, user_profiles(team_name)")
            .eq("tournament_id", currentTournamentId)
            .gte("prediction_stars", 10)
            .order("prediction_stars", { ascending: false })
            .limit(5)
    ]);

    const stars    = pointsRes.value?.data?.prediction_stars || 0;
    const starEl   = document.getElementById("userStarCount");
    if (starEl) starEl.textContent = `${stars} ⭐`;

    // Calculate streak from recent predictions
    let streak = 0;
    if (streakRes.value?.data) {
        for (const p of streakRes.value.data) {
            if (p.is_correct) streak++;
            else break;
        }
    }

    // Recent sub winners (prediction_stars >= 10 multiples)
    const recentWinners = winnersRes.value?.data || [];

    // Fetch upcoming match
    const { data: match } = await supabase
        .from("matches")
        .select("id, team_a:real_teams!team_a_id(id, short_code, photo_name), team_b:real_teams!team_b_id(id, short_code, photo_name)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .maybeSingle();

    const area = document.getElementById("predictionArea");
    if (!match) {
        if (area) area.innerHTML = `<p class="empty-msg">No upcoming matches to predict.</p>`;
        return;
    }

    currentMatchId = match.id;

    // Fetch user's prediction + community split for this match
    const [existingRes, totalRes, teamARes, teamBRes] = await Promise.all([
        supabase.from("user_predictions")
            .select("predicted_winner_id")
            .eq("user_id", currentUserId)
            .eq("match_id", currentMatchId)
            .maybeSingle(),
        supabase.from("user_predictions")
            .select("*", { count: "exact", head: true })
            .eq("match_id", currentMatchId),
        supabase.from("user_predictions")
            .select("*", { count: "exact", head: true })
            .eq("match_id", currentMatchId)
            .eq("predicted_winner_id", match.team_a.id),
        supabase.from("user_predictions")
            .select("*", { count: "exact", head: true })
            .eq("match_id", currentMatchId)
            .eq("predicted_winner_id", match.team_b.id),
    ]);

    const existing      = existingRes.data;
    const totalPreds    = totalRes.count || 0;
    const teamAPreds    = teamARes.count || 0;
    const teamBPreds    = teamBRes.count || 0;
    const isLocked      = !!existing?.predicted_winner_id;

    const pctA = totalPreds > 0 ? Math.round((teamAPreds / totalPreds) * 100) : null;
    const pctB = totalPreds > 0 ? Math.round((teamBPreds / totalPreds) * 100) : null;

    renderPredictionUI(match, existing?.predicted_winner_id, {
        stars, streak, recentWinners,
        isLocked, totalPreds,
        split: pctA !== null ? { a: pctA, b: pctB, aName: match.team_a.short_code, bName: match.team_b.short_code } : null,
    });
}

function renderPredictionUI(match, predictedWinnerId, meta) {
    const container = document.getElementById("predictionArea");
    if (!container) return;

    const bucket = supabase.storage.from("team-logos");
    const logoA  = match.team_a.photo_name
        ? bucket.getPublicUrl(match.team_a.photo_name).data.publicUrl
        : "images/default-team.png";
    const logoB  = match.team_b.photo_name
        ? bucket.getPublicUrl(match.team_b.photo_name).data.publicUrl
        : "images/default-team.png";

    const isLocked = !!predictedWinnerId;
    container.replaceChildren();

    // ── FOMO strip: streak + star progress ──────────────────────────────
    const fomoStrip       = document.createElement("div");
    fomoStrip.className   = "fomo-strip";

    // Streak
    const streakEl        = document.createElement("div");
    streakEl.className    = `fomo-pill ${meta.streak >= 3 ? "fomo-hot" : ""}`;
    streakEl.innerHTML    = meta.streak > 0
        ? `🔥 ${meta.streak} correct in a row`
        : `⭐ ${meta.stars} stars total`;

    // Star progress toward next free sub
    const starsToNext     = 10 - (meta.stars % 10);
    const progressEl      = document.createElement("div");
    progressEl.className  = "fomo-pill fomo-progress";
    progressEl.textContent = `${starsToNext} star${starsToNext !== 1 ? "s" : ""} to free sub`;

    fomoStrip.append(streakEl, progressEl);
    container.appendChild(fomoStrip);

    // Star progress bar
    const pct              = ((meta.stars % 10) / 10) * 100;
    const barWrap          = document.createElement("div");
    barWrap.className      = "star-bar-wrap";

    const barTrack         = document.createElement("div");
    barTrack.className     = "star-bar-track";

    const barFill          = document.createElement("div");
    barFill.className      = "star-bar-fill";
    barFill.style.width    = `${pct}%`;

    const barLabel         = document.createElement("div");
    barLabel.className     = "star-bar-label";
    barLabel.textContent   = `${meta.stars % 10}/10 ⭐ toward free sub`;

    barTrack.appendChild(barFill);
    barWrap.append(barTrack, barLabel);
    container.appendChild(barWrap);

    // Recent winners strip
    if (meta.recentWinners.length > 0) {
        const winnersWrap       = document.createElement("div");
        winnersWrap.className   = "winners-strip";

        const wLabel            = document.createElement("span");
        wLabel.className        = "winners-label";
        wLabel.textContent      = "🎁 Recent free subs:";
        winnersWrap.appendChild(wLabel);

        meta.recentWinners.forEach(w => {
            const pill          = document.createElement("span");
            pill.className      = "winners-pill";
            pill.textContent    = w.user_profiles?.team_name || "Expert";
            winnersWrap.appendChild(pill);
        });

        container.appendChild(winnersWrap);
    }

    // ── Prediction question ──────────────────────────────────────────────
    const hdr = document.createElement("div");
    hdr.className = "pred-header";

    const q           = document.createElement("p");
    q.className       = "pred-question";
    q.textContent     = "Who will win?";

    const hook        = document.createElement("p");
    hook.className    = "pred-hook";
    hook.textContent  = "Correct = 1 ⭐ · Every 10 stars = 1 free sub 🎁";

    const guruBtn     = document.createElement("button");
    guruBtn.className = "icon-btn";
    guruBtn.textContent = "🏆 Prediction Masters";
    guruBtn.onclick   = () => showGuruLeaderboard();

    hdr.append(q, hook, guruBtn);
    container.appendChild(hdr);

    // ── VS row ───────────────────────────────────────────────────────────
    const vsWrap = document.createElement("div");
    vsWrap.className = "team-vs-container";

    const makeTeamCard = (team, logoUrl, pct) => {
        const card    = document.createElement("div");
        card.className = `team-card ${predictedWinnerId === team.id ? "selected" : ""}`;
        if (!isLocked) card.onclick = () => savePrediction(team.id);

        const img     = document.createElement("img");
        img.src       = logoUrl;
        img.alt       = team.short_code;

        const name    = document.createElement("span");
        name.textContent = team.short_code;

        card.append(img, name);

        // Community split shown only after user has locked
        if (isLocked && pct !== null) {
            const pctEl       = document.createElement("span");
            pctEl.className   = "community-pct";
            pctEl.textContent = `${pct}% picked`;
            card.appendChild(pctEl);
        }

        return card;
    };

    const vs        = document.createElement("div");
    vs.className    = "vs-badge";
    vs.textContent  = "VS";

    vsWrap.append(
        makeTeamCard(match.team_a, logoA, meta.split?.a ?? null),
        vs,
        makeTeamCard(match.team_b, logoB, meta.split?.b ?? null)
    );
    container.appendChild(vsWrap);

    // Total predictions count
    if (meta.totalPreds > 0) {
        const totalEl       = document.createElement("p");
        totalEl.className   = "pred-total";
        totalEl.textContent = `${meta.totalPreds} expert${meta.totalPreds !== 1 ? "s" : ""} have predicted`;
        container.appendChild(totalEl);
    }

    if (isLocked) {
        const lockMsg       = document.createElement("div");
        lockMsg.className   = "locked-msg";
        lockMsg.textContent = "Prediction locked 🔒";
        container.appendChild(lockMsg);
    }
}

async function savePrediction(teamId) {
    const ok = await showConfirm("Lock Prediction?", "You cannot change this later.");
    if (!ok) return;

    const { error } = await supabase.from("user_predictions").upsert({
        user_id:             currentUserId,
        match_id:            currentMatchId,
        predicted_winner_id: teamId,
    });

    if (error) { showToast("Failed to save prediction.", "error"); return; }
    showToast("Prediction locked! 🔒", "success");
    loadPredictionCard();
}

window.savePrediction = savePrediction;

/* ─── POST-MATCH SUMMARY ─────────────────────────────────────────────────── */
async function loadPostMatchSummary() {
    const { data: lastMatch } = await supabase
        .from("matches")
        .select("id, winner_id, team_a:real_teams!team_a_id(id, short_code), team_b:real_teams!team_b_id(id, short_code)")
        .eq("points_processed", true)
        .order("actual_start_time", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lastMatch?.winner_id) return;

    const [totalRes, correctRes] = await Promise.all([
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", lastMatch.id),
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", lastMatch.id).eq("predicted_winner_id", lastMatch.winner_id),
    ]);

    const total   = totalRes.count || 0;
    const correct = correctRes.count || 0;
    const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;
    const winner  = lastMatch.winner_id === lastMatch.team_a.id
        ? lastMatch.team_a.short_code
        : lastMatch.team_b.short_code;

    const el = document.getElementById("postMatchSummary");
    if (!el) return;

    el.innerHTML = "";
    const card = document.createElement("div");
    card.className = "summary-card";

    const title       = document.createElement("p");
    title.className   = "summary-title";
    title.textContent = `${winner} won!`;

    const body        = document.createElement("p");
    body.className    = "summary-body";
    body.textContent  = `${pct}% of experts predicted this correctly.`;

    card.append(title, body);
    el.appendChild(card);
}

/* ─── PODIUMS ────────────────────────────────────────────────────────────── */
async function loadPodiums() {
    try {
        const { data: lastMatch } = await supabase
            .from("matches")
            .select("id, match_number, winner_id")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastMatch) return;

        const [playersRes, usersRes] = await Promise.all([
            supabase.from("player_match_stats")
                .select("fantasy_points, player_id, players(name, photo_url)")
                .eq("match_id", lastMatch.id)
                .order("fantasy_points", { ascending: false })
                .limit(3),
            supabase.from("user_match_points")
                .select("total_points, user_id, user_profiles(team_name, team_photo_url)")
                .eq("match_id", lastMatch.id)
                .order("total_points", { ascending: false })
                .limit(3),
        ]);

        renderPodium(playersRes.data, "playerPodium", "player", lastMatch.id);
        renderPodium(usersRes.data,   "userPodium",   "user",   lastMatch.id);

    } catch (err) {
        console.error("Podium error:", err);
    }
}

function renderPodium(data, containerId, type, matchId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data?.length) {
        const p       = document.createElement("p");
        p.className   = "empty-msg";
        p.textContent = "Awaiting results…";
        container.replaceChildren(p);
        return;
    }

    const order = [data[1], data[0], data[2]].filter(Boolean);
    container.replaceChildren();

    order.forEach(item => {
        const rank = item === data[0] ? 1 : item === data[1] ? 2 : 3;

        let name, pts, photoPath, clickHandler;

        if (type === "player") {
            name        = item.players?.name?.split(" ").pop() || "Unknown";
            pts         = `${item.fantasy_points} pts`;
            photoPath   = item.players?.photo_url
                ? supabase.storage.from("player-photos").getPublicUrl(item.players.photo_url).data.publicUrl
                : "images/default-avatar.png";
            // BUG FIX: use player_id not item.id for the stat lookup
            const pid   = item.player_id;
            clickHandler = () => openPlayerDetail(pid, matchId);
        } else {
            name        = item.user_profiles?.team_name || "Unknown";
            pts         = `${item.total_points} pts`;
            photoPath   = item.user_profiles?.team_photo_url
                ? supabase.storage.from("team-avatars").getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl
                : "images/default-avatar.png";
            const uid   = item.user_id;
            clickHandler = () => openTeamScout(uid, matchId);
        }

        const itemEl       = document.createElement("div");
        itemEl.className   = `podium-item rank-${rank}`;
        itemEl.style.cursor = "pointer";
        itemEl.onclick     = clickHandler;
        itemEl.title       = "Tap to view details";

        const nameEl       = document.createElement("div");
        nameEl.className   = "podium-name";
        nameEl.textContent = name;

        const wrap         = document.createElement("div");
        wrap.className     = "podium-avatar-wrapper";

        const img          = document.createElement("img");
        img.src            = photoPath;
        img.className      = "podium-img";
        img.alt            = name;

        const badge        = document.createElement("div");
        badge.className    = "rank-badge";
        badge.textContent  = String(rank);

        // Tap hint icon
        const tapHint      = document.createElement("div");
        tapHint.className  = "podium-tap-hint";
        tapHint.textContent = "👆";

        wrap.append(img, badge);

        const ptsEl        = document.createElement("div");
        ptsEl.className    = "podium-pts";
        ptsEl.textContent  = pts;

        if (type === "user") applyRankFlair(img, nameEl, rank);

        itemEl.append(nameEl, wrap, ptsEl, tapHint);
        container.appendChild(itemEl);
    });
}

/* ─── GURU LEADERBOARD ───────────────────────────────────────────────────── */
window.showGuruLeaderboard = async () => {
    const { data: top100 } = await supabase
        .from("user_tournament_points")
        .select("prediction_stars, user_profiles(team_name, team_photo_url)")
        .eq("tournament_id", currentTournamentId)
        .order("prediction_stars", { ascending: false })
        .order("updated_at", { ascending: true })
        .limit(100);

    const overlay = document.getElementById("guruModal");
    const list    = document.getElementById("guruList");
    if (!overlay || !list) return;

    list.replaceChildren();

    (top100 || []).forEach((g, i) => {
        const rank    = i + 1;
        const photo   = g.user_profiles?.team_photo_url
            ? supabase.storage.from("team-avatars").getPublicUrl(g.user_profiles.team_photo_url).data.publicUrl
            : "images/default-avatar.png";

        const row         = document.createElement("div");
        row.className     = "guru-row";

        const rankEl      = document.createElement("div");
        rankEl.className  = "guru-rank";
        rankEl.textContent = `#${rank}`;

        const avatarEl    = document.createElement("img");
        avatarEl.src      = photo;
        avatarEl.className = "guru-avatar";

        const nameEl      = document.createElement("div");
        nameEl.className  = "guru-name";
        nameEl.textContent = g.user_profiles?.team_name || "Expert";

        const starsEl     = document.createElement("div");
        starsEl.className = "guru-stars";
        starsEl.textContent = `${g.prediction_stars} ⭐`;

        if (rank <= 3) applyRankFlair(avatarEl, nameEl, rank);

        row.append(rankEl, avatarEl, nameEl, starsEl);
        list.appendChild(row);
    });

    overlay.classList.remove("hidden");
};

document.getElementById("closeGuruModal")?.addEventListener("click", () => {
    document.getElementById("guruModal")?.classList.add("hidden");
});


/* ═══════════════════════════════════════════════════════════════════════════
   ALL STARS PANEL
═══════════════════════════════════════════════════════════════════════════ */

let allStarsState = {
    allPlayers:     [],
    selected:       [],
    captainId:      null,
    vcId:           null,
    isMatch1Locked: false,
    existingTeamId: null,
    activeRole:     "ALL",
    searchQuery:    "",
    saving:         false,
};

async function loadAllStarsPanel() {
    const panel = document.getElementById("panel-allstars");
    if (!panel) return;
    showPanelSpinner("panel-allstars");

    const { data: match1 } = await supabase
        .from("matches")
        .select("status, lock_processed, points_processed")
        .eq("tournament_id", currentTournamentId)
        .eq("match_number", 1)
        .maybeSingle();

    allStarsState.isMatch1Locked = !!(
        match1?.status         === "locked" ||
        match1?.lock_processed === true     ||
        match1?.points_processed === true
    );

    const { data: players } = await supabase
        .from("player_pool_view")
        .select("*")
        .eq("is_active", true)
        .eq("tournament_id", currentTournamentId);

    allStarsState.allPlayers = players || [];

    const { data: existing } = await supabase
        .from("user_allstar_teams")
        .select("*, user_allstar_team_players(player_id)")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .maybeSingle();

    if (existing) {
        allStarsState.existingTeamId = existing.id;
        allStarsState.captainId      = existing.captain_id;
        allStarsState.vcId           = existing.vice_captain_id;
        const savedIds = existing.user_allstar_team_players.map(p => p.player_id);
        allStarsState.selected = allStarsState.allPlayers.filter(p => savedIds.includes(p.id));
    }

    const { data: lbRows } = await supabase
        .from("allstar_leaderboard_view")
        .select("user_id, team_name, total_allstar_points, rank")
        .eq("tournament_id", currentTournamentId)
        .order("rank", { ascending: true })
        .limit(10);

    renderAllStarsPanel(lbRows || []);
}

function renderAllStarsPanel(lbRows) {
    const panel = document.getElementById("panel-allstars");
    if (!panel) return;
    panel.innerHTML = "";

    const hasTeam  = allStarsState.selected.length > 0;
    const isLocked = allStarsState.isMatch1Locked;
    const stats    = calcAllStarsStats();

    if (isLocked && hasTeam) {
        renderAllStarsPitchCard(panel);
        renderAllStarsLeaderboard(panel, lbRows);
        return;
    }

    const hdr = document.createElement("div");
    hdr.className = "as-header";
    hdr.innerHTML = `
        <div class="as-title-row">
            <span class="as-title">All Stars XI</span>
            <span class="as-subtitle">${isLocked ? "Window closed — Match 1 has started" : "Edit freely until Match 1 locks"}</span>
        </div>
        <div class="as-stats-row">
            <span class="as-stat"><strong>${stats.count}</strong>/11</span>
            <span class="as-stat"><strong>${stats.credits.toFixed(1)}</strong> Cr</span>
            <span class="as-stat"><strong>${stats.overseas}</strong>/4 OS</span>
        </div>`;
    panel.appendChild(hdr);

    if (!isLocked) {
        const warn       = document.createElement("div");
        warn.className   = "as-deadline-warn";
        warn.textContent = "⏰ Locks when Match 1 starts — save before then!";
        panel.appendChild(warn);
    }

    if (hasTeam) {
        const xiSection = document.createElement("div");
        xiSection.className = "as-xi-section";

        const xiLabel       = document.createElement("p");
        xiLabel.className   = "as-section-label";
        xiLabel.textContent = "My All Stars XI";
        xiSection.appendChild(xiLabel);

        const sorted = [...allStarsState.selected].sort((a, b) =>
            (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) || (b.credit - a.credit));
        sorted.forEach(p => xiSection.appendChild(buildAllStarsPlayerCard(p, true, stats)));
        panel.appendChild(xiSection);
    }

    if (!isLocked) {
        const search       = document.createElement("input");
        search.type        = "text";
        search.className   = "as-search";
        search.placeholder = "Search players…";
        search.value       = allStarsState.searchQuery;
        search.oninput     = e => { allStarsState.searchQuery = e.target.value; renderAllStarsPanel([]); };
        panel.appendChild(search);

        panel.appendChild(buildRoleTabs(allStarsState, () => renderAllStarsPanel([])));

        const poolSection = document.createElement("div");
        poolSection.className = "as-pool-section";

        const poolLabel       = document.createElement("p");
        poolLabel.className   = "as-section-label";
        poolLabel.textContent = "Player Pool";
        poolSection.appendChild(poolLabel);

        const s = allStarsState.searchQuery.toLowerCase();
        const filtered = allStarsState.allPlayers
            .filter(p => {
                if (allStarsState.activeRole !== "ALL" && p.role !== allStarsState.activeRole) return false;
                if (s && !p.name.toLowerCase().includes(s) &&
                    !(p.team_short_code || "").toLowerCase().includes(s)) return false;
                return true;
            })
            .sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit);

        filtered.forEach(p => poolSection.appendChild(buildAllStarsPlayerCard(p, false, stats)));
        panel.appendChild(poolSection);

        const saveBtn       = document.createElement("button");
        saveBtn.className   = "as-save-btn";
        saveBtn.id          = "allStarsSaveBtn";
        saveBtn.textContent = allStarsState.existingTeamId ? "Update All Stars XI" : "Save All Stars XI";
        saveBtn.disabled    = !isAllStarsValid(stats) || allStarsState.saving;
        saveBtn.onclick     = saveAllStars;
        panel.appendChild(saveBtn);
    }

    renderAllStarsLeaderboard(panel, lbRows);
}

function renderAllStarsPitchCard(panel) {
    const hdr = document.createElement("div");
    hdr.className = "pitch-card-header";
    hdr.innerHTML = `
        <span class="pitch-card-title">⭐ My All Stars XI</span>
        <span class="pitch-card-sub">Locked for the season</span>`;
    panel.appendChild(hdr);

    const ptsEl       = document.createElement("div");
    ptsEl.className   = "pitch-season-pts";
    ptsEl.textContent = "Loading…";
    panel.appendChild(ptsEl);

    supabase.from("allstar_leaderboard_view")
        .select("total_allstar_points, rank")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .maybeSingle()
        .then(({ data }) => {
            ptsEl.textContent = data
                ? `${data.total_allstar_points} pts  ·  Rank #${data.rank}`
                : "Points appear after Match 1 is processed";
        });

    const pitch    = document.createElement("div");
    pitch.className = "pitch-field";

    const groups = { WK: [], BAT: [], AR: [], BOWL: [] };
    allStarsState.selected.forEach(p => { if (groups[p.role]) groups[p.role].push(p); });

    const roleLabels = { WK: "Keeper", BAT: "Batters", AR: "All-Rounders", BOWL: "Bowlers" };

    for (const role of ["WK", "BAT", "AR", "BOWL"]) {
        const group = groups[role];
        if (!group.length) continue;

        const row = document.createElement("div");
        row.className = "pitch-row";

        group.forEach(p => {
            const isC  = p.id === allStarsState.captainId;
            const isVC = p.id === allStarsState.vcId;

            const circle       = document.createElement("div");
            circle.className   = `pitch-circle ${isC ? "cap" : isVC ? "vc" : ""}`;

            const photo = p.photo_url
                ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl
                : "images/default-avatar.png";

            const av                 = document.createElement("div");
            av.className             = "pitch-avatar";
            av.style.backgroundImage = `url('${photo}')`;

            if (isC || isVC) {
                const badge       = document.createElement("span");
                badge.className   = `pitch-badge ${isC ? "pitch-badge-c" : "pitch-badge-vc"}`;
                badge.textContent = isC ? "C" : "VC";
                circle.appendChild(badge);
            }

            const name       = document.createElement("span");
            name.className   = "pitch-name";
            name.textContent = p.name.split(" ").pop();

            const team       = document.createElement("span");
            team.className   = "pitch-team";
            team.textContent = p.team_short_code;

            circle.append(av, name, team);
            row.appendChild(circle);
        });

        const rowLabel       = document.createElement("p");
        rowLabel.className   = "pitch-row-label";
        rowLabel.textContent = roleLabels[role];

        const rowWrap        = document.createElement("div");
        rowWrap.className    = "pitch-row-wrap";
        rowWrap.append(row, rowLabel);

        pitch.appendChild(rowWrap);
    }

    panel.appendChild(pitch);
}

function renderAllStarsLeaderboard(panel, rows) {
    const section       = document.createElement("div");
    section.className   = "as-lb-section";

    const title         = document.createElement("p");
    title.className     = "as-section-label";
    title.textContent   = "All Stars Leaderboard";
    section.appendChild(title);

    if (!rows.length) {
        const empty       = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Rankings appear after Match 1 is processed.";
        section.appendChild(empty);
        panel.appendChild(section);
        return;
    }

    rows.forEach(row => {
        const el       = document.createElement("div");
        el.className   = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

        const rank     = document.createElement("span");
        rank.className = "as-lb-rank";
        rank.textContent = `#${row.rank}`;

        const name     = document.createElement("span");
        name.className = "as-lb-name";
        name.textContent = row.team_name || "Expert";

        const pts      = document.createElement("span");
        pts.className  = "as-lb-pts";
        pts.textContent = `${row.total_allstar_points} pts`;

        el.append(rank, name, pts);
        section.appendChild(el);
    });

    panel.appendChild(section);
}

function buildAllStarsPlayerCard(player, isInXI, stats) {
    const isSelected = allStarsState.selected.some(p => p.id === player.id);

    const card       = document.createElement("div");
    card.className   = `as-player-card ${isSelected ? "selected" : ""}`;

    const photo = player.photo_url
        ? supabase.storage.from("player-photos").getPublicUrl(player.photo_url).data.publicUrl
        : "images/default-avatar.png";

    const av       = document.createElement("img");
    av.src         = photo;
    av.alt         = player.name;
    av.className   = "as-avatar";

    const info     = document.createElement("div");
    info.className = "as-player-info";

    const name     = document.createElement("span");
    name.className   = "as-player-name";
    name.textContent = player.name;

    const meta     = document.createElement("span");
    meta.className   = "as-player-meta";
    meta.textContent = `${player.role} · ${player.team_short_code} · ${player.credit} Cr`;

    info.append(name, meta);

    const ctrls    = document.createElement("div");
    ctrls.className = "as-controls";

    if (isInXI) {
        const cBtn         = document.createElement("button");
        cBtn.className     = `as-role-btn ${allStarsState.captainId === player.id ? "active-c" : ""}`;
        cBtn.textContent   = "C";
        cBtn.onclick       = () => toggleAllStarsRole(player.id, "C");

        const vcBtn        = document.createElement("button");
        vcBtn.className    = `as-role-btn ${allStarsState.vcId === player.id ? "active-vc" : ""}`;
        vcBtn.textContent  = "VC";
        vcBtn.onclick      = () => toggleAllStarsRole(player.id, "VC");

        ctrls.append(cBtn, vcBtn);
    }

    const actionBtn        = document.createElement("button");
    actionBtn.className    = `as-action-btn ${isSelected ? "remove" : "add"}`;
    actionBtn.textContent  = isSelected ? "−" : "+";
    actionBtn.onclick      = () => toggleAllStarsPlayer(player.id);
    ctrls.appendChild(actionBtn);

    card.append(av, info, ctrls);
    return card;
}

function calcAllStarsStats() {
    const roles = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
    let overseas = 0, credits = 0;
    for (const p of allStarsState.selected) {
        roles[p.role] = (roles[p.role] || 0) + 1;
        if (p.category === "overseas") overseas++;
        credits += Number(p.credit);
    }
    return { count: allStarsState.selected.length, overseas, credits, roles };
}

function isAllStarsValid(stats) {
    return (
        stats.count === 11 && allStarsState.captainId && allStarsState.vcId &&
        stats.roles.WK >= 1 && stats.roles.BAT >= 3 && stats.roles.AR >= 1 &&
        stats.roles.BOWL >= 3 && stats.overseas <= 4 && stats.credits <= 100.05
    );
}

function toggleAllStarsPlayer(id) {
    const idx = allStarsState.selected.findIndex(p => p.id === id);
    if (idx > -1) {
        allStarsState.selected.splice(idx, 1);
        if (allStarsState.captainId === id) allStarsState.captainId = null;
        if (allStarsState.vcId      === id) allStarsState.vcId      = null;
    } else if (allStarsState.selected.length < 11) {
        const p = allStarsState.allPlayers.find(p => p.id === id);
        if (p) allStarsState.selected.push(p);
    }
    renderAllStarsPanel([]);
}

function toggleAllStarsRole(id, type) {
    if (type === "C") {
        allStarsState.captainId = allStarsState.captainId === id ? null : id;
        if (allStarsState.captainId === allStarsState.vcId) allStarsState.vcId = null;
    } else {
        allStarsState.vcId = allStarsState.vcId === id ? null : id;
        if (allStarsState.vcId === allStarsState.captainId) allStarsState.captainId = null;
    }
    renderAllStarsPanel([]);
}

async function saveAllStars() {
    const stats = calcAllStarsStats();
    if (!isAllStarsValid(stats)) { showToast("Team incomplete — check all requirements.", "error"); return; }

    const isUpdate = !!allStarsState.existingTeamId;
    const ok = await showConfirm(
        isUpdate ? "Update All Stars XI?" : "Save All Stars XI?",
        isUpdate ? "Your previous XI will be replaced." : "You can keep editing until Match 1 locks."
    );
    if (!ok) return;

    allStarsState.saving = true;
    renderAllStarsPanel([]);

    try {
        const { data: saved, error: teamError } = await supabase
            .from("user_allstar_teams")
            .upsert(
                {
                    ...(allStarsState.existingTeamId ? { id: allStarsState.existingTeamId } : {}),
                    user_id:         currentUserId,
                    tournament_id:   currentTournamentId,
                    captain_id:      allStarsState.captainId,
                    vice_captain_id: allStarsState.vcId,
                    total_credits:   stats.credits,
                    updated_at:      new Date().toISOString(),
                },
                { onConflict: "user_id,tournament_id" }
            )
            .select().single();

        if (teamError) throw teamError;
        allStarsState.existingTeamId = saved.id;

        await supabase.from("user_allstar_team_players").delete().eq("user_allstar_team_id", saved.id);
        const { error: insertError } = await supabase.from("user_allstar_team_players").insert(
            allStarsState.selected.map(p => ({ user_allstar_team_id: saved.id, player_id: p.id }))
        );
        if (insertError) throw insertError;

        showToast(isUpdate ? "All Stars XI updated! ✅" : "All Stars XI saved! ✅", "success");

    } catch (err) {
        console.error("All Stars save error:", err);
        showToast("Save failed: " + err.message, "error");
    } finally {
        allStarsState.saving = false;
        await loadAllStarsPanel();
    }
}


/* ═══════════════════════════════════════════════════════════════════════════
   DAILY XI PANEL
═══════════════════════════════════════════════════════════════════════════ */

let dailyState = {
    match:      null,
    players:    [],
    selected:   [],
    captainId:  null,
    vcId:       null,
    isLocked:   false,
    activeRole: "ALL",
};

async function loadDailyPanel() {
    const panel = document.getElementById("panel-daily");
    if (!panel || panel.dataset.loaded) return;
    panel.dataset.loaded = "1";
    showPanelSpinner("panel-daily");

    const { data: match } = await supabase
        .from("matches")
        .select("*, team_a:real_teams!team_a_id(id, short_code, photo_name), team_b:real_teams!team_b_id(id, short_code, photo_name)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (!match) {
        panel.innerHTML = `<p class="empty-msg" style="padding:40px 0;">No upcoming match today.</p>`;
        return;
    }

    dailyState.match = match;

    const { data: players } = await supabase
        .from("player_pool_view")
        .select("*")
        .eq("is_active", true)
        .eq("tournament_id", currentTournamentId)
        .in("real_team_id", [match.team_a.id, match.team_b.id]);

    dailyState.players = players || [];

    const { data: existing } = await supabase
        .from("user_daily_teams")
        .select("*, user_daily_team_players(player_id)")
        .eq("user_id", currentUserId)
        .eq("match_id", match.id)
        .maybeSingle();

    if (existing) {
        dailyState.isLocked  = true;
        dailyState.captainId = existing.captain_id;
        dailyState.vcId      = existing.vice_captain_id;
        const savedIds       = existing.user_daily_team_players.map(p => p.player_id);
        dailyState.selected  = dailyState.players.filter(p => savedIds.includes(p.id));
    }

    renderDailyPanel();
    await Promise.all([loadDailyLeaderboard(match.id), loadDailyAvgRank()]);
}

function renderDailyPanel() {
    const panel = document.getElementById("panel-daily");
    if (!panel) return;
    panel.innerHTML = "";

    const match = dailyState.match;
    const stats = calcDailyStats();

    const matchHdr = document.createElement("div");
    matchHdr.className = "daily-match-header";
    matchHdr.innerHTML = `
        <span class="daily-match-label">Today's Match</span>
        <span class="daily-match-name">${match.team_a.short_code} vs ${match.team_b.short_code}</span>
        <span class="daily-match-hint">Pick your best XI from these two teams only</span>`;
    panel.appendChild(matchHdr);

    const statsBar = document.createElement("div");
    statsBar.className = "daily-stats-bar";
    statsBar.innerHTML = `
        <span class="daily-stat"><strong>${stats.count}</strong>/11</span>
        <span class="daily-stat"><strong>${stats.credits.toFixed(1)}</strong> Cr</span>
        <span class="daily-stat"><strong>${stats.overseas}</strong>/4 OS</span>`;
    panel.appendChild(statsBar);

    if (dailyState.isLocked) {
        const banner       = document.createElement("div");
        banner.className   = "as-locked-banner";
        banner.textContent = "🔒 Daily XI locked for this match";
        panel.appendChild(banner);
    }

    if (dailyState.selected.length > 0) {
        const xiSec = document.createElement("div");
        xiSec.className = "as-xi-section";

        const lbl       = document.createElement("p");
        lbl.className   = "as-section-label";
        lbl.textContent = "My Daily XI";
        xiSec.appendChild(lbl);

        const sorted = [...dailyState.selected].sort((a, b) =>
            (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) || (b.credit - a.credit));
        sorted.forEach(p => xiSec.appendChild(buildDailyPlayerCard(p, true, stats)));
        panel.appendChild(xiSec);
    }

    if (!dailyState.isLocked) {
        panel.appendChild(buildRoleTabs(dailyState, renderDailyPanel));

        const poolSec = document.createElement("div");
        poolSec.className = "as-pool-section";

        const poolLbl       = document.createElement("p");
        poolLbl.className   = "as-section-label";
        poolLbl.textContent = "Available Players";
        poolSec.appendChild(poolLbl);

        const filtered = dailyState.players
            .filter(p => dailyState.activeRole === "ALL" || p.role === dailyState.activeRole)
            .sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit);

        filtered.forEach(p => poolSec.appendChild(buildDailyPlayerCard(p, false, stats)));
        panel.appendChild(poolSec);

        const saveBtn       = document.createElement("button");
        saveBtn.className   = "as-save-btn";
        saveBtn.id          = "dailySaveBtn";
        saveBtn.textContent = "Lock Daily XI";
        saveBtn.disabled    = !isDailyValid(stats);
        saveBtn.onclick     = saveDailyXI;
        panel.appendChild(saveBtn);
    }

    const lbWrap = document.createElement("div");
    lbWrap.innerHTML = `
        <div id="dailyLeaderboard" class="as-lb-section"></div>
        <div id="dailyAvgRank"     class="as-lb-section"></div>`;
    panel.appendChild(lbWrap);
}

function buildDailyPlayerCard(player, isInXI, stats) {
    const isSelected = dailyState.selected.some(p => p.id === player.id);

    const card       = document.createElement("div");
    card.className   = `as-player-card ${isSelected ? "selected" : ""}`;

    const photo = player.photo_url
        ? supabase.storage.from("player-photos").getPublicUrl(player.photo_url).data.publicUrl
        : "images/default-avatar.png";

    const av       = document.createElement("img");
    av.src         = photo;
    av.alt         = player.name;
    av.className   = "as-avatar";

    const info     = document.createElement("div");
    info.className = "as-player-info";

    const name     = document.createElement("span");
    name.className   = "as-player-name";
    name.textContent = player.name;

    const meta     = document.createElement("span");
    meta.className   = "as-player-meta";
    meta.textContent = `${player.role} · ${player.team_short_code} · ${player.credit} Cr`;

    info.append(name, meta);

    const ctrls    = document.createElement("div");
    ctrls.className = "as-controls";

    if (isInXI && !dailyState.isLocked) {
        const cBtn        = document.createElement("button");
        cBtn.className    = `as-role-btn ${dailyState.captainId === player.id ? "active-c" : ""}`;
        cBtn.textContent  = "C";
        cBtn.onclick      = () => toggleDailyRole(player.id, "C");

        const vcBtn       = document.createElement("button");
        vcBtn.className   = `as-role-btn ${dailyState.vcId === player.id ? "active-vc" : ""}`;
        vcBtn.textContent = "VC";
        vcBtn.onclick     = () => toggleDailyRole(player.id, "VC");

        ctrls.append(cBtn, vcBtn);
    } else if (isInXI && dailyState.isLocked) {
        if (dailyState.captainId === player.id) {
            const b = document.createElement("span");
            b.className = "as-badge-c";
            b.textContent = "C";
            ctrls.appendChild(b);
        }
        if (dailyState.vcId === player.id) {
            const b = document.createElement("span");
            b.className = "as-badge-vc";
            b.textContent = "VC";
            ctrls.appendChild(b);
        }
    }

    if (!dailyState.isLocked) {
        const actionBtn        = document.createElement("button");
        actionBtn.className    = `as-action-btn ${isSelected ? "remove" : "add"}`;
        actionBtn.textContent  = isSelected ? "−" : "+";
        actionBtn.onclick      = () => toggleDailyPlayer(player.id);
        ctrls.appendChild(actionBtn);
    }

    card.append(av, info, ctrls);
    return card;
}

function calcDailyStats() {
    const roles  = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
    let overseas = 0, credits = 0;
    for (const p of dailyState.selected) {
        roles[p.role] = (roles[p.role] || 0) + 1;
        if (p.category === "overseas") overseas++;
        credits += Number(p.credit);
    }
    return { count: dailyState.selected.length, overseas, credits, roles };
}

function isDailyValid(stats) {
    return (
        stats.count === 11 && dailyState.captainId && dailyState.vcId &&
        stats.roles.WK >= 1 && stats.roles.BAT >= 3 && stats.roles.AR >= 1 &&
        stats.roles.BOWL >= 3 && stats.overseas <= 4 && stats.credits <= 100.05
    );
}

function toggleDailyPlayer(id) {
    const idx = dailyState.selected.findIndex(p => p.id === id);
    if (idx > -1) {
        dailyState.selected.splice(idx, 1);
        if (dailyState.captainId === id) dailyState.captainId = null;
        if (dailyState.vcId      === id) dailyState.vcId      = null;
    } else if (dailyState.selected.length < 11) {
        const p = dailyState.players.find(p => p.id === id);
        if (p) dailyState.selected.push(p);
    }
    renderDailyPanel();
}

function toggleDailyRole(id, type) {
    if (type === "C") {
        dailyState.captainId = dailyState.captainId === id ? null : id;
        if (dailyState.captainId === dailyState.vcId) dailyState.vcId = null;
    } else {
        dailyState.vcId = dailyState.vcId === id ? null : id;
        if (dailyState.vcId === dailyState.captainId) dailyState.captainId = null;
    }
    renderDailyPanel();
}

async function saveDailyXI() {
    const stats = calcDailyStats();
    if (!isDailyValid(stats)) { showToast("Team incomplete — check all requirements.", "error"); return; }

    const ok = await showConfirm("Lock Daily XI?", "You can't change it once locked.");
    if (!ok) return;

    const btn = document.getElementById("dailySaveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    try {
        const { data: saved, error: teamError } = await supabase
            .from("user_daily_teams")
            .insert([{
                user_id:         currentUserId,
                match_id:        dailyState.match.id,
                tournament_id:   currentTournamentId,
                captain_id:      dailyState.captainId,
                vice_captain_id: dailyState.vcId,
                total_credits:   calcDailyStats().credits,
            }])
            .select().single();

        if (teamError) throw teamError;

        const { error: playersError } = await supabase
            .from("user_daily_team_players")
            .insert(dailyState.selected.map(p => ({ user_daily_team_id: saved.id, player_id: p.id })));

        if (playersError) throw playersError;

        dailyState.isLocked = true;
        showToast("Daily XI locked! 🔒 Good luck!", "success");
        delete document.getElementById("panel-daily")?.dataset.loaded;
        await loadDailyPanel();

    } catch (err) {
        console.error("Daily XI save error:", err);
        showToast("Save failed: " + err.message, "error");
        if (btn) { btn.disabled = false; btn.textContent = "Lock Daily XI"; }
    }
}

async function loadDailyLeaderboard(matchId) {
    const section = document.getElementById("dailyLeaderboard");
    if (!section) return;

    const { data: rows } = await supabase
        .from("daily_match_leaderboard_view")
        .select("team_name, total_daily_points, rank, user_id")
        .eq("match_id", matchId)
        .order("rank", { ascending: true })
        .limit(10);

    section.innerHTML = "";
    const title       = document.createElement("p");
    title.className   = "as-section-label";
    title.textContent = "Daily Match Leaderboard";
    section.appendChild(title);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent = "Rankings appear after the match is processed.";
        section.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const el       = document.createElement("div");
        el.className   = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

        const rank     = document.createElement("span");
        rank.className = "as-lb-rank";
        rank.textContent = `#${row.rank}`;

        const name     = document.createElement("span");
        name.className = "as-lb-name";
        name.textContent = row.team_name || "Expert";

        const pts      = document.createElement("span");
        pts.className  = "as-lb-pts";
        pts.textContent = `${row.total_daily_points} pts`;

        el.append(rank, name, pts);
        section.appendChild(el);
    });
}

async function loadDailyAvgRank() {
    const section = document.getElementById("dailyAvgRank");
    if (!section) return;

    const { data: rows } = await supabase
        .from("daily_season_avg_rank_view")
        .select("team_name, avg_rank, matches_played, user_id")
        .eq("tournament_id", currentTournamentId)
        .order("avg_rank", { ascending: true })
        .limit(10);

    section.innerHTML = "";
    const title       = document.createElement("p");
    title.className   = "as-section-label";
    title.textContent = "Season Average Rank";
    section.appendChild(title);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent = "Appears after your first Daily XI match.";
        section.appendChild(empty);
        return;
    }

    rows.forEach((row, i) => {
        const el       = document.createElement("div");
        el.className   = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

        const rank     = document.createElement("span");
        rank.className = "as-lb-rank";
        rank.textContent = `#${i + 1}`;

        const name     = document.createElement("span");
        name.className = "as-lb-name";
        name.textContent = row.team_name || "Expert";

        const pts      = document.createElement("span");
        pts.className  = "as-lb-pts";
        pts.textContent = `Avg #${Number(row.avg_rank).toFixed(1)} · ${row.matches_played}M`;

        el.append(rank, name, pts);
        section.appendChild(el);
    });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SHARED HELPERS
═══════════════════════════════════════════════════════════════════════════ */

function buildRoleTabs(stateObj, onchange) {
    const wrap    = document.createElement("div");
    wrap.className = "as-role-tabs";
    for (const role of ["ALL", "WK", "BAT", "AR", "BOWL"]) {
        const btn       = document.createElement("button");
        btn.className   = `as-role-tab ${stateObj.activeRole === role ? "active" : ""}`;
        btn.textContent = role;
        btn.onclick     = () => { stateObj.activeRole = role; onchange(); };
        wrap.appendChild(btn);
    }
    return wrap;
}