import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { getEffectiveRank, applyRankFlair } from "./animations.js";

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */
const TOTAL_SUBS_LIMIT     = 145;
const TOTAL_BOOSTERS       = 7;
const PLAYOFF_START_MATCH  = 81;

/* ─── ELEMENTS ───────────────────────────────────────────────────────────── */
const teamContainer      = document.getElementById("teamContainer");
const teamStatus         = document.getElementById("teamStatus");
const tabUpcoming        = document.getElementById("tabUpcoming");
const tabLocked          = document.getElementById("tabLocked");
const countdownContainer = document.getElementById("countdownContainer");
const timerDisplay       = document.getElementById("timer");
const tabs               = document.querySelectorAll(".xi-tab");
const viewTitle          = document.getElementById("viewTitle");
const historyBtn         = document.getElementById("viewHistoryBtn");
const historyOverlay     = document.getElementById("historyOverlay");
const historyList        = document.getElementById("historyList");
const historySubsRemaining = document.getElementById("historySubsRemaining");
const historyBoostersLeft  = document.getElementById("historyBoostersLeft");
const boosterIndicator   = document.getElementById("boosterIndicator");

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let userId;
let tournamentId;
let countdownInterval;
let isScoutMode = false;
let realTeamsMap = {};
let currentSession = null; // set by authReady so we don't call getSession() twice


/* ─── BOOSTER HELPERS ────────────────────────────────────────────────────── */
function getAppliedBooster(record) {
    if (typeof record?.active_booster === "string" && record.active_booster !== "NONE") {
        return record.active_booster;
    }
    return record?.use_booster ? "TOTAL_2X" : "NONE";
}

function formatBoosterLabel(booster) {
    return booster === "NONE" ? "" : booster.replaceAll("_", " ");
}

function updateBoosterIndicator(element, booster) {
    if (!element) return;
    if (!booster || booster === "NONE") {
        element.classList.add("hidden");
        element.textContent = "";
        return;
    }
    element.textContent = `🚀 ${formatBoosterLabel(booster)}`;
    element.classList.remove("hidden");
}

/* ─── DOM HELPERS ────────────────────────────────────────────────────────── */
function setEmptyState(container, message) {
    if (!container) return;
    const p = document.createElement("p");
    p.className   = "empty-msg";
    p.textContent = message;
    container.replaceChildren(p);
}

function setSpinner(container) {
    if (!container) return;
    const d = document.createElement("div");
    d.className = "spinner-small";
    container.replaceChildren(d);
}

function setTeamStatus(message = "") {
    if (!teamStatus) return;
    teamStatus.textContent = message;
}

function getPhotoUrl(bucketName, path) {
    if (!path) return "images/default-avatar.png";
    return supabase.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
}

function createRoleTitle(role) {
    const el = document.createElement("div");
    el.className   = "role-title";
    el.textContent = role;
    return el;
}

/* ─── POINTS CALCULATION ─────────────────────────────────────────────────── */
function getBoostedBasePoints(player, basePoints, booster, momId = null) {
    switch (booster) {
        case "TOTAL_2X":    return basePoints * 2;
        case "OVERSEAS_2X": return player.category === "overseas" ? basePoints * 2 : basePoints;
        case "UNCAPPED_2X": return player.category === "uncapped" ? basePoints * 2 : basePoints;
        case "INDIAN_2X":   return (player.category === "none" || player.category === "uncapped") ? basePoints * 2 : basePoints;
        case "MOM_2X":      return player.id === momId ? basePoints * 2 : basePoints;
        default:            return basePoints;
    }
}

function calculateDisplayedPlayerPoints(player, statsMap, captainId, viceCaptainId, booster, momId = null) {
    const appliedBooster = getAppliedBooster({ active_booster: booster });
    const basePoints     = statsMap?.[player.id] || 0;
    let   totalPoints    = getBoostedBasePoints(player, basePoints, appliedBooster, momId);
    const gotBoosted     = totalPoints > basePoints;

    if (player.id === captainId) {
        totalPoints += appliedBooster === "CAPTAIN_3X"
            ? (basePoints * 2)
            : gotBoosted ? (basePoints * 2) : basePoints;
    } else if (player.id === viceCaptainId) {
        totalPoints += gotBoosted
            ? Math.floor(totalPoints * 0.5)
            : Math.floor(basePoints * 0.5);
    }
    return totalPoints;
}

