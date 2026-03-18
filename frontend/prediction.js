import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let currentUserId, currentTournamentId, currentMatchId;

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

    // Tab routing — default to predict
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
    document.querySelectorAll(".fun-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach(p => {
        p.classList.toggle("hidden", p.id !== `panel-${tab}`);
    });
    location.hash = tab;

    if (tab === "allstars") loadAllStarsPanel();
    if (tab === "daily")    loadDailyPanel();
};

/* ─── TOAST & CONFIRM ────────────────────────────────────────────────────── */
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
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

function showConfirm(title, message) {
    return new Promise(resolve => {
        const overlay  = document.getElementById("funConfirmOverlay");
        const titleEl  = document.getElementById("funConfirmTitle");
        const textEl   = document.getElementById("funConfirmText");
        const btnOk    = document.getElementById("funConfirmOk");
        const btnCanel = document.getElementById("funConfirmCancel");
        if (!overlay) return resolve(false);

        titleEl.textContent = title;
        textEl.textContent  = message;
        overlay.classList.remove("hidden");

        const cleanup = () => overlay.classList.add("hidden");
        btnOk.onclick    = () => { cleanup(); resolve(true); };
        btnCanel.onclick = () => { cleanup(); resolve(false); };
    });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PANEL 1 — PREDICT
═══════════════════════════════════════════════════════════════════════════ */

/* ─── PREDICTION CARD ────────────────────────────────────────────────────── */
async function loadPredictionCard() {
    const { data: pts } = await supabase
        .from("user_tournament_points")
        .select("prediction_stars")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .maybeSingle();

    const starEl = document.getElementById("userStarCount");
    if (starEl) starEl.textContent = `${pts?.prediction_stars || 0} ⭐`;

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

    const { data: existing } = await supabase
        .from("user_predictions")
        .select("predicted_winner_id")
        .eq("user_id", currentUserId)
        .eq("match_id", currentMatchId)
        .maybeSingle();

    renderPredictionUI(match, existing?.predicted_winner_id);
}

function renderPredictionUI(match, predictedWinnerId) {
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

    // Header
    const hdr = document.createElement("div");
    hdr.className = "pred-header";
    hdr.innerHTML = `
        <p class="pred-question">Who will win?</p>
        <p class="pred-hook">Correct = 1 sub reward per 10 wins 🎁</p>
        <button class="icon-btn" onclick="showGuruLeaderboard()">🏆 Top Prediction Masters</button>`;
    container.appendChild(hdr);

    // Team cards
    const vsWrap = document.createElement("div");
    vsWrap.className = "team-vs-container";

    const makeTeamCard = (team, logoUrl) => {
        const card = document.createElement("div");
        card.className = `team-card ${predictedWinnerId === team.id ? "selected" : ""}`;
        if (!isLocked) card.onclick = () => savePrediction(team.id);

        const img  = document.createElement("img");
        img.src    = logoUrl;
        img.alt    = team.short_code;

        const name = document.createElement("span");
        name.textContent = team.short_code;

        card.append(img, name);
        return card;
    };

    const vs = document.createElement("div");
    vs.className   = "vs-badge";
    vs.textContent = "VS";

    vsWrap.append(makeTeamCard(match.team_a, logoA), vs, makeTeamCard(match.team_b, logoB));
    container.appendChild(vsWrap);

    if (isLocked) {
        const lockMsg = document.createElement("div");
        lockMsg.className   = "locked-msg";
        lockMsg.textContent = "Prediction locked 🔒";
        container.appendChild(lockMsg);
    }
}

async function savePrediction(teamId) {
    // BUG FIX: replaced native confirm() with custom modal
    const ok = await showConfirm("Lock Prediction?", "You cannot change this later.");
    if (!ok) return;

    const { error } = await supabase.from("user_predictions").upsert({
        user_id:             currentUserId,
        match_id:            currentMatchId,
        predicted_winner_id: teamId,
    });

    if (error) {
        showToast("Failed to save prediction.", "error");
        return;
    }

    showToast("Prediction locked in! 🔒", "success");
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

    const total   = totalRes.count   || 0;
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

    const title = document.createElement("p");
    title.className   = "summary-title";
    title.textContent = `${winner} won!`;

    const body = document.createElement("p");
    body.className   = "summary-body";
    body.textContent = `${pct}% of experts predicted this. Did you get your star?`;

    card.append(title, body);
    el.appendChild(card);
}

/* ─── PODIUMS ─────────────────────────────────────────────────────────────── */
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
                .select("fantasy_points, players(name, photo_url)")
                .eq("match_id", lastMatch.id)
                .order("fantasy_points", { ascending: false })
                .limit(3),
            supabase.from("user_match_points")
                .select("total_points, user_id, user_profiles(team_name, team_photo_url)")
                .eq("match_id", lastMatch.id)
                .order("total_points", { ascending: false })
                .limit(3),
        ]);

        renderPodium(playersRes.data, "playerPodium", "player");
        renderPodium(usersRes.data,   "userPodium",   "user");

    } catch (err) { console.error("Podium error:", err); }
}

