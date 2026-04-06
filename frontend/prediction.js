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

    // Hide skeleton once all data is loaded
    document.getElementById("skeletonScreen")?.classList.add("hidden");
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

/* ─── TOAST & CONFIRM ────────────────────────────────────────────────────── */
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

function showPanelSpinner(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.innerHTML = `<div class="panel-spinner"></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOTTOM SHEET & PLAYER DETAILS (Unchanged)
═══════════════════════════════════════════════════════════════════════════ */
function openBottomSheet(contentFn) {
    document.getElementById("funBottomSheet")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "funBottomSheet";
    overlay.className = "fun-sheet-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) closeBottomSheet(); };

    const sheet = document.createElement("div");
    sheet.className = "fun-sheet";
    const handle = document.createElement("div");
    handle.className = "fun-sheet-handle";
    const closeBtn = document.createElement("button");
    closeBtn.className = "fun-sheet-close";
    closeBtn.textContent = "✕";
    closeBtn.onclick = closeBottomSheet;

    const body = document.createElement("div");
    body.className = "fun-sheet-body";
    body.innerHTML = `<div class="sheet-spinner"></div>`;

    sheet.append(handle, closeBtn, body);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add("open"));
    contentFn(body);
}

function closeBottomSheet() {
    const overlay = document.getElementById("funBottomSheet");
    if (!overlay) return;
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 320);
}

async function openPlayerDetail(playerId, matchId) {
    openBottomSheet(async (body) => {
        const { data: stats } = await supabase
            .from("player_match_stats")
            .select(`*, player:players!inner(name, role, photo_url, team:real_teams!inner(short_code))`)
            .eq("player_id", playerId)
            .eq("match_id", matchId)
            .maybeSingle();

        body.innerHTML = "";
        if (!stats) {
            body.innerHTML = `<p class="sheet-empty">No stats found for this player.</p>`;
            return;
        }

        const p = stats.player;
        const photo = p?.photo_url ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";

        const hdr = document.createElement("div");
        hdr.className = "sheet-player-hdr";
        hdr.innerHTML = `
            <div class="sheet-avatar" style="background-image: url('${photo}')"></div>
            <div>
                <div class="sheet-player-name">${p?.name || "Unknown"}</div>
                <div class="sheet-player-meta">${p?.role || "—"} · ${p?.team?.short_code || "TBA"}</div>
                <div class="sheet-player-pts">${stats.fantasy_points} pts this match</div>
            </div>`;
        body.appendChild(hdr);

        const chipsWrap = document.createElement("div");
        chipsWrap.className = "sheet-chips-wrap";
        chipsWrap.innerHTML = `<p class="sheet-section-label">Points Breakdown</p>`;
        
        const grid = document.createElement("div");
        grid.className = "sheet-chips-grid";
        const chips = buildStatChips(stats);
        if (chips.length) chips.forEach(c => grid.appendChild(c));
        else grid.innerHTML = `<span class="stat-tag empty">Played — no scorable actions</span>`;

        chipsWrap.appendChild(grid);
        body.appendChild(chipsWrap);
    });
}

async function openTeamScout(userId, matchId) {
    openBottomSheet(async (body) => {
        const [teamRes, ptsRes, statsRes] = await Promise.all([
            supabase.from("user_match_teams").select(`
                id, captain_id, vice_captain_id, user_profiles(team_name, team_photo_url),
                user_match_team_players(player_id, players(id, name, role, photo_url, team:real_teams!inner(short_code)))
            `).eq("user_id", userId).eq("match_id", matchId).maybeSingle(),
            supabase.from("user_match_points").select("total_points").eq("user_id", userId).eq("match_id", matchId).maybeSingle(),
            supabase.from("player_match_stats").select("player_id, fantasy_points, is_player_of_match").eq("match_id", matchId),
        ]);

        body.innerHTML = "";
        const team = teamRes.data;
        if (!team) { body.innerHTML = `<p class="sheet-empty">This user didn't have a team for this match.</p>`; return; }

        const statsMap = {};
        (statsRes.data || []).forEach(s => { statsMap[s.player_id] = s; });

        const profile = team.user_profiles;
        const photo = profile?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url).data.publicUrl : "images/default-avatar.png";

        body.innerHTML += `
            <div class="sheet-team-hdr">
                <div class="sheet-team-avatar" style="background-image: url('${photo}')"></div>
                <div>
                    <div class="sheet-player-name">${profile?.team_name || "Expert"}</div>
                    <div class="sheet-player-pts">${ptsRes.data?.total_points || 0} pts this match</div>
                </div>
            </div>
            <p class="sheet-section-label">Locked Team</p>`;

        const players = (team.user_match_team_players || []).map(r => ({
            ...r.players,
            pts: statsMap[r.player_id]?.fantasy_points || 0,
            isC: r.player_id === team.captain_id,
            isVC: r.player_id === team.vice_captain_id,
            isPOM: statsMap[r.player_id]?.is_player_of_match || false,
        })).sort((a, b) => (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) || (b.pts - a.pts));

        players.forEach(p => {
            const pPhoto = p.photo_url ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl : "";
            const row = document.createElement("div");
            row.className = "sheet-player-row";
            row.innerHTML = `
                <div class="sheet-row-avatar" style="background-image: url('${pPhoto}')"></div>
                <div class="sheet-row-info">
                    <div class="sheet-row-name-row">
                        <span class="sheet-row-name">${p.name || "Unknown"}</span>
                        ${p.isC ? `<span class="sheet-role-badge c">C</span>` : p.isVC ? `<span class="sheet-role-badge vc">VC</span>` : ""}
                    </div>
                    <span class="sheet-row-meta">${p.role} · ${p.team?.short_code || "TBA"}</span>
                </div>
                <div class="sheet-row-pts" style="${p.isPOM ? 'color:var(--fun-cyan)' : ''}">${p.isPOM ? "🌟 " : ""}${p.pts} pts</div>
            `;
            body.appendChild(row);
        });
    });
}

function buildStatChips(m) {
    const chips = [];
    const chip = (txt, cls) => { const el = document.createElement("span"); el.className = `stat-tag ${cls}`; el.textContent = txt; return el; };
    if (m.runs > 0) chips.push(chip(`🏏 ${m.runs}${m.balls ? ` (${m.balls}b)` : ""}`, "bat"));
    if (m.fours > 0 || m.sixes > 0) chips.push(chip(`🎯 ${m.fours||0}×4 ${m.sixes||0}×6`, "boundary"));
    if (m.sr_points) chips.push(chip(`⚡ SR ${m.sr_points > 0 ? "+" : ""}${m.sr_points}`, "bonus"));
    if (m.milestone_points > 0) chips.push(chip(`🏆 +${m.milestone_points}`, "bonus"));
    if (m.duck_penalty < 0) chips.push(chip(`🦆 Duck ${m.duck_penalty}`, "penalty"));
    if (m.wickets > 0) chips.push(chip(`🎳 ${m.wickets}W`, "bowl"));
    if (m.maidens > 0) chips.push(chip(`🧱 ${m.maidens} Maiden${m.maidens > 1 ? "s" : ""}`, "bowl"));
    if (m.er_points) chips.push(chip(`📉 Econ ${m.er_points > 0 ? "+" : ""}${m.er_points}`, "bonus"));
    if (m.catches > 0) chips.push(chip(`🧤 ${m.catches}C`, "field"));
    if (m.stumpings > 0) chips.push(chip(`🏃 ${m.stumpings}St`, "field"));
    const ro = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (ro > 0) chips.push(chip(`🎯 ${ro}RO`, "field"));
    if (m.is_player_of_match) chips.push(chip("🏆 POM +20", "gold"));
    return chips;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PREDICT PANEL & PODIUMS (Unchanged)
═══════════════════════════════════════════════════════════════════════════ */
async function loadPredictionCard() {
    const [pointsRes, streakRes, winnersRes] = await Promise.allSettled([        
        supabase.from("user_tournament_points").select("prediction_stars").eq("user_id", currentUserId).eq("tournament_id", currentTournamentId).maybeSingle(),
        supabase.from("user_predictions").select("is_correct").eq("user_id", currentUserId).order("created_at", { ascending: false }).limit(20),
        supabase.from("user_tournament_points").select("prediction_stars, user_profiles(team_name)").eq("tournament_id", currentTournamentId).gte("prediction_stars", 10).order("prediction_stars", { ascending: false }).limit(5)
    ]);

    const stars = pointsRes.value?.data?.prediction_stars || 0;
    const starEl = document.getElementById("userStarCount");
    if (starEl) starEl.textContent = `${stars} ⭐`;

    let streak = 0;
    if (streakRes.value?.data) {
        for (const p of streakRes.value.data) {
            if (p.is_correct) streak++;
            else break;
        }
    }

    const recentWinners = winnersRes.value?.data || [];

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

    const [existingRes, totalRes, teamARes, teamBRes] = await Promise.all([
        supabase.from("user_predictions").select("predicted_winner_id").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle(),
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", currentMatchId),
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", currentMatchId).eq("predicted_winner_id", match.team_a.id),
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", currentMatchId).eq("predicted_winner_id", match.team_b.id),
    ]);

    const existing = existingRes.data;
    const totalPreds = totalRes.count || 0;
    const pctA = totalPreds > 0 ? Math.round((teamARes.count / totalPreds) * 100) : null;
    const pctB = totalPreds > 0 ? Math.round((teamBRes.count / totalPreds) * 100) : null;

    renderPredictionUI(match, existing?.predicted_winner_id, {
        stars, streak, recentWinners, isLocked: !!existing?.predicted_winner_id, totalPreds,
        split: pctA !== null ? { a: pctA, b: pctB, aName: match.team_a.short_code, bName: match.team_b.short_code } : null,
    });
}

function renderPredictionUI(match, predictedWinnerId, meta) {
    const container = document.getElementById("predictionArea");
    if (!container) return;

    const bucket = supabase.storage.from("team-logos");
    const logoA = match.team_a.photo_name ? bucket.getPublicUrl(match.team_a.photo_name).data.publicUrl : "images/default-team.png";
    const logoB = match.team_b.photo_name ? bucket.getPublicUrl(match.team_b.photo_name).data.publicUrl : "images/default-team.png";

    container.replaceChildren();

    const fomoStrip = document.createElement("div");
    fomoStrip.className = "fomo-strip";
    fomoStrip.innerHTML = `
        <div class="fomo-pill ${meta.streak >= 3 ? "fomo-hot" : ""}">${meta.streak > 0 ? `🔥 ${meta.streak} correct in a row` : `⭐ ${meta.stars} stars total`}</div>
        <div class="fomo-pill fomo-progress">${10 - (meta.stars % 10)} star${(10 - (meta.stars % 10)) !== 1 ? "s" : ""} to free sub</div>
    `;
    container.appendChild(fomoStrip);

    const pct = ((meta.stars % 10) / 10) * 100;
    const barWrap = document.createElement("div");
    barWrap.className = "star-bar-wrap";
    barWrap.innerHTML = `<div class="star-bar-track"><div class="star-bar-fill" style="width:${pct}%"></div></div><div class="star-bar-label">${meta.stars % 10}/10 ⭐ toward free sub</div>`;
    container.appendChild(barWrap);

    if (meta.recentWinners.length > 0) {
        const winnersWrap = document.createElement("div");
        winnersWrap.className = "winners-strip";
        winnersWrap.innerHTML = `<span class="winners-label">🎁 Recent free subs:</span>` + meta.recentWinners.map(w => `<span class="winners-pill">${w.user_profiles?.team_name || "Expert"}</span>`).join("");
        container.appendChild(winnersWrap);
    }

    const hdr = document.createElement("div");
    hdr.className = "pred-header";
    hdr.innerHTML = `<p class="pred-question">Who will win?</p><p class="pred-hook">Correct = 1 ⭐ · Every 10 stars = 1 free sub 🎁</p>`;
    const guruBtn = document.createElement("button");
    guruBtn.className = "icon-btn";
    guruBtn.textContent = "🏆 Prediction Masters";
    guruBtn.onclick = () => showGuruLeaderboard();
    hdr.appendChild(guruBtn);
    container.appendChild(hdr);

    const vsWrap = document.createElement("div");
    vsWrap.className = "team-vs-container";

    const makeTeamCard = (team, logoUrl, pct) => {
        const card = document.createElement("div");
        card.className = `team-card ${predictedWinnerId === team.id ? "selected" : ""}`;
        if (!meta.isLocked) card.onclick = () => savePrediction(team.id);
        card.innerHTML = `<img src="${logoUrl}" alt="${team.short_code}"><span>${team.short_code}</span>`;
        if (meta.isLocked && pct !== null) card.innerHTML += `<span class="community-pct">${pct}% picked</span>`;
        return card;
    };

    const vs = document.createElement("div");
    vs.className = "vs-badge";
    vs.textContent = "VS";

    vsWrap.append(makeTeamCard(match.team_a, logoA, meta.split?.a ?? null), vs, makeTeamCard(match.team_b, logoB, meta.split?.b ?? null));
    container.appendChild(vsWrap);

    if (meta.totalPreds > 0) {
        const totalEl = document.createElement("p");
        totalEl.className = "pred-total";
        totalEl.textContent = `${meta.totalPreds} expert${meta.totalPreds !== 1 ? "s" : ""} have predicted`;
        container.appendChild(totalEl);
    }

    if (meta.isLocked) {
        const lockMsg = document.createElement("div");
        lockMsg.className = "locked-msg";
        lockMsg.textContent = "Prediction locked 🔒";
        container.appendChild(lockMsg);
    }
}

async function savePrediction(teamId) {
    const ok = await showConfirm("Lock Prediction?", "You cannot change this later.");
    if (!ok) return;

    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId, match_id: currentMatchId, predicted_winner_id: teamId,
    });

    if (error) { showToast("Failed to save prediction.", "error"); return; }
    showToast("Prediction locked! 🔒", "success");
    loadPredictionCard();
}