function calculateMatchTotal(players, statsMap, captainId, viceCaptainId, booster, momId = null) {
    return (players || []).reduce((sum, p) =>
        sum + calculateDisplayedPlayerPoints(p, statsMap || {}, captainId, viceCaptainId, booster, momId), 0);
}

/* ─── PLAYER CIRCLE ──────────────────────────────────────────────────────── */
function buildPlayerCircle(player, captainId, viceCaptainId, statsMap, matchId = null, booster = "NONE", momId = null) {
    const wrapper = document.createElement("div");
    wrapper.className = "player-circle";
    if (player.id === captainId)    wrapper.classList.add("captain");
    if (player.id === viceCaptainId) wrapper.classList.add("vice-captain");

    if (matchId) {
        wrapper.style.cursor = "pointer";
        wrapper.addEventListener("click", () => window.openPlayerPointLog(player.id, matchId));
    }

    if (player.id === captainId) {
        const badge = document.createElement("div");
        badge.className   = "badge captain-badge";
        badge.textContent = "C";
        wrapper.appendChild(badge);
    }

    if (player.id === viceCaptainId) {
        const badge = document.createElement("div");
        badge.className   = "badge vice-badge";
        badge.textContent = "VC";
        wrapper.appendChild(badge);
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundImage = `url('${getPhotoUrl("player-photos", player.photo_url)}')`;

    const teamLabel = document.createElement("div");
    teamLabel.className   = "team-init-label";
    teamLabel.textContent = realTeamsMap[player.real_team_id] || "TBA";
    avatar.appendChild(teamLabel);

    const name = document.createElement("div");
    name.className   = "player-name";
    name.textContent = player.name ? player.name.split(" ").pop() : "Player";

    wrapper.append(avatar, name);

    if (statsMap) {
        const pts = document.createElement("div");
        pts.className   = "player-pts";
        pts.textContent = `${calculateDisplayedPlayerPoints(player, statsMap, captainId, viceCaptainId, booster, momId)} pts`;
        wrapper.appendChild(pts);
    }

    return wrapper;
}

/* ─── HISTORY ROW ────────────────────────────────────────────────────────── */
// BUG FIX #6: Replaced '|| *' placeholder with two distinct styled chips.
// Points and subs are now visually separated — no hacky delimiter.
function createHistoryRow(snapshot, totalPoints) {
    const row = document.createElement("div");
    row.className = "history-row";

    if (totalPoints >= 300)      row.classList.add("tier-gold");
    else if (totalPoints >= 200) row.classList.add("tier-silver");
    else                         row.classList.add("tier-bronze");

    row.addEventListener("click", () => window.viewMatchBreakdown(snapshot.id));

    // Left column
    const left = document.createElement("div");
    left.className = "h-left";

    const matchNum = document.createElement("span");
    matchNum.className   = "h-m-num";
    matchNum.textContent = `Match ${snapshot.matches.match_number}`;
    left.appendChild(matchNum);

    const booster = getAppliedBooster(snapshot);
    if (booster !== "NONE") {
        const boosterTag = document.createElement("span");
        boosterTag.className   = "h-booster";
        boosterTag.textContent = formatBoosterLabel(booster);
        left.appendChild(boosterTag);
    }

    const teams = document.createElement("span");
    teams.className   = "h-teams";
    teams.textContent = `${realTeamsMap[snapshot.matches.team_a_id] || "TBA"} vs ${realTeamsMap[snapshot.matches.team_b_id] || "TBA"}`;
    left.appendChild(teams);

    // Right column — two chips, clearly separated
    const right = document.createElement("div");
    right.className = "h-right";

const ptsPill = document.createElement("span");
ptsPill.className   = `h-pts-pill${totalPoints > 0 ? " has-pts" : ""}`;
ptsPill.textContent = `${totalPoints} pts`;

    const subsPill = document.createElement("span");
    subsPill.className   = "h-subs-pill";
    subsPill.textContent = `${snapshot.subs_used_for_match} subs`;

    const arrow = document.createElement("i");
    arrow.className = "fas fa-chevron-right h-arrow";

    right.append(ptsPill, subsPill, arrow);
    row.append(left, right);
    return row;
}

/* ─── HISTORY SUMMARY ────────────────────────────────────────────────────── */
function formatSubsRemaining(subs) {
    return subs === 999 ? "∞" : String(subs);
}

function renderHistorySummary({ subsRemaining, boostersLeft }) {
    if (historySubsRemaining) historySubsRemaining.textContent = formatSubsRemaining(subsRemaining);
    if (historyBoostersLeft)  historyBoostersLeft.textContent  = `${boostersLeft}/${TOTAL_BOOSTERS}`;
}

async function fetchHistorySummaryData(history = []) {
    const [dashboardRes, boosterRes, upcomingRes] = await Promise.all([
        supabase.from("home_dashboard_view").select("subs_remaining").eq("user_id", userId).maybeSingle(),
        supabase.from("user_tournament_points").select("used_boosters").eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle(),
        supabase.from("matches").select("match_number").eq("tournament_id", tournamentId).eq("status", "upcoming").order("actual_start_time", { ascending: true }).limit(1).maybeSingle(),
    ]);

    const usedBoosters = boosterRes.data?.used_boosters ?? [];
    const fallbackTotal = history[0]?.total_subs_used ?? 0;
    let fallbackSubs    = Math.max(0, TOTAL_SUBS_LIMIT - fallbackTotal);

    if (upcomingRes.data?.match_number === 1 || upcomingRes.data?.match_number === PLAYOFF_START_MATCH) {
        fallbackSubs = 999;
    }

    return {
        subsRemaining: dashboardRes.data?.subs_remaining ?? fallbackSubs,
        boostersLeft:  Math.max(0, TOTAL_BOOSTERS - usedBoosters.length),
    };
}

async function fetchUserMatchTotal(matchId) {
    const { data } = await supabase
        .from("user_match_points")
        .select("total_points")
        .eq("user_id", userId)
        .eq("match_id", matchId)
        .maybeSingle();
    return data?.total_points ?? null;
}

async function fetchUserMatchTotals(matchIds) {
    if (!matchIds.length) return new Map();
    const { data } = await supabase
        .from("user_match_points")
        .select("match_id, total_points")
        .eq("user_id", userId)
        .in("match_id", matchIds);
    return new Map((data || []).map(r => [r.match_id, r.total_points]));
}

/* ─── PAGE REVEAL ────────────────────────────────────────────────────────── */
function revealApp() {
    if (document.body.classList.contains("loaded")) return;
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = "none";
    }, 600);
}

