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

const TOTAL_SUBS_LIMIT = 130;
const TOTAL_BOOSTERS = 7;
const PLAYOFF_START_MATCH = 71;

let userId;
let tournamentId;
let countdownInterval;
let isScoutMode = false;
let realTeamsMap = {};

/* =========================
   UTILITIES
========================= */
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
    container.innerHTML = `<p class="empty-msg">${message}</p>`;
}

function setSpinner(container) {
    if (!container) return;
    container.innerHTML = `<div class="spinner-small"></div>`;
}

function setTeamStatus(message = "") {
    if (!teamStatus) return;
    teamStatus.textContent = message;
}

function getPhotoUrl(bucketName, path) {
    if (!path || path === "" || path === "null") {
        return "https://tuvqgcosbweljslbfgqc.supabase.co/storage/v1/object/public/player-photos/silhouette.png"; 
    }
    return supabase.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
}

function createRoleTitle(role) {
    const title = document.createElement("div");
    title.className = "role-title";
    title.textContent = role;
    return title;
}

/* =========================
   BOOSTER & POINT MATH
========================= */
function getBoostedBasePoints(player, basePoints, booster, pomId = null) {
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
            return player.id === pomId ? basePoints * 2 : basePoints;
        default:
            return basePoints;
    }
}

function calculateDisplayedPlayerPoints(player, statsMap, captainId, viceCaptainId, booster, pomId = null) {
    const appliedBooster = getAppliedBooster({ active_booster: booster });
    const basePoints = statsMap?.[player.id] || 0;
    
    let totalPoints = getBoostedBasePoints(player, basePoints, appliedBooster, pomId);

    if (player.id === captainId) {
        if (appliedBooster === "CAPTAIN_3X") {
            totalPoints += basePoints * 2;
        } else if (appliedBooster === "TOTAL_2X") {
            totalPoints += basePoints * 2; 
        } else if (appliedBooster === "INDIAN_2X" && (player.category === "none" || player.category === "uncapped")) {
            totalPoints += basePoints * 2;
        } else if (appliedBooster === "MOM_2X" && player.id === pomId) {
            totalPoints += basePoints * 2;
        } else {
            totalPoints += basePoints; 
        }
    } else if (player.id === viceCaptainId) {
        let vcBase = Math.floor(basePoints * 0.5); 
        if (appliedBooster === "TOTAL_2X") {
            totalPoints += vcBase * 2;
        } else if (appliedBooster === "INDIAN_2X" && (player.category === "none" || player.category === "uncapped")) {
            totalPoints += vcBase * 2;
        } else if (appliedBooster === "MOM_2X" && player.id === pomId) {
            totalPoints += vcBase * 2;
        } else {
            totalPoints += vcBase; 
        }
    }

    return totalPoints;
}

function calculateMatchTotal(players, statsMap, captainId, viceCaptainId, booster, pomId = null) {
    return (players || []).reduce((sum, player) => (
        sum + calculateDisplayedPlayerPoints(player, statsMap || {}, captainId, viceCaptainId, booster, pomId)
    ), 0);
}

/* =========================
   RENDERERS
========================= */
function buildPlayerCircle(player, captainId, viceCaptainId, statsMap, matchId = null, booster = "NONE", pomId = null) {    
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
            player, statsMap, captainId, viceCaptainId, booster, pomId
        );
        const points = document.createElement("div");
        points.className = "player-pts";
        points.textContent = `${displayPoints} pts`;
        wrapper.appendChild(points);
    }

    return wrapper;
}

function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container, matchId = null, booster = "NONE", pomId = null) {
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
            row.appendChild(buildPlayerCircle(player, captainId, viceCaptainId, statsMap, matchId, booster, pomId));
        });

        section.appendChild(row);
        container.appendChild(section);
    });
}

function revealApp() {
    if (document.body.classList.contains("loaded")) return;
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = "none";
    }, 600);
}

/* =========================
   INITIALIZATION
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
        userId = scoutUid || session.user.id;
        isScoutMode = !!scoutUid && scoutUid !== session.user.id;

        const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
        if (!activeTournament) return;
        tournamentId = activeTournament.id;

        const { data: profile } = await supabase.from("user_profiles").select("team_name").eq("user_id", userId).maybeSingle();
        viewTitle.textContent = profile?.team_name || "User Team";

        if (isScoutMode) {
            tabUpcoming.style.display = "none";
            tabLocked.classList.add("active");
        }

        await setupMatchTabs();
        isScoutMode ? loadLastLockedXI() : loadCurrentXI();
        setupHistoryListeners();

    } catch (err) {
        console.error("Init error:", err);
    } finally {
        revealApp();
    }
}

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

/* =========================
   LOADERS
========================= */
async function loadCurrentXI() {
    if (isScoutMode) return;
    clearInterval(countdownInterval);
    setTeamStatus("");
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    const { data: userTeam } = await supabase
        .from("user_fantasy_teams")
        .select("*")
        .eq("user_id", userId)
        .eq("tournament_id", tournamentId)
        .maybeSingle();

    if (!userTeam) {
        setEmptyState(teamContainer, "Team not created yet.");
        updateBoosterIndicator(boosterIndicator, "NONE", "");
        return;
    }

    updateBoosterIndicator(boosterIndicator, getAppliedBooster(userTeam), "ACTIVE");

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
    
    renderTeamLayout(
        players || [],
        userTeam.captain_id,
        userTeam.vice_captain_id,
        null,
        teamContainer,
        null,
        getAppliedBooster(userTeam),
        null 
    );
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    const { data: snapshot } = await supabase
        .from("user_match_teams")
        .select("*, matches!match_id(man_of_the_match_id, match_number, team_a_id, team_b_id)")
        .eq("user_id", userId)
        .order("locked_at", { ascending: false })
        .limit(1).maybeSingle();

    if (!snapshot) return setEmptyState(teamContainer, "No locked team found.");

    updateBoosterIndicator(boosterIndicator, getAppliedBooster(snapshot), "USED");

    const { data: tp } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshot.id);
    const pIds = (tp || []).map(p => p.player_id);

    const [{ data: players }, { data: stats }] = await Promise.all([
        supabase.from("players").select("*").in("id", pIds),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id)
    ]);

    const statsMap = Object.fromEntries((stats || []).map(s => [s.player_id, s.fantasy_points]));
    
    renderTeamLayout(
        players || [], 
        snapshot.captain_id, 
        snapshot.vice_captain_id, 
        statsMap, 
        teamContainer, 
        snapshot.match_id, 
        getAppliedBooster(snapshot), 
        snapshot.matches?.man_of_the_match_id
    );

    const finalTotal = await fetchUserMatchTotal(snapshot.match_id) || calculateMatchTotal(players, statsMap, snapshot.captain_id, snapshot.vice_captain_id, getAppliedBooster(snapshot), snapshot.matches?.man_of_the_match_id);
    setTeamStatus(`Match Points: ${finalTotal} | Subs Used: ${snapshot.subs_used_for_match}`);
}