function renderPodium(data, containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data?.length) {
        const p = document.createElement("p");
        p.className   = "empty-msg";
        p.textContent = "Awaiting results…";
        container.replaceChildren(p);
        return;
    }

    const order = [data[1], data[0], data[2]].filter(Boolean);
    container.replaceChildren();

    order.forEach(item => {
        const rank = item === data[0] ? 1 : item === data[1] ? 2 : 3;
        const bucket = supabase.storage;

        let name, pts, photoPath;
        if (type === "player") {
            name      = item.players?.name?.split(" ").pop() || "Unknown";
            pts       = `${item.fantasy_points} pts`;
            photoPath = item.players?.photo_url
                ? bucket.from("player-photos").getPublicUrl(item.players.photo_url).data.publicUrl
                : "images/default-avatar.png";
        } else {
            name      = item.user_profiles?.team_name || "Unknown";
            pts       = `${item.total_points} pts`;
            photoPath = item.user_profiles?.team_photo_url
                ? bucket.from("team-avatars").getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl
                : "images/default-avatar.png";
        }

        const itemEl = document.createElement("div");
        itemEl.className = `podium-item rank-${rank}`;

        const nameEl = document.createElement("div");
        nameEl.className   = "podium-name";
        nameEl.textContent = name;

        const wrap = document.createElement("div");
        wrap.className = "podium-avatar-wrapper";

        const img  = document.createElement("img");
        img.src    = photoPath;
        img.className = "podium-img";
        img.alt    = name;

        const badge = document.createElement("div");
        badge.className   = "rank-badge";
        badge.textContent = String(rank);

        wrap.append(img, badge);

        const ptsEl = document.createElement("div");
        ptsEl.className   = "podium-pts";
        ptsEl.textContent = pts;

        if (type === "user") {
            applyRankFlair(img, nameEl, rank);
            itemEl.append(nameEl, wrap, ptsEl);
        } else {
            itemEl.append(nameEl, wrap, ptsEl);
        }

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

        const row = document.createElement("div");
        row.className = "guru-row";

        const rankEl   = document.createElement("div");
        rankEl.className   = "guru-rank";
        rankEl.textContent = `#${rank}`;

        const avatarEl    = document.createElement("img");
        avatarEl.src      = photo;
        avatarEl.className = "guru-avatar";

        const nameEl  = document.createElement("div");
        nameEl.className   = "guru-name";
        nameEl.textContent = g.user_profiles?.team_name || "Expert";

        const starsEl = document.createElement("div");
        starsEl.className   = "guru-stars";
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
   PANEL 2 — ALL STARS
   One team, locked forever after first save, earns points all season.
   Stored in user_allstar_teams + user_allstar_team_players tables.
═══════════════════════════════════════════════════════════════════════════ */

const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };

let allStarsState = {
    allPlayers:      [],
    selected:        [],
    captainId:       null,
    vcId:            null,
    isLocked:        false,
    activeRole:      "ALL",
    searchQuery:     "",
};

async function loadAllStarsPanel() {
    const panel = document.getElementById("panel-allstars");
    if (!panel || panel.dataset.loaded) return;
    panel.dataset.loaded = "1";

    showPanelSpinner("panel-allstars");

    // Check if team is already locked
    const { data: existing } = await supabase
        .from("user_allstar_teams")
        .select("*, user_allstar_team_players(player_id)")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .maybeSingle();

    const { data: players } = await supabase
        .from("player_pool_view")
        .select("*")
        .eq("is_active", true)
        .eq("tournament_id", currentTournamentId);

    allStarsState.allPlayers = players || [];

    if (existing) {
        allStarsState.isLocked  = true;
        allStarsState.captainId = existing.captain_id;
        allStarsState.vcId      = existing.vice_captain_id;
        const savedIds = existing.user_allstar_team_players.map(p => p.player_id);
        allStarsState.selected  = allStarsState.allPlayers.filter(p => savedIds.includes(p.id));
    }

    renderAllStarsPanel();
    await loadAllStarsLeaderboard();
}

function renderAllStarsPanel() {
    const panel = document.getElementById("panel-allstars");
    if (!panel) return;
    panel.innerHTML = "";

    const stats = calcAllStarsStats();

    // ── Header ──
    const hdr = document.createElement("div");
    hdr.className = "as-header";
    hdr.innerHTML = `
        <div class="as-title-row">
            <span class="as-title">All Stars XI</span>
            <span class="as-subtitle">Locked forever after saving</span>
        </div>
        <div class="as-stats-row">
            <span class="as-stat"><strong>${stats.count}</strong>/11</span>
            <span class="as-stat"><strong>${stats.credits.toFixed(1)}</strong> Cr</span>
            <span class="as-stat"><strong>${stats.overseas}</strong>/4 OS</span>
        </div>`;
    panel.appendChild(hdr);

    if (allStarsState.isLocked) {
        const lockedBanner = document.createElement("div");
        lockedBanner.className = "as-locked-banner";
        lockedBanner.textContent = "🔒 Your All Stars XI is locked for the season";
        panel.appendChild(lockedBanner);
    }

    // ── Role tabs ──
    const roleTabs = document.createElement("div");
    roleTabs.className = "as-role-tabs";
    ["ALL", "WK", "BAT", "AR", "BOWL"].forEach(role => {
        const btn = document.createElement("button");
        btn.className   = `as-role-tab ${allStarsState.activeRole === role ? "active" : ""}`;
        btn.textContent = role;
        btn.onclick     = () => { allStarsState.activeRole = role; renderAllStarsPanel(); };
        roleTabs.appendChild(btn);
    });
    panel.appendChild(roleTabs);

    // ── My XI view ──
    if (allStarsState.selected.length > 0) {
        const xiSection = document.createElement("div");
        xiSection.className = "as-xi-section";

        const xiTitle = document.createElement("p");
        xiTitle.className   = "as-section-label";
        xiTitle.textContent = "My All Stars XI";
        xiSection.appendChild(xiTitle);

        const sorted = [...allStarsState.selected].sort((a, b) =>
            (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) || (b.credit - a.credit));

        sorted.forEach(p => xiSection.appendChild(buildAllStarsCard(p, true, stats)));
        panel.appendChild(xiSection);
    }

    // ── Player pool (if not locked) ──
    if (!allStarsState.isLocked) {
        // Search
        const search = document.createElement("input");
        search.type        = "text";
        search.className   = "as-search";
        search.placeholder = "Search players…";
        search.value       = allStarsState.searchQuery;
        search.oninput     = e => { allStarsState.searchQuery = e.target.value; renderAllStarsPanel(); };
        panel.appendChild(search);

        const poolSection = document.createElement("div");
        poolSection.className = "as-pool-section";

        const poolLabel = document.createElement("p");
        poolLabel.className   = "as-section-label";
        poolLabel.textContent = "Player Pool";
        poolSection.appendChild(poolLabel);

        const s = allStarsState.searchQuery.toLowerCase();
        const filtered = allStarsState.allPlayers
            .filter(p => {
                if (allStarsState.activeRole !== "ALL" && p.role !== allStarsState.activeRole) return false;
                if (s && !p.name.toLowerCase().includes(s) && !(p.team_short_code || "").toLowerCase().includes(s)) return false;
                return true;
            })
            .sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit);

        filtered.forEach(p => poolSection.appendChild(buildAllStarsCard(p, false, stats)));
        panel.appendChild(poolSection);

        // Save button
        const saveBtn = document.createElement("button");
        saveBtn.className   = "as-save-btn";
        saveBtn.id          = "allStarsSaveBtn";
        saveBtn.textContent = "Lock My All Stars XI";
        saveBtn.disabled    = !isAllStarsValid(stats);
        saveBtn.onclick     = saveAllStars;
        panel.appendChild(saveBtn);
    }

    // ── Leaderboard ──
    const lbSection = document.createElement("div");
    lbSection.id        = "allStarsLeaderboard";
    lbSection.className = "as-lb-section";
    panel.appendChild(lbSection);
}