// BUG FIX #3: Reduced to 3s — 6s was too long. Comment kept for prod visibility.
setTimeout(() => {
    if (document.body.classList.contains("loading-state")) {
        console.warn("Safety fallback: revealing team view after timeout.");
        revealApp();
    }
}, 3000);

/* ─── INIT ───────────────────────────────────────────────────────────────── */
// BUG FIX #1: Replaced direct supabase.auth.getSession() with authReady.
// auth-guard.js handles redirect to login if no session exists.
async function boot() {
    try {
        currentSession = { user: await authReady };
    } catch (_) {
        // auth-guard.js already redirected to login
        return;
    }
    init();
}

boot();

async function init() {
    try {
        const { data: teamData } = await supabase.from("real_teams").select("id, short_code");
        realTeamsMap = Object.fromEntries((teamData || []).map(t => [t.id, t.short_code]));

        const user       = currentSession.user;
        const urlParams  = new URLSearchParams(window.location.search);
        const scoutUid   = urlParams.get("uid");
        const scoutName  = urlParams.get("name");

        const { data: activeTournament } = await supabase
            .from("active_tournament").select("*").maybeSingle();
        if (!activeTournament) return;
        tournamentId = activeTournament.id;

        if (scoutUid && scoutUid !== user.id) {
            // ── SCOUT MODE ──────────────────────────────────────────────────
            userId     = scoutUid;
            isScoutMode = true;

            const { data: profile } = await supabase
                .from("user_profiles")
                .select("team_name")
                .eq("user_id", scoutUid)
                .maybeSingle();

            viewTitle.textContent = profile?.team_name
                || decodeURIComponent(scoutName || "")
                || "User Team";

            const [overallRes, privateRes] = await Promise.all([
                supabase.from("leaderboard_view").select("rank").eq("user_id", scoutUid).eq("tournament_id", tournamentId).maybeSingle(),
                supabase.from("private_league_leaderboard").select("rank_in_league").eq("user_id", scoutUid).maybeSingle(),
            ]);

            applyRankFlair(null, viewTitle,
                getEffectiveRank(overallRes.data?.rank ?? Infinity, privateRes.data?.rank_in_league ?? Infinity));

            tabUpcoming.style.display = "none";
            tabLocked.classList.add("active");

        } else {
            // ── OWN TEAM MODE ────────────────────────────────────────────────
            userId = user.id;

            const [profileRes, overallRes, privateRes] = await Promise.all([
                supabase.from("user_profiles").select("team_name").eq("user_id", userId).maybeSingle(),
                supabase.from("leaderboard_view").select("rank").eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle(),
                supabase.from("private_league_leaderboard").select("rank_in_league").eq("user_id", userId).maybeSingle(),
            ]);

            viewTitle.textContent = profileRes.data?.team_name || "My XI";
            applyRankFlair(null, viewTitle,
                getEffectiveRank(overallRes.data?.rank ?? Infinity, privateRes.data?.rank_in_league ?? Infinity));
        }

        await Promise.allSettled([
            setupMatchTabs(),
            isScoutMode ? loadLastLockedXI() : loadCurrentXI(),
        ]);

        setupHistoryListeners();

    } catch (err) {
        console.error("Init error:", err);
    } finally {
        revealApp();
    }
}

