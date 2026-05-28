import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

/* ─── ELEMENTS ───────────────────────────────────────────────────────────── */
const teamContainer      = document.getElementById("teamContainer");
const teamStatus         = document.getElementById("teamStatus");
const tabUpcoming        = document.getElementById("tabUpcoming");
const tabLocked          = document.getElementById("tabLocked");
const tabs               = document.querySelectorAll(".xi-tab");
const viewTitle          = document.getElementById("viewTitle");
const historyBtn         = document.getElementById("viewHistoryBtn");
const historyOverlay     = document.getElementById("historyOverlay");
const historyList        = document.getElementById("historyList");
const boosterIndicator   = document.getElementById("boosterIndicator");

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let userId;
let currentSession = null;
let isScoutMode = false;
let realTeamsMap = {};
let activePhaseId = null;

/* ─── DOM HELPERS ────────────────────────────────────────────────────────── */
function setEmptyState(container, message) {
    if (!container) return;
    const wrapper = document.createElement("div");
    wrapper.className = "empty-msg";
    wrapper.innerHTML = `<span style="font-size:32px;opacity:0.5;margin-bottom:10px">🏏</span><span>${message}</span>`;
    container.replaceChildren(wrapper);
}

function setSkeletonXI(container) {
    if (!container) return;
    container.innerHTML = `
        <div class="role-section"><div class="skeleton-role-label skeleton"></div><div class="skeleton-row"><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div><div class="skeleton-name skeleton"></div></div></div></div>
        <div class="role-section"><div class="skeleton-role-label skeleton"></div><div class="skeleton-row"><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div></div></div>
    `;
}

function getPhotoUrl(path) {
    if (!path) return "images/default-avatar.png";
    return supabase.storage.from("player-photos").getPublicUrl(path).data.publicUrl;
}

function revealApp() {
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
    setTimeout(() => {
        const overlay = document.getElementById("skeletonScreen");
        if (overlay) overlay.style.display = "none";
    }, 200);
}

/* ─── INIT ───────────────────────────────────────────────────────────────── */
async function boot() {
    try {
        currentSession = { user: await authReady };
        init();
    } catch (_) {
        return; // auth-guard handles redirect
    }
}

boot();

async function init() {
    try {
        const { data: teamData } = await supabase.from("ppl_teams").select("id, short_name");
        realTeamsMap = Object.fromEntries((teamData || []).map(t => [t.id, t.short_name]));

        const user      = currentSession.user;
        const urlParams = new URLSearchParams(window.location.search);
        const scoutUid  = urlParams.get("uid");
        const scoutName = urlParams.get("name");

        if (scoutUid && scoutUid !== user.id) {
            // SCOUT MODE (Viewing someone else)
            userId = scoutUid;
            isScoutMode = true;

            const [profileRes, rankRes] = await Promise.all([
                supabase.from("user_profiles").select("team_name").eq("user_id", scoutUid).maybeSingle(),
                supabase.from("ppl_overall_leaderboard").select("overall_rank").eq("user_id", scoutUid).maybeSingle(),
            ]);

            viewTitle.textContent = profileRes.data?.team_name || decodeURIComponent(scoutName || "") || "Manager Team";
            if (rankRes.data?.overall_rank) applyRankFlair(null, viewTitle, rankRes.data.overall_rank);

            tabUpcoming.style.display = "none"; // Scouts cannot see upcoming unlocked teams
            tabLocked.classList.add("active");
            loadLastLockedXI();

        } else {
            // OWN TEAM MODE
            userId = user.id;
            
            const [profileRes, rankRes] = await Promise.all([
                supabase.from("user_profiles").select("team_name").eq("user_id", userId).maybeSingle(),
                supabase.from("ppl_overall_leaderboard").select("overall_rank").eq("user_id", userId).maybeSingle(),
            ]);

            viewTitle.textContent = profileRes.data?.team_name || "My XI";
            if (rankRes.data?.overall_rank) applyRankFlair(null, viewTitle, rankRes.data.overall_rank);

            tabUpcoming.classList.add("active");
            loadCurrentXI();
        }

        setupHistoryListeners();
        setupTabs();

    } catch (err) {
        console.error("Init error:", err);
    } finally {
        revealApp();
    }
}

function setupTabs() {
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            if (tab.dataset.tab === "current") loadCurrentXI();
            else loadLastLockedXI();
        });
    });
}

/* ─── XI LOADERS ─────────────────────────────────────────────────────────── */
async function loadCurrentXI() {
    setSkeletonXI(teamContainer);
    teamStatus.textContent = "";
    boosterIndicator.classList.add("hidden");

    // Get active phase
    const { data: activeDay } = await supabase.from("ppl_fantasy_days").select("id").eq("is_locked", false).order("created_at").limit(1).maybeSingle();
    if (!activeDay) { setEmptyState(teamContainer, "No active phases right now."); return; }

    const { data: userTeam } = await supabase.from("ppl_user_teams")
        .select("*, ppl_user_team_players(player_id)")
        .eq("user_id", userId)
        .eq("phase_id", activeDay.id)
        .maybeSingle();

    if (!userTeam || !userTeam.ppl_user_team_players.length) {
        setEmptyState(teamContainer, "Team not created yet.");
        return;
    }

    const playerIds = userTeam.ppl_user_team_players.map(p => p.player_id);
    const { data: players } = await supabase.from("ppl_players").select("*").in("id", playerIds);

    renderTeamLayout(players || [], userTeam.captain_player_id, userTeam.vice_captain_player_id, null, teamContainer);
}

