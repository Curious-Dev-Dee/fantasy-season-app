import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS & STATE
========================= */
const teamContainer = document.getElementById("teamContainer");
const teamStatus = document.getElementById("teamStatus");
const tabUpcoming = document.getElementById("tabUpcoming");
const tabLocked = document.getElementById("tabLocked");
const countdownContainer = document.getElementById("countdownContainer");
const timerDisplay = document.getElementById("timer");
const tabs = document.querySelectorAll(".xi-tab");
const viewTitle = document.getElementById("viewTitle");
const historyBtn = document.getElementById("viewHistoryBtn");
const historyOverlay = document.getElementById("historyOverlay");
const historyList = document.getElementById("historyList");
const historySummary = document.getElementById("historySummary");
const historySubsRemaining = document.getElementById("historySubsRemaining");
const historyBoostersLeft = document.getElementById("historyBoostersLeft");
const boosterIndicator = document.getElementById("boosterIndicator");

const TOTAL_SUBS_LIMIT = 150;
const TOTAL_BOOSTERS = 7;
const PLAYOFF_START_MATCH = 71;

let userId;
let tournamentId;
let countdownInterval;
let isScoutMode = false;
let realTeamsMap = {};

function getAppliedBooster(record) {
    if (typeof record?.active_booster === "string" && record.active_booster !== "NONE") {
        return record.active_booster;
    }
    return record?.use_booster ? "TOTAL_2X" : "NONE";
}

function formatBoosterLabel(booster) {
    return booster === "NONE" ? "" : booster.replaceAll("_", " ");
}

function updateBoosterIndicator(element, booster, suffix) {
    if (!element) return;

    if (!booster || booster === "NONE") {
        element.classList.add("hidden");
        element.textContent = "";
        return;
    }

    element.textContent = `BOOSTER: ${formatBoosterLabel(booster)} ${suffix}`;
    element.classList.remove("hidden");
}

function setEmptyState(container, message) {
    if (!container) return;
    const text = document.createElement("p");
    text.className = "empty-msg";
    text.textContent = message;
    container.replaceChildren(text);
}

function setSpinner(container) {
    if (!container) return;
    const spinner = document.createElement("div");
    spinner.className = "spinner-small";
    container.replaceChildren(spinner);
}

function setTeamStatus(message = "") {
    if (!teamStatus) return;
    teamStatus.textContent = message;
}

function getPhotoUrl(bucketName, path) {
    if (!path) {
        return "https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png";
    }
    return supabase.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
}

function createRoleTitle(role) {
    const title = document.createElement("div");
    title.className = "role-title";
    title.textContent = role;
    return title;
}

// 🟢 ADDED: momId parameter to handle Man of the Match 2X booster
function getBoostedBasePoints(player, basePoints, booster, momId = null) {
    switch (booster) {
        case "TOTAL_2X":
            return basePoints * 2;
        case "OVERSEAS_2X":
            return player.category === "overseas" ? basePoints * 2 : basePoints;
        case "UNCAPPED_2X":
            return player.category === "uncapped" ? basePoints * 2 : basePoints;
        case "INDIAN_2X": 
            return (player.category === "none" || player.category === "uncapped") ? basePoints * 2 : basePoints;
        case "MOM_2X": 
            return player.id === momId ? basePoints * 2 : basePoints;
        default:
            return basePoints;
    }
}

// 🟢 ADDED: momId parameter
function calculateDisplayedPlayerPoints(player, statsMap, captainId, viceCaptainId, booster, momId = null) {
    const appliedBooster = getAppliedBooster({ active_booster: booster });
    const basePoints = statsMap?.[player.id] || 0;
    
    // 1. Get their base points (boosted if applicable)
    let totalPoints = getBoostedBasePoints(player, basePoints, appliedBooster, momId);

    // 2. Did this specific player get boosted?
    const gotBoosted = totalPoints > basePoints; 

    // 3. Apply Captain / VC Math
    if (player.id === captainId) {
        if (appliedBooster === "CAPTAIN_3X") {
            totalPoints += (basePoints * 2); // Base + 2x Bonus = 3x
        } else if (gotBoosted) {
            totalPoints += (basePoints * 2); // If base doubled, bonus doubles = 4x
        } else {
            totalPoints += basePoints;       // Normal 2x
        }
    } else if (player.id === viceCaptainId) {
        if (gotBoosted) {
            // FIXED: Halve the actual boosted total, not the base!
            totalPoints += Math.floor(totalPoints * 0.5); 
        } else {
            totalPoints += Math.floor(basePoints * 0.5);     // Normal 1.5x
        }
    }

    return totalPoints;
}