/* ─── MATCH TABS ─────────────────────────────────────────────────────────── */
async function setupMatchTabs() {
    if (!isScoutMode) {
        const { data: upcoming } = await supabase
            .from("matches")
            .select("*")
            .eq("tournament_id", tournamentId)
            .eq("status", "upcoming")
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (upcoming) {
            tabUpcoming.textContent       = `${realTeamsMap[upcoming.team_a_id] || "TBA"} vs ${realTeamsMap[upcoming.team_b_id] || "TBA"} – Edit`;
            tabUpcoming.dataset.startTime = upcoming.actual_start_time;
        }
    }

    const { data: lastLocked } = await supabase
        .from("user_match_teams")
        .select("match_id")
        .eq("user_id", userId)
        .eq("tournament_id", tournamentId)
        .order("locked_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lastLocked) {
        const { data: matchInfo } = await supabase
            .from("matches").select("*").eq("id", lastLocked.match_id).single();
        if (matchInfo) {
            tabLocked.textContent = `${realTeamsMap[matchInfo.team_a_id] || "TBA"} vs ${realTeamsMap[matchInfo.team_b_id] || "TBA"} – Locked`;
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            if (tab.dataset.tab === "current") loadCurrentXI();
            else loadLastLockedXI();
        });
    });
}

/* ─── COUNTDOWN ──────────────────────────────────────────────────────────── */
function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownContainer.classList.remove("hidden");

    const update = () => {
        const diff = new Date(startTime) - new Date();
        if (diff <= 0) {
            timerDisplay.textContent = "Live";
            clearInterval(countdownInterval);
            return;
        }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        timerDisplay.textContent = `${h}h ${m}m ${s}s`;
    };

    update();
    countdownInterval = setInterval(update, 1000);
}