async function loadPostMatchSummary() {
    const { data: lastMatch } = await supabase.from("matches").select("id, winner_id, team_a:real_teams!team_a_id(id, short_code), team_b:real_teams!team_b_id(id, short_code)").eq("points_processed", true).order("actual_start_time", { ascending: false }).limit(1).maybeSingle();
    if (!lastMatch?.winner_id) return;

    const [totalRes, correctRes] = await Promise.all([
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", lastMatch.id),
        supabase.from("user_predictions").select("*", { count: "exact", head: true }).eq("match_id", lastMatch.id).eq("predicted_winner_id", lastMatch.winner_id),
    ]);

    const total = totalRes.count || 0;
    const correct = correctRes.count || 0;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const winner = lastMatch.winner_id === lastMatch.team_a.id ? lastMatch.team_a.short_code : lastMatch.team_b.short_code;

    const el = document.getElementById("postMatchSummary");
    if (!el) return;

    el.innerHTML = `<div class="summary-card"><p class="summary-title">${winner} won!</p><p class="summary-body">${pct}% of experts predicted this correctly.</p></div>`;
}

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

    const [playersRes, usersRes, viewsRes] = await Promise.all([
      supabase
        .from("player_match_stats")
        .select("fantasy_points, player_id, players(name, photo_url)")
        .eq("match_id", lastMatch.id)
        .order("fantasy_points", { ascending: false })
        .limit(3),
      supabase
        .from("user_match_points")
        .select("total_points, user_id, user_profiles(team_name, team_photo_url)")
        .eq("match_id", lastMatch.id)
        .order("total_points", { ascending: false })
        .limit(3),
      supabase
        .from("team_profile_views")
        .select("viewed_user_id, user_profiles!viewed_user_id(team_name, team_photo_url)")
        .eq("match_id", lastMatch.id)
        .neq("viewer_user_id", "viewed_user_id")
    ]);

    renderPodium(playersRes.data, "playerPodium", "player", lastMatch.id);
    renderPodium(usersRes.data,   "userPodium",   "user",   lastMatch.id);
    renderViewsPodium(viewsRes.data, lastMatch.id);

  } catch (err) {
    console.error("Podium error:", err);
  }
}

function renderPodium(data, containerId, type, matchId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data?.length) { container.innerHTML = `<p class="empty-msg">Awaiting results…</p>`; return; }

    const order = [data[1], data[0], data[2]].filter(Boolean);
    container.innerHTML = "";

    order.forEach(item => {
        const rank = item === data[0] ? 1 : item === data[1] ? 2 : 3;
        let name, pts, photoPath, clickHandler;

        if (type === "player") {
            name = item.players?.name?.split(" ").pop() || "Unknown";
            pts = `${item.fantasy_points} pts`;
            photoPath = item.players?.photo_url ? supabase.storage.from("player-photos").getPublicUrl(item.players.photo_url).data.publicUrl : "images/default-avatar.png";
            const pid = item.player_id;
            clickHandler = () => openPlayerDetail(pid, matchId);
        } else {
            name = item.user_profiles?.team_name || "Unknown";
            pts = `${item.total_points} pts`;
            photoPath = item.user_profiles?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl : "images/default-avatar.png";
            const uid = item.user_id;
            clickHandler = () => openTeamScout(uid, matchId);
        }

        const itemEl = document.createElement("div");
        itemEl.className = `podium-item rank-${rank}`;
        itemEl.onclick = clickHandler;

        const nameEl = document.createElement("div");
        nameEl.className = "podium-name";
        nameEl.textContent = name;

        const wrap = document.createElement("div");
        wrap.className = "podium-avatar-wrapper";
        const img = document.createElement("img");
        img.src = photoPath;
        img.className = "podium-img";
        const badge = document.createElement("div");
        badge.className = "rank-badge";
        badge.textContent = String(rank);
        const tapHint = document.createElement("div");
        tapHint.className = "podium-tap-hint";
        tapHint.textContent = "👆";
        wrap.append(img, badge);

        const ptsEl = document.createElement("div");
        ptsEl.className = "podium-pts";
        ptsEl.textContent = pts;

        if (type === "user") applyRankFlair(img, nameEl, rank);

        itemEl.append(nameEl, wrap, ptsEl, tapHint);
        container.appendChild(itemEl);
    });
}

function renderViewsPodium(data, matchId) {
  const container = document.getElementById("viewsPodium");
  if (!container) return;

  if (!data?.length) {
    container.innerHTML = `<p class="empty-msg">No scouts yet</p>`;
    return;
  }

  // Count views per user
  const countMap = {};
  data.forEach(row => {
    const uid = row.viewed_user_id;
    if (!countMap[uid]) {
      countMap[uid] = {
        user_id:   uid,
        views:     0,
        team_name: row.user_profiles?.team_name  || "Expert",
        photo_url: row.user_profiles?.team_photo_url || null,
      };
    }
    countMap[uid].views++;
  });

  const top3 = Object.values(countMap)
    .sort((a, b) => b.views - a.views)
    .slice(0, 3);

  // Podium order: 2nd, 1st, 3rd
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);

  container.innerHTML = "";
  order.forEach(item => {
    const rank = top3.indexOf(item) + 1;

    const photoPath = item.photo_url
      ? supabase.storage.from("team-avatars").getPublicUrl(item.photo_url).data.publicUrl
      : "images/default-avatar.png";

    const itemEl  = document.createElement("div");
    itemEl.className = `podium-item rank-${rank}`;
    itemEl.onclick = () => openTeamScout(item.user_id, matchId);

    const nameEl = document.createElement("div");
    nameEl.className   = "podium-name";
    nameEl.textContent = item.team_name;

    const wrap  = document.createElement("div");
    wrap.className = "podium-avatar-wrapper";

    const img   = document.createElement("img");
    img.src       = photoPath;
    img.className = "podium-img";

    const badge = document.createElement("div");
    badge.className   = "rank-badge";
    badge.textContent = String(rank);

    const tapHint = document.createElement("div");
    tapHint.className   = "podium-tap-hint";
    tapHint.textContent = "👁️";

    wrap.append(img, badge);

    const ptsEl = document.createElement("div");
    ptsEl.className   = "podium-pts";
    ptsEl.textContent = `${item.views} views`;

    applyRankFlair(img, nameEl, rank);

    itemEl.append(nameEl, wrap, ptsEl, tapHint);
    container.appendChild(itemEl);
  });
}

