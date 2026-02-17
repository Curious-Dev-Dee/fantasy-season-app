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

// New History Elements
const historyBtn = document.getElementById("viewHistoryBtn");
const historyOverlay = document.getElementById("historyOverlay");
const breakdownOverlay = document.getElementById("breakdownOverlay");
const historyList = document.getElementById("historyList");

let userId, tournamentId, countdownInterval, isScoutMode = false;
let realTeamsMap = {};

/* =========================
   INIT LOGIC
========================= */
init();

async function init() {
    // 1. Load Team Maps
    const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
    realTeamsMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

    // 2. Auth Guard
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }

    // 3. Determine Mode (Scout vs Self)
    const urlParams = new URLSearchParams(window.location.search);
    const scoutUid = urlParams.get('uid');
    const scoutName = urlParams.get('name');

    if (scoutUid && scoutUid !== session.user.id) {
        userId = scoutUid;
        isScoutMode = true;
        if (viewTitle) viewTitle.textContent = scoutName || "User Team";
        tabUpcoming.style.display = 'none'; // Hide strategy in scout mode
        tabLocked.classList.add("active");
        tabUpcoming.classList.remove("active");
    } else {
        userId = session.user.id;
        isScoutMode = false;
        const { data: myData } = await supabase
            .from("leaderboard_view")
            .select("team_name")
            .eq("user_id", userId)
            .maybeSingle();
        if (viewTitle) viewTitle.textContent = myData?.team_name || "My XI";
    }

    const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTournament) return;
    tournamentId = activeTournament.id;

    // 4. Load UI Components
    await setupMatchTabs();
    isScoutMode ? loadLastLockedXI() : loadCurrentXI();
    setupHistoryListeners();
}

/* =========================
   CORE VIEW LOGIC
========================= */
async function setupMatchTabs() {
    if (!isScoutMode) {
        const { data: upcoming } = await supabase.from("matches")
            .select("*").eq("tournament_id", tournamentId)
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true }).limit(1).maybeSingle();

        if (upcoming) {
            tabUpcoming.innerHTML = `${realTeamsMap[upcoming.team_a_id]} vs ${realTeamsMap[upcoming.team_b_id]} 🔓`;
            tabUpcoming.dataset.startTime = upcoming.actual_start_time;
        }
    }

    const { data: lastLocked } = await supabase.from("user_match_teams")
        .select("match_id").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (lastLocked) {
        const { data: mInfo } = await supabase.from("matches").select("*").eq("id", lastLocked.match_id).single();
        tabLocked.innerHTML = `${realTeamsMap[mInfo.team_a_id]} vs ${realTeamsMap[mInfo.team_b_id]} 🔒`;
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

    renderTeamLayout(players, userTeam.captain_id, userTeam.vice_captain_id, null, teamContainer);
    teamStatus.textContent = "Current Strategy (Unlocked)";
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    const { data: snapshot } = await supabase.from("user_match_teams").select("*")
        .eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (!snapshot) {
        teamContainer.innerHTML = "<p class='empty-msg'>No match history found.</p>";
        return;
    }

    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshot.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));

    const { data: stats } = await supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id);
    const statsMap = Object.fromEntries(stats.map(s => [s.player_id, s.fantasy_points]));

    renderTeamLayout(players, snapshot.captain_id, snapshot.vice_captain_id, statsMap, teamContainer);
    
    // Recalculate total for Last Locked view as well to be safe
    let calculatedTotal = 0;
    players.forEach(p => {
        let pPts = statsMap[p.id] || 0;
        if (p.id === snapshot.captain_id) pPts *= 2;
        else if (p.id === snapshot.vice_captain_id) pPts *= 1.5;
        calculatedTotal += pPts;
    });

    teamStatus.textContent = `Points: ${calculatedTotal} | Subs Used: ${snapshot.subs_used_for_match}`;
}

/* =========================
   HELPER: UNIVERSAL RENDERER
========================= */
function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container) {
    container.innerHTML = "";
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
                <div class="avatar">
                    <div class="team-init-label">${realTeamsMap[p.real_team_id] || 'TBA'}</div>
                </div>
                <div class="player-name">${p.name}</div>
                ${displayPts}
            `;
            row.appendChild(circle);
        });
        section.appendChild(row);
        container.appendChild(section);
    });
}

/* =========================
   HISTORY FEATURE LOGIC
========================= */
function setupHistoryListeners() {
    // 1. Open History List
    historyBtn.onclick = async () => {
        historyOverlay.classList.remove("hidden");
        historyList.innerHTML = `<div class="spinner-small"></div>`;

        const { data: history, error } = await supabase
            .from('user_match_teams')
            .select('*, matches(match_number, team_a_id, team_b_id)')
            .eq('user_id', userId)
            .order('locked_at', { ascending: false });

        if (!history || history.length === 0) {
            historyList.innerHTML = "<p class='empty-msg'>No matches played yet this season.</p>";
            return;
        }

        historyList.innerHTML = history.map(h => `
            <div class="history-row" onclick="viewMatchBreakdown('${h.id}')">
                <div>
                    <span class="h-m-num">MATCH ${h.matches.match_number}</span>
                    <span class="h-teams">${realTeamsMap[h.matches.team_a_id]} vs ${realTeamsMap[h.matches.team_b_id]}</span>
                </div>
                <div class="h-stats">
                    <span class="h-pts">${h.total_points || 0} PTS</span>
                    <span class="h-subs">${h.subs_used_for_match} SUBS</span>
                </div>
                <i class="fas fa-chevron-right" style="color:#475569; margin-left:10px;"></i>
            </div>
        `).join('');
    };

    // 2. View Specific Match Breakdown (RECALCULATED FIX)
    window.viewMatchBreakdown = async (snapshotId) => {
        breakdownOverlay.classList.remove("hidden");
        const bContainer = document.getElementById("breakdownTeamContainer");
        const bFooter = document.getElementById("breakdownFooter");
        const bTitle = document.getElementById("breakdownTitle");
        
        bContainer.innerHTML = `<div class="spinner-small"></div>`;

        const { data: snap } = await supabase.from("user_match_teams").select("*, matches(*)").eq("id", snapshotId).single();
        const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshotId);
        
        bTitle.innerText = `Match ${snap.matches.match_number} Details`;

        const [playersRes, statsRes] = await Promise.all([
            supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id)),
            supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snap.match_id)
        ]);

        const statsMap = Object.fromEntries(statsRes.data.map(s => [s.player_id, s.fantasy_points]));
        
        // --- SENIOR FIX: CALCULATE TOTAL LIVE ---
        let calculatedTotal = 0;
        playersRes.data.forEach(p => {
            let pPts = statsMap[p.id] || 0;
            if (p.id === snap.captain_id) pPts *= 2;
            else if (p.id === snap.vice_captain_id) pPts *= 1.5;
            calculatedTotal += pPts;
        });

        renderTeamLayout(playersRes.data, snap.captain_id, snap.vice_captain_id, statsMap, bContainer);
        
        // Show the recalculated total here
        bFooter.innerHTML = `Total Points: ${calculatedTotal} | Substitutions: ${snap.subs_used_for_match}`;
    };

    // 3. UI Close Handlers
    document.getElementById("closeHistory").onclick = () => historyOverlay.classList.add("hidden");
    document.getElementById("backToHistory").onclick = () => breakdownOverlay.classList.add("hidden");
}