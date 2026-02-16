import { supabase } from "./supabase.js";

const teamContainer = document.getElementById("teamContainer");
const teamStatus = document.getElementById("teamStatus");
const tabUpcoming = document.getElementById("tabUpcoming");
const tabLocked = document.getElementById("tabLocked");
const countdownContainer = document.getElementById("countdownContainer");
const timerDisplay = document.getElementById("timer");
const tabs = document.querySelectorAll(".xi-tab");
const viewTitle = document.getElementById("viewTitle"); 

let userId, tournamentId, countdownInterval, isScoutMode = false;
let realTeamsMap = {};

init();


async function init()
 {

  const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
realTeamsMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }

    // 1. Determine Identity and Mode
    const urlParams = new URLSearchParams(window.location.search);
    const scoutUid = urlParams.get('uid');
    const scoutName = urlParams.get('name');

    if (scoutUid && scoutUid !== session.user.id) {
        // --- SCOUT MODE ---
        userId = scoutUid;
        isScoutMode = true;
        
        // Dynamic title from Leaderboard click
        if (viewTitle) viewTitle.textContent = scoutName || "User Team";
        
        tabUpcoming.style.display = 'none';
        tabLocked.classList.add("active");
        tabUpcoming.classList.remove("active");
    } else {
        // --- PERSONAL MODE ---
        userId = session.user.id;
        isScoutMode = false;

        // Fetch your own team name from leaderboard_view
        const { data: myData } = await supabase
            .from("leaderboard_view")
            .select("team_name")
            .eq("user_id", userId)
            .maybeSingle();

        if (viewTitle) {
            viewTitle.textContent = myData?.team_name || "My XI";
        }
    }

    const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTournament) return;
    tournamentId = activeTournament.id;

    await setupMatchTabs();

    // 2. Load Content
    isScoutMode ? loadLastLockedXI() : loadCurrentXI();
}

async function setupMatchTabs() {
    const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
    const tMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

    if (!isScoutMode) {
        const { data: upcoming } = await supabase.from("matches")
            .select("*").eq("tournament_id", tournamentId)
            .gt("start_time", new Date().toISOString())
            .order("start_time", { ascending: true }).limit(1).maybeSingle();

        if (upcoming) {
            tabUpcoming.innerHTML = `${tMap[upcoming.team_a_id]} vs ${tMap[upcoming.team_b_id]} 🔓`;
            tabUpcoming.dataset.startTime = upcoming.start_time;
        }
    }

    const { data: lastLocked } = await supabase.from("user_match_teams")
        .select("match_id").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (lastLocked) {
        const { data: mInfo } = await supabase.from("matches").select("*").eq("id", lastLocked.match_id).single();
        tabLocked.innerHTML = `${tMap[mInfo.team_a_id]} vs ${tMap[mInfo.team_b_id]} 🔒`;
    } else if (isScoutMode) {
        teamStatus.textContent = "No match history for this user.";
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            if (tab.style.display === 'none') return;
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            tab.dataset.tab === "current" ? loadCurrentXI() : loadLastLockedXI();
        });
    });
}

function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownContainer.classList.remove("hidden");
    const update = () => {
        const diff = new Date(startTime) - new Date();
        if (diff <= 0) { timerDisplay.textContent = "Live"; clearInterval(countdownInterval); return; }
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
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    const { data: userTeam } = await supabase.from("user_fantasy_teams").select("*")
        .eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle();

    if (!userTeam) {
        teamContainer.innerHTML = "<p class='empty-msg'>Team not created yet.</p>";
        return;
    }

    const { data: teamPlayers } = await supabase.from("user_fantasy_team_players").select("player_id").eq("user_fantasy_team_id", userTeam.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));

    renderTeam(players, userTeam.captain_id, userTeam.vice_captain_id, null);
    teamStatus.textContent = "Next Match Strategy";
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    const { data: snapshot } = await supabase.from("user_match_teams").select("*")
        .eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (!snapshot) {
        teamContainer.innerHTML = "<p class='empty-msg'>No locked data available.</p>";
        return;
    }

    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshot.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));

    const { data: stats } = await supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id);
    const statsMap = Object.fromEntries(stats.map(s => [s.player_id, s.fantasy_points]));

    renderTeam(players, snapshot.captain_id, snapshot.vice_captain_id, statsMap);
    teamStatus.textContent = isScoutMode ? "Historical Performance" : `Points Summary | Subs: ${snapshot.subs_used_for_match}`;
}

function renderTeam(players, captainId, viceCaptainId, statsMap) {
    teamContainer.innerHTML = "";
    const roleOrder = ["WK", "BAT", "AR", "BOWL"];

    roleOrder.forEach(role => {
        const rolePlayers = players.filter(p => p.role === role);
        if (!rolePlayers.length) return;

        const section = document.createElement("div");
        section.className = "role-section";
        section.innerHTML = `<div class="role-title">${role}</div>`;
        const row = document.createElement("div");
        row.className = "player-row";

        rolePlayers.forEach(p => {
            let pts = statsMap ? (statsMap[p.id] || 0) : null;
            
            // --- FIX: Only show points if they are non-zero (Match has started) ---
            let displayPts = "";
            if (pts !== null && pts !== 0) {
                if (p.id === captainId) pts *= 2;
                if (p.id === viceCaptainId) pts *= 1.5;
                displayPts = `<div class="player-pts">${pts} pts</div>`;
            }

            const circle = document.createElement("div");
            circle.className = `player-circle ${p.id === captainId ? 'captain' : ''} ${p.id === viceCaptainId ? 'vice-captain' : ''}`;
            
            circle.innerHTML = `
                ${p.id === captainId ? '<div class="badge captain-badge">C</div>' : ''}
                ${p.id === viceCaptainId ? '<div class="badge vice-badge">VC</div>' : ''}
                <div class="avatar">
                    <div class="team-init-label">${realTeamsMap[p.real_team_id] || 'TBA'}</div>
                </div>
                <div class="player-name">${p.name}</div>
                ${displayPts}
            `;
            row.appendChild(circle);
        });
        section.appendChild(row);
        teamContainer.appendChild(section);
    });
}