// 🟢 ADDED: momId parameter
function calculateMatchTotal(players, statsMap, captainId, viceCaptainId, booster, momId = null) {
    return (players || []).reduce((sum, player) => (
        sum + calculateDisplayedPlayerPoints(player, statsMap || {}, captainId, viceCaptainId, booster, momId)
    ), 0);
}

// 🟢 ADDED: momId parameter
function buildPlayerCircle(player, captainId, viceCaptainId, statsMap, matchId = null, booster = "NONE", momId = null) {
    const wrapper = document.createElement("div");
    wrapper.className = "player-circle";
    if (player.id === captainId) wrapper.classList.add("captain");
    if (player.id === viceCaptainId) wrapper.classList.add("vice-captain");

    if (matchId) {
        wrapper.style.cursor = "pointer";
        wrapper.addEventListener("click", () => window.openPlayerPointLog(player.id, matchId));
    }

    if (player.id === captainId) {
        const badge = document.createElement("div");
        badge.className = "badge captain-badge";
        badge.textContent = "C";
        wrapper.appendChild(badge);
    }

    if (player.id === viceCaptainId) {
        const badge = document.createElement("div");
        badge.className = "badge vice-badge";
        badge.textContent = "VC";
        wrapper.appendChild(badge);
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundImage = `url('${getPhotoUrl("player-photos", player.photo_url)}')`;

    const teamLabel = document.createElement("div");
    teamLabel.className = "team-init-label";
    teamLabel.textContent = realTeamsMap[player.real_team_id] || "TBA";
    avatar.appendChild(teamLabel);

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name ? player.name.split(" ").pop() : "Player";

    wrapper.append(avatar, name);

    if (statsMap) {
        const displayPoints = calculateDisplayedPlayerPoints(
            player,
            statsMap,
            captainId,
            viceCaptainId,
            booster,
            momId
        );

        const points = document.createElement("div");
        points.className = "player-pts";
        points.textContent = `${displayPoints} pts`;
        wrapper.appendChild(points);
    }

    return wrapper;
}

function createHistoryRow(snapshot, totalPoints) {
    const row = document.createElement("div");
    row.className = "history-row";

    if (totalPoints >= 300) {
        row.classList.add("tier-gold");
    } else if (totalPoints >= 200) {
        row.classList.add("tier-silver");
    } else {
        row.classList.add("tier-red");
    }
    
    row.addEventListener("click", () => window.viewMatchBreakdown(snapshot.id));

    const left = document.createElement("div");

    const matchNum = document.createElement("span");
    matchNum.className = "h-m-num";
    matchNum.textContent = `MATCH ${snapshot.matches.match_number}${getAppliedBooster(snapshot) !== "NONE" ? " [BOOSTER]" : ""}`;

    const teams = document.createElement("span");
    teams.className = "h-teams";
    teams.textContent = `${realTeamsMap[snapshot.matches.team_a_id] || "TBA"} vs ${realTeamsMap[snapshot.matches.team_b_id] || "TBA"}`;

    left.append(matchNum);

    const booster = getAppliedBooster(snapshot);
    if (booster !== "NONE") {
        const boosterTag = document.createElement("span");
        boosterTag.className = "h-booster";
        boosterTag.textContent = formatBoosterLabel(booster);
        left.appendChild(boosterTag);
    }

    left.appendChild(teams);

    const stats = document.createElement("div");
    stats.className = "h-stats";

    const points = document.createElement("span");
    points.className = "h-pts";
    points.textContent = `${totalPoints} PTS || *`;

    const subs = document.createElement("span");
    subs.className = "h-subs";
    subs.textContent = `${snapshot.subs_used_for_match} SUBS`;

    stats.append(points, subs);

    const arrow = document.createElement("i");
    arrow.className = "fas fa-chevron-right";
    arrow.style.color = "#475569";
    arrow.style.marginLeft = "10px";

    row.append(left, stats, arrow);
    return row;
}

function formatSubsRemaining(subsRemaining) {
    return subsRemaining === 999 ? "UNLIMITED" : String(subsRemaining);
}

function renderHistorySummary({ subsRemaining, boostersLeft }) {
    if (!historySummary || !historySubsRemaining || !historyBoostersLeft) return;
    historySubsRemaining.textContent = formatSubsRemaining(subsRemaining);
    historyBoostersLeft.textContent = `${boostersLeft}/${TOTAL_BOOSTERS}`;
}

async function fetchHistorySummaryData(history = []) {
    const [dashboardRes, boosterRes, upcomingRes] = await Promise.all([
        supabase
            .from("home_dashboard_view")
            .select("subs_remaining")
            .eq("user_id", userId)
            .maybeSingle(),
        supabase
            .from("user_tournament_points")
            .select("used_boosters")
            .eq("user_id", userId)
            .eq("tournament_id", tournamentId)
            .maybeSingle(),
        supabase
            .from("matches")
            .select("match_number")
            .eq("tournament_id", tournamentId)
            .eq("status", "upcoming")
            .order("actual_start_time", { ascending: true })
            .limit(1)
            .maybeSingle()
    ]);

    const usedBoosters = boosterRes.data?.used_boosters ?? [];
    const fallbackTotalUsed = history[0]?.total_subs_used ?? 0;
    let fallbackSubsRemaining = Math.max(0, TOTAL_SUBS_LIMIT - fallbackTotalUsed);

    if (upcomingRes.data?.match_number === 1 || upcomingRes.data?.match_number === PLAYOFF_START_MATCH) {
        fallbackSubsRemaining = 999;
    }

    return {
        subsRemaining: dashboardRes.data?.subs_remaining ?? fallbackSubsRemaining,
        boostersLeft: Math.max(0, TOTAL_BOOSTERS - usedBoosters.length)
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

    return new Map((data || []).map((row) => [row.match_id, row.total_points]));
}

/* =========================
   PAGE LOAD TRANSITION
========================= */
function revealApp() {
    if (document.body.classList.contains("loaded")) return;

    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");

    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = "none";
    }, 600);
}

