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
const boosterIndicator = document.getElementById("boosterIndicator");

let userId, tournamentId, countdownInterval, isScoutMode = false;
let realTeamsMap = {};

/* =========================
    INIT LOGIC
========================= */
init();

async function init() {
    const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
    realTeamsMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }

    const urlParams = new URLSearchParams(window.location.search);
    const scoutUid = urlParams.get('uid');
    const scoutNameFromUrl = urlParams.get('name');

    if (scoutUid && scoutUid !== session.user.id) {
        userId = scoutUid;
        isScoutMode = true;
        if (scoutNameFromUrl && scoutNameFromUrl !== 'undefined') {
            viewTitle.textContent = decodeURIComponent(scoutNameFromUrl);
        } else {
            const { data: profileData } = await supabase.from("user_profiles").select("team_name").eq("user_id", scoutUid).maybeSingle();
            viewTitle.textContent = profileData?.team_name || "User Team";
        }
        tabUpcoming.style.display = 'none'; 
        tabLocked.classList.add("active");
    } else {
        userId = session.user.id;
        const { data: myData } = await supabase.from("leaderboard_view").select("team_name").eq("user_id", userId).maybeSingle();
        viewTitle.textContent = myData?.team_name || "My XI";
    }

    const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTournament) return;
    tournamentId = activeTournament.id;

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
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            tab.dataset.tab === "current" ? loadCurrentXI() : loadLastLockedXI();
        });
    });
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
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    const { data: snapshot } = await supabase.from("user_match_teams").select("*")
        .eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (!snapshot) {
        teamContainer.innerHTML = "<p class='empty-msg'>No snapshots available.</p>";
        return;
    }

    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshot.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));
    const { data: stats } = await supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id);
    const statsMap = Object.fromEntries(stats.map(s => [s.player_id, s.fantasy_points]));

    renderTeamLayout(players, snapshot.captain_id, snapshot.vice_captain_id, statsMap, teamContainer, snapshot.match_id);
}

/* =========================
    UNIVERSAL RENDERER
========================= */
function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container, matchId = null) {
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
                else if (p.id === viceCaptainId) pts *= 1.5;
                displayPts = `<div class="player-pts">${pts} pts</div>`;
            }

            const teamCode = realTeamsMap[p.real_team_id] || 'TBA';
            const photoUrl = p.photo_url
                ? supabase.storage.from('player-photos').getPublicUrl(p.photo_url).data.publicUrl
                : 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png';

            const isC = p.id === captainId;
            const isVC = p.id === viceCaptainId;
            const clickAction = matchId ? `onclick="openPlayerPointLog('${p.id}', '${matchId}')"` : '';

            row.innerHTML += `
                <div class="player-circle ${isC ? 'captain' : ''} ${isVC ? 'vice-captain' : ''}" ${clickAction} style="${matchId ? 'cursor:pointer' : ''}">
                    ${isC ? '<div class="badge captain-badge">C</div>' : ''}
                    ${isVC ? '<div class="badge vice-badge">VC</div>' : ''}
                    <div class="avatar" style="background-image: url('${photoUrl}'); background-size: cover;">
                        <div class="team-init-label">${teamCode}</div>
                    </div>
                    <div class="player-name">${p.name.split(' ').pop()}</div>
                    ${displayPts}
                </div>`;
        });
        section.appendChild(row);
        container.appendChild(section);
    });
}

/* =========================
    MATCH HISTORY LOGIC
========================= */
function setupHistoryListeners() {
    historyBtn.onclick = async () => {
        historyOverlay.classList.remove("hidden");
        const { data: history } = await supabase.from('user_match_teams')
            .select('*, matches(match_number, team_a_id, team_b_id), user_match_team_players(player_id)')
            .eq('user_id', userId).order('locked_at', { ascending: false });

        historyList.innerHTML = history.map(h => `
            <div class="history-row" onclick="viewMatchBreakdown('${h.id}')">
                <div>
                    <span class="h-m-num">MATCH ${h.matches.match_number}</span>
                    <span class="h-teams">${realTeamsMap[h.matches.team_a_id]} vs ${realTeamsMap[h.matches.team_b_id]}</span>
                </div>
                <div class="h-stats"><span class="h-pts">${h.subs_used_for_match} SUBS</span></div>
            </div>`).join('');
    };
    document.getElementById("closeHistory").onclick = () => historyOverlay.classList.add("hidden");
    document.getElementById("closePPL").onclick = () => document.getElementById("playerPointLogOverlay").classList.add("hidden");
}

/* =========================
    BREAKDOWN LOGIC
========================= */
window.viewMatchBreakdown = async (snapshotId) => {
    const bContainer = document.getElementById("breakdownTeamContainer");
    document.getElementById("breakdownOverlay").classList.remove("hidden");

    const { data: snap } = await supabase.from("user_match_teams").select("*, matches(*)").eq("id", snapshotId).single();
    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshotId);
    
    const [playersRes, statsRes] = await Promise.all([
        supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id)),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snap.match_id)
    ]);

    const statsMap = Object.fromEntries(statsRes.data.map(s => [s.player_id, s.fantasy_points]));
    renderTeamLayout(playersRes.data, snap.captain_id, snap.vice_captain_id, statsMap, bContainer, snap.match_id);
};

window.openPlayerPointLog = async (playerId, matchId) => {
    const content = document.getElementById("pplContent");
    document.getElementById("playerPointLogOverlay").classList.remove("hidden");
    content.innerHTML = `<div class="spinner-small"></div>`;

    const { data: m } = await supabase.from("player_match_stats").select("*, players(name)").eq("match_id", matchId).eq("player_id", playerId).single();
    if (!m) return content.innerHTML = "<p>Data unavailable.</p>";

    document.getElementById("pplPlayerName").innerText = m.players.name;
    const log = [];
    if (m.runs > 0) log.push(`${m.runs} Runs (+${m.runs})`);
    if (m.boundary_points > 0) log.push(`Boundaries (+${m.boundary_points})`);
    if (m.milestone_points > 0) log.push(`Milestone (+${m.milestone_points})`);
    if (m.sr_points !== 0) log.push(`SR (${m.sr_points > 0 ? '+' : ''}${m.sr_points})`);
    if (m.wickets > 0) log.push(`${m.wickets} Wkts (+${20 + (Math.max(0, m.wickets - 1) * 25)})`);
    if (m.er_points !== 0) log.push(`Econ (${m.er_points > 0 ? '+' : ''}${m.er_points})`);

    content.innerHTML = `
        <div class="log-items" style="display:flex; flex-direction:column; gap:8px;">
            ${log.map(item => `<div class="log-entry"><span>${item}</span></div>`).join('')}
            <div style="margin-top:15px; font-weight:800; color:var(--accent);">BASE TOTAL: ${m.fantasy_points} PTS</div>
        </div>`;
};