function setupHistoryListeners() {
    if (!historyBtn) return;
    historyBtn.onclick = async () => {
        historyOverlay.classList.remove("hidden");
        setSpinner(historyList);
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
                snapshot.matches?.man_of_the_match_id
            );

            historyList.appendChild(createHistoryRow(snapshot, matchTotals.get(snapshot.match_id) ?? fallbackTotal));
        });
    };
    document.getElementById("closeHistory").onclick = () => historyOverlay.classList.add("hidden");
    document.getElementById("closePPL").onclick = () => document.getElementById("playerPointLogOverlay").classList.add("hidden");
    document.getElementById("backToHistory").onclick = () => document.getElementById("breakdownOverlay").classList.add("hidden");
}

/* =========================
   OVERLAYS
========================= */
window.viewMatchBreakdown = async (snapshotId) => {
    const breakdownContainer = document.getElementById("breakdownTeamContainer");
    const breakdownFooter = document.getElementById("breakdownFooter");
    const breakdownTitle = document.getElementById("breakdownTitle");
    const breakdownBooster = document.getElementById("breakdownBooster");

    document.getElementById("breakdownOverlay").classList.remove("hidden");
    setSpinner(breakdownContainer);

    const [{ data: snapshot }, { data: teamPlayers }] = await Promise.all([
        supabase.from("user_match_teams").select("*, matches(match_number, man_of_the_match_id)").eq("id", snapshotId).single(),
        supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshotId)
    ]);

    if (!snapshot) return setEmptyState(breakdownContainer, "Data unavailable.");

    breakdownTitle.textContent = `Match ${snapshot.matches.match_number} Details`;
    updateBoosterIndicator(breakdownBooster, getAppliedBooster(snapshot), "USED");

    const pIds = (teamPlayers || []).map(p => p.player_id);
    const [{ data: players }, { data: stats }] = await Promise.all([
        supabase.from("players").select("*").in("id", pIds),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id)
    ]);

    const statsMap = Object.fromEntries((stats || []).map(s => [s.player_id, s.fantasy_points]));
    renderTeamLayout(players, snapshot.captain_id, snapshot.vice_captain_id, statsMap, breakdownContainer, snapshot.match_id, getAppliedBooster(snapshot), snapshot.matches?.man_of_the_match_id);

    const finalTotal = await fetchUserMatchTotal(snapshot.match_id) || calculateMatchTotal(players, statsMap, snapshot.captain_id, snapshot.vice_captain_id, getAppliedBooster(snapshot), snapshot.matches?.man_of_the_match_id);
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

    if (!matchStat) return setEmptyState(content, "Data unavailable.");

    document.getElementById("pplPlayerName").textContent = matchStat.players.name;
    const log = [];
    if (matchStat.runs > 0) log.push(`${matchStat.runs} Runs (+${matchStat.runs})`);
    if (matchStat.boundary_points > 0) log.push(`Boundaries (+${matchStat.boundary_points})`);
    if (matchStat.milestone_points > 0) log.push(`Milestone (+${matchStat.milestone_points})`);
    if (matchStat.sr_points !== 0) log.push(`SR (${matchStat.sr_points > 0 ? "+" : ""}${matchStat.sr_points})`);
    if (matchStat.wickets > 0) log.push(`${matchStat.wickets} Wkts (+${20 + (Math.max(0, matchStat.wickets - 1) * 25)})`);
    if (matchStat.er_points !== 0) log.push(`Econ (${matchStat.er_points > 0 ? "+" : ""}${matchStat.er_points})`);
    if (matchStat.catches > 0) log.push(`${matchStat.catches} Catch (+${matchStat.catches * 8})`);
    if (matchStat.involvement_points > 0) log.push(`Active (+${matchStat.involvement_points})`);
    if (matchStat.is_player_of_match) log.push("POM (+20)");
    if (matchStat.duck_penalty < 0) log.push(`Duck Penalty (${matchStat.duck_penalty})`);

    const list = document.createElement("div");
    list.className = "log-items";
    list.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

    log.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "log-entry";
        row.innerHTML = `<span>${entry}</span>`;
        list.appendChild(row);
    });

    const total = document.createElement("div");
    total.style.cssText = "margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; font-weight: 800; color: #9AE000;";
    total.textContent = `BASE TOTAL: ${matchStat.fantasy_points} PTS`;
    content.replaceChildren(list, total);
};