/* ─── CURRENT XI ─────────────────────────────────────────────────────────── */
async function loadCurrentXI() {
    if (isScoutMode) return;

    clearInterval(countdownInterval);
    setTeamStatus("");
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    const [{ data: userTeam }, { data: pointsData }] = await Promise.all([
        supabase.from("user_fantasy_teams").select("*").eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle(),
        supabase.from("user_tournament_points").select("used_boosters").eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle(),
    ]);

    if (!userTeam) {
        setEmptyState(teamContainer, "Team not created yet.");
        updateBoosterIndicator(boosterIndicator, "NONE");
        return;
    }

    const usedBoosters  = pointsData?.used_boosters || [];
    let currentBooster  = getAppliedBooster(userTeam);
    if (usedBoosters.includes(currentBooster)) currentBooster = "NONE";
    updateBoosterIndicator(boosterIndicator, currentBooster);

    const { data: teamPlayers } = await supabase
        .from("user_fantasy_team_players")
        .select("player_id")
        .eq("user_fantasy_team_id", userTeam.id);

    const playerIds = (teamPlayers || []).map(p => p.player_id);
    if (!playerIds.length) { setEmptyState(teamContainer, "No players selected yet."); return; }

    const { data: players } = await supabase.from("players").select("*").in("id", playerIds);
    renderTeamLayout(players || [], userTeam.captain_id, userTeam.vice_captain_id, null, teamContainer, null, currentBooster, null);
}

/* ─── LAST LOCKED XI ─────────────────────────────────────────────────────── */
async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    const { data: snapshot } = await supabase
        .from("user_match_teams")
        .select("*, matches(man_of_the_match_id)")
        .eq("user_id", userId)
        .eq("tournament_id", tournamentId)
        .order("locked_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!snapshot) {
        setEmptyState(teamContainer, "Not playing yet.");
        setTeamStatus("");
        updateBoosterIndicator(boosterIndicator, "NONE");
        return;
    }

    const momId   = snapshot.matches?.man_of_the_match_id || null;
    const booster = getAppliedBooster(snapshot);
    updateBoosterIndicator(boosterIndicator, booster);

    const { data: teamPlayers } = await supabase
        .from("user_match_team_players")
        .select("player_id")
        .eq("user_match_team_id", snapshot.id);

    const playerIds = (teamPlayers || []).map(p => p.player_id);

    const [{ data: players }, { data: stats }] = await Promise.all([
        playerIds.length ? supabase.from("players").select("*").in("id", playerIds) : Promise.resolve({ data: [] }),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id),
    ]);

    const statsMap    = Object.fromEntries((stats || []).map(r => [r.player_id, r.fantasy_points]));
    const teamPlayers_ = players || [];

    renderTeamLayout(teamPlayers_, snapshot.captain_id, snapshot.vice_captain_id, statsMap, teamContainer, snapshot.match_id, booster, momId);

    const fallback   = calculateMatchTotal(teamPlayers_, statsMap, snapshot.captain_id, snapshot.vice_captain_id, booster, momId);
    const finalTotal = await fetchUserMatchTotal(snapshot.match_id) ?? fallback;
    setTeamStatus(`${finalTotal} pts · ${snapshot.subs_used_for_match} subs used`);
}

/* ─── TEAM LAYOUT RENDERER ───────────────────────────────────────────────── */
function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container, matchId = null, booster = "NONE", momId = null) {
    container.replaceChildren();
    for (const role of ["WK", "BAT", "AR", "BOWL"]) {
        const rolePlayers = players.filter(p => p.role === role);
        if (!rolePlayers.length) continue;

        const section = document.createElement("div");
        section.className = "role-section";
        section.appendChild(createRoleTitle(role));

        const row = document.createElement("div");
        row.className = "player-row";
        rolePlayers.forEach(p => row.appendChild(
            buildPlayerCircle(p, captainId, viceCaptainId, statsMap, matchId, booster, momId)
        ));

        section.appendChild(row);
        container.appendChild(section);
    }
}