function buildAllStarsCard(player, isInXI, stats) {
    const isSelected = allStarsState.selected.some(p => p.id === player.id);
    const card       = document.createElement("div");
    card.className   = `as-player-card ${isSelected ? "selected" : ""}`;

    const photo = player.photo_url
        ? supabase.storage.from("player-photos").getPublicUrl(player.photo_url).data.publicUrl
        : "images/default-avatar.png";

    const av = document.createElement("img");
    av.src    = photo;
    av.alt    = player.name;
    av.className = "as-avatar";

    const info = document.createElement("div");
    info.className = "as-player-info";

    const name = document.createElement("span");
    name.className   = "as-player-name";
    name.textContent = player.name;

    const meta = document.createElement("span");
    meta.className   = "as-player-meta";
    meta.textContent = `${player.role} · ${player.team_short_code} · ${player.credit} Cr`;

    info.append(name, meta);

    const ctrls = document.createElement("div");
    ctrls.className = "as-controls";

    if (isInXI && !allStarsState.isLocked) {
        const cBtn = document.createElement("button");
        cBtn.className   = `as-role-btn ${allStarsState.captainId === player.id ? "active-c" : ""}`;
        cBtn.textContent = "C";
        cBtn.onclick     = () => toggleAllStarsRole(player.id, "C");

        const vcBtn = document.createElement("button");
        vcBtn.className   = `as-role-btn ${allStarsState.vcId === player.id ? "active-vc" : ""}`;
        vcBtn.textContent = "VC";
        vcBtn.onclick     = () => toggleAllStarsRole(player.id, "VC");

        ctrls.append(cBtn, vcBtn);
    } else if (isInXI && allStarsState.isLocked) {
        if (allStarsState.captainId === player.id) {
            const cb = document.createElement("span");
            cb.className   = "as-badge-c";
            cb.textContent = "C";
            ctrls.appendChild(cb);
        }
        if (allStarsState.vcId === player.id) {
            const vcb = document.createElement("span");
            vcb.className   = "as-badge-vc";
            vcb.textContent = "VC";
            ctrls.appendChild(vcb);
        }
    }

    if (!allStarsState.isLocked) {
        const actionBtn = document.createElement("button");
        actionBtn.className   = `as-action-btn ${isSelected ? "remove" : "add"}`;
        actionBtn.textContent = isSelected ? "−" : "+";
        actionBtn.onclick     = () => toggleAllStarsPlayer(player.id);
        ctrls.appendChild(actionBtn);
    }

    card.append(av, info, ctrls);
    return card;
}