window.showGuruLeaderboard = async () => {
    const { data: top100 } = await supabase.from("user_tournament_points").select("prediction_stars, user_profiles(team_name, team_photo_url)").eq("tournament_id", currentTournamentId).order("prediction_stars", { ascending: false }).order("updated_at", { ascending: true }).limit(100);
    const overlay = document.getElementById("guruModal");
    const list    = document.getElementById("guruList");
    if (!overlay || !list) return;

    list.innerHTML = "";
    (top100 || []).forEach((g, i) => {
        const rank = i + 1;
        const photo = g.user_profiles?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(g.user_profiles.team_photo_url).data.publicUrl : "images/default-avatar.png";
        const row = document.createElement("div");
        row.className = "guru-row";
        const rankEl = document.createElement("div");
        rankEl.className = "guru-rank";
        rankEl.textContent = `#${rank}`;
        const avatarEl = document.createElement("img");
        avatarEl.src = photo;
        avatarEl.className = "guru-avatar";
        const nameEl = document.createElement("div");
        nameEl.className = "guru-name";
        nameEl.textContent = g.user_profiles?.team_name || "Expert";
        const starsEl = document.createElement("div");
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
   UNIFIED TEAM BUILDER ENGINE (Based on Edit Team Page)
═══════════════════════════════════════════════════════════════════════════ */

function getEditorHTML(idPrefix) {
    return `
    <div class="team-builder-ui">
        <div class="sticky-controls">
            <div class="premium-progress">
                <div id="${idPrefix}-dots" class="team-dots-row"></div>
                <div class="progress-labels">
                    <div class="dashboard-item">
                        <i class="di-icon fas fa-user"></i>
                        <span id="${idPrefix}-count">0</span><span class="di-max">/11</span>
                    </div>
                    <div class="dashboard-item">
                        <i class="di-icon fas fa-plane"></i>
                        <span id="${idPrefix}-os">0/4</span>
                    </div>
                    <div class="dashboard-item">
                        <i class="di-icon fas fa-coins"></i>
                        <span id="${idPrefix}-cr">100</span><span class="di-max"> left</span>
                    </div>
                </div>
            </div>

            <div class="view-tabs">
                <button class="toggle-btn" id="${idPrefix}-tab-myxi">My XI</button>
                <button class="toggle-btn active" id="${idPrefix}-tab-pool">Edit Squad</button>
            </div>

            <div class="search-filter-wrapper" id="${idPrefix}-sf-wrap" style="padding-bottom:10px;">
                <div class="role-search-row">
                    <div class="role-tabs-container">
                        <div class="role-tab active" data-role="WK">WK <span id="${idPrefix}-cnt-WK">0</span></div>
                        <div class="role-tab" data-role="BAT">BAT <span id="${idPrefix}-cnt-BAT">0</span></div>
                        <div class="role-tab" data-role="AR">AR <span id="${idPrefix}-cnt-AR">0</span></div>
                        <div class="role-tab" data-role="BOWL">BOWL <span id="${idPrefix}-cnt-BOWL">0</span></div>
                    </div>
                </div>
                <div style="margin-top: 12px; padding: 0 16px;">
                    <input type="text" id="${idPrefix}-search" class="tb-search-input" placeholder="Search player or team..." autocomplete="off" spellcheck="false">
                </div>
            </div>
        </div>

        <div class="content-area" style="padding: 10px 0; background: transparent;">
            <div id="${idPrefix}-view-myxi" class="view-mode">
                <div id="${idPrefix}-list-myxi" class="player-list"></div>
            </div>
            <div id="${idPrefix}-view-pool" class="view-mode active">
                <div id="${idPrefix}-list-pool" class="player-list"></div>
            </div>
        </div>

        <div class="save-bar">
            <div class="save-hint" id="${idPrefix}-hint" style="text-align:center; padding:5px 0;"></div>
            <button id="${idPrefix}-save" class="save-btn" disabled>NEXT →</button>
        </div>
    </div>
    `;
}

function calcTeamStats(selected) {
    const roles = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
    let overseas = 0, credits = 0;
    for (const p of selected) {
        roles[p.role] = (roles[p.role] || 0) + 1;
        if (p.category === "overseas") overseas++;
        credits += Number(p.credit);
    }
    return { count: selected.length, overseas, credits, roles };
}

function renderEditorList(containerId, isMyXi, state, idPrefix) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const stats = calcTeamStats(state.selected);
    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    const neededSlots = Object.keys(minReq).reduce((acc, r) => acc + Math.max(0, minReq[r] - stats.roles[r]), 0);

    let list = [];
    if (isMyXi) {
        list = [...state.selected].sort((a, b) => {
            if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
            return Number(b.credit) - Number(a.credit);
        });
    } else {
        const s = state.filters.search.toLowerCase();
        list = state.allPlayers.filter(p => {
            if (s && !p.name.toLowerCase().includes(s) && !(p.team_short_code || "").toLowerCase().includes(s)) return false;
            if (!state.filters.search && p.role !== state.filters.role) return false;
            return true;
        }).sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit);
    }

    const bucket = supabase.storage.from("player-photos");
    const frag = document.createDocumentFragment();

    if (list.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-pool-msg";
        empty.style.padding = "20px";
        empty.textContent = isMyXi ? "Select players from the Edit Squad tab." : "No players match your filters.";
        frag.appendChild(empty);
        container.innerHTML = "";
        container.appendChild(frag);
        return;
    }

    for (const p of list) {
        const isSelected = state.selected.some(sp => sp.id === p.id);
        const tooExpensive = p.credit > (100 - stats.credits + (isSelected ? p.credit : 0));
        const overseasLimit = stats.overseas >= 4 && p.category === "overseas" && !isSelected;
        const roleLocked = !isSelected && (11 - stats.count) <= neededSlots && (minReq[p.role] - stats.roles[p.role]) <= 0;
        const isDisabled = !isMyXi && !isSelected && (stats.count >= 11 || tooExpensive || overseasLimit || roleLocked);

        const photoUrl = p.photo_url ? bucket.getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";
        const catBadge = p.category === "overseas" ? '<span class="cat-badge overseas">✈</span>' : p.category === "uncapped" ? '<span class="cat-badge uncapped">U</span>' : "";

        const card = document.createElement("div");
        card.className = `player-card ${isSelected ? "selected" : ""} ${isDisabled ? "player-faded" : ""}`;
        card.dataset.id = p.id;

        card.innerHTML = `
        <div class="avatar-col" onclick="openPlayerProfile('${p.id}')">
            <div class="avatar-wrap">
                <img src="${photoUrl}" class="player-avatar" loading="lazy">
                ${catBadge}
            </div>
            <span class="p-team-badge">${p.team_short_code}</span>
        </div>
        <div class="player-info">
            <strong class="p-name">${p.name}</strong>
            <span class="p-meta">${p.credit} Cr</span>
        </div>
        <div class="controls">
            ${isMyXi ? `
                <button class="role-btn ${state.captainId === p.id ? "active-c" : ""}" data-action="C" data-id="${p.id}">C</button>
                <button class="role-btn ${state.vcId === p.id ? "active-vc" : ""}" data-action="VC" data-id="${p.id}">VC</button>
            ` : ""}
            <button class="action-btn ${isSelected ? "remove" : "add"}" data-action="toggle" data-id="${p.id}" ${isDisabled ? "disabled" : ""}>
                ${isSelected ? "−" : "+"}
            </button>
        </div>`;

        frag.appendChild(card);
    }
    container.innerHTML = "";
    container.appendChild(frag);
}

function updateBuilderUI(state, idPrefix) {
    const stats = calcTeamStats(state.selected);
    
    document.getElementById(`${idPrefix}-count`).textContent = stats.count;
    document.getElementById(`${idPrefix}-os`).textContent = `${stats.overseas}/4`;
    
    const crEl = document.getElementById(`${idPrefix}-cr`);
    crEl.textContent = (100 - stats.credits).toFixed(1);
    crEl.closest(".dashboard-item")?.classList.toggle("negative", (100 - stats.credits) < 5);

    const dotsContainer = document.getElementById(`${idPrefix}-dots`);
    if (dotsContainer) {
        dotsContainer.innerHTML = "";
        for (let i = 0; i < 11; i++) {
            const dot = document.createElement("div");
            dot.className = "team-dot";
            if (state.selected[i]) {
                dot.classList.add("filled", "no-logo");
                dot.textContent = state.selected[i].team_short_code?.[0] || "?";
            } else if (i === 10) {
                dot.classList.add("no-logo", "dot-eleven");
                dot.textContent = "11";
            }
            dotsContainer.appendChild(dot);
        }
    }

    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    document.querySelectorAll(`#${idPrefix}-sf-wrap .role-tab`).forEach(tab => {
        const role = tab.dataset.role;
        const count = stats.roles[role] || 0;
        const min = minReq[role] || 0;
        const badge = tab.querySelector("span");
        if (badge) badge.textContent = count;
        tab.classList.remove("req-met", "req-unmet");
        if (count >= min) tab.classList.add("req-met");
        else tab.classList.add("req-unmet");
    });

    renderEditorList(`${idPrefix}-list-myxi`, true, state, idPrefix);
    renderEditorList(`${idPrefix}-list-pool`, false, state, idPrefix);

    const btn = document.getElementById(`${idPrefix}-save`);
    const hint = document.getElementById(`${idPrefix}-hint`);
    
    if (state.isLocked) {
        if (btn) { btn.disabled = true; btn.textContent = "LOCKED"; }
        if (hint) hint.textContent = "Match started. Team locked.";
        return;
    }

    const checks = [
        [state.saving, "SAVING...", ""],
        [stats.count < 11, "NEXT →", `Add ${11 - stats.count} more players`],
        [!state.captainId || !state.vcId, "NEXT →", "Select Captain & Vice-Captain"],
        [stats.roles.WK < 1, "NEXT →", "Need min 1 WK"],
        [stats.roles.BAT < 3, "NEXT →", "Need min 3 BAT"],
        [stats.roles.AR < 1, "NEXT →", "Need min 1 AR"],
        [stats.roles.BOWL < 3, "NEXT →", "Need min 3 BOWL"],
        [stats.overseas > 4, "NEXT →", "Max 4 overseas"],
        [stats.credits > 100.05, "NEXT →", "Credits exceeded"]
    ];

    let passed = true;
    for (const [cond, lbl, hnt] of checks) {
        if (cond) {
            if (btn) { btn.disabled = true; btn.textContent = lbl; }
            if (hint) hint.textContent = hnt;
            passed = false;
            break;
        }
    }

    if (passed) {
        if (btn) { btn.disabled = false; btn.textContent = "CONFIRM & SAVE"; }
        if (hint) hint.textContent = "Ready to save!";
    }

    const allMet = stats.roles.WK >= 1 && stats.roles.BAT >= 3 && stats.roles.AR >= 1 && stats.roles.BOWL >= 3;
    if (stats.count === 11 && allMet && (!state.captainId || !state.vcId)) {
        switchBuilderTab(idPrefix, 'myxi');
    }
}

function switchBuilderTab(idPrefix, mode) {
    document.getElementById(`${idPrefix}-tab-myxi`).classList.toggle("active", mode === "myxi");
    document.getElementById(`${idPrefix}-tab-pool`).classList.toggle("active", mode === "pool");
    document.getElementById(`${idPrefix}-view-myxi`).classList.toggle("active", mode === "myxi");
    document.getElementById(`${idPrefix}-view-pool`).classList.toggle("active", mode === "pool");
    const sfWrap = document.getElementById(`${idPrefix}-sf-wrap`);
    if (sfWrap) sfWrap.style.display = mode === "myxi" ? "none" : "block";
}

function bindBuilderListeners(state, idPrefix, onSave) {
    document.getElementById(`${idPrefix}-list-pool`)?.addEventListener("click", e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn || btn.disabled) return;
        if (btn.dataset.action === "toggle") {
            const id = btn.dataset.id;
            const idx = state.selected.findIndex(p => p.id === id);
            if (idx > -1) {
                state.selected.splice(idx, 1);
                if (state.captainId === id) state.captainId = null;
                if (state.vcId === id) state.vcId = null;
            } else if (state.selected.length < 11) {
                const p = state.allPlayers.find(p => p.id === id);
                if (p) state.selected.push(p);
            }
            updateBuilderUI(state, idPrefix);
        }
    });

    document.getElementById(`${idPrefix}-list-myxi`)?.addEventListener("click", e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn || btn.disabled) return;
        const id = btn.dataset.id;
        if (btn.dataset.action === "toggle") {
            const idx = state.selected.findIndex(p => p.id === id);
            if (idx > -1) {
                state.selected.splice(idx, 1);
                if (state.captainId === id) state.captainId = null;
                if (state.vcId === id) state.vcId = null;
            }
        } else if (btn.dataset.action === "C") {
            state.captainId = state.captainId === id ? null : id;
            if (state.captainId === state.vcId) state.vcId = null;
        } else if (btn.dataset.action === "VC") {
            state.vcId = state.vcId === id ? null : id;
            if (state.vcId === state.captainId) state.captainId = null;
        }
        updateBuilderUI(state, idPrefix);
    });

    document.getElementById(`${idPrefix}-tab-myxi`).onclick = () => switchBuilderTab(idPrefix, 'myxi');
    document.getElementById(`${idPrefix}-tab-pool`).onclick = () => switchBuilderTab(idPrefix, 'pool');

    document.querySelectorAll(`#${idPrefix}-sf-wrap .role-tab`).forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(`#${idPrefix}-sf-wrap .role-tab`).forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            state.filters.search = "";
            const sInput = document.getElementById(`${idPrefix}-search`);
            if (sInput) sInput.value = "";
            updateBuilderUI(state, idPrefix);
        };
    });

    const sInput = document.getElementById(`${idPrefix}-search`);
    if (sInput) {
        let st;
        sInput.oninput = e => {
            clearTimeout(st);
            st = setTimeout(() => {
                const term = e.target.value.toLowerCase().trim();
                state.filters.search = term;
                if (term) {
                    const match = state.allPlayers.find(p => p.name.toLowerCase().includes(term) || (p.team_short_code || "").toLowerCase().includes(term));
                    if (match && match.role !== state.filters.role) {
                        state.filters.role = match.role;
                        document.querySelectorAll(`#${idPrefix}-sf-wrap .role-tab`).forEach(t => {
                            t.classList.toggle("active", t.dataset.role === match.role);
                        });
                    }
                }
                updateBuilderUI(state, idPrefix);
            }, 250);
        };
    }

    document.getElementById(`${idPrefix}-save`).onclick = onSave;
}

function renderPitchCard(panel, state, title, subtitle) {
    const hdr = document.createElement("div");
    hdr.className = "pitch-card-header";
    hdr.innerHTML = `<span class="pitch-card-title">${title}</span><span class="pitch-card-sub">${subtitle}</span>`;
    panel.appendChild(hdr);

    const pitch = document.createElement("div");
    pitch.className = "pitch-field";

    const groups = { WK: [], BAT: [], AR: [], BOWL: [] };
    state.selected.forEach(p => { if (groups[p.role]) groups[p.role].push(p); });

    const roleLabels = { WK: "Keeper", BAT: "Batters", AR: "All-Rounders", BOWL: "Bowlers" };

    for (const role of ["WK", "BAT", "AR", "BOWL"]) {
        const group = groups[role];
        if (!group.length) continue;

        const row = document.createElement("div");
        row.className = "pitch-row";

        group.forEach(p => {
            const isC = p.id === state.captainId;
            const isVC = p.id === state.vcId;
            const circle = document.createElement("div");
            circle.className = `pitch-circle ${isC ? "cap" : isVC ? "vc" : ""}`;
            const photo = p.photo_url ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";
            const av = document.createElement("div");
            av.className = "pitch-avatar";
            av.style.backgroundImage = `url('${photo}')`;
            if (isC || isVC) {
                const badge = document.createElement("span");
                badge.className = `pitch-badge ${isC ? "pitch-badge-c" : "pitch-badge-vc"}`;
                badge.textContent = isC ? "C" : "VC";
                circle.appendChild(badge);
            }
            const name = document.createElement("span");
            name.className = "pitch-name";
            name.textContent = p.name.split(" ").pop();
            const team = document.createElement("span");
            team.className = "pitch-team";
            team.textContent = p.team_short_code;
            circle.append(av, name, team);
            row.appendChild(circle);
        });

        const rowLabel = document.createElement("p");
        rowLabel.className = "pitch-row-label";
        rowLabel.textContent = roleLabels[role];
        const rowWrap = document.createElement("div");
        rowWrap.className = "pitch-row-wrap";
        rowWrap.append(row, rowLabel);
        pitch.appendChild(rowWrap);
    }
    panel.appendChild(pitch);
}


/* ═══════════════════════════════════════════════════════════════════════════
   ALL STARS PANEL
═══════════════════════════════════════════════════════════════════════════ */

