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
   PAGE LOAD TRANSITION
========================= */
function revealApp() {
    if (document.body.classList.contains('loaded')) return;
    document.body.classList.remove('loading-state');
    document.body.classList.add('loaded');
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }, 600);
}

// Safety timeout
setTimeout(() => {
    if (document.body.classList.contains('loading-state')) revealApp();
}, 6000);

/* =========================
    INIT LOGIC
========================= */
init();

========================= */
async function init() {
    try {
        // Parallel load basic data
        const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
        realTeamsMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { window.location.href = "login.html"; return; }

        const urlParams = new URLSearchParams(window.location.search);
        const scoutUid = urlParams.get('uid');
        const scoutNameFromUrl = urlParams.get('name');

        const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
        if (!activeTournament) return;
        tournamentId = activeTournament.id;

        if (scoutUid && scoutUid !== session.user.id) {
            userId = scoutUid;
            isScoutMode = true;
            const { data: profile } = await supabase.from("user_profiles").select("team_name, equipped_flex").eq("user_id", scoutUid).maybeSingle();
            viewTitle.textContent = profile?.team_name || decodeURIComponent(scoutNameFromUrl) || "User Team";
            if (profile?.equipped_flex && profile.equipped_flex !== 'none') viewTitle.className = `main-title ${profile.equipped_flex}`;
            tabUpcoming.style.display = 'none'; 
            tabLocked.classList.add("active");
        } else {
            userId = session.user.id;
            const { data: myData } = await supabase.from("user_profiles").select("team_name, equipped_flex").eq("user_id", userId).maybeSingle();
            viewTitle.textContent = myData?.team_name || "My XI";
            if (myData?.equipped_flex && myData.equipped_flex !== 'none') viewTitle.className = `main-title ${myData.equipped_flex}`;
        }

        // Fetch the actual team layout before revealing
        await Promise.allSettled([
            setupMatchTabs(),
            isScoutMode ? loadLastLockedXI() : loadCurrentXI()
        ]);
        
        setupHistoryListeners();

    } catch (err) {
        console.error("Init error:", err);
    } finally {
        // REVEAL THE TEAM FIELD
        revealApp();
    }
}

