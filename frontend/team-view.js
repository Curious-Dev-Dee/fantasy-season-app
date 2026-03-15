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

const TOTAL_SUBS_LIMIT = 130;
const TOTAL_BOOSTERS = 7;

let userId, tournamentId, countdownInterval, isScoutMode = false;
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

function getPhotoUrl(path) {
    if (!path || path === "null" || path === "") {
        return "https://tuvqgcosbweljslbfgqc.supabase.co/storage/v1/object/public/player-photos/silhouette.png";
    }
    return supabase.storage.from('player-photos').getPublicUrl(path).data.publicUrl;
}

function revealApp() {
    if (document.body.classList.contains('loaded')) return;
    document.body.classList.remove('loading-state');
    document.body.classList.add('loaded');
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }, 600);
}

/* =========================
   BOOSTER MATH ENGINE
========================= */
function calculatePlayerPoints(player, basePoints, booster, isC, isVC, pomId) {
    let pts = basePoints;

    // 1. Identity Boosters
    if (booster === "TOTAL_2X") pts *= 2;
    else if (booster === "OVERSEAS_2X" && player.category === "overseas") pts *= 2;
    else if (booster === "UNCAPPED_2X" && player.category === "uncapped") pts *= 2;
    else if (booster === "INDIAN_2X" && (player.category === "none" || player.category === "uncapped")) pts *= 2;
    else if (booster === "MOM_2X" && player.id === pomId) pts *= 2;

    // 2. Captain/VC Multipliers
    if (isC) {
        pts += (booster === "CAPTAIN_3X") ? (basePoints * 2) : basePoints;
    } else if (isVC) {
        pts += Math.floor(basePoints * 0.5);
    }

    return pts;
}

/* =========================
   INIT LOGIC
========================= */
init();

async function init() {
    try {
        const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
        realTeamsMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { window.location.href = "login.html"; return; }

        const urlParams = new URLSearchParams(window.location.search);
        const scoutUid = urlParams.get('uid');
        userId = (scoutUid && scoutUid !== session.user.id) ? scoutUid : session.user.id;
        isScoutMode = (userId !== session.user.id);

        const { data: activeT } = await supabase.from("active_tournament").select("*").maybeSingle();
        tournamentId = activeT?.id;

        const { data: profile } = await supabase.from("user_profiles").select("team_name, equipped_flex").eq("user_id", userId).maybeSingle();
        viewTitle.textContent = profile?.team_name || "User Team";
        if (profile?.equipped_flex && profile.equipped_flex !== 'none') viewTitle.className = `main-title ${profile.equipped_flex}`;

        if (isScoutMode) {
            tabUpcoming.style.display = 'none';
            tabLocked.classList.add("active");
        }

        await setupMatchTabs();
        isScoutMode ? loadLastLockedXI() : loadCurrentXI();
        setupHistoryListeners();

    } catch (err) { console.error(err); }
    finally { revealApp(); }
}

