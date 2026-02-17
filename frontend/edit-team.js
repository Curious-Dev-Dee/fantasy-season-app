import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],    
    baseSubsRemaining: 80,  
    matches: [], 
    captainId: null, 
    viceCaptainId: null, 
    filters: { search: "", role: "ALL", teams: [], credits: [], matches: [] }, 
    saving: false 
};

let countdownInterval;

window.addEventListener('auth-verified', async (e) => {
    init(e.detail.user); 
});

async function init(user) {
    if (!user) return;
    const [playersRes, summaryRes, lastLockRes, currentTeamRes, matchesRes] = await Promise.all([
        supabase.from("player_pool_view").select("*").eq("is_active", true),
        supabase.from("dashboard_summary").select("subs_remaining").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_match_teams").select("id, user_match_team_players(player_id)").eq("user_id", user.id).order("locked_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)").eq("user_id", user.id).maybeSingle(),
        supabase.from("matches").select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)").gt("actual_start_time", new Date().toISOString()).order("actual_start_time", { ascending: true }).limit(5)
    ]);

    state.allPlayers = playersRes.data || [];
    state.baseSubsRemaining = summaryRes.data?.subs_remaining ?? 80;
    if (lastLockRes.data?.user_match_team_players) state.lockedPlayerIds = lastLockRes.data.user_match_team_players.map(p => p.player_id);
    if (currentTeamRes.data) {
        state.captainId = currentTeamRes.data.captain_id;
        state.viceCaptainId = currentTeamRes.data.vice_captain_id;
        const savedIds = currentTeamRes.data.user_fantasy_team_players.map(row => row.player_id);
        state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
    }
    state.matches = matchesRes.data || [];
    if (state.matches.length > 0) updateHeaderMatch(state.matches[0]);

    initFilters();
    setupListeners();
    render();
}

function render() {
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const count = state.selectedPlayers.length;
    let subsUsed = state.lockedPlayerIds.length > 0 ? state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length : 0;
    const liveSubsRemaining = state.baseSubsRemaining - subsUsed;

    const roles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };

    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    document.getElementById("subsRemainingLabel").innerText = liveSubsRemaining;

    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = roles[role] > 0 ? roles[role] : "";
    });

    renderList("myXIList", state.selectedPlayers, true);  
    renderList("playerPoolList", state.allPlayers, false); 

    const validRoles = roles.WK >= 1 && roles.BAT >= 3 && roles.AR >= 1 && roles.BOWL >= 3;
    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100 && liveSubsRemaining >= 0 && validRoles;
    document.getElementById("saveTeamBtn").disabled = !isValid;
}

function setupListeners() {
    const roleContainer = document.getElementById("roleTabsContainer");
    
    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            
            // DRIVE THE SLIDER
            roleContainer.setAttribute("data-active", tab.dataset.index);
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .view-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
        };
    });

    document.getElementById("playerSearch").oninput = (e) => { state.filters.search = e.target.value; render(); };

    ['match', 'team', 'credit'].forEach(type => {
        document.getElementById(`${type}Toggle`).onclick = (e) => {
            e.stopPropagation();
            document.getElementById(`${type}Menu`).classList.toggle('show');
        };
    });

    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true;
        render();
        const { data: team } = await supabase.from("user_fantasy_teams").upsert({
            user_id: (await supabase.auth.getUser()).data.user.id,
            tournament_id: TOURNAMENT_ID,
            captain_id: state.captainId,
            vice_captain_id: state.viceCaptainId,
            total_credits: state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0)
        }).select().single();
        
        await supabase.from("user_fantasy_team_players").delete().eq("user_fantasy_team_id", team.id);
        await supabase.from("user_fantasy_team_players").insert(state.selectedPlayers.map(p => ({ user_fantasy_team_id: team.id, player_id: p.id })));
        alert("Team Saved!");
        window.location.href = "home.html";
    };
}

function updateHeaderMatch(match) {
    const target = new Date(match.actual_start_time).getTime();
    countdownInterval = setInterval(() => {
        const diff = target - new Date().getTime();
        if (diff <= 0) { clearInterval(countdownInterval); return; }
        const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
        document.getElementById("headerCountdown").innerText = `${h}h ${m}m ${s}s`;
    }, 1000);
}

function renderList(containerId, sourceList, isMyXi) {
    const container = document.getElementById(containerId);
    let filtered = isMyXi ? sourceList : sourceList.filter(p => {
        if (state.filters.role !== "ALL" && p.role !== state.filters.role) return false;
        if (!p.name.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
        return true;
    });

    container.innerHTML = filtered.map(p => `
        <div class="player-card ${state.selectedPlayers.some(sp => sp.id === p.id) ? 'selected' : ''}">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} • ${p.team_short_code} • ${p.credit} Cr</span>
            </div>
            <button onclick="togglePlayer('${p.id}')">${isMyXi ? '−' : '+'}</button>
        </div>
    `).join('');
}

window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) state.selectedPlayers.splice(idx, 1);
    else if (state.selectedPlayers.length < 11) state.selectedPlayers.push(state.allPlayers.find(p => p.id === id));
    render();
};

function initFilters() { /* Simplified placeholder */ }