/* ─── HISTORY ────────────────────────────────────────────────────────────── */
function setupHistoryListeners() {
    if (!historyBtn) return;

    let isFetchingHistory = false;

    historyBtn.onclick = async () => {
        if (isFetchingHistory) return;
        isFetchingHistory = true;


        document.body.style.overflow = "hidden";
        historyOverlay.classList.remove("hidden");
        setSpinner(historyList);

        try {
            const { data: history } = await supabase
                .from("user_match_teams")
                .select("*, matches(match_number, team_a_id, team_b_id, man_of_the_match_id), user_match_team_players(player_id)")
                .eq("user_id", userId)
                .eq("tournament_id", tournamentId)
                .order("locked_at", { ascending: false });

            const summaryData = await fetchHistorySummaryData(history || []);
            renderHistorySummary(summaryData);

            if (!history?.length) {
                setEmptyState(historyList, "No season history yet.");
                return;
            }

            const matchIds      = history.map(s => s.match_id);
            const allPlayerIds  = [...new Set(history.flatMap(s => (s.user_match_team_players || []).map(p => p.player_id)))];

            const [{ data: allStats }, { data: playerCats }] = await Promise.all([
                supabase.from("player_match_stats").select("*").in("match_id", matchIds),
                allPlayerIds.length
                    ? supabase.from("players").select("id, category").in("id", allPlayerIds)
                    : Promise.resolve({ data: [] }),
            ]);

            const matchTotals  = await fetchUserMatchTotals(matchIds);
            const categoryMap  = new Map((playerCats || []).map(p => [p.id, p.category]));

            historyList.replaceChildren();
            history.forEach(snapshot => {
                const momId       = snapshot.matches?.man_of_the_match_id || null;
                const statsMap    = Object.fromEntries(
                    (allStats || []).filter(s => s.match_id === snapshot.match_id)
                                    .map(s => [s.player_id, s.fantasy_points])
                );
                const fallPlayers = (snapshot.user_match_team_players || []).map(p => ({
                    id: p.player_id, category: categoryMap.get(p.player_id) || null,
                }));
                const fallback    = calculateMatchTotal(fallPlayers, statsMap, snapshot.captain_id, snapshot.vice_captain_id, getAppliedBooster(snapshot), momId);
                historyList.appendChild(
                    createHistoryRow(snapshot, matchTotals.get(snapshot.match_id) ?? fallback)
                );
            });
        } finally {
            isFetchingHistory = false;
        }
    };

    document.getElementById("closeHistory").onclick = () => {
        historyOverlay.classList.add("hidden");
        document.body.style.overflow = "";
    };

    document.getElementById("closePPL").onclick = () => {
        document.getElementById("playerPointLogOverlay").classList.add("hidden");
    };

    document.getElementById("backToHistory").onclick = () => {
        const overlay = document.getElementById("breakdownOverlay");
        // BUG FIX #13: Reset breakdown scroll position when going back
        overlay.querySelector(".breakdown-body")?.scrollTo(0, 0);
        overlay.classList.add("hidden");
    };
}

/* ─── BREAKDOWN OVERLAY ──────────────────────────────────────────────────── */
window.viewMatchBreakdown = async snapshotId => {
    const breakdownContainer = document.getElementById("breakdownTeamContainer");
    const breakdownFooter    = document.getElementById("breakdownFooter");
    const breakdownTitle     = document.getElementById("breakdownTitle");
    const breakdownBooster   = document.getElementById("breakdownBooster");
    const breakdownOverlay   = document.getElementById("breakdownOverlay");

    breakdownOverlay.classList.remove("hidden");
    // BUG FIX #13: Always reset scroll when opening a new breakdown
    breakdownOverlay.querySelector(".breakdown-body")?.scrollTo(0, 0);
    setSpinner(breakdownContainer);

    const [{ data: snapshot }, { data: teamPlayers }] = await Promise.all([
        supabase.from("user_match_teams").select("*, matches(*)").eq("id", snapshotId).single(),
        supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshotId),
    ]);

    if (!snapshot) { setEmptyState(breakdownContainer, "Data unavailable."); return; }

    const momId   = snapshot.matches?.man_of_the_match_id || null;
    const booster = getAppliedBooster(snapshot);
    breakdownTitle.textContent = `Match ${snapshot.matches.match_number}`;
    updateBoosterIndicator(breakdownBooster, booster);

    const playerIds = (teamPlayers || []).map(p => p.player_id);
    const [{ data: players }, { data: stats }] = await Promise.all([
        playerIds.length ? supabase.from("players").select("*").in("id", playerIds) : Promise.resolve({ data: [] }),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id),
    ]);

    const statsMap = Object.fromEntries((stats || []).map(s => [s.player_id, s.fantasy_points]));
    const bPlayers = players || [];

    renderTeamLayout(bPlayers, snapshot.captain_id, snapshot.vice_captain_id, statsMap, breakdownContainer, snapshot.match_id, booster, momId);

    const fallback   = calculateMatchTotal(bPlayers, statsMap, snapshot.captain_id, snapshot.vice_captain_id, booster, momId);
    const finalTotal = await fetchUserMatchTotal(snapshot.match_id) ?? fallback;

    // BUG FIX #9: removed inline style — uses .breakdown-footer-text class
    breakdownFooter.innerHTML = `
        <span class="breakdown-pts">${finalTotal} pts</span>
        <span class="breakdown-subs">${snapshot.subs_used_for_match} subs</span>`;
};

