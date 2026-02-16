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

const getTeamInfo = (id, useShort = false) => {
    const team = state.teamsMap[id];
    if (!team) return "Unknown";
    return useShort ? team.short_code : team.name;
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch Real Teams
    const { data: tData } = await supabase.from("real_teams").select("*").eq("tournament_id", TOURNAMENT_ID);
    if (tData) {
        tData.forEach(t => {
            state.teamsMap[t.id] = { name: t.name, short_code: t.short_code };
        });
    }

    // 2. Fetch Active Players
    const { data: pData } = await supabase.from("players").select("*").eq("is_active", true);
    state.allPlayers = pData || [];

    // 3. Fetch Subs
    const { data: summary } = await supabase
        .from("dashboard_summary")
        .select("subs_remaining")
        .eq("user_id", user.id)
        .eq("tournament_id", TOURNAMENT_ID)
        .maybeSingle();
    state.baseSubsRemaining = summary?.subs_remaining ?? 80;

    // 4. Fetch Last Locked Team
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

    // 6. Fetch Next 5 UPCOMING matches
    const { data: matches } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", TOURNAMENT_ID)
        .gt("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(5);
    state.matches = matches || [];

    initFilters(); // RESTORED
    render();
    setupListeners();
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
    
    const subsEl = document.getElementById("subsRemainingLabel") || document.getElementById("subsRemaining");
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

    // VALIDATION RULES
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

function initFilters() {
    const uniqueTeams = [...new Set(state.allPlayers.map(p => p.real_team_id))].filter(Boolean).sort();
    renderCheckboxDropdown('teamMenu', uniqueTeams, 'teams', (id) => getTeamInfo(id));
    
    const uniqueCredits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b);
    renderCheckboxDropdown('creditMenu', uniqueCredits, 'credits', (c) => `${c} Cr`);
    
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => 
        `M#${m.match_number}: ${getTeamInfo(m.team_a_id, true)} vs ${getTeamInfo(m.team_b_id, true)}`
    );
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if(!container) return;
    container.innerHTML = items.map(item => {
        const value = typeof item === 'object' ? item.id : item;
        const label = labelFn(item);
        const isChecked = state.filters[filterKey].includes(value) ? 'checked' : '';
        return `<label class="filter-item"><input type="checkbox" value="${value}" ${isChecked} onchange="toggleFilter('${filterKey}', '${value}', this)"><span>${label}</span></label>`;
    }).join('');
}

window.toggleFilter = (key, value, checkbox) => {
    if (key === 'credits') value = parseFloat(value);
    if (checkbox.checked) {
        state.filters[key].push(value);
    } else {
        state.filters[key] = state.filters[key].filter(item => String(item) !== String(value));
    }
    const btnId = key === 'teams' ? 'teamToggle' : key === 'matches' ? 'matchToggle' : 'creditToggle';
    const btn = document.getElementById(btnId);
    if (btn) btn.innerText = state.filters[key].length > 0 ? `${key.charAt(0).toUpperCase() + key.slice(1)} (${state.filters[key].length})` : `${key.charAt(0).toUpperCase() + key.slice(1)} ▼`;
    render();
};

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
            if (state.filters.matches.length > 0) {
                const pTeam = p.real_team_id;
                const inMatch = state.matches.some(m => 
                    state.filters.matches.includes(m.id) && (m.team_a_id === pTeam || m.team_b_id === pTeam)
                );
                if (!inMatch) return false;
            }
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
            const filterWrap = document.querySelector(".search-filter-wrapper");
            if(filterWrap) filterWrap.style.display = btn.dataset.mode === 'myxi' ? 'none' : 'flex';
        };
    });

    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    const searchInput = document.getElementById("playerSearch");
    if(searchInput) searchInput.oninput = (e) => { state.filters.search = e.target.value; render(); };

    ['match', 'team', 'credit'].forEach(type => {
        const btn = document.getElementById(`${type}Toggle`);
        if(btn) btn.onclick = (e) => { 
            e.stopPropagation(); 
            const menu = document.getElementById(`${type}Menu`);
            const isShowing = menu.classList.contains('show');
            document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
            if(!isShowing) menu.classList.add('show');
        };
    });

    document.addEventListener('click', () => { 
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    });

    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true;
        render(); 

        const { data: { user } } = await supabase.auth.getUser();
        const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);

        const { data: team, error } = await supabase.from("user_fantasy_teams").upsert({
            user_id: user.id, 
            tournament_id: TOURNAMENT_ID,
            captain_id: state.captainId, 
            vice_captain_id: state.viceCaptainId,
            total_credits: totalCredits
        }, { onConflict: 'user_id, tournament_id' }).select().single();

        if(!error && team) {
            await supabase.from("user_fantasy_team_players").delete().eq("user_fantasy_team_id", team.id);
            if(state.selectedPlayers.length > 0) {
                await supabase.from("user_fantasy_team_players").insert(
                    state.selectedPlayers.map(p => ({ user_fantasy_team_id: team.id, player_id: p.id }))
                );
            }
            showSuccessModal();
        } else {
            alert("Error saving team.");
        }
        state.saving = false;
        render();
    };
}

function showSuccessModal() {
    const nextMatch = state.matches[0];
    const matchLabel = nextMatch ? `${getTeamInfo(nextMatch.team_a_id, true)} vs ${getTeamInfo(nextMatch.team_b_id, true)}` : "Next Match";
    
    const modal = document.createElement("div");
    modal.className = "success-modal-overlay";
    modal.innerHTML = `
        <div class="success-modal">
            <div class="icon">✅</div>
            <h2>Team Saved!</h2>
            <p>Your XI is ready for <strong>${matchLabel}</strong></p>
            <div class="modal-actions">
                <button class="modal-btn secondary" id="btnChangeAgain">Change Again</button>
                <button class="modal-btn primary" id="btnGoHome">Go to Home</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("btnChangeAgain").onclick = () => modal.remove();
    document.getElementById("btnGoHome").onclick = () => window.location.href = "home.html";
}

init();