function calcAllStarsStats() {
    const sel     = allStarsState.selected;
    const roles   = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
    let overseas  = 0, credits = 0;
    for (const p of sel) {
        roles[p.role] = (roles[p.role] || 0) + 1;
        if (p.category === "overseas") overseas++;
        credits += Number(p.credit);
    }
    return { count: sel.length, overseas, credits, roles };
}

function isAllStarsValid(stats) {
    return stats.count === 11
        && allStarsState.captainId
        && allStarsState.vcId
        && stats.roles.WK >= 1
        && stats.roles.BAT >= 3
        && stats.roles.AR >= 1
        && stats.roles.BOWL >= 3
        && stats.overseas <= 4
        && stats.credits <= 100.05;
}

function toggleAllStarsPlayer(id) {
    const idx = allStarsState.selected.findIndex(p => p.id === id);
    if (idx > -1) {
        allStarsState.selected.splice(idx, 1);
        if (allStarsState.captainId === id) allStarsState.captainId = null;
        if (allStarsState.vcId === id)      allStarsState.vcId      = null;
    } else if (allStarsState.selected.length < 11) {
        const p = allStarsState.allPlayers.find(p => p.id === id);
        if (p) allStarsState.selected.push(p);
    }
    renderAllStarsPanel();
}

function toggleAllStarsRole(id, type) {
    if (type === "C") {
        allStarsState.captainId = allStarsState.captainId === id ? null : id;
        if (allStarsState.captainId === allStarsState.vcId) allStarsState.vcId = null;
    } else {
        allStarsState.vcId = allStarsState.vcId === id ? null : id;
        if (allStarsState.vcId === allStarsState.captainId) allStarsState.captainId = null;
    }
    renderAllStarsPanel();
}