let allStarsState = {
    allPlayers: [],
    selected: [],
    captainId: null,
    vcId: null,
    isLocked: false,
    existingTeamId: null,
    filters: { role: "WK", search: "" },
    saving: false,
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

    allStarsState.isLocked = !!(
        match1?.status === "locked" ||
        match1?.lock_processed === true ||
        match1?.points_processed === true
    );

    // Always fetch the full player pool for the leaderboard sheet viewer
    const { data: players } = await supabase
        .from("player_pool_view")
        .select("*")
        .eq("is_active", true)
        .eq("tournament_id", currentTournamentId);
    allStarsState.allPlayers = players || [];

    // Fetch user's own team with full player details
    const { data: existing } = await supabase
        .from("user_allstar_teams")
        .select("id, captain_id, vice_captain_id, user_allstar_team_players(player_id)")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .maybeSingle();

    if (existing) {
        allStarsState.existingTeamId = existing.id;
        allStarsState.captainId      = existing.captain_id;
        allStarsState.vcId           = existing.vice_captain_id;
        const savedIds = existing.user_allstar_team_players.map(p => p.player_id);
        // Pull from allPlayers which we already loaded
        allStarsState.selected = allStarsState.allPlayers.filter(p => savedIds.includes(p.id));
    } else {
        allStarsState.existingTeamId = null;
        allStarsState.captainId      = null;
        allStarsState.vcId           = null;
        allStarsState.selected       = [];
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

    const hasTeam   = allStarsState.selected.length > 0;
    const isLocked  = allStarsState.isLocked;

    if (isLocked && hasTeam) {
        // Show pitch view — team is locked, no editing
        renderPitchCard(panel, allStarsState, "⭐ My All Stars XI", "Locked for the season");

    } else if (!isLocked && hasTeam) {
        // Match 1 not locked yet — show editor with saved team pre-filled
        const editNote = document.createElement("div");
        editNote.style.cssText = "background:var(--accent-dim);border:1px solid var(--border-accent);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-family:var(--font-body);font-size:12px;color:var(--accent);";
        editNote.textContent = "⚠️ Match 1 hasn't started yet — you can still edit your All Stars XI.";
        panel.appendChild(editNote);

        const wrap = document.createElement("div");
        wrap.innerHTML = getEditorHTML('as');
        panel.appendChild(wrap);
        bindBuilderListeners(allStarsState, 'as', saveAllStars);
        updateBuilderUI(allStarsState, 'as');

    } else if (!isLocked && !hasTeam) {
        // No team saved yet and Match 1 not locked — show builder
        const wrap = document.createElement("div");
        wrap.innerHTML = getEditorHTML('as');
        panel.appendChild(wrap);
        bindBuilderListeners(allStarsState, 'as', saveAllStars);
        updateBuilderUI(allStarsState, 'as');

    } else {
        // Locked but no team saved — missed the window
        const missed = document.createElement("div");
        missed.style.cssText = "background:var(--bg-card);border:1px solid var(--border-card);border-radius:12px;padding:20px;text-align:center;margin-bottom:16px;";
        missed.innerHTML = `
            <p style="font-family:var(--font-display);font-size:16px;font-weight:900;color:var(--text-faint);margin:0 0 6px;">All Stars Closed</p>
            <p style="font-family:var(--font-body);font-size:12px;color:var(--text-faint);margin:0;">The window to pick your All Stars XI has passed.</p>`;
        panel.appendChild(missed);
    }

    // Leaderboard — always shown below
    const lbSection = document.createElement("div");
    lbSection.className = "as-lb-section";
    lbSection.style.marginTop = "20px";

    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    titleRow.innerHTML = `<p class="as-section-label" style="margin:0;">All Stars Leaderboard</p>`;
    lbSection.appendChild(titleRow);

    if (!lbRows.length) {
        const empty = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Rankings appear after Match 1 is processed.";
        lbSection.appendChild(empty);
    } else {
        lbRows.forEach(row => {
            const el = document.createElement("div");
            el.className    = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;
            el.style.cursor = "pointer";
            el.onclick      = () => openAllStarsTeam(row.user_id, row.team_name);

            const rank = document.createElement("span");
            rank.className   = "as-lb-rank";
            rank.textContent = `#${row.rank}`;

            const name = document.createElement("span");
            name.className   = "as-lb-name";
            name.textContent = row.team_name || "Expert";

            const pts = document.createElement("span");
            pts.className   = `as-lb-pts${row.total_allstar_points > 0 ? " has-pts" : ""}`;
            pts.textContent = `${row.total_allstar_points} pts`;

            const arrow = document.createElement("i");
            arrow.className   = "fas fa-chevron-right";
            arrow.style.cssText = "font-size:10px;color:var(--text-ghost);flex-shrink:0;";

            el.append(rank, name, pts, arrow);
            lbSection.appendChild(el);
        });

        // View all button
const viewBtn = document.createElement("button");
viewBtn.className = "btn-view-all";
viewBtn.style.marginTop = "8px";
viewBtn.innerHTML = `Full All Stars Leaderboard <i class="fas fa-chevron-right"></i>`;
viewBtn.onclick   = () => openFullAllStarsLeaderboard();
lbSection.appendChild(viewBtn);
    }

    panel.appendChild(lbSection);
}

async function saveAllStars() {
    const stats = calcTeamStats(allStarsState.selected);
    const ok = await showConfirm(
        allStarsState.existingTeamId ? "Update All Stars XI?" : "Save All Stars XI?",
        allStarsState.existingTeamId ? "Your previous XI will be replaced." : "You can keep editing until Match 1 locks."
    );
    if (!ok) return;

    allStarsState.saving = true;
    updateBuilderUI(allStarsState, 'as');

    try {
        const { data: saved, error: teamError } = await supabase
            .from("user_allstar_teams")
            .upsert({
                ...(allStarsState.existingTeamId ? { id: allStarsState.existingTeamId } : {}),
                user_id:         currentUserId,
                tournament_id:   currentTournamentId,
                captain_id:      allStarsState.captainId,
                vice_captain_id: allStarsState.vcId,
                total_credits:   stats.credits,
                updated_at:      new Date().toISOString(),
            }, { onConflict: "user_id,tournament_id" })
            .select().single();

        if (teamError) throw teamError;
        allStarsState.existingTeamId = saved.id;

        await supabase.from("user_allstar_team_players").delete().eq("user_allstar_team_id", saved.id);
        const { error: insertError } = await supabase.from("user_allstar_team_players").insert(
            allStarsState.selected.map(p => ({ user_allstar_team_id: saved.id, player_id: p.id }))
        );
        if (insertError) throw insertError;

        showToast("All Stars XI saved successfully! ✅", "success");
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
    match: null,
        existingTeamId: null,   // ← ADD THIS

    allPlayers: [],
    selected: [],
    captainId: null,
    vcId: null,
    isLocked: false,
    filters: { role: "WK", search: "" },
    saving: false,
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

    dailyState.allPlayers = players || [];

    const { data: existing } = await supabase
        .from("user_daily_teams")
        .select("*, user_daily_team_players(player_id)")
        .eq("user_id", currentUserId)
        .eq("match_id", match.id)
        .maybeSingle();

    // ✅ REPLACE WITH:
if (existing) {
    dailyState.existingTeamId = existing.id;  // store ID for upsert
    dailyState.isLocked  = match.status !== "upcoming";  // lock only when match locks
    dailyState.captainId = existing.captain_id;
    dailyState.vcId      = existing.vice_captain_id;
    const savedIds       = existing.user_daily_team_players.map(p => p.player_id);
    dailyState.selected  = dailyState.allPlayers.filter(p => savedIds.includes(p.id));
} else {
    dailyState.existingTeamId = null;
    dailyState.isLocked = match.status !== "upcoming";
}

    renderDailyPanel();
    await Promise.all([loadDailyLeaderboard(match.id), loadDailyAvgRank()]);
}

function renderDailyPanel() {
    const panel = document.getElementById("panel-daily");
    if (!panel) return;
    panel.innerHTML = "";

    const match = dailyState.match;

    // ── MATCH CARD (like home page next match card) ──
    const matchCard = document.createElement("div");
    matchCard.className = "card match-card";
    matchCard.style.cssText = "padding:16px 18px 18px;margin-bottom:12px;";

    const bucket = supabase.storage.from("team-logos");
    const logoA  = match.team_a?.photo_name
        ? bucket.getPublicUrl(match.team_a.photo_name).data.publicUrl
        : "images/default-team.png";
    const logoB  = match.team_b?.photo_name
        ? bucket.getPublicUrl(match.team_b.photo_name).data.publicUrl
        : "images/default-team.png";

matchCard.innerHTML = `
    <div class="daily-card-badge">DAILY XI</div>
    <div class="daily-card-vs-row">
        <div class="daily-card-team">
            <div class="daily-card-logo" style="background-image:url('${logoA}')"></div>
            <span class="daily-card-team-name">${match.team_a.short_code}</span>
        </div>
        <div class="daily-card-center">
            <span class="daily-card-vs">VS</span>
            <span class="daily-card-status">${dailyState.isLocked ? "✅ Team locked" : "Not submitted yet"}</span>
        </div>
        <div class="daily-card-team">
            <div class="daily-card-logo" style="background-image:url('${logoB}')"></div>
            <span class="daily-card-team-name">${match.team_b.short_code}</span>
        </div>
    </div>
    <div class="daily-card-actions">
        <button class="daily-btn-locked" id="dailyEditBtn">
            ${dailyState.isLocked ? "🔒 Locked" : "✏️ Edit XI"}
        </button>
        <button class="daily-btn-view" id="dailyViewBtn">👁 View</button>
    </div>
    <p class=\"daily-card-hint\">${dailyState.isLocked ? "Match locked 🔒" : dailyState.existingTeamId ? "You can still edit until match locks" : "Pick your XI before the match starts!"}</p>`;
    
    panel.appendChild(matchCard);

    // ── EDITOR (hidden by default, shown on Edit tap) ──
    const editorWrap = document.createElement("div");
    editorWrap.id = "dailyEditorWrap";
    editorWrap.style.display = "none";

    if (!dailyState.isLocked) {
        editorWrap.innerHTML = getEditorHTML('dy');
        panel.appendChild(editorWrap);
    }
    panel.appendChild(editorWrap);

    // Edit button
    matchCard.querySelector("#dailyEditBtn").onclick = () => {
        if (dailyState.isLocked) {
            showToast("Match has locked. No more changes.", "error");
            return;
        }
        const isOpen = editorWrap.style.display !== "none";
        editorWrap.style.display = isOpen ? "none" : "block";
        if (!isOpen && !editorWrap._bound) {
            editorWrap._bound = true;
            bindBuilderListeners(dailyState, 'dy', saveDailyXI);
            updateBuilderUI(dailyState, 'dy');
        }
    };

    // View button — opens bottom sheet with their own locked team
    matchCard.querySelector("#dailyViewBtn").onclick = async () => {
    // Fetch most recent Daily XI for this user regardless of match
    const { data: recent } = await supabase
        .from("user_daily_teams")
        .select("match_id")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!recent) {
        showToast("You haven't saved a Daily XI yet.", "error");
        return;
    }

    openDailyTeamSheet(currentUserId, recent.match_id);
};

    // ── LEADERBOARD SECTIONS ──
    const lbWrap = document.createElement("div");
    lbWrap.style.marginTop = "8px";
    lbWrap.innerHTML = `
        <div id="dailyLeaderboard" class="as-lb-section"></div>
        <div id="dailyAvgRank" class="as-lb-section" style="margin-top:15px;"></div>`;
    panel.appendChild(lbWrap);
}

async function saveDailyXI() {
    const stats = calcTeamStats(dailyState.selected);
    const isUpdate = !!dailyState.existingTeamId;
    const ok = await showConfirm(
        isUpdate ? "Update Daily XI?" : "Lock Daily XI?",
        isUpdate ? "Your previous XI will be replaced." : "You can keep editing until the match locks."
    );
    if (!ok) return;

    dailyState.saving = true;
    updateBuilderUI(dailyState, 'dy');

    try {
        const { data: saved, error: teamError } = await supabase
            .from("user_daily_teams")
            .upsert({
                ...(isUpdate ? { id: dailyState.existingTeamId } : {}),
                user_id:         currentUserId,
                match_id:        dailyState.match.id,
                tournament_id:   currentTournamentId,
                captain_id:      dailyState.captainId,
                vice_captain_id: dailyState.vcId,
                total_credits:   stats.credits,
            }, { onConflict: "user_id,match_id" })
            .select().single();

        if (teamError) throw teamError;
        dailyState.existingTeamId = saved.id;

        // Delete old players and re-insert
        await supabase.from("user_daily_team_players").delete().eq("user_daily_team_id", saved.id);
        const { error: playersError } = await supabase
            .from("user_daily_team_players")
            .insert(dailyState.selected.map(p => ({ user_daily_team_id: saved.id, player_id: p.id })));

        if (playersError) throw playersError;

        showToast(isUpdate ? "Daily XI updated! ✅" : "Daily XI saved! 🔒", "success");
        const dp = document.getElementById("panel-daily");
        if (dp) { dp.innerHTML = ""; delete dp.dataset.loaded; }
        await loadDailyPanel();

    } catch (err) {
        console.error("Daily XI save error:", err);
        showToast("Save failed: " + err.message, "error");
    } finally {
        dailyState.saving = false;
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
        .limit(3);  // top 3 only

    section.innerHTML = "";
    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    titleRow.innerHTML = `
        <p class="as-section-label" style="margin:0;">Match Leaderboard</p>`;
    section.appendChild(titleRow);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Rankings appear after the match is processed.";
        section.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const el = document.createElement("div");
        el.className    = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;
        el.style.cursor = "pointer";
        el.onclick = () => openDailyTeamSheet(row.user_id, matchId);

        const rank = document.createElement("span");
        rank.className   = "as-lb-rank";
        rank.textContent = `#${row.rank}`;

        const name = document.createElement("span");
        name.className   = "as-lb-name";
        name.textContent = row.team_name || "Expert";

        const pts = document.createElement("span");
        pts.className   = `as-lb-pts${row.total_daily_points > 0 ? " has-pts" : ""}`;
        pts.textContent = `${row.total_daily_points} pts`;

        const arrow = document.createElement("i");
        arrow.className = "fas fa-chevron-right";
        arrow.style.cssText = "font-size:10px;color:var(--text-ghost);flex-shrink:0;";

        el.append(rank, name, pts, arrow);
        section.appendChild(el);
    });

    // View full leaderboard button
    const viewBtn = document.createElement("button");
    viewBtn.className   = "btn-view-all";
    viewBtn.style.marginTop = "8px";
    viewBtn.innerHTML   = `Full Match Leaderboard <i class="fas fa-chevron-right"></i>`;
    viewBtn.onclick     = () => openFullDailyLeaderboard(matchId, "match");
    section.appendChild(viewBtn);
}