async function setupMatchTabs() {
    if (!isScoutMode) {
        const { data: upcoming } = await supabase.from("matches").select("*").eq("status", "upcoming").order("actual_start_time", { ascending: true }).limit(1).maybeSingle();
        if (upcoming) {
            tabUpcoming.innerHTML = `${realTeamsMap[upcoming.team_a_id] || 'TBA'} vs ${realTeamsMap[upcoming.team_b_id] || 'TBA'} 🖊️`;
            tabUpcoming.dataset.startTime = upcoming.actual_start_time;
        }
    }

    const { data: lastLocked } = await supabase.from("user_match_teams").select("match_id").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();
    if (lastLocked) {
        const { data: m } = await supabase.from("matches").select("*").eq("id", lastLocked.match_id).single();
        tabLocked.innerHTML = `${realTeamsMap[m.team_a_id]} vs ${realTeamsMap[m.team_b_id]} 🔒`;
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

/* =========================
   TEAM LOADERS
========================= */
async function loadCurrentXI() {
    if (isScoutMode) return;
    clearInterval(countdownInterval);
    if (tabUpcoming.dataset.startTime) startCountdown(tabUpcoming.dataset.startTime);

    const { data: ut } = await supabase.from("user_fantasy_teams").select("*").eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle();
    if (!ut) { teamContainer.innerHTML = "<p class='empty-msg'>Team not created yet.</p>"; return; }

    const booster = getAppliedBooster(ut);
    booster !== "NONE" ? (boosterIndicator.classList.remove("hidden"), boosterIndicator.textContent = `BOOSTER: ${formatBoosterLabel(booster)} ACTIVE`) : boosterIndicator.classList.add("hidden");

    const { data: tp } = await supabase.from("user_fantasy_team_players").select("player_id").eq("user_fantasy_team_id", ut.id);
    const { data: players } = await supabase.from("players").select("*").in("id", tp.map(p => p.player_id));

    renderTeamLayout(players, ut.captain_id, ut.vice_captain_id, null, teamContainer);
}

async function loadLastLockedXI() {
    clearInterval(countdownInterval);
    countdownContainer.classList.add("hidden");

    // STEP 1: Fetch the team record
    const { data: snap } = await supabase.from("user_match_teams").select("*").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();
    if (!snap) { teamContainer.innerHTML = "<p class='empty-msg'>Not Playing.</p>"; return; }

    // STEP 2: Fetch the match record separately to avoid join errors (400)
    const { data: match } = await supabase.from("matches").select("man_of_the_match_id").eq("id", snap.match_id).single();

    const booster = getAppliedBooster(snap);
    booster !== "NONE" ? (boosterIndicator.classList.remove("hidden"), boosterIndicator.textContent = `BOOSTER: ${formatBoosterLabel(booster)} USED`) : boosterIndicator.classList.add("hidden");

    const { data: tp } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", snap.id);
    const { data: players } = await supabase.from("players").select("*").in("id", tp.map(p => p.player_id));
    const { data: stats } = await supabase.from("player_match_stats").select("player_id, fantasy_points").eq("match_id", snap.match_id);
    
    const statsMap = Object.fromEntries(stats.map(s => [s.player_id, s.fantasy_points]));
    renderTeamLayout(players, snap.captain_id, snap.vice_captain_id, statsMap, teamContainer, snap.match_id, booster, match?.man_of_the_match_id);

    let calculatedTotal = 0;
    players.forEach(p => {
        calculatedTotal += calculatePlayerPoints(p, statsMap[p.id] || 0, booster, p.id === snap.captain_id, p.id === snap.vice_captain_id, match?.man_of_the_match_id);
    });

    teamStatus.textContent = `Match Points: ${calculatedTotal} | Subs Used: ${snap.subs_used_for_match}`;
}

/* =========================
   UNIVERSAL RENDERER
========================= */
function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container, matchId = null, booster = "NONE", pomId = null) {
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
            let pts = statsMap ? calculatePlayerPoints(p, statsMap[p.id] || 0, booster, p.id === captainId, p.id === viceCaptainId, pomId) : null;
            const displayPts = pts !== null ? `<div class="player-pts">${pts} pts</div>` : "";

            const teamCode = realTeamsMap[p.real_team_id] || 'TBA';
            const isC = p.id === captainId;
            const isVC = p.id === viceCaptainId;
            const clickAction = matchId ? `onclick="openPlayerPointLog('${p.id}', '${matchId}')"` : '';

            row.innerHTML += `
                <div class="player-circle ${isC ? 'captain' : ''} ${isVC ? 'vice-captain' : ''}" ${clickAction} style="${matchId ? 'cursor:pointer' : ''}">
                    ${isC ? '<div class="badge captain-badge">C</div>' : ''}
                    ${isVC ? '<div class="badge vice-badge">VC</div>' : ''}
                    <div class="avatar" style="background-image: url('${getPhotoUrl(p.photo_url)}'); background-size: cover;">
                        <div class="team-init-label">${teamCode}</div>
                    </div>
                    <div class="player-name">${p.name ? p.name.split(' ').pop() : 'Player'}</div>
                    ${displayPts}
                </div>`;
        });
        section.appendChild(row);
        container.appendChild(section);
    });


// ... rest of history/breakdown logic (Use fetchHistorySummaryData for stats)
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