async function saveAllStars() {
    const stats = calcAllStarsStats();
    if (!isAllStarsValid(stats)) {
        showToast("Team incomplete — check all requirements.", "error");
        return;
    }

    const ok = await showConfirm(
        "Lock Your All Stars XI?",
        "This team is permanent. You cannot make any changes after saving."
    );
    if (!ok) return;

    const btn = document.getElementById("allStarsSaveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    try {
        const { data: saved, error } = await supabase
            .from("user_allstar_teams")
            .insert([{
                user_id:         currentUserId,
                tournament_id:   currentTournamentId,
                captain_id:      allStarsState.captainId,
                vice_captain_id: allStarsState.vcId,
                total_credits:   stats.credits,
            }])
            .select()
            .single();

        if (error) throw error;

        await supabase.from("user_allstar_team_players").insert(
            allStarsState.selected.map(p => ({
                user_allstar_team_id: saved.id,
                player_id: p.id,
            }))
        );

        allStarsState.isLocked = true;
        showToast("All Stars XI locked for the season! 🔒", "success");
        // Force re-render with locked state
        delete document.getElementById("panel-allstars")?.dataset.loaded;
        await loadAllStarsPanel();

    } catch (err) {
        console.error("All Stars save error:", err);
        showToast("Save failed: " + err.message, "error");
        if (btn) { btn.disabled = false; btn.textContent = "Lock My All Stars XI"; }
    }
}

async function loadAllStarsLeaderboard() {
    const section = document.getElementById("allStarsLeaderboard");
    if (!section) return;

    const { data: rows } = await supabase
        .from("allstar_leaderboard_view")
        .select("team_name, total_allstar_points, rank, user_id")
        .order("rank", { ascending: true })
        .limit(10);

    section.innerHTML = "";

    const title = document.createElement("p");
    title.className   = "as-section-label";
    title.textContent = "All Stars Leaderboard";
    section.appendChild(title);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Rankings appear after Match 1.";
        section.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const el = document.createElement("div");
        el.className = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

        const rank = document.createElement("span");
        rank.className   = "as-lb-rank";
        rank.textContent = `#${row.rank}`;

        const name = document.createElement("span");
        name.className   = "as-lb-name";
        name.textContent = row.team_name || "Expert";

        const pts = document.createElement("span");
        pts.className   = "as-lb-pts";
        pts.textContent = `${row.total_allstar_points} pts`;

        el.append(rank, name, pts);
        section.appendChild(el);
    });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PANEL 3 — DAILY XI
   Pick 11 from today's two teams. Separate save per match. Leaderboard shows
   per-match rank AND season average rank.
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

    // Get today's match
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

    // Get players from only those two teams
    const { data: players } = await supabase
        .from("player_pool_view")
        .select("*")
        .eq("is_active", true)
        .eq("tournament_id", currentTournamentId)
        .in("real_team_id", [match.team_a.id, match.team_b.id]);

    dailyState.players = players || [];

    // Check if daily XI already saved for this match
    const { data: existing } = await supabase
        .from("user_daily_teams")
        .select("*, user_daily_team_players(player_id)")
        .eq("user_id", currentUserId)
        .eq("match_id", match.id)
        .maybeSingle();

    if (existing) {
        dailyState.isLocked = true;
        dailyState.captainId = existing.captain_id;
        dailyState.vcId      = existing.vice_captain_id;
        const savedIds = existing.user_daily_team_players.map(p => p.player_id);
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

    // Match header
    const matchHdr = document.createElement("div");
    matchHdr.className = "daily-match-header";
    matchHdr.innerHTML = `
        <span class="daily-match-label">Today's Match</span>
        <span class="daily-match-name">${match.team_a.short_code} vs ${match.team_b.short_code}</span>
        <span class="daily-match-hint">Pick your best XI from these two teams</span>`;
    panel.appendChild(matchHdr);

    // Stats bar
    const statsBar = document.createElement("div");
    statsBar.className = "daily-stats-bar";
    statsBar.innerHTML = `
        <span class="daily-stat"><strong>${stats.count}</strong>/11</span>
        <span class="daily-stat"><strong>${stats.credits.toFixed(1)}</strong> Cr</span>
        <span class="daily-stat"><strong>${stats.overseas}</strong>/4 OS</span>`;
    panel.appendChild(statsBar);

    if (dailyState.isLocked) {
        const lockedBanner = document.createElement("div");
        lockedBanner.className = "as-locked-banner";
        lockedBanner.textContent = "🔒 Daily XI locked for this match";
        panel.appendChild(lockedBanner);
    }

    // My XI
    if (dailyState.selected.length > 0) {
        const xiSec = document.createElement("div");
        xiSec.className = "as-xi-section";

        const lbl = document.createElement("p");
        lbl.className   = "as-section-label";
        lbl.textContent = "My Daily XI";
        xiSec.appendChild(lbl);

        const sorted = [...dailyState.selected].sort((a, b) =>
            (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) || (b.credit - a.credit));
        sorted.forEach(p => xiSec.appendChild(buildDailyCard(p, true, stats)));
        panel.appendChild(xiSec);
    }

    // Pool
    if (!dailyState.isLocked) {
        const poolSec = document.createElement("div");
        poolSec.className = "as-pool-section";

        const lbl = document.createElement("p");
        lbl.className   = "as-section-label";
        lbl.textContent = "Available Players";
        poolSec.appendChild(lbl);

        // Role filter
        const roleTabs = document.createElement("div");
        roleTabs.className = "as-role-tabs";
        ["ALL", "WK", "BAT", "AR", "BOWL"].forEach(role => {
            const btn = document.createElement("button");
            btn.className   = `as-role-tab ${dailyState.activeRole === role ? "active" : ""}`;
            btn.textContent = role;
            btn.onclick     = () => { dailyState.activeRole = role; renderDailyPanel(); };
            roleTabs.appendChild(btn);
        });
        panel.appendChild(roleTabs);

        const filtered = dailyState.players
            .filter(p => dailyState.activeRole === "ALL" || p.role === dailyState.activeRole)
            .sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit);

        filtered.forEach(p => poolSec.appendChild(buildDailyCard(p, false, stats)));
        panel.appendChild(poolSec);

        const saveBtn = document.createElement("button");
        saveBtn.className   = "as-save-btn";
        saveBtn.id          = "dailySaveBtn";
        saveBtn.textContent = "Lock Daily XI";
        saveBtn.disabled    = !isDailyValid(stats);
        saveBtn.onclick     = saveDailyXI;
        panel.appendChild(saveBtn);
    }

    // Leaderboard containers
    const lbWrap = document.createElement("div");
    lbWrap.innerHTML = `
        <div id="dailyLeaderboard" class="as-lb-section"></div>
        <div id="dailyAvgRank"     class="as-lb-section"></div>`;
    panel.appendChild(lbWrap);
}