setTimeout(() => {
    if (document.body.classList.contains("loading-state")) {
        console.warn("Safety trigger: Revealing team field...");
        revealApp();
    }
}, 6000);

/* =========================
   INIT LOGIC
========================= */
init();

async function init() {
    try {
        const { data: teamData } = await supabase.from("real_teams").select("id, short_code");
        realTeamsMap = Object.fromEntries((teamData || []).map((team) => [team.id, team.short_code]));

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            window.location.href = "login.html";
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const scoutUid = urlParams.get("uid");
        const scoutNameFromUrl = urlParams.get("name");

        const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
        if (!activeTournament) return;
        tournamentId = activeTournament.id;

        if (scoutUid && scoutUid !== session.user.id) {
            userId = scoutUid;
            isScoutMode = true;

            const { data: profile } = await supabase
                .from("user_profiles")
                .select("team_name, equipped_flex")
                .eq("user_id", scoutUid)
                .maybeSingle();

            viewTitle.textContent = profile?.team_name || decodeURIComponent(scoutNameFromUrl || "") || "User Team";
            if (profile?.equipped_flex && profile.equipped_flex !== "none") {
                viewTitle.className = `main-title ${profile.equipped_flex}`;
            }
            tabUpcoming.style.display = "none";
            tabLocked.classList.add("active");
        } else {
            userId = session.user.id;

            const { data: myData } = await supabase
                .from("user_profiles")
                .select("team_name, equipped_flex")
                .eq("user_id", userId)
                .maybeSingle();

            viewTitle.textContent = myData?.team_name || "My XI";
            if (myData?.equipped_flex && myData.equipped_flex !== "none") {
                viewTitle.className = `main-title ${myData.equipped_flex}`;
            }
        }

        await Promise.allSettled([
            setupMatchTabs(),
            isScoutMode ? loadLastLockedXI() : loadCurrentXI()
        ]);

        setupHistoryListeners();
    } catch (err) {
        console.error("Init error:", err);
    } finally {
        revealApp();
    }
}

/* =========================
   CORE VIEW LOGIC
========================= */
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
            tabUpcoming.textContent = `${realTeamsMap[upcoming.team_a_id] || "TBA"} vs ${realTeamsMap[upcoming.team_b_id] || "TBA"} EDIT`;
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
        const { data: matchInfo } = await supabase.from("matches").select("*").eq("id", lastLocked.match_id).single();
        if (matchInfo) {
            tabLocked.textContent = `${realTeamsMap[matchInfo.team_a_id] || "TBA"} vs ${realTeamsMap[matchInfo.team_b_id] || "TBA"} LOCKED`;
        }
    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((candidate) => candidate.classList.remove("active"));
            tab.classList.add("active");
            if (tab.dataset.tab === "current") loadCurrentXI();
            else loadLastLockedXI();
        });
    });
}

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

