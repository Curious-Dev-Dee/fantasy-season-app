import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],    
    baseSubsRemaining: 80,  
    matches: [], 
    teamsMap: {}, 
    captainId: null, 
    viceCaptainId: null, 
    filters: { 
        search: "", 
        role: "ALL", 
        teams: [],   
        credits: [], 
        matches: []  
    }, 
    saving: false 
};

let countdownInterval;

const getTeamInfo = (id, useShort = false) => {
    const team = state.teamsMap[id];
    if (!team) return "Unknown";
    return useShort ? team.short_code : team.name;
};

async function init() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            window.location.href = "login.html";
            return;
        }

        // 1. Fetch Real Teams (Essential for names)
        const { data: tData } = await supabase.from("real_teams").select("*").eq("tournament_id", TOURNAMENT_ID);
        if (tData) {
            tData.forEach(t => {
                state.teamsMap[t.id] = { name: t.name, short_code: t.short_code };
            });
        }

        // 2. Fetch Active Players
        const { data: pData } = await supabase.from("players").select("*").eq("is_active", true);
        state.allPlayers = pData || [];

        // 3. Fetch Subs Remaining
        const { data: summary } = await supabase
            .from("dashboard_summary")
            .select("subs_remaining")
            .eq("user_id", user.id)
            .eq("tournament_id", TOURNAMENT_ID)
            .maybeSingle();
        state.baseSubsRemaining = summary?.subs_remaining ?? 80;

        // 4. Fetch Last Locked Team (for subs calculation)
        const { data: lastLock } = await supabase
            .from("user_match_teams")
            .select("id")
            .eq("user_id", user.id)
            .order("locked_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastLock) {
            const { data: lp } = await supabase
                .from("user_match_team_players")
                .select("player_id")
                .eq("user_match_team_id", lastLock.id);
            state.lockedPlayerIds = (lp || []).map(p => p.player_id);
        }

        // 5. Fetch Current Team
        const { data: team } = await supabase.from("user_fantasy_teams")
            .select("*")
            .eq("user_id", user.id)
            .eq("tournament_id", TOURNAMENT_ID)
            .maybeSingle();

        if (team) {
            state.captainId = team.captain_id;
            state.viceCaptainId = team.vice_captain_id;
            const { data: pIds } = await supabase.from("user_fantasy_team_players")
                .select("player_id")
                .eq("user_fantasy_team_id", team.id);
            
            state.selectedPlayers = (pIds || [])
                .map(row => state.allPlayers.find(p => p.id === row.player_id))
                .filter(Boolean);
        }

        // 6. Fetch Upcoming Matches
        const { data: matches } = await supabase
            .from("matches")
            .select("*")
            .eq("tournament_id", TOURNAMENT_ID)
            .gt("start_time", new Date().toISOString())
            .order("start_time", { ascending: true })
            .limit(5);
        state.matches = matches || [];

        // Finalize UI
        if (state.matches.length > 0) {
            updateHeaderMatch(state.matches[0]);
        } else {
            document.getElementById("upcomingMatchName").innerText = "No upcoming matches";
        }

        initFilters();
        setupListeners();
        render(); // This MUST be called last to show the players

    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

function updateHeaderMatch(match) {
    const nameEl = document.getElementById("upcomingMatchName");
    const timerEl = document.getElementById("headerCountdown");
    if (!nameEl || !timerEl || !match) return;

    nameEl.innerText = `${getTeamInfo(match.team_a_id, true)} vs ${getTeamInfo(match.team_b_id, true)}`;
    
    if (countdownInterval) clearInterval(countdownInterval);
    const targetDate = new Date(match.start_time).getTime();
    
    const startTimer = () => {
        const now = new Date().getTime();
        const diff = targetDate - now;
        if (diff <= 0) {
            timerEl.innerText = "MATCH LIVE";
            clearInterval(countdownInterval);
            return;
        }
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        timerEl.innerText = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    };
    startTimer();
    countdownInterval = setInterval(startTimer, 1000);
}

