import { supabase } from "./supabase.js";

const teamContainer = document.getElementById("teamContainer");
const teamStatus = document.getElementById("teamStatus");
const tabUpcoming = document.getElementById("tabUpcoming");
const tabLocked = document.getElementById("tabLocked");
const countdownContainer = document.getElementById("countdownContainer");
const timerDisplay = document.getElementById("timer");
const tabs = document.querySelectorAll(".xi-tab");

let userId, tournamentId, countdownInterval;

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    userId = session.user.id;

    const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTournament) return;
    tournamentId = activeTournament.id;

    await setupMatchTabs();
    loadCurrentXI(); 
}

async function setupMatchTabs() {
    const { data: teams } = await supabase.from('real_teams').select('id, short_code');
    const tMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

    const { data: upcoming } = await supabase.from("matches")
        .select("*").eq("tournament_id", tournamentId)
        .gt("start_time", new Date().toISOString())
        .order("start_time", { ascending: true }).limit(1).maybeSingle();

    if (upcoming) {
        tabUpcoming.innerHTML = `${tMap[upcoming.team_a_id]} vs ${tMap[upcoming.team_b_id]} 🔓`;
        tabUpcoming.dataset.startTime = upcoming.start_time;
    }

    const { data: lastLocked } = await supabase.from("user_match_teams")
        .select("match_id").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (lastLocked) {
        const { data: mInfo } = await supabase.from("matches").select("*").eq("id", lastLocked.match_id).single();
        tabLocked.innerHTML = `${tMap[mInfo.team_a_id]} vs ${tMap[mInfo.team_b_id]} 🔒`;
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
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
    clearInterval(countdownInterval);
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    const { data: userTeam } = await supabase.from("user_fantasy_teams").select("*")
        .eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle();

    if (!userTeam) return;

    const { data: teamPlayers } = await supabase.from("user_fantasy_team_players").select("player_id").eq("user_fantasy_team_id", userTeam.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));

    renderTeam(players, userTeam.captain_id, userTeam.vice_captain_id, null);
    teamStatus.textContent = "Current Editable XI";
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    const { data: snapshot } = await supabase.from("user_match_teams").select("*")
        .eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (!snapshot) return;

    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshot.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));

    const { data: stats } = await supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id);
    const statsMap = Object.fromEntries(stats.map(s => [s.player_id, s.fantasy_points]));

    renderTeam(players, snapshot.captain_id, snapshot.vice_captain_id, statsMap);
    teamStatus.textContent = `Locked Scorecard | Subs: ${snapshot.subs_used_for_match}`;
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
            let displayPts = "";
            if (pts !== null) {
                if (p.id === captainId) pts *= 2;
                if (p.id === viceCaptainId) pts *= 1.5;
                displayPts = `<div class="player-pts">${pts} pts</div>`;
            }

            const circle = document.createElement("div");
            circle.className = `player-circle ${p.id === captainId ? 'captain' : ''} ${p.id === viceCaptainId ? 'vice-captain' : ''}`;
            circle.innerHTML = `
                ${p.id === captainId ? '<div class="badge captain-badge">C</div>' : ''}
                ${p.id === viceCaptainId ? '<div class="badge vice-badge">VC</div>' : ''}
                <div class="avatar silhouette"></div>
                <div class="player-name">${p.name}</div>
                ${displayPts}
            `;
            row.appendChild(circle);
        });
        section.appendChild(row);
        teamContainer.appendChild(section);
    });
}