async function loadCurrentXI() {
    if (isScoutMode) return;

    clearInterval(countdownInterval);
    setTeamStatus("");
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    // 1. Fetch both the Team AND the Used Boosters at the same time
    const [ { data: userTeam }, { data: pointsData } ] = await Promise.all([
        supabase
            .from("user_fantasy_teams")
            .select("*")
            .eq("user_id", userId)
            .eq("tournament_id", tournamentId)
            .maybeSingle(),
        supabase
            .from("user_tournament_points")
            .select("used_boosters")
            .eq("user_id", userId)
            .eq("tournament_id", tournamentId)
            .maybeSingle()
    ]);

    if (!userTeam) {
        setEmptyState(teamContainer, "Team not created yet.");
        updateBoosterIndicator(boosterIndicator, "NONE", "");
        return;
    }

    // 2. THE FIX: Check if the saved booster is already spent
    const usedBoosters = pointsData?.used_boosters || [];
    let currentBooster = getAppliedBooster(userTeam);

    // If it's in the used list, it belonged to a past match. Reset to NONE for UI.
    if (usedBoosters.includes(currentBooster)) {
        currentBooster = "NONE";
    }

    // 3. Update the UI with the corrected booster state
    updateBoosterIndicator(boosterIndicator, currentBooster, "ACTIVE");

    const { data: teamPlayers } = await supabase
        .from("user_fantasy_team_players")
        .select("player_id")
        .eq("user_fantasy_team_id", userTeam.id);

    const playerIds = (teamPlayers || []).map((player) => player.player_id);
    if (playerIds.length === 0) {
        setEmptyState(teamContainer, "No players selected yet.");
        return;
    }

    const { data: players } = await supabase.from("players").select("*").in("id", playerIds);
    
    // 4. Pass the corrected booster to the renderer so it doesn't wrongly double player points
    renderTeamLayout(
        players || [],
        userTeam.captain_id,
        userTeam.vice_captain_id,
        null,
        teamContainer,
        null,
        currentBooster, // Pass the verified booster here!
        null 
    );
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    // 🟢 ADDED: Fetching man_of_the_match_id
    const { data: snapshot } = await supabase
        .from("user_match_teams")
        .select("*, matches(man_of_the_match_id)")
        .eq("user_id", userId)
        .eq("tournament_id", tournamentId)
        .order("locked_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!snapshot) {
        setEmptyState(teamContainer, "Not Playing.");
        setTeamStatus("");
        updateBoosterIndicator(boosterIndicator, "NONE", "");
        return;
    }

    // 🟢 ADDED: Extract MOM ID
    const momId = snapshot.matches?.man_of_the_match_id || null;

    updateBoosterIndicator(boosterIndicator, getAppliedBooster(snapshot), "USED");

    const { data: teamPlayers } = await supabase
        .from("user_match_team_players")
        .select("player_id")
        .eq("user_match_team_id", snapshot.id);

    const playerIds = (teamPlayers || []).map((player) => player.player_id);

    const [{ data: players }, { data: stats }] = await Promise.all([
        playerIds.length
            ? supabase.from("players").select("*").in("id", playerIds)
            : Promise.resolve({ data: [] }),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id)
    ]);

    const statsMap = Object.fromEntries((stats || []).map((row) => [row.player_id, row.fantasy_points]));
    const teamPlayersData = players || [];

    renderTeamLayout(
        teamPlayersData,
        snapshot.captain_id,
        snapshot.vice_captain_id,
        statsMap,
        teamContainer,
        snapshot.match_id,
        getAppliedBooster(snapshot),
        momId // 🟢 Passed momId
    );

    const fallbackTotal = calculateMatchTotal(
        teamPlayersData,
        statsMap,
        snapshot.captain_id,
        snapshot.vice_captain_id,
        getAppliedBooster(snapshot),
        momId // 🟢 Passed momId
    );
    const finalTotal = await fetchUserMatchTotal(snapshot.match_id) ?? fallbackTotal;
    setTeamStatus(`Match Points: ${finalTotal} | Subs Used: ${snapshot.subs_used_for_match}`);
}