/* =========================
    CORE VIEW LOGIC
========================= */
async function setupMatchTabs() {
    if (!isScoutMode) {
        const { data: upcoming } = await supabase.from("matches")
            .select("*").eq("tournament_id", tournamentId)
            .eq("status", "upcoming") // Strictly only show upcoming in the 'current' tab
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true }).limit(1).maybeSingle();

        if (upcoming) {
            tabUpcoming.innerHTML = `${realTeamsMap[upcoming.team_a_id] || 'TBA'} vs ${realTeamsMap[upcoming.team_b_id] || 'TBA'} 🔓`;
            tabUpcoming.dataset.startTime = upcoming.actual_start_time;
        }
    }

    const { data: lastLocked } = await supabase.from("user_match_teams")
        .select("match_id").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (lastLocked) {
        const { data: mInfo } = await supabase.from("matches").select("*").eq("id", lastLocked.match_id).single();
        if (mInfo) {
            tabLocked.innerHTML = `${realTeamsMap[mInfo.team_a_id] || 'TBA'} vs ${realTeamsMap[mInfo.team_b_id] || 'TBA'} 🔒`;
        }
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
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    const { data: userTeam } = await supabase.from("user_fantasy_teams").select("*")
        .eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle();

    if (!userTeam) {
        teamContainer.innerHTML = "<p class='empty-msg'>Team not created yet.</p>";
        return;
    }

    userTeam.use_booster ? boosterIndicator.classList.remove("hidden") : boosterIndicator.classList.add("hidden");

    const { data: teamPlayers } = await supabase.from("user_fantasy_team_players").select("player_id").eq("user_fantasy_team_id", userTeam.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));

    renderTeamLayout(players, userTeam.captain_id, userTeam.vice_captain_id, null, teamContainer);
    teamStatus.textContent = "Strategy for Next Match";
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    const { data: snapshot } = await supabase.from("user_match_teams").select("*")
        .eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (!snapshot) {
        teamContainer.innerHTML = "<p class='empty-msg'>No match snapshots available.</p>";
        return;
    }

    snapshot.use_booster ? boosterIndicator.classList.remove("hidden") : boosterIndicator.classList.add("hidden");

    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshot.id);
    const { data: players } = await supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id));
    const { data: stats } = await supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snapshot.match_id);
    const statsMap = Object.fromEntries(stats.map(s => [s.player_id, s.fantasy_points]));

    renderTeamLayout(players, snapshot.captain_id, snapshot.vice_captain_id, statsMap, teamContainer, snapshot.match_id);

    let calculatedTotal = 0;
    players.forEach(p => {
        let pPts = statsMap[p.id] || 0;
        if (p.id === snapshot.captain_id) pPts *= 2;
        else if (p.id === snapshot.vice_captain_id) pPts *= 1.5;
        calculatedTotal += pPts;
    });

    const finalTotal = snapshot.use_booster ? Math.floor(calculatedTotal * 2) : calculatedTotal;
    teamStatus.textContent = `Match Points: ${finalTotal} | Subs Used: ${snapshot.subs_used_for_match}`;
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
                    <div class="player-name">${p.name ? p.name.split(' ').pop() : 'Player'}</div>
                    ${displayPts}
                </div>`;
        });
        section.appendChild(row);
        container.appendChild(section);
    });
}

// ... rest of history logic remains identical to your original code ...

/* =========================
    HISTORY FEATURE LOGIC
========================= */
function setupHistoryListeners() {
    historyBtn.onclick = async () => {
        historyOverlay.classList.remove("hidden");
        historyList.innerHTML = `<div class="spinner-small"></div>`;
        const { data: history } = await supabase.from('user_match_teams')
            .select('*, matches(match_number, team_a_id, team_b_id), user_match_team_players(player_id)')
            .eq('user_id', userId).order('locked_at', { ascending: false });

        if (!history || history.length === 0) {
            historyList.innerHTML = "<p class='empty-msg'>No season history found.</p>";
            return;
        }

        const matchIds = history.map(h => h.match_id);
        const { data: allStats } = await supabase.from("player_match_stats").select("*").in("match_id", matchIds);

        historyList.innerHTML = history.map(h => {
            let rowTotal = 0;
            const matchStats = allStats.filter(s => s.match_id === h.match_id);
            const statsMap = Object.fromEntries(matchStats.map(s => [s.player_id, s.fantasy_points]));

            h.user_match_team_players.forEach(p => {
                let pPts = statsMap[p.player_id] || 0;
                if (p.player_id === h.captain_id) pPts *= 2;
                else if (p.player_id === h.vice_captain_id) pPts *= 1.5;
                rowTotal += pPts;
            });

            return `
                <div class="history-row" onclick="viewMatchBreakdown('${h.id}')">
                    <div>
                        <span class="h-m-num">MATCH ${h.matches.match_number} ${h.use_booster ? '🚀' : ''}</span>
                        <span class="h-teams">${realTeamsMap[h.matches.team_a_id]} vs ${realTeamsMap[h.matches.team_b_id]}</span>
                    </div>
                    <div class="h-stats">
                        <span class="h-pts">${h.use_booster ? rowTotal * 2 : rowTotal} PTS</span>
                        <span class="h-subs">${h.subs_used_for_match} SUBS</span>
                    </div>
                    <i class="fas fa-chevron-right" style="color:#475569; margin-left:10px;"></i>
                </div>`;
        }).join('');
    };

    document.getElementById("closeHistory").onclick = () => historyOverlay.classList.add("hidden");
    document.getElementById("closePPL").onclick = () => document.getElementById("playerPointLogOverlay").classList.add("hidden");
    document.getElementById("backToHistory").onclick = () => document.getElementById("breakdownOverlay").classList.add("hidden");
}

/* =========================
    OVERLAY HANDLERS
========================= */
window.viewMatchBreakdown = async (snapshotId) => {
    const bContainer = document.getElementById("breakdownTeamContainer");
    const bFooter = document.getElementById("breakdownFooter");
    const bTitle = document.getElementById("breakdownTitle");
    const bBooster = document.getElementById("breakdownBooster");

    document.getElementById("breakdownOverlay").classList.remove("hidden");
    bContainer.innerHTML = `<div class="spinner-small"></div>`;

    const { data: snap } = await supabase.from("user_match_teams").select("*, matches(*)").eq("id", snapshotId).single();
    const { data: teamPlayers } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snapshotId);
    
    bTitle.innerText = `Match ${snap.matches.match_number} Details`;
    snap.use_booster ? bBooster.classList.remove("hidden") : bBooster.classList.add("hidden");

    const [playersRes, statsRes] = await Promise.all([
        supabase.from("players").select("*").in("id", teamPlayers.map(p => p.player_id)),
        supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snap.match_id)
    ]);

    const statsMap = Object.fromEntries(statsRes.data.map(s => [s.player_id, s.fantasy_points]));
    renderTeamLayout(playersRes.data, snap.captain_id, snap.vice_captain_id, statsMap, bContainer, snap.match_id);

    let total = 0;
    playersRes.data.forEach(p => {
        let pPts = statsMap[p.id] || 0;
        if (p.id === snap.captain_id) pPts *= 2;
        else if (p.id === snap.vice_captain_id) pPts *= 1.5;
        total += pPts;
    });
    bFooter.innerHTML = `MATCH TOTAL: ${snap.use_booster ? total * 2 : total} PTS | SUBS: ${snap.subs_used_for_match}`;
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
    if (m.catches > 0) log.push(`${m.catches} Catch (+${m.catches * 8})`);
    if (m.involvement_points > 0) log.push(`Active (+${m.involvement_points})`);
    if (m.is_player_of_match) log.push(`POM (+20)`);
    if (m.duck_penalty < 0) log.push(`Duck Penalty (${m.duck_penalty})`);

    content.innerHTML = `
        <div class="log-items" style="display:flex; flex-direction:column; gap:8px;">
            ${log.map(item => `<div class="log-entry"><span>${item}</span></div>`).join('')}
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px; font-weight:800; color:var(--accent);">BASE TOTAL: ${m.fantasy_points} PTS</div>
        </div>`;
};