function render() {
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const count = state.selectedPlayers.length;

    let subsUsedInDraft = 0;
    if (state.lockedPlayerIds.length > 0) {
        subsUsedInDraft = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
    }
    const liveSubsRemaining = state.baseSubsRemaining - subsUsedInDraft;
    const isOverLimit = liveSubsRemaining < 0;

    const roles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };

    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    
    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) {
        subsEl.innerText = liveSubsRemaining;
        subsEl.parentElement.className = isOverLimit ? "subs-text negative" : "subs-text";
    }

    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = roles[role] > 0 ? roles[role] : "";
    });

    renderList("myXIList", state.selectedPlayers, true);  
    renderList("playerPoolList", state.allPlayers, false); 

    const hasRequiredRoles = roles.WK >= 1 && roles.BAT >= 3 && roles.AR >= 1 && roles.BOWL >= 3;
    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100 && !isOverLimit && hasRequiredRoles;

    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;

    if (isOverLimit) {
        saveBtn.innerText = "OUT OF SUBS!";
    } else if (!hasRequiredRoles && count === 11) {
        saveBtn.innerText = "1 WK, 3 BAT, 1 AR, 3 BOWL REQ.";
    } else {
        saveBtn.innerText = state.saving ? "SAVING..." : "SAVE TEAM";
    }
}

// ... (initFilters, toggleFilter, renderCheckboxDropdown functions stay the same) ...

function renderList(containerId, sourceList, isMyXi) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let filtered = sourceList;
    if (!isMyXi) {
        filtered = sourceList.filter(p => {
            if (!p.name.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
            if (state.filters.role !== "ALL" && p.role !== state.filters.role) return false;
            if (state.filters.teams.length > 0 && !state.filters.teams.includes(p.real_team_id)) return false;
            if (state.filters.credits.length > 0 && !state.filters.credits.includes(p.credit)) return false;
            return true;
        });
    }

    container.innerHTML = filtered.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const isLocked = state.lockedPlayerIds.includes(p.id);
        let controlsHtml = isMyXi ? `
            <div class="controls">
                <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                <button class="action-btn-circle remove" onclick="togglePlayer('${p.id}')">−</button>
            </div>` : `<button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" onclick="togglePlayer('${p.id}')">${isSelected ? '−' : '+'}</button>`;
        
        return `
        <div class="player-card ${isSelected ? 'selected' : ''}">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <strong>${p.name} ${isLocked ? '📌' : ''}</strong>
                <span>${p.role} • ${getTeamInfo(p.real_team_id, true)} • ${p.credit} Cr</span>
            </div>
            ${controlsHtml}
        </div>`;
    }).join('');
}

// Global functions for window scope
window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
        state.selectedPlayers.splice(idx, 1);
        if (state.captainId === id) state.captainId = null;
        if (state.viceCaptainId === id) state.viceCaptainId = null;
    } else if (state.selectedPlayers.length < 11) {
        const p = state.allPlayers.find(p => p.id === id);
        if (p) state.selectedPlayers.push(p);
    }
    render();
};

window.setRole = (id, role) => {
    if (role === 'C') {
        state.captainId = (state.captainId === id) ? null : id;
        if (state.captainId && state.viceCaptainId === id) state.viceCaptainId = null;
    } else {
        state.viceCaptainId = (state.viceCaptainId === id) ? null : id;
        if (state.viceCaptainId && state.captainId === id) state.captainId = null;
    }
    render();
};

function setupListeners() {
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .view-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
        };
    });

    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        
        // 1. Time-Gate check
        if (state.matches.length > 0) {
            const matchStart = new Date(state.matches[0].start_time).getTime();
            if (Date.now() >= matchStart) {
                alert("Match has started! Team locked.");
                window.location.href = "home.html";
                return;
            }
        }

        state.saving = true;
        render(); 

        const { data: { user } } = await supabase.auth.getUser();
        const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
        const playerIds = state.selectedPlayers.map(p => p.id);

        // ATOMIC SAVE RPC
        const { error } = await supabase.rpc('save_fantasy_team_atomic', {
            p_user_id: user.id, 
            p_tournament_id: TOURNAMENT_ID,
            p_captain_id: state.captainId, 
            p_vice_captain_id: state.viceCaptainId,
            p_total_credits: totalCredits,
            p_player_ids: playerIds
        });

        if(!error) {
            showSuccessModal();
        } else {
            console.error(error);
            alert("Error saving team.");
        }
        state.saving = false;
        render();
    };
}

// ... (showSuccessModal, initFilters, toggleFilter, renderCheckboxDropdown functions) ...

init();