/* =========================
   UNIVERSAL RENDERER
========================= */
// 🟢 ADDED: momId parameter
function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container, matchId = null, booster = "NONE", momId = null) {
    container.replaceChildren();
    const roleOrder = ["WK", "BAT", "AR", "BOWL"];

    roleOrder.forEach((role) => {
        const rolePlayers = (players || []).filter((player) => player.role === role);
        if (!rolePlayers.length) return;

        const section = document.createElement("div");
        section.className = "role-section";
        section.appendChild(createRoleTitle(role));

        const row = document.createElement("div");
        row.className = "player-row";

        rolePlayers.forEach((player) => {
            row.appendChild(buildPlayerCircle(player, captainId, viceCaptainId, statsMap, matchId, booster, momId));
        });

        section.appendChild(row);
        container.appendChild(section);
    });
}

/* =========================
   HISTORY FEATURE LOGIC
========================= */
function setupHistoryListeners() {
    if (!historyBtn) return;

    
let isFetchingHistory = false;

    historyBtn.onclick = async () => {
        if (isFetchingHistory) return; // Stop double-taps!
        isFetchingHistory = true;
        document.body.style.overflow = 'hidden'; // LOCK SCROLL
        historyOverlay.classList.remove("hidden");
        // ... rest of the function
        setSpinner(historyList);
        try {
        // 🟢 ADDED: Fetching man_of_the_match_id inside matches()
        const { data: history } = await supabase
            .from("user_match_teams")
            .select("*, matches(match_number, team_a_id, team_b_id, man_of_the_match_id), user_match_team_players(player_id)")
            .eq("user_id", userId)
            .eq("tournament_id", tournamentId)
            .order("locked_at", { ascending: false });

        const summaryData = await fetchHistorySummaryData(history || []);
        renderHistorySummary(summaryData);

        if (!history || history.length === 0) {
            setEmptyState(historyList, "No season history found.");
            return;
        }

        const matchIds = history.map((snapshot) => snapshot.match_id);
        const allPlayerIds = [...new Set(history.flatMap((snapshot) => (snapshot.user_match_team_players || []).map((player) => player.player_id)))];

        const [{ data: allStats }, { data: playerCategories }] = await Promise.all([
            supabase.from("player_match_stats").select("*").in("match_id", matchIds),
            allPlayerIds.length
                ? supabase.from("players").select("id, category").in("id", allPlayerIds)
                : Promise.resolve({ data: [] })
        ]);

        const matchTotals = await fetchUserMatchTotals(matchIds);
        const categoryMap = new Map((playerCategories || []).map((player) => [player.id, player.category]));

        historyList.replaceChildren();
        history.forEach((snapshot) => {
            // 🟢 ADDED: Extract MOM ID
            const momId = snapshot.matches?.man_of_the_match_id || null;

            const matchStats = (allStats || []).filter((stat) => stat.match_id === snapshot.match_id);
            const statsMap = Object.fromEntries(matchStats.map((stat) => [stat.player_id, stat.fantasy_points]));
            const fallbackPlayers = (snapshot.user_match_team_players || []).map((player) => ({
                id: player.player_id,
                category: categoryMap.get(player.player_id) || null
            }));

            const fallbackTotal = calculateMatchTotal(
                fallbackPlayers,
                statsMap,
                snapshot.captain_id,
                snapshot.vice_captain_id,
                getAppliedBooster(snapshot),
                momId // 🟢 Passed momId
            );

      historyList.appendChild(createHistoryRow(snapshot, matchTotals.get(snapshot.match_id) ?? fallbackTotal));
        });
        } finally {
            isFetchingHistory = false; // Unlock it when done!
        }
    };

 document.getElementById("closeHistory").onclick = () => {
        historyOverlay.classList.add("hidden");
        document.body.style.overflow = ''; // UNLOCK SCROLL
    };
    
    document.getElementById("closePPL").onclick = () => {
        document.getElementById("playerPointLogOverlay").classList.add("hidden");
        // Keep locked if breakdown is still open behind it
    };
    
    document.getElementById("backToHistory").onclick = () => {
        document.getElementById("breakdownOverlay").classList.add("hidden");
        // Keep locked because History is still open behind it
    };
}
/* =========================
   OVERLAY HANDLERS
========================= */
window.viewMatchBreakdown = async (snapshotId) => {
    const breakdownContainer = document.getElementById("breakdownTeamContainer");
    const breakdownFooter = document.getElementById("breakdownFooter");
    const breakdownTitle = document.getElementById("breakdownTitle");
    const breakdownBooster = document.getElementById("breakdownBooster");

    document.getElementById("breakdownOverlay").classList.remove("hidden");
    setSpinner(breakdownContainer);

    const [{ data: snapshot }, { data: teamPlayers }] = await Promise.all([
        supabase.from("user_match_teams").select("*, matches(*)").eq("id", snapshotId).single(),
        supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshotId)
    ]);

    if (!snapshot) {
        setEmptyState(breakdownContainer, "Data unavailable.");
        return;
    }

    // 🟢 ADDED: Extract MOM ID
    const momId = snapshot.matches?.man_of_the_match_id || null;

    breakdownTitle.textContent = `Match ${snapshot.matches.match_number} Details`;
    updateBoosterIndicator(breakdownBooster, getAppliedBooster(snapshot), "USED");

    const playerIds = (teamPlayers || []).map((player) => player.player_id);
    const [{ data: players }, { data: stats }] = await Promise.all([
        playerIds.length
            ? supabase.from("players").select("*").in("id", playerIds)
            : Promise.resolve({ data: [] }),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id)
    ]);

    const statsMap = Object.fromEntries((stats || []).map((stat) => [stat.player_id, stat.fantasy_points]));
    const breakdownPlayers = players || [];

    renderTeamLayout(
        breakdownPlayers,
        snapshot.captain_id,
        snapshot.vice_captain_id,
        statsMap,
        breakdownContainer,
        snapshot.match_id,
        getAppliedBooster(snapshot),
        momId // 🟢 Passed momId
    );

    const fallbackTotal = calculateMatchTotal(
        breakdownPlayers,
        statsMap,
        snapshot.captain_id,
        snapshot.vice_captain_id,
        getAppliedBooster(snapshot),
        momId // 🟢 Passed momId
    );
    const finalTotal = await fetchUserMatchTotal(snapshot.match_id) ?? fallbackTotal;
    breakdownFooter.textContent = `MATCH TOTAL: ${finalTotal} PTS | SUBS: ${snapshot.subs_used_for_match}`;
};

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

    if (!matchStat) {
        setEmptyState(content, "Data unavailable.");
        return;
    }

    document.getElementById("pplPlayerName").textContent = matchStat.players.name;

    const log = [];
    if (matchStat.runs > 0) log.push(`${matchStat.runs} Runs (+${matchStat.runs})`);
    if (matchStat.boundary_points > 0) log.push(`Boundaries (+${matchStat.boundary_points})`);
    if (matchStat.milestone_points > 0) log.push(`Milestone (+${matchStat.milestone_points})`);
    if (matchStat.sr_points !== 0) log.push(`SR (${matchStat.sr_points > 0 ? "+" : ""}${matchStat.sr_points})`);
    if (matchStat.wickets > 0) {
        log.push(`${matchStat.wickets} Wkts (+${20 + (Math.max(0, matchStat.wickets - 1) * 25)})`);
    }
    if (matchStat.er_points !== 0) log.push(`Econ (${matchStat.er_points > 0 ? "+" : ""}${matchStat.er_points})`);
    if (matchStat.catches > 0) log.push(`${matchStat.catches} Catch (+${matchStat.catches * 8})`);
    if (matchStat.involvement_points > 0) log.push(`Active (+${matchStat.involvement_points})`);
    if (matchStat.is_player_of_match) log.push("POM (+20)");
    if (matchStat.duck_penalty < 0) log.push(`Duck Penalty (${matchStat.duck_penalty})`);

    const list = document.createElement("div");
    list.className = "log-items";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "8px";

    log.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "log-entry";

        const text = document.createElement("span");
        text.textContent = entry;
        row.appendChild(text);
        list.appendChild(row);
    });

    const total = document.createElement("div");
    total.style.marginTop = "15px";
    total.style.borderTop = "1px solid rgba(255,255,255,0.1)";
    total.style.paddingTop = "10px";
    total.style.fontWeight = "800";
    total.style.color = "var(--accent)";
    total.textContent = `BASE TOTAL: ${matchStat.fantasy_points} PTS`;

    content.replaceChildren(list, total);
};