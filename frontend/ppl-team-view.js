import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

const teamContainer = document.getElementById("teamContainer");
const viewTitle = document.getElementById("viewTitle");
const phaseToggleRow = document.getElementById("phaseToggleRow");

let userId;
let currentSession = null;
let isScoutMode = false;
let phases = [];

async function boot() {
    try {
        currentSession = { user: await authReady };
        init();
    } catch (_) { return; }
}

boot();

async function init() {
    try {
        const user = currentSession.user;
        const urlParams = new URLSearchParams(window.location.search);
        const scoutUid = urlParams.get("uid");
        const scoutName = urlParams.get("name");

        if (scoutUid && scoutUid !== user.id) {
            userId = scoutUid;
            isScoutMode = true;
            const [profileRes, rankRes] = await Promise.all([
                supabase.from("user_profiles").select("team_name").eq("user_id", scoutUid).maybeSingle(),
                supabase.from("ppl_overall_leaderboard").select("overall_rank").eq("user_id", scoutUid).maybeSingle(),
            ]);
            viewTitle.textContent = profileRes.data?.team_name || decodeURIComponent(scoutName || "") || "Manager Team";
            if (rankRes.data?.overall_rank) applyRankFlair(null, viewTitle, rankRes.data.overall_rank);
        } else {
            userId = user.id;
            const [profileRes, rankRes] = await Promise.all([
                supabase.from("user_profiles").select("team_name").eq("user_id", userId).maybeSingle(),
                supabase.from("ppl_overall_leaderboard").select("overall_rank").eq("user_id", userId).maybeSingle(),
            ]);
            viewTitle.textContent = profileRes.data?.team_name || "My XI";
            if (rankRes.data?.overall_rank) applyRankFlair(null, viewTitle, rankRes.data.overall_rank);
        }

        // Fetch Phases
        const { data: pData } = await supabase.from("ppl_fantasy_days").select("*").order("created_at");
        phases = pData || [];
        
        renderPhaseTabs();
        if (phases.length > 0) {
            window.switchPhase(0);
        } else {
            setEmptyState(teamContainer, "No phases found.");
        }

    } catch (err) {
        console.error("Init error:", err);
    } finally {
        document.body.classList.remove("loading-state");
        document.getElementById("skeletonScreen").style.display = "none";
    }
}

function renderPhaseTabs() {
    if (!phaseToggleRow) return;
    phaseToggleRow.innerHTML = phases.map((p, idx) => {
        const name = p.phase === 'group_a' ? 'Group A' : p.phase === 'group_b' ? 'Group B' : 'Knockout';
        return `<button class="xi-tab ${idx === 0 ? 'active' : ''}" onclick="window.switchPhase(${idx}, this)">${name}</button>`;
    }).join('');
}

window.switchPhase = async (index, el) => {
    if (el) {
        document.querySelectorAll(".xi-tab").forEach(t => t.classList.remove("active"));
        el.classList.add("active");
    }

    const phase = phases[index];
    
    // Scout prevention: Hide teams if the phase is currently unlocked (prevent peeking before lock)
    if (isScoutMode && !phase.is_locked) {
        setEmptyState(teamContainer, "Team hidden until phase locks.");
        return;
    }

    setSkeletonXI();

    const [{ data: userTeam }, { data: scores }] = await Promise.all([
        supabase.from("ppl_user_teams")
            .select("*, ppl_user_team_players(player_id)")
            .eq("user_id", userId)
            .eq("phase_id", phase.id)
            .maybeSingle(),
        supabase.from("ppl_fantasy_scores").select("phase_points").eq("user_id", userId).eq("phase_id", phase.id).maybeSingle()
    ]);

    if (!userTeam || !userTeam.ppl_user_team_players.length) {
        setEmptyState(teamContainer, "No team saved for this phase.");
        return;
    }

    const playerIds = userTeam.ppl_user_team_players.map(p => p.player_id);
    const { data: players } = await supabase.from("ppl_players").select("*, ppl_teams(short_name)").in("id", playerIds);

    renderTeamLayout(players || [], userTeam.captain_player_id, userTeam.vice_captain_player_id, teamContainer);

    if (scores && scores.phase_points !== null) {
        const chip = document.createElement("div");
        chip.className = "field-score-chip";
        chip.innerHTML = `<div class="fsc-right"><span class="fsc-pts">${parseFloat(scores.phase_points).toFixed(1)} pts</span></div>`;
        teamContainer.appendChild(chip);
    }
};

function renderTeamLayout(players, captainId, viceCaptainId, container) {
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
            const photoUrl = p.photo_url ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";
            avatar.style.backgroundImage = `url('${photoUrl}')`;

            const tLabel = document.createElement("div");
            tLabel.className = "team-init-label";
            tLabel.textContent = p.ppl_teams?.short_name || "TBA";
            avatar.appendChild(tLabel);

            const name = document.createElement("div");
            name.className = "player-name";
            name.textContent = p.name.split(" ").pop();

            wrap.append(avatar, name);
            row.appendChild(wrap);
        });

        section.appendChild(row);
        container.appendChild(section);
    }
}

function setEmptyState(container, message) {
    container.innerHTML = `<div class="empty-msg"><span style="font-size:32px;opacity:0.5;margin-bottom:10px">🏏</span><span>${message}</span></div>`;
}

function setSkeletonXI() {
    teamContainer.innerHTML = `
        <div class="role-section"><div class="skeleton-role-label skeleton"></div><div class="skeleton-row"><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div></div></div>
        <div class="role-section"><div class="skeleton-role-label skeleton"></div><div class="skeleton-row"><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div><div class="skeleton-player"><div class="skeleton-avatar skeleton"></div></div></div></div>
    `;
}