async function loadDailyAvgRank() {
    const section = document.getElementById("dailyAvgRank");
    if (!section) return;

    // Compute avg points per match from user_match_points joined to daily teams
    // Group by user, sum points, count matches, divide
    const { data: rows } = await supabase
    .from("daily_season_avg_points_view")
    .select("team_name, avg_points, matches_played, user_id")
    .eq("tournament_id", currentTournamentId)
    .order("avg_points", { ascending: false })
    .limit(3);

    section.innerHTML = "";
    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    titleRow.innerHTML = `<p class="as-section-label" style="margin:0;">Avg Points Per Match</p>`;
    section.appendChild(titleRow);

    if (!rows?.length) {
        const empty = document.createElement("p");
        empty.className   = "empty-msg";
        empty.textContent = "Appears after your first Daily XI match.";
        section.appendChild(empty);
        return;
    }

    rows.forEach((row, i) => {
        const el = document.createElement("div");
        el.className    = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

        const rank = document.createElement("span");
        rank.className   = "as-lb-rank";
        rank.textContent = `#${i + 1}`;

        const name = document.createElement("span");
        name.className   = "as-lb-name";
        name.textContent = row.team_name || "Expert";

        const pts = document.createElement("span");
        pts.className   = "as-lb-pts has-pts";
        // Show avg points · matches played
        const avg = row.avg_points
            ? Number(row.avg_points).toFixed(1)
            : row.matches_played > 0
                ? (row.total_points / row.matches_played).toFixed(1)
                : "0";
pts.textContent = `${Number(row.avg_points).toFixed(1)} avg · ${row.matches_played}M`;
        el.append(rank, name, pts);
        section.appendChild(el);
    });

const viewBtn = document.createElement("button");
viewBtn.className = "btn-view-all";
viewBtn.style.marginTop = "8px";
viewBtn.innerHTML = `Full Avg Points Table <i class="fas fa-chevron-right"></i>`;
viewBtn.onclick = () => openFullDailyLeaderboard(null, "avg");
section.appendChild(viewBtn);
}

async function openAllStarsTeam(userId, teamName) {
    openBottomSheet(async (body) => {

        const { data: team } = await supabase
            .from("user_allstar_teams")
            .select("id, captain_id, vice_captain_id")
            .eq("user_id", userId)
            .eq("tournament_id", currentTournamentId)
            .maybeSingle();

        body.innerHTML = "";

        if (!team) {
            body.innerHTML = `<p class="sheet-empty">No All Stars team found.</p>`;
            return;
        }

        const [profileRes, teamPlayersRes, ptsRes] = await Promise.all([
            supabase.from("user_profiles")
                .select("team_name, team_photo_url")
                .eq("user_id", userId)
                .maybeSingle(),
            supabase.from("user_allstar_team_players")
                .select("player_id")
                .eq("user_allstar_team_id", team.id),
            supabase.from("allstar_leaderboard_view")
                .select("total_allstar_points")
                .eq("user_id", userId)
                .eq("tournament_id", currentTournamentId)
                .maybeSingle(),
        ]);

        const playerIds = (teamPlayersRes.data || []).map(r => r.player_id);

        const { data: playerDetails } = playerIds.length
            ? await supabase.from("players")
                .select("id, name, role, photo_url, real_teams!inner(short_code)")
                .in("id", playerIds)
            : { data: [] };

        const profile  = profileRes.data;
        const photo    = profile?.team_photo_url
            ? supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url).data.publicUrl
            : "images/default-avatar.png";
        const totalPts = ptsRes.data?.total_allstar_points || 0;

        const hdr = document.createElement("div");
        hdr.className = "sheet-team-hdr";
        hdr.innerHTML = `
            <div class="sheet-team-avatar" style="background-image:url('${photo}')"></div>
            <div>
                <div class="sheet-player-name">${profile?.team_name || teamName || "Expert"}</div>
                <div class="sheet-player-pts">${totalPts} season pts</div>
            </div>`;
        body.appendChild(hdr);

        const players = (playerDetails || []).map(p => ({
            ...p,
            short_code: p.real_teams?.short_code || "TBA",
            isC:  p.id === team.captain_id,
            isVC: p.id === team.vice_captain_id,
        }));

        const roleLabels = { WK: "Wicket-Keeper", BAT: "Batters", AR: "All-Rounders", BOWL: "Bowlers" };
        for (const role of ["WK", "BAT", "AR", "BOWL"]) {
            const group = players.filter(p => p.role === role);
            if (!group.length) continue;

            const label = document.createElement("p");
            label.className   = "sheet-section-label";
            label.textContent = roleLabels[role];
            body.appendChild(label);

            group.sort((a, b) => (b.isC ? 1 : 0) - (a.isC ? 1 : 0));
            group.forEach(p => {
                const pPhoto = p.photo_url
                    ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl
                    : "images/default-avatar.png";
                const row = document.createElement("div");
                row.className = "sheet-player-row";
                row.innerHTML = `
                    <div class="sheet-row-avatar" style="background-image:url('${pPhoto}');background-size:cover;background-position:center;"></div>
                    <div class="sheet-row-info">
                        <div class="sheet-row-name-row">
                            <span class="sheet-row-name">${p.name || "Unknown"}</span>
                            ${p.isC  ? `<span class="sheet-role-badge c">C</span>`  : ""}
                            ${p.isVC ? `<span class="sheet-role-badge vc">VC</span>` : ""}
                        </div>
                        <span class="sheet-row-meta">${p.role} · ${p.short_code}</span>
                    </div>`;
                body.appendChild(row);
            });
        }
    });
}

async function openFullAllStarsLeaderboard() {
    openBottomSheet(async (body) => {
        body.innerHTML = `<div class="sheet-spinner"></div>`;

        const { data: rows } = await supabase
            .from("allstar_leaderboard_view")
            .select("user_id, team_name, total_allstar_points, rank")
            .eq("tournament_id", currentTournamentId)
            .order("rank", { ascending: true })
            .limit(100);

        body.innerHTML = "";
        const title = document.createElement("p");
        title.className      = "sheet-section-label";
        title.style.marginBottom = "12px";
        title.textContent    = "Full All Stars Leaderboard";
        body.appendChild(title);

        if (!rows?.length) {
            body.innerHTML += `<p class="sheet-empty">No data yet.</p>`;
            return;
        }

        rows.forEach(row => {
            const el = document.createElement("div");
            el.className    = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;
            el.style.cursor = "pointer";
            el.onclick      = () => openAllStarsTeam(row.user_id, row.team_name);

            const rank = document.createElement("span");
            rank.className   = "as-lb-rank";
            rank.textContent = `#${row.rank}`;

            const name = document.createElement("span");
            name.className   = "as-lb-name";
            name.textContent = row.team_name || "Expert";

            const pts = document.createElement("span");
            pts.className   = `as-lb-pts${row.total_allstar_points > 0 ? " has-pts" : ""}`;
            pts.textContent = `${row.total_allstar_points} pts`;

            const arrow = document.createElement("i");
            arrow.className   = "fas fa-chevron-right";
            arrow.style.cssText = "font-size:10px;color:var(--text-ghost);flex-shrink:0;";

            el.append(rank, name, pts, arrow);
            body.appendChild(el);
        });
    });
}

async function openDailyTeamSheet(userId, matchId) {
    openBottomSheet(async (body) => {

        const { data: team } = await supabase
            .from("user_daily_teams")
            .select("id, captain_id, vice_captain_id")
            .eq("user_id", userId)
            .eq("match_id", matchId)
            .maybeSingle();

        body.innerHTML = "";

        if (!team) {
            body.innerHTML = `<p class="sheet-empty">No Daily XI found for this match.</p>`;
            return;
        }

        const [profileRes, teamPlayersRes, ptsRes] = await Promise.all([
            supabase.from("user_profiles")
                .select("team_name, team_photo_url")
                .eq("user_id", userId)
                .maybeSingle(),
            supabase.from("user_daily_team_players")
                .select("player_id")
                .eq("user_daily_team_id", team.id),
            supabase.from("daily_match_leaderboard_view")
                .select("total_daily_points")
                .eq("user_id", userId)
                .eq("match_id", matchId)
                .maybeSingle(),
        ]);

        const playerIds = (teamPlayersRes.data || []).map(r => r.player_id);

        const { data: playerDetails } = playerIds.length
            ? await supabase.from("players")
                .select("id, name, role, photo_url, real_teams!inner(short_code)")
                .in("id", playerIds)
            : { data: [] };

        const profile = profileRes.data;
        const photo   = profile?.team_photo_url
            ? supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url).data.publicUrl
            : "images/default-avatar.png";

        const hdr = document.createElement("div");
        hdr.className = "sheet-team-hdr";
        hdr.innerHTML = `
            <div class="sheet-team-avatar" style="background-image:url('${photo}')"></div>
            <div>
                <div class="sheet-player-name">${profile?.team_name || "Expert"}</div>
                <div class="sheet-player-pts">${ptsRes.data?.total_daily_points ?? "—"} pts this match</div>
            </div>`;
        body.appendChild(hdr);

        const players = (playerDetails || []).map(p => ({
            ...p,
            short_code: p.real_teams?.short_code || "TBA",
            isC:  p.id === team.captain_id,
            isVC: p.id === team.vice_captain_id,
        }));

        const roleLabels = { WK: "Wicket-Keeper", BAT: "Batters", AR: "All-Rounders", BOWL: "Bowlers" };
        for (const role of ["WK", "BAT", "AR", "BOWL"]) {
            const group = players.filter(p => p.role === role);
            if (!group.length) continue;

            const label = document.createElement("p");
            label.className   = "sheet-section-label";
            label.textContent = roleLabels[role];
            body.appendChild(label);

            group.forEach(p => {
                const pPhoto = p.photo_url
                    ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl
                    : "images/default-avatar.png";
                const row = document.createElement("div");
                row.className = "sheet-player-row";
                row.innerHTML = `
                    <div class="sheet-row-avatar" style="background-image:url('${pPhoto}');background-size:cover;background-position:center;"></div>
                    <div class="sheet-row-info">
                        <div class="sheet-row-name-row">
                            <span class="sheet-row-name">${p.name || "Unknown"}</span>
                            ${p.isC  ? `<span class="sheet-role-badge c">C</span>`  : ""}
                            ${p.isVC ? `<span class="sheet-role-badge vc">VC</span>` : ""}
                        </div>
                        <span class="sheet-row-meta">${p.role} · ${p.short_code}</span>
                    </div>`;
                body.appendChild(row);
            });
        }
    });
}

async function openFullDailyLeaderboard(matchId, type) {
    openBottomSheet(async (body) => {
        body.innerHTML = `<div class="sheet-spinner"></div>`;

        let rows;
        if (type === "match") {
            const { data } = await supabase
                .from("daily_match_leaderboard_view")
                .select("team_name, total_daily_points, rank, user_id")
                .eq("match_id", matchId)
                .order("rank", { ascending: true })
                .limit(100);
            rows = data;
        } else {
            const { data } = await supabase
                .from("daily_season_avg_points_view")
                .select("team_name, avg_points, matches_played, user_id")
                .eq("tournament_id", currentTournamentId)
                .order("avg_points", { ascending: false })
                .limit(100);
            rows = data;
        }

        body.innerHTML = "";
        const title = document.createElement("p");
        title.className = "sheet-section-label";
        title.style.marginBottom = "12px";
        title.textContent = type === "match" ? "Full Match Leaderboard" : "Avg Points Leaderboard";
        body.appendChild(title);

        if (!rows?.length) {
            body.innerHTML += `<p class="sheet-empty">No data yet.</p>`;
            return;
        }

        rows.forEach((row, i) => {
            const el = document.createElement("div");
            el.className = `as-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

            const rank = document.createElement("span");
            rank.className = "as-lb-rank";
            rank.textContent = type === "match" ? `#${row.rank}` : `#${i + 1}`;

            const name = document.createElement("span");
            name.className = "as-lb-name";
            name.textContent = row.team_name || "Expert";

            const pts = document.createElement("span");
            pts.className = "as-lb-pts has-pts";

            if (type === "match") {
                pts.textContent = `${row.total_daily_points} pts`;
            } else {
                pts.textContent = `${Number(row.avg_points).toFixed(1)} avg · ${row.matches_played}M`;
            }

            if (type === "match") {
                el.style.cursor = "pointer";
                el.onclick = () => openDailyTeamSheet(row.user_id, matchId);
                const arrow = document.createElement("i");
                arrow.className = "fas fa-chevron-right";
                arrow.style.cssText = "font-size:10px;color:var(--text-ghost);flex-shrink:0;";
                el.append(rank, name, pts, arrow);
            } else {
                el.append(rank, name, pts);
            }

            body.appendChild(el);
        });
    });
}

/* ═══════════════════════════════════════════════════════════════════════════
   H2H CHALLENGE PANEL
   Paste this entire block at the bottom of prediction.js
═══════════════════════════════════════════════════════════════════════════ */