async function loadLastLockedXI() {
    setSkeletonXI(teamContainer);
    boosterIndicator.classList.add("hidden");

    // Fetch the most recently scored phase
    const { data: lastScore } = await supabase.from("ppl_fantasy_scores")
        .select("phase_id, phase_points")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lastScore) {
        setEmptyState(teamContainer, "No locked teams yet.");
        return;
    }

    const { data: userTeam } = await supabase.from("ppl_user_teams")
        .select("*, ppl_user_team_players(player_id, is_captain, is_vice_captain, fantasy_points)")
        .eq("user_id", userId)
        .eq("phase_id", lastScore.phase_id)
        .maybeSingle();

    if (!userTeam) { setEmptyState(teamContainer, "Team data missing."); return; }

    const playerIds = userTeam.ppl_user_team_players.map(p => p.player_id);
    const { data: players } = await supabase.from("ppl_players").select("*").in("id", playerIds);
    
    // Create points map
    const statsMap = {};
    userTeam.ppl_user_team_players.forEach(p => {
        statsMap[p.player_id] = p.fantasy_points || 0;
    });

    renderTeamLayout(players || [], userTeam.captain_player_id, userTeam.vice_captain_player_id, statsMap, teamContainer);

    // Add total points chip
    const chip = document.createElement("div");
    chip.className = "field-score-chip";
    chip.innerHTML = `<div class="fsc-right"><span class="fsc-pts">${parseFloat(lastScore.phase_points).toFixed(1)} pts</span></div>`;
    teamContainer.appendChild(chip);
}

/* ─── RENDER LAYOUT ──────────────────────────────────────────────────────── */
function renderTeamLayout(players, captainId, viceCaptainId, statsMap, container) {
    container.replaceChildren();
    
    const roles = ["WK", "BAT", "AR", "BOWL"];
    
    for (const role of roles) {
        const rolePlayers = players.filter(p => p.role === role);
        if (!rolePlayers.length) continue;

        const section = document.createElement("div");
        section.className = "role-section";
        
        const title = document.createElement("div");
        title.className = "role-title";
        title.textContent = role;
        section.appendChild(title);

        const row = document.createElement("div");
        row.className = "player-row";
        
        rolePlayers.forEach(p => {
            const wrap = document.createElement("div");
            wrap.className = "player-circle";
            if (p.id === captainId) wrap.classList.add("captain");
            if (p.id === viceCaptainId) wrap.classList.add("vice-captain");

            if (p.id === captainId) {
                const b = document.createElement("div"); b.className = "badge captain-badge"; b.textContent = "C"; wrap.appendChild(b);
            }
            if (p.id === viceCaptainId) {
                const b = document.createElement("div"); b.className = "badge vice-badge"; b.textContent = "VC"; wrap.appendChild(b);
            }

            const avatar = document.createElement("div");
            avatar.className = "avatar";
            avatar.style.backgroundImage = `url('${getPhotoUrl(p.photo_url)}')`;

            const name = document.createElement("div");
            name.className = "player-name";
            name.textContent = p.name.split(" ").pop();

            wrap.append(avatar, name);

            if (statsMap && statsMap[p.id] !== undefined) {
                let ptsVal = statsMap[p.id];
                if (p.id === captainId) ptsVal *= 2;
                if (p.id === viceCaptainId) ptsVal *= 1.5;
                
                const pts = document.createElement("div");
                pts.className = "player-pts";
                pts.textContent = `${ptsVal} pts`;
                wrap.appendChild(pts);
            }

            row.appendChild(wrap);
        });

        section.appendChild(row);
        container.appendChild(section);
    }
}

/* ─── HISTORY OVERLAY ────────────────────────────────────────────────────── */
function setupHistoryListeners() {
    if (!historyBtn) return;

    historyBtn.onclick = async () => {
        historyOverlay.classList.remove("hidden");
        document.body.style.overflow = "hidden";
        setSkeletonXI(historyList); // Temporary loader

        const { data: scores } = await supabase.from("ppl_fantasy_scores")
            .select("*, ppl_fantasy_days(phase)")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (!scores || !scores.length) {
            setEmptyState(historyList, "No season history yet.");
            return;
        }

        historyList.replaceChildren();
        scores.forEach(s => {
            const row = document.createElement("div");
            row.className = "history-row";
            
            const phaseName = s.ppl_fantasy_days?.phase === 'group_a' ? 'Group A' : 
                              s.ppl_fantasy_days?.phase === 'group_b' ? 'Group B' : 'Knockout';

            row.innerHTML = `
                <div class="h-left">
                    <span class="h-m-num">${phaseName}</span>
                    <span class="h-teams">Phase Rank: #${s.rank_for_phase || '--'}</span>
                </div>
                <div class="h-right">
                    <span class="h-pts-pill has-pts">${parseFloat(s.phase_points).toFixed(1)} pts</span>
                </div>
            `;
            historyList.appendChild(row);
        });
    };

    document.getElementById("closeHistory").onclick = () => {
        historyOverlay.classList.add("hidden");
        document.body.style.overflow = "";
    };
}