function buildDailyCard(player, isInXI, stats) {
    const isSelected = dailyState.selected.some(p => p.id === player.id);
    const card       = document.createElement("div");
    card.className   = `as-player-card ${isSelected ? "selected" : ""}`;

    const photo = player.photo_url
        ? supabase.storage.from("player-photos").getPublicUrl(player.photo_url).data.publicUrl
        : "images/default-avatar.png";

    const av = document.createElement("img");
    av.src    = photo;
    av.alt    = player.name;
    av.className = "as-avatar";

    const info = document.createElement("div");
    info.className = "as-player-info";

    const name = document.createElement("span");
    name.className   = "as-player-name";
    name.textContent = player.name;

    const meta = document.createElement("span");
    meta.className   = "as-player-meta";
    meta.textContent = `${player.role} · ${player.team_short_code} · ${player.credit} Cr`;

    info.append(name, meta);

    const ctrls = document.createElement("div");
    ctrls.className = "as-controls";

    if (isInXI && !dailyState.isLocked) {
        const cBtn = document.createElement("button");
        cBtn.className   = `as-role-btn ${dailyState.captainId === player.id ? "active-c" : ""}`;
        cBtn.textContent = "C";
        cBtn.onclick     = () => toggleDailyRole(player.id, "C");

        const vcBtn = document.createElement("button");
        vcBtn.className   = `as-role-btn ${dailyState.vcId === player.id ? "active-vc" : ""}`;
        vcBtn.textContent = "VC";
        vcBtn.onclick     = () => toggleDailyRole(player.id, "VC");

        ctrls.append(cBtn, vcBtn);
    } else if (isInXI && dailyState.isLocked) {
        if (dailyState.captainId === player.id) {
            const b = document.createElement("span"); b.className = "as-badge-c"; b.textContent = "C"; ctrls.appendChild(b);
        }
        if (dailyState.vcId === player.id) {
            const b = document.createElement("span"); b.className = "as-badge-vc"; b.textContent = "VC"; ctrls.appendChild(b);
        }
    }

    if (!dailyState.isLocked) {
        const actionBtn = document.createElement("button");
        actionBtn.className   = `as-action-btn ${isSelected ? "remove" : "add"}`;
        actionBtn.textContent = isSelected ? "−" : "+";
        actionBtn.onclick     = () => toggleDailyPlayer(player.id);
        ctrls.appendChild(actionBtn);
    }

    card.append(av, info, ctrls);
    return card;
}