/* ─── PLAYER POINT LOG ───────────────────────────────────────────────────── */
window.openPlayerPointLog = async (playerId, matchId) => {
    const content = document.getElementById("pplContent");
    document.getElementById("playerPointLogOverlay").classList.remove("hidden");
    setSpinner(content);

    const { data: matchStat } = await supabase
        .from("player_match_stats")
        .select("*, players(name)")
        .eq("match_id", matchId)
        .eq("player_id", playerId)
        .single();

    if (!matchStat) { setEmptyState(content, "Data unavailable."); return; }

    document.getElementById("pplPlayerName").textContent = matchStat.players.name;

    // BUG FIX #14: Display raw DB values where available rather than
    // recalculating formulas client-side. Fallback to formula only if field missing.
    const log = [];
    if (matchStat.runs > 0)               log.push({ label: `${matchStat.runs} Runs`,         pts: `+${matchStat.run_points         ?? matchStat.runs}` });
    if (matchStat.boundary_points > 0)    log.push({ label: "Boundaries",                      pts: `+${matchStat.boundary_points}` });
    if (matchStat.milestone_points > 0)   log.push({ label: "Milestone",                        pts: `+${matchStat.milestone_points}` });
    if (matchStat.sr_points !== 0)        log.push({ label: "Strike Rate",                      pts: `${matchStat.sr_points > 0 ? "+" : ""}${matchStat.sr_points}` });
    if (matchStat.wickets > 0)            log.push({ label: `${matchStat.wickets} Wickets`,     pts: `+${matchStat.wicket_points ?? (20 + Math.max(0, matchStat.wickets - 1) * 25)}` });
    if (matchStat.er_points !== 0)        log.push({ label: "Economy",                           pts: `${matchStat.er_points > 0 ? "+" : ""}${matchStat.er_points}` });
    if (matchStat.catches > 0)            log.push({ label: `${matchStat.catches} Catch${matchStat.catches > 1 ? "es" : ""}`, pts: `+${matchStat.catches * 8}` });
    if (matchStat.involvement_points > 0) log.push({ label: "Active",                            pts: `+${matchStat.involvement_points}` });
    if (matchStat.is_player_of_match)     log.push({ label: "Player of Match",                  pts: "+20" });
    if (matchStat.duck_penalty < 0)       log.push({ label: "Duck Penalty",                     pts: `${matchStat.duck_penalty}` });

    const list = document.createElement("div");
    list.className = "log-items";

    log.forEach(entry => {
        const row = document.createElement("div");
        row.className = "log-entry";

        const label = document.createElement("span");
        label.className   = "log-label";
        label.textContent = entry.label;

        const pts = document.createElement("span");
        pts.className   = "log-pts";
        pts.textContent = entry.pts;

        row.append(label, pts);
        list.appendChild(row);
    });

    // BUG FIX #5: Replaced inline style.cssText with CSS class
    const total = document.createElement("div");
    total.className   = "log-total";
    total.textContent = `Base Total: ${matchStat.fantasy_points} pts`;

    content.replaceChildren(list, total);
};