/* ─── H2H SUB-TAB SWITCHER ───────────────────────────────────────────────── */
window.switchH2HTab = function(sub) {
    document.querySelectorAll(".h2h-sub-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.sub === sub);
    });
    document.querySelectorAll(".h2h-sub-panel").forEach(panel => {
        panel.classList.toggle("hidden", panel.id !== `h2h-sub-${sub}`);
    });
    if (sub === "challenges")  loadH2HChallenges();
    if (sub === "leaderboard") loadH2HLeaderboard();
    if (sub === "live")        loadH2HLive();
};

/* ─── H2H STATE ──────────────────────────────────────────────────────────── */
let h2hState = {
    match: null,
    team: null,          // saved h2h_teams row for current match
    players: [],         // player pool for current match (4 roles)
    slots: { WK: null, BAT: null, AR: null, BOWL: null },
    captainId: null,
    vcId: null,
    saving: false,
};

/* ─── ENTRY POINT ────────────────────────────────────────────────────────── */
async function loadH2HPanel() {
    // Always re-fetch, never use cached match
    const { data: match, error: matchErr } = await supabase
        .from("matches")
        .select("*, team_a:real_teams!team_a_id(id, short_code, photo_name), team_b:real_teams!team_b_id(id, short_code, photo_name)")
        .eq("tournament_id", currentTournamentId)
        .in("status", ["upcoming", "live"])
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (matchErr) console.error("[H2H] match fetch error:", matchErr);
    console.log("[H2H] current match:", match?.id, match?.match_number);
    h2hState.match = match;

    // Always reload player pool for this match
    if (h2hState.match) {
        const { data: players } = await supabase
            .from("player_pool_view")
            .select("*")
            .eq("is_active", true)
            .eq("tournament_id", currentTournamentId)
            .in("real_team_id", [h2hState.match.team_a.id, h2hState.match.team_b.id]);
        h2hState.players = players || [];
    }

    // Load any existing team for this match
    if (h2hState.match) {
        const { data: team } = await supabase
            .from("h2h_teams")
            .select("*, h2h_team_players(player_id, role)")
            .eq("user_id", currentUserId)
            .eq("match_id", h2hState.match.id)
            .maybeSingle();

        if (team) {
            h2hState.team = team;
            h2hState.captainId = team.captain_id;
            h2hState.vcId = team.vice_captain_id;
            (team.h2h_team_players || []).forEach(tp => {
                const player = h2hState.players.find(p => p.id === tp.player_id);
                if (player) h2hState.slots[tp.role] = player;
            });
        }
    }

    loadH2HChallenges();
}

/* ─── CHALLENGES SUB-PANEL ───────────────────────────────────────────────── */
async function loadH2HChallenges() {
    const panel = document.getElementById("h2h-sub-challenges");
    if (!panel) return;
    panel.innerHTML = `<div class="panel-spinner"></div>`;

    const match = h2hState.match;

    if (!match) {
        panel.innerHTML = `
            <div class="h2h-empty">
                <div class="h2h-empty-icon">🏏</div>
                <div class="h2h-empty-title">No upcoming match</div>
                <p>Check back when the next match is announced.</p>
            </div>`;
        return;
    }

    // Check if match is locked
    const isMatchLocked = match.status !== "upcoming";

    // Fetch incoming + sent challenges
// Fetch incoming + sent challenges — NO match_id filter, show all
// CHANGE these two queries — add .eq("match_id", match.id) to both

const { data: incomingRaw } = await supabase
    .from("h2h_challenges")
    .select("id, challenger_id, opponent_id, status, created_at, match_id, matches!match_id(match_number)")
    .eq("opponent_id", currentUserId)
    .eq("match_id", match.id)          // ← ADD THIS
    .eq("status", "pending")
    .order("created_at", { ascending: false });

const { data: sentRaw } = await supabase
    .from("h2h_challenges")
    .select("id, challenger_id, opponent_id, status, created_at, match_id, matches!match_id(match_number)")
    .eq("challenger_id", currentUserId)
    .eq("match_id", match.id)          // ← ADD THIS
    .neq("status", "rejected")
    .order("created_at", { ascending: false });

    // Fetch profiles separately to avoid silent RLS join failures
    const allUserIds = new Set();
    (incomingRaw || []).forEach(c => allUserIds.add(c.challenger_id));
    (sentRaw || []).forEach(c => allUserIds.add(c.opponent_id));

    let profileMap = {};
    if (allUserIds.size > 0) {
        const { data: profiles } = await supabase
            .from("user_profiles")
            .select("user_id, team_name, team_photo_url")
            .in("user_id", [...allUserIds]);
        (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
    }

    const incoming = (incomingRaw || []).map(c => ({
        ...c,
        challenger: profileMap[c.challenger_id] || { team_name: "Expert" },
        matchNumber: c.matches?.match_number || "",
    }));

    const sent = (sentRaw || []).map(c => ({
        ...c,
        opponent: profileMap[c.opponent_id] || { team_name: "Expert" },
        matchNumber: c.matches?.match_number || "",
    }));

    panel.innerHTML = "";

    // Match strip
    const strip = document.createElement("div");
    strip.className = "h2h-match-strip";
    strip.innerHTML = `
        <span class="h2h-match-badge">Match ${match.match_number || ""}</span>
        <span class="h2h-match-name">${match.team_a.short_code} vs ${match.team_b.short_code}</span>
        <span class="h2h-match-timer">${isMatchLocked ? "🔒 Locked" : "Open"}</span>`;
    panel.appendChild(strip);

    // Pick Team & Challenge button
    const hasTeam = Object.values(h2hState.slots).every(v => v !== null);
    const pickBtn = document.createElement("button");
    pickBtn.className = "h2h-pick-btn";
    pickBtn.disabled = isMatchLocked;
    pickBtn.textContent = isMatchLocked
        ? "🔒 Challenge window closed"
        : hasTeam
            ? "✏️ Edit Team & Challenge"
            : "⚡ Pick Team & Challenge";
    pickBtn.onclick = () => openH2HTeamBuilder();
    panel.appendChild(pickBtn);

    // Incoming challenges
    if (incoming?.length) {
        const inLabel = document.createElement("p");
        inLabel.className = "as-section-label";
        inLabel.textContent = `Incoming (${incoming.length})`;
        panel.appendChild(inLabel);

        incoming.forEach(c => {
            const card = buildChallengeCard(c, "incoming", () => openAcceptSheet(c));
            panel.appendChild(card);
        });
    }

    // Sent challenges
    const sentLabel = document.createElement("p");
    sentLabel.className = "as-section-label";
    sentLabel.style.marginTop = "10px";
    sentLabel.textContent = `Sent (${sent?.length || 0})`;
    panel.appendChild(sentLabel);

    if (!sent?.length) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent = "No challenges sent yet. Pick a team and challenge someone!";
        panel.appendChild(empty);
    } else {
        sent.forEach(c => {
            const card = buildChallengeCard(c, "sent", null);
            panel.appendChild(card);
        });
    }
}

function buildChallengeCard(challenge, type, onClick) {
    const isIncoming = type === "incoming";
    const profile = isIncoming ? challenge.challenger : challenge.opponent;
    const name = profile?.team_name || "Expert";

    const card = document.createElement("div");
    card.className = `h2h-challenge-card ${isIncoming ? "incoming" : ""}`;
    if (onClick) card.style.cursor = "pointer";
    if (onClick) card.onclick = onClick;

    const photoUrl = profile?.team_photo_url
        ? supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url).data.publicUrl
        : null;

    const avatar = document.createElement("div");
    avatar.className = "h2h-cc-avatar";
    if (photoUrl) {
        avatar.style.backgroundImage = `url('${photoUrl}')`;
        avatar.style.backgroundSize = "cover";
        avatar.style.backgroundPosition = "center";
    } else {
        avatar.textContent = name.slice(0, 2).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "h2h-cc-info";
    info.innerHTML = `
        <div class="h2h-cc-name">${name}</div>
<div class="h2h-cc-meta">${challenge.status === "accepted" ? "Accepted" : isIncoming ? "Sent you a challenge" : "Waiting..."} · Match ${challenge.matchNumber || ""}</div>`;

    const actionBtn = document.createElement("button");
    actionBtn.className = `h2h-cc-action ${isIncoming ? "accept" : challenge.status === "accepted" ? "accept" : "pending"}`;
    actionBtn.textContent = isIncoming ? "Accept" : challenge.status === "accepted" ? "Accepted" : "Pending";
    if (isIncoming && onClick) {
        actionBtn.onclick = (e) => { e.stopPropagation(); onClick(); };
    }

    card.append(avatar, info, actionBtn);
    return card;
}

/* ─── H2H TEAM BUILDER (4-slot) ──────────────────────────────────────────── */
function openH2HTeamBuilder() {
    openBottomSheet((body) => {
        body.innerHTML = "";
        renderH2HSlotPicker(body);
    });
}

function renderH2HSlotPicker(body) {
    body.innerHTML = "";

    const title = document.createElement("p");
    title.className = "sheet-section-label";
    title.style.marginBottom = "12px";
    title.textContent = "Pick one player per role";
    body.appendChild(title);

    // 4-slot grid
    const grid = document.createElement("div");
    grid.className = "h2h-slot-grid";

    const roles = ["WK", "BAT", "AR", "BOWL"];
    const roleLabels = { WK: "Wicket-Keeper", BAT: "Batter", AR: "All-Rounder", BOWL: "Bowler" };

    roles.forEach(role => {
        const filled = h2hState.slots[role];
        const slot = document.createElement("div");
        slot.className = `h2h-slot ${filled ? "filled" : ""}`;
        slot.onclick = () => openH2HPlayerPicker(role, body);

        if (filled) {
            const photoUrl = filled.photo_url
                ? supabase.storage.from("player-photos").getPublicUrl(filled.photo_url).data.publicUrl
                : null;
            const isC  = filled.id === h2hState.captainId;
            const isVC = filled.id === h2hState.vcId;
            slot.innerHTML = `
                <span class="h2h-slot-role">${role}</span>
                <div class="h2h-slot-avatar" style="background-image:url('${photoUrl || "images/default-avatar.png"}')"></div>
                <span class="h2h-slot-name">${filled.name.split(" ").pop()}</span>
                <span class="h2h-slot-team">${filled.team_short_code || ""}</span>
                ${isC ? `<span class="h2h-slot-badge c">C</span>` : isVC ? `<span class="h2h-slot-badge vc">VC</span>` : ""}`;
        } else {
            slot.innerHTML = `
                <span class="h2h-slot-role">${roleLabels[role]}</span>
                <div class="h2h-slot-empty-icon">+</div>
                <span class="h2h-slot-empty-text">Tap to pick</span>`;
        }
        grid.appendChild(slot);
    });
    body.appendChild(grid);

    // C / VC selector (only when all slots filled)
    const allFilled = roles.every(r => h2hState.slots[r]);
    if (allFilled) {
        const cvcLabel = document.createElement("p");
        cvcLabel.className = "h2h-cvc-label";
        cvcLabel.textContent = "Captain & Vice-Captain";
        body.appendChild(cvcLabel);

        const cvcBtns = document.createElement("div");
        cvcBtns.className = "h2h-cvc-btns";

        const filledPlayers = roles.map(r => h2hState.slots[r]);
        filledPlayers.forEach(p => {
            const isC  = p.id === h2hState.captainId;
            const isVC = p.id === h2hState.vcId;
            const btn = document.createElement("button");
            btn.className = `h2h-cvc-btn ${isC ? "active-c" : isVC ? "active-vc" : ""}`;
            btn.textContent = `${isC ? "C" : isVC ? "VC" : "—"} ${p.name.split(" ").pop()}`;
            btn.onclick = () => {
                if (!h2hState.captainId) {
                    h2hState.captainId = p.id;
                } else if (h2hState.captainId === p.id) {
                    h2hState.captainId = null;
                } else if (!h2hState.vcId) {
                    h2hState.vcId = p.id;
                } else if (h2hState.vcId === p.id) {
                    h2hState.vcId = null;
                } else {
                    h2hState.captainId = p.id;
                }
                renderH2HSlotPicker(body);
            };
            cvcBtns.appendChild(btn);
        });
        body.appendChild(cvcBtns);

        // Challenger list
        renderH2HChallengerList(body);
    }
}