function calcDailyStats() {
    const sel     = dailyState.selected;
    const roles   = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
    let overseas  = 0, credits = 0;
    for (const p of sel) {
        roles[p.role] = (roles[p.role] || 0) + 1;
        if (p.category === "overseas") overseas++;
        credits += Number(p.credit);
    }
    return { count: sel.length, overseas, credits, roles };
}

function isDailyValid(stats) {
    return stats.count === 11
        && dailyState.captainId
        && dailyState.vcId
        && stats.roles.WK >= 1
        && stats.roles.BAT >= 3
        && stats.roles.AR >= 1
        && stats.roles.BOWL >= 3
        && stats.overseas <= 4
        && stats.credits <= 100.05;
}

function toggleDailyPlayer(id) {
    const idx = dailyState.selected.findIndex(p => p.id === id);
    if (idx > -1) {
        dailyState.selected.splice(idx, 1);
        if (dailyState.captainId === id) dailyState.captainId = null;
        if (dailyState.vcId === id)      dailyState.vcId      = null;
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
    if (!isDailyValid(stats)) {
        showToast("Team incomplete — check all requirements.", "error");
        return;
    }

    const ok = await showConfirm("Lock Daily XI?", "You can't change it once locked.");
    if (!ok) return;

    const btn = document.getElementById("dailySaveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    try {
        const { data: saved, error } = await supabase
            .from("user_daily_teams")
            .insert([{
                user_id:         currentUserId,
                match_id:        dailyState.match.id,
                tournament_id:   currentTournamentId,
                captain_id:      dailyState.captainId,
                vice_captain_id: dailyState.vcId,
                total_credits:   stats.credits,
            }])
            .select()
            .single();

        if (error) throw error;

        await supabase.from("user_daily_team_players").insert(
            dailyState.selected.map(p => ({
                user_daily_team_id: saved.id,
                player_id: p.id,
            }))
        );

        dailyState.isLocked = true;
        showToast("Daily XI locked! 🔒 Good luck!", "success");
        delete document.getElementById("panel-daily")?.dataset.loaded;
        await loadDailyPanel();

    } catch (err) {
        console.error("Daily save error:", err);
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

    const title = document.createElement("p");
    title.className   = "as-section-label";
    title.textContent = "Daily Match Leaderboard";
    section.appendChild(title);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Rankings appear after the match.";
        section.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const el = document.createElement("div");
        el.className = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;
        el.innerHTML = `
            <span class="as-lb-rank">#${row.rank}</span>
            <span class="as-lb-name">${row.team_name || "Expert"}</span>
            <span class="as-lb-pts">${row.total_daily_points} pts</span>`;
        section.appendChild(el);
    });
}

async function loadDailyAvgRank() {
    const section = document.getElementById("dailyAvgRank");
    if (!section) return;

    const { data: rows } = await supabase
        .from("daily_season_avg_rank_view")
        .select("team_name, avg_rank, matches_played, user_id")
        .order("avg_rank", { ascending: true })
        .limit(10);

    section.innerHTML = "";

    const title = document.createElement("p");
    title.className   = "as-section-label";
    title.textContent = "Season Average Rank";
    section.appendChild(title);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Appears after your first daily match.";
        section.appendChild(empty);
        return;
    }

    rows.forEach((row, i) => {
        const el = document.createElement("div");
        el.className = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;
        el.innerHTML = `
            <span class="as-lb-rank">#${i + 1}</span>
            <span class="as-lb-name">${row.team_name || "Expert"}</span>
            <span class="as-lb-pts">Avg #${Number(row.avg_rank).toFixed(1)} · ${row.matches_played}M</span>`;
        section.appendChild(el);
    });
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function showPanelSpinner(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.innerHTML = `<div class="panel-spinner"></div>`;
}