async function renderH2HChallengerList(body) {
    const label = document.createElement("p");
    label.className = "h2h-cvc-label";
    label.textContent = "Challenge who?";
    body.appendChild(label);

    // Fetch other users in the tournament (excluding self)
    const { data: users } = await supabase
        .from("user_tournament_points")
        .select("user_id, user_profiles(team_name, team_photo_url)")
        .eq("tournament_id", currentTournamentId)
        .neq("user_id", currentUserId)
        .limit(20);

    // Fetch existing challenges this match (by current user)
    const { data: existingChallenges } = await supabase
        .from("h2h_challenges")
        .select("opponent_id, challenger_id, status")
        .eq("match_id", h2hState.match.id)
        .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`);

    const alreadySent     = new Set((existingChallenges || []).filter(c => c.challenger_id === currentUserId).map(c => c.opponent_id));
    const incomingFromThem = new Set((existingChallenges || []).filter(c => c.opponent_id === currentUserId).map(c => c.challenger_id));

    (users || []).forEach(u => {
        const profile = u.user_profiles;
        const isAlreadySent  = alreadySent.has(u.user_id);
        const hasIncoming    = incomingFromThem.has(u.user_id);
        const name = profile?.team_name || "Expert";

        const row = document.createElement("div");
        row.className = `h2h-challenger-row ${isAlreadySent ? "" : ""}`;

        const check = document.createElement("div");
        check.className = "h2h-cr-check";
        check.textContent = isAlreadySent ? "✓" : "";
        if (isAlreadySent) check.classList.add("checked");

        const nameEl = document.createElement("span");
        nameEl.className = "h2h-cr-name";
        nameEl.textContent = name;

        const badgeEl = document.createElement("span");
        badgeEl.className = `h2h-cr-badge ${hasIncoming ? "incoming" : isAlreadySent ? "sent" : ""}`;
        badgeEl.textContent = hasIncoming ? "Accept challenge" : isAlreadySent ? "Already sent" : "";

        row.append(check, nameEl, badgeEl);

        if (!isAlreadySent) {
            row.style.cursor = "pointer";
            row.onclick = () => {
                if (hasIncoming) {
                    // Shortcut — show warning about incoming challenge
                    showDupWarning(u.user_id, name, body);
                } else {
                    sendH2HChallenge(u.user_id, name);
                }
            };
        }
        body.appendChild(row);
    });
}

function showDupWarning(opponentId, opponentName, body) {
    const existing = body.querySelector(".h2h-dup-warn");
    if (existing) existing.remove();

    const warn = document.createElement("div");
    warn.className = "h2h-dup-warn";
    warn.innerHTML = `<strong>${opponentName} already challenged you!</strong><br>
        Accept their challenge from the Challenges section, or send a separate challenge anyway.`;
    body.insertBefore(warn, body.querySelector(".h2h-cvc-label") || body.firstChild);
}

async function openH2HPlayerPicker(role, parentBody) {
    parentBody.innerHTML = "";

    const back = document.createElement("button");
    back.className = "back-btn";
    back.innerHTML = "← Back";
    back.style.cssText = "background:transparent;border:none;color:var(--fun-cyan);font-size:12px;font-weight:700;cursor:pointer;margin-bottom:12px;display:flex;align-items:center;gap:5px;padding:0;";
    back.onclick = () => renderH2HSlotPicker(parentBody);
    parentBody.appendChild(back);

    const roleLabels = { WK: "Wicket-Keeper", BAT: "Batter", AR: "All-Rounder", BOWL: "Bowler" };
    const label = document.createElement("p");
    label.className = "sheet-section-label";
    label.style.marginBottom = "12px";
    label.textContent = `Pick your ${roleLabels[role]}`;
    parentBody.appendChild(label);

    const eligible = h2hState.players.filter(p => p.role === role);
    if (!eligible.length) {
        parentBody.innerHTML += `<p class="sheet-empty">No ${role} players available for this match.</p>`;
        return;
    }

    eligible.forEach(p => {
        const photoUrl = p.photo_url
            ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl
            : "images/default-avatar.png";
        const card = document.createElement("div");
        card.className = "h2h-player-card";
        card.innerHTML = `
            <div class="h2h-player-avatar" style="background-image:url('${photoUrl}')"></div>
            <div class="h2h-player-info">
                <div class="h2h-player-name">${p.name}</div>
                <div class="h2h-player-meta">${p.role} · ${p.team_short_code} · ${p.credit} Cr</div>
            </div>
            <button class="h2h-select-btn">Select</button>`;
        card.querySelector("button").onclick = () => {
            h2hState.slots[role] = p;
            renderH2HSlotPicker(parentBody);
        };
        parentBody.appendChild(card);
    });
}

async function sendH2HChallenge(opponentId, opponentName) {
    const roles = ["WK", "BAT", "AR", "BOWL"];
    const allFilled = roles.every(r => h2hState.slots[r]);
    if (!allFilled || !h2hState.captainId || !h2hState.vcId) {
        showToast("Fill all 4 slots and set C/VC first.", "error");
        return;
    }

    const ok = await showConfirm(
        `Challenge ${opponentName}?`,
        "Your team will be locked once they accept. You can still send more challenges."
    );
    if (!ok) return;

    h2hState.saving = true;

    try {
// Step 1 — Save team to DB (upsert so user can edit until match locks)
const { data: team, error: teamError } = await supabase
    .from("h2h_teams")
    .upsert({
        ...(h2hState.team?.id ? { id: h2hState.team.id } : {}),
        user_id:         currentUserId,
        match_id:        h2hState.match.id,
        tournament_id:   currentTournamentId,
        captain_id:      h2hState.captainId,
        vice_captain_id: h2hState.vcId,
    }, { onConflict: "user_id,match_id" })
    .select().single();
if (teamError) throw teamError;

// Delete old players before re-inserting
await supabase.from("h2h_team_players").delete().eq("h2h_team_id", team.id);

        // 2. Save players
        const { error: playersErr } = await supabase
            .from("h2h_team_players")
            .insert(roles.map(role => ({
                h2h_team_id: team.id,
                player_id:   h2hState.slots[role].id,
                role,
            })));
        if (playersErr) throw playersErr;

        h2hState.team = team;

        // 3a. If responding to an incoming challenge — auto-accept instead of sending new
        if (h2hState.pendingAcceptChallengeId) {
            const pendingId = h2hState.pendingAcceptChallengeId;
            h2hState.pendingAcceptChallengeId = null;
            await acceptChallenge(pendingId, team.id);
            return; // acceptChallenge handles toast + sheet close
        }

        // 3b. Normal flow — create a new outgoing challenge
        const { error: challengeErr } = await supabase
            .from("h2h_challenges")
            .insert([{
                match_id:           h2hState.match.id,
                tournament_id:      currentTournamentId,
                challenger_id:      currentUserId,
                opponent_id:        opponentId,
                challenger_team_id: team.id,
            }]);
        if (challengeErr) throw challengeErr;

        showToast(`Challenge sent to ${opponentName}! ⚔️`, "success");
        closeBottomSheet();
        loadH2HChallenges();

    } catch (err) {
        console.error("H2H challenge error:", err);
        showToast("Failed: " + err.message, "error");
    } finally {
        h2hState.saving = false;
    }
}

/* ─── ACCEPT SHEET ───────────────────────────────────────────────────────── */
function openAcceptSheet(challenge) {
    openBottomSheet(async (body) => {
        const challengerName = challenge.challenger?.team_name || "Expert";
        body.innerHTML = "";

        const fromBox = document.createElement("div");
        fromBox.className = "h2h-accept-from";
        fromBox.innerHTML = `
            <div class="h2h-accept-from-label">Challenge from</div>
            <div class="h2h-accept-from-name">${challengerName}</div>
            <div class="h2h-accept-from-meta">Match vs ${h2hState.match?.team_a?.short_code} vs ${h2hState.match?.team_b?.short_code}</div>`;
        body.appendChild(fromBox);

        const label = document.createElement("p");
        label.className = "sheet-section-label";
        label.textContent = "Your response";
        body.appendChild(label);

        // If they already have a saved team, offer to use it
        const hasTeam = Object.values(h2hState.slots).every(v => v !== null);

        if (hasTeam) {
            const useExisting = document.createElement("button");
            useExisting.className = "h2h-challenge-btn";
            useExisting.textContent = "✅ Accept with my saved team";
            useExisting.onclick = () => acceptChallenge(challenge.id, null);
            body.appendChild(useExisting);

            const buildNew = document.createElement("button");
            buildNew.className = "h2h-challenge-btn ghost";
            buildNew.style.marginTop = "8px";
            buildNew.textContent = "Build a new team instead";
            buildNew.onclick = () => {
                closeBottomSheet();
                openH2HTeamBuilder();
            };
            body.appendChild(buildNew);
        } else {
    const buildBtn = document.createElement("button");
    buildBtn.className = "h2h-challenge-btn";
    buildBtn.textContent = "⚡ Build a team to accept";
    buildBtn.onclick = () => {
        closeBottomSheet();
        // Store pending challenge so team builder auto-accepts after save
        h2hState.pendingAcceptChallengeId = challenge.id;
        openH2HTeamBuilder();
    };
    body.appendChild(buildBtn);
}
        const rejectBtn = document.createElement("button");
        rejectBtn.className = "h2h-challenge-btn danger";
        rejectBtn.style.marginTop = "8px";
        rejectBtn.textContent = "Decline";
        rejectBtn.onclick = () => rejectChallenge(challenge.id);
        body.appendChild(rejectBtn);
    });
}

async function acceptChallenge(challengeId, opponentTeamId) {
    // If opponentTeamId not provided, use the already-saved team
    let teamId = opponentTeamId || h2hState.team?.id;

    if (!teamId) {
        // Save a new team first
        const roles = ["WK", "BAT", "AR", "BOWL"];
        const allFilled = roles.every(r => h2hState.slots[r]);
        if (!allFilled) { showToast("Fill all 4 slots first.", "error"); return; }

// ✅ Replace:
const { data: team, error: tErr } = await supabase
    .from("h2h_teams")
    .upsert({
        user_id:         currentUserId,
        match_id:        h2hState.match.id,
        tournament_id:   currentTournamentId,
        captain_id:      h2hState.captainId,
        vice_captain_id: h2hState.vcId,
    }, { onConflict: "user_id,match_id" })
    .select().single();
if (tErr) { showToast("Error: " + tErr.message, "error"); return; }

await supabase.from("h2h_team_players").delete().eq("h2h_team_id", team.id);
await supabase.from("h2h_team_players").insert(
    roles.map(role => ({ h2h_team_id: team.id, player_id: h2hState.slots[role].id, role }))
);

        if (tErr) { showToast("Error: " + tErr.message, "error"); return; }

        await supabase.from("h2h_team_players").insert(
            roles.map(role => ({ h2h_team_id: team.id, player_id: h2hState.slots[role].id, role }))
        );
        teamId = team.id;
        h2hState.team = team;
    }

    const { error } = await supabase
        .from("h2h_challenges")
        .update({ status: "accepted", opponent_team_id: teamId, updated_at: new Date().toISOString() })
        .eq("id", challengeId);

    if (error) { showToast("Accept failed: " + error.message, "error"); return; }
    showToast("Challenge accepted! ⚔️ Good luck!", "success");
    closeBottomSheet();
    loadH2HChallenges();
}

async function rejectChallenge(challengeId) {
    const ok = await showConfirm("Decline challenge?", "This cannot be undone.");
    if (!ok) return;
    await supabase.from("h2h_challenges").update({ status: "rejected" }).eq("id", challengeId);
    showToast("Challenge declined.", "success");
    closeBottomSheet();
    loadH2HChallenges();
}

/* ─── LEADERBOARD SUB-PANEL ──────────────────────────────────────────────── */
async function loadH2HLeaderboard() {
    const panel = document.getElementById("h2h-sub-leaderboard");
    if (!panel) return;
    panel.innerHTML = `<div class="panel-spinner"></div>`;

    const { data: rows } = await supabase
        .from("h2h_leaderboard_view")
        .select("user_id, team_name, total_wins, total_points, rank")
        .order("rank", { ascending: true })
        .limit(20);

    panel.innerHTML = "";

    // Season standings
    const label = document.createElement("p");
    label.className = "as-section-label";
    label.textContent = "Season standings";
    panel.appendChild(label);

    if (!rows?.length) {
        panel.innerHTML += `<div class="h2h-empty"><div class="h2h-empty-icon">🏆</div><div class="h2h-empty-title">No results yet</div><p>Complete a match to see the leaderboard.</p></div>`;
    } else {
        rows.forEach(row => {
            const el = document.createElement("div");
            el.className = `h2h-lb-row ${row.user_id === currentUserId ? "you" : ""}`;

            el.innerHTML = `
                <span class="h2h-lb-rank">#${row.rank}</span>
                <span class="h2h-lb-name">${row.team_name || "Expert"}</span>
                <span class="h2h-lb-wins">${row.total_wins}W</span>
                <span class="h2h-lb-tb">${row.total_points}pts</span>`;
            panel.appendChild(el);
        });
    }

    // H2H filter bar
    const filterLabel = document.createElement("p");
    filterLabel.className = "as-section-label";
    filterLabel.style.marginTop = "20px";
    filterLabel.textContent = "Head-to-head filter";
    panel.appendChild(filterLabel);

    renderH2HFilterBar(panel, rows || []);
}

function renderH2HFilterBar(panel, users) {
    const bar = document.createElement("div");
    bar.className = "h2h-filter-bar";

    const makeSelect = (id) => {
        const sel = document.createElement("select");
        sel.className = "h2h-filter-select";
        sel.id = id;
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "Select user";
        sel.appendChild(defaultOpt);
        users.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.user_id;
            opt.textContent = u.team_name || "Expert";
            sel.appendChild(opt);
        });
        return sel;
    };

    const selA = makeSelect("h2h-filter-a");
    const vsLabel = document.createElement("span");
    vsLabel.className = "h2h-filter-vs";
    vsLabel.textContent = "vs";
    const selB = makeSelect("h2h-filter-b");

    bar.append(selA, vsLabel, selB);
    panel.appendChild(bar);

    const resultBox = document.createElement("div");
    resultBox.id = "h2h-filter-result";
    panel.appendChild(resultBox);

    const update = async () => {
        const aId = selA.value;
        const bId = selB.value;
        if (!aId || !bId || aId === bId) { resultBox.innerHTML = ""; return; }

        const { data: stats } = await supabase
            .from("h2h_season_stats")
            .select("user_a_id, user_b_id, user_a_wins, user_b_wins")
            .or(`and(user_a_id.eq.${aId},user_b_id.eq.${bId}),and(user_a_id.eq.${bId},user_b_id.eq.${aId})`)
            .maybeSingle();

        const nameA = selA.options[selA.selectedIndex]?.textContent || "A";
        const nameB = selB.options[selB.selectedIndex]?.textContent || "B";

        let winsA = 0, winsB = 0;
        if (stats) {
            if (stats.user_a_id === aId) { winsA = stats.user_a_wins; winsB = stats.user_b_wins; }
            else { winsA = stats.user_b_wins; winsB = stats.user_a_wins; }
        }
        const total = winsA + winsB || 1;
        const pctA  = Math.round((winsA / total) * 100);
        const pctB  = 100 - pctA;

        resultBox.innerHTML = `
            <div class="h2h-result-card">
                <div class="h2h-result-teams">
                    <div class="h2h-result-team">
                        <div class="h2h-result-team-name">${nameA}</div>
                        <div class="h2h-result-wins">${winsA}</div>
                        <div class="h2h-result-wins-label">wins</div>
                    </div>
                    <span class="h2h-result-vs-badge">vs</span>
                    <div class="h2h-result-team">
                        <div class="h2h-result-team-name">${nameB}</div>
                        <div class="h2h-result-wins">${winsB}</div>
                        <div class="h2h-result-wins-label">wins</div>
                    </div>
                </div>
                <div class="h2h-bar-track">
                    <div class="h2h-bar-a" style="width:${pctA}%"></div>
                    <div class="h2h-bar-b" style="width:${pctB}%"></div>
                </div>
                <div class="h2h-bar-labels"><span>${pctA}%</span><span>${pctB}%</span></div>
            </div>`;
    };

    selA.onchange = update;
    selB.onchange = update;
}

/* ─── LIVE SUB-PANEL ─────────────────────────────────────────────────────── */
async function loadH2HLive() {
    const panel = document.getElementById("h2h-sub-live");
    if (!panel) return;
    panel.innerHTML = `<div class="panel-spinner"></div>`;

    // Step 1 — get accepted challenges for this user
    const { data: challenges, error: cErr } = await supabase
        .from("h2h_challenges")
        .select("id, challenger_id, opponent_id, match_id, challenger_team_id, opponent_team_id")
        .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`)
        .eq("status", "accepted");

    if (!challenges?.length) {
        panel.innerHTML = `
            <div class="h2h-empty">
                <div class="h2h-empty-icon">⚔️</div>
                <div class="h2h-empty-title">No live battles</div>
                <p>Accepted challenges will appear here once the match starts.</p>
            </div>`;
        return;
    }

    // Step 2 — get match statuses separately
    const matchIds = [...new Set(challenges.map(c => c.match_id))];
// AFTER
const { data: matches } = await supabase
    .from("matches")
    .select("id, status, match_number")
    .in("id", matchIds)
    .eq("status", "locked")               // ✅ only truly live matches
    .eq("points_processed", false);        // ✅ exclude completed ones

    const liveMatchIds = new Set((matches || []).map(m => m.id));
    const matchMap = {};
    (matches || []).forEach(m => { matchMap[m.id] = m; });

    // Only keep challenges where match is live or completed
    const activeChallenges = challenges.filter(c => liveMatchIds.has(c.match_id));

    if (!activeChallenges.length) {
        panel.innerHTML = `
            <div class="h2h-empty">
                <div class="h2h-empty-icon">⚔️</div>
                <div class="h2h-empty-title">No live battles yet</div>
                <p>Your accepted challenges will appear here once the match starts.</p>
            </div>`;
        return;
    }

    // Step 3 — fetch results from the view
    const challengeIds = activeChallenges.map(c => c.id);
    const { data: results } = await supabase
        .from("h2h_results_view")
        .select("challenge_id, challenger_points, opponent_points, winner_id, challenger_name, opponent_name")
        .in("challenge_id", challengeIds);

    const resultsMap = {};
    (results || []).forEach(r => { resultsMap[r.challenge_id] = r; });

    // Step 4 — fetch all team players for these challenges
    const allTeamIds = [];
    activeChallenges.forEach(c => {
        if (c.challenger_team_id) allTeamIds.push(c.challenger_team_id);
        if (c.opponent_team_id)   allTeamIds.push(c.opponent_team_id);
    });

// ✅ Fixed:
const { data: teamPlayers } = await supabase
    .from("h2h_team_players")
    .select("h2h_team_id, player_id, role, players(name)")
    .in("h2h_team_id", allTeamIds);

    const teamPlayersMap = {};
    (teamPlayers || []).forEach(tp => {
        if (!teamPlayersMap[tp.h2h_team_id]) teamPlayersMap[tp.h2h_team_id] = [];
        teamPlayersMap[tp.h2h_team_id].push(tp);
    });

    // Step 5 — fetch player stats for all relevant players
    const allPlayerIds = (teamPlayers || []).map(tp => tp.player_id);
    const { data: allStats } = allPlayerIds.length
        ? await supabase
            .from("player_match_stats")
            .select("player_id, match_id, fantasy_points, players(name)")
            .in("player_id", allPlayerIds)
            .in("match_id", [...liveMatchIds])
        : { data: [] };

    const statsMap = {};
    (allStats || []).forEach(s => {
        statsMap[`${s.player_id}_${s.match_id}`] = s;
    });

    panel.innerHTML = "";

    activeChallenges.forEach(challenge => {
        const match      = matchMap[challenge.match_id];
        const result     = resultsMap[challenge.id];
        const isChallenger = challenge.challenger_id === currentUserId;

        const myTeamId    = isChallenger ? challenge.challenger_team_id : challenge.opponent_team_id;
        const theirTeamId = isChallenger ? challenge.opponent_team_id   : challenge.challenger_team_id;
        const myPlayers    = teamPlayersMap[myTeamId]    || [];
        const theirPlayers = teamPlayersMap[theirTeamId] || [];

        const myPts    = result ? (isChallenger ? result.challenger_points : result.opponent_points) : 0;
        const theirPts = result ? (isChallenger ? result.opponent_points   : result.challenger_points) : 0;
        const theirName = isChallenger ? result?.opponent_name : result?.challenger_name;

const isLive = match?.status === "locked";
        const iWin   = myPts >= theirPts;

        const card = document.createElement("div");
        card.className = "h2h-live-card";
        card.onclick = () => openLiveDetailSheet(challenge, statsMap, myPts, theirPts, theirName, match, myPlayers, theirPlayers);

        card.innerHTML = `
            <div class="h2h-live-header">
                <div class="h2h-live-badge">
                    ${isLive ? `<div class="h2h-live-dot"></div> Live` : "Completed"}
                </div>
                <span class="h2h-live-hint">Match ${match?.match_number || ""} · Tap for breakdown</span>
            </div>`;

        const vsRow = document.createElement("div");
        vsRow.className = "h2h-live-vs-row";

        const makeSide = (players, label) => {
            const side = document.createElement("div");
            side.className = "h2h-live-team";
            side.innerHTML = `<div class="h2h-live-team-name">${label}</div>`;
            players.forEach(tp => {
                const stat = statsMap[`${tp.player_id}_${challenge.match_id}`];
                const row = document.createElement("div");
                row.className = "h2h-live-player-row";
                row.innerHTML = `
                    <span class="h2h-live-role">${tp.role}</span>
<span class="h2h-live-pname">${stat?.players?.name?.split(" ").pop() || tp.players?.name?.split(" ").pop() || "—"}</span>                    <span class="h2h-live-pts">${stat?.fantasy_points || 0}</span>`;
                side.appendChild(row);
            });
            return side;
        };

        const mid = document.createElement("div");
        mid.className = "h2h-live-vs-mid";
        mid.innerHTML = `<span class="h2h-live-vs-text">vs</span>`;

        vsRow.append(makeSide(myPlayers, "You"), mid, makeSide(theirPlayers, theirName || "Opponent"));
        card.appendChild(vsRow);

        card.innerHTML += `
            <div class="h2h-live-totals">
                <div class="h2h-live-total-blk">
                    <div class="h2h-live-total-pts ${!iWin ? "losing" : ""}">${myPts}</div>
                    <div class="h2h-live-total-label">Your pts</div>
                    ${iWin ? `<div class="h2h-winning-badge">Winning</div>` : ""}
                </div>
                <div style="flex-shrink:0;padding:0 10px;color:var(--text-faint);font-size:12px;font-weight:900;">vs</div>
                <div class="h2h-live-total-blk">
                    <div class="h2h-live-total-pts ${iWin ? "losing" : ""}">${theirPts}</div>
                    <div class="h2h-live-total-label">${theirName || "Opponent"}</div>
                    ${!iWin ? `<div class="h2h-winning-badge" style="background:var(--red-dim);color:var(--red);border-color:rgba(239,68,68,0.25);">Trailing</div>` : ""}
                </div>
            </div>`;

        panel.appendChild(card);
    });
}



function openLiveDetailSheet(challenge, statsMap, myPts, theirPts, theirName, match, myPlayers, theirPlayers) {
    openBottomSheet((body) => {
const isLive = match?.status === "locked";
        body.innerHTML = "";

        const badge = document.createElement("div");
        badge.className = "h2h-live-badge";
        badge.style.marginBottom = "14px";
        badge.innerHTML = `${isLive ? `<div class="h2h-live-dot"></div> Live` : "Completed"} · Match ${match?.match_number || ""}`;
        body.appendChild(badge);

        const vsRow = document.createElement("div");
        vsRow.className = "h2h-live-vs-row";
        vsRow.style.marginBottom = "14px";

        const makeSide = (players, label) => {
            const side = document.createElement("div");
            side.className = "h2h-live-team";
            side.innerHTML = `<div class="h2h-live-team-name">${label}</div>`;
            players.forEach(tp => {
                const stat = statsMap[`${tp.player_id}_${challenge.match_id}`];
                const row = document.createElement("div");
                row.className = "h2h-live-player-row";
                row.innerHTML = `
                    <span class="h2h-live-role">${tp.role}</span>
                    <span class="h2h-live-pname">${stat?.players?.name?.split(" ").pop() || "—"}</span>
                    <span class="h2h-live-pts">${stat?.fantasy_points || 0}</span>`;
                side.appendChild(row);
            });
            return side;
        };

        const mid = document.createElement("div");
        mid.className = "h2h-live-vs-mid";
        mid.innerHTML = `<span class="h2h-live-vs-text">vs</span>`;

        vsRow.append(makeSide(myPlayers, "You"), mid, makeSide(theirPlayers, theirName || "Opponent"));
        body.appendChild(vsRow);

        const iWin = myPts >= theirPts;
        const totals = document.createElement("div");
        totals.className = "h2h-live-totals";
        totals.style.cssText = "background:var(--bg-card);border:1px solid var(--fun-cyan-bdr);border-radius:10px;padding:12px;";
        totals.innerHTML = `
            <div class="h2h-live-total-blk">
                <div class="h2h-live-total-pts ${!iWin ? "losing" : ""}">${myPts}</div>
                <div class="h2h-live-total-label">Your total</div>
                ${iWin ? `<div class="h2h-winning-badge">Winning +${myPts - theirPts}</div>` : ""}
            </div>
            <div style="flex-shrink:0;padding:0 10px;color:var(--text-faint);font-size:12px;font-weight:900;">vs</div>
            <div class="h2h-live-total-blk">
                <div class="h2h-live-total-pts ${iWin ? "losing" : ""}">${theirPts}</div>
                <div class="h2h-live-total-label">${theirName || "Opponent"}</div>
                ${!iWin ? `<div class="h2h-winning-badge" style="background:var(--red-dim);color:var(--red);">Trailing ${Math.abs(myPts - theirPts)}</div>` : ""}
            </div>`;
        body.appendChild(totals);
    });
}

/* ─── HOOK INTO TAB SWITCHER ─────────────────────────────────────────────── */
// Extend the existing switchTab function to load H2H when clicked
const _originalSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    _originalSwitchTab(tab);
    if (tab === "h2h") loadH2HPanel();
};