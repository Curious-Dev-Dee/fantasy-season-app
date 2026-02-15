import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],    
    baseSubsRemaining: 80,  
    matches: [], 
    teams: [], 
    captainId: null, 
    viceCaptainId: null, 
    filters: { search: "", role: "ALL", teams: [], credits: [], matches: [] }, 
    saving: false 
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch Players and Real Teams for data mapping
    const [{ data: pData }, { data: teamsData }] = await Promise.all([
        supabase.from("players").select("*").eq("is_active", true),
        supabase.from("real_teams").select("*")
    ]);
    state.allPlayers = pData || [];
    state.teams = teamsData || [];
    const teamMap = Object.fromEntries(state.teams.map(t => [t.id, t.short_code]));

    // 2. Fetch Next 5 Matches with Mapped Names (Fixes Match Filter)
    const { data: matches } = await supabase.from("matches").select("*")
        .eq("tournament_id", TOURNAMENT_ID)
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true }).limit(5);
    
    state.matches = (matches || []).map(m => ({
        ...m,
        team_home: teamMap[m.team_a_id] || "TBD",
        team_away: teamMap[m.team_b_id] || "TBD"
    }));

    // 3. Load Subs & User Draft
    const { data: summary } = await supabase.from("dashboard_summary")
        .select("subs_remaining").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle();
    state.baseSubsRemaining = summary?.subs_remaining ?? 80;

    const { data: team } = await supabase.from("user_fantasy_teams").select("*").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle();
    if (team) {
        state.captainId = team.captain_id;
        state.viceCaptainId = team.vice_captain_id;
        const { data: pIds } = await supabase.from("user_fantasy_team_players").select("player_id").eq("user_fantasy_team_id", team.id);
        state.selectedPlayers = (pIds || []).map(row => state.allPlayers.find(p => p.id === row.player_id)).filter(Boolean);
    }

    initFilters();
    render();
    setupListeners();
}

function initFilters() {
    // Populate Team Filter from actual players in pool
    const uniqueTeams = [...new Set(state.allPlayers.map(p => p.team_code || p.team))].filter(Boolean).sort();
    renderCheckboxDropdown('teamMenu', uniqueTeams, 'teams', (t) => t);
    
    // Populate Match Filter with next 5 match labels
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => `${m.team_home} vs ${m.team_away}`);
    
    // Credit Filter
    renderCheckboxDropdown('creditMenu', [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b), 'credits', (c) => `${c} Cr`);
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    container.innerHTML = items.length ? items.map(item => {
        const val = typeof item === 'object' ? item.id : item;
        const isChecked = state.filters[filterKey].includes(val) ? 'checked' : '';
        return `<label class="filter-item"><input type="checkbox" value="${val}" ${isChecked} onchange="toggleFilter('${filterKey}', '${val}', this)"><span>${labelFn(item)}</span></label>`;
    }).join('') : `<div class="filter-item">No upcoming matches</div>`;
}

window.toggleFilter = (key, value, checkbox) => {
    const val = key === 'credits' ? parseFloat(value) : value;
    if (checkbox.checked) state.filters[key].push(val);
    else state.filters[key] = state.filters[key].filter(i => String(i) !== String(value));
    
    const btnId = key === 'teams' ? 'teamToggle' : key === 'matches' ? 'matchToggle' : 'creditToggle';
    document.getElementById(btnId).innerText = state.filters[key].length > 0 ? `${key} (${state.filters[key].length})` : `${key} ▼`;
    render();
};

function renderList(containerId, sourceList, isMyXi) {
    const container = document.getElementById(containerId);
    let filtered = isMyXi ? sourceList : sourceList.filter(p => {
        const pTeam = p.team_code || p.team;
        if (!p.name.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
        if (state.filters.role !== "ALL" && p.role !== state.filters.role) return false;
        if (state.filters.teams.length && !state.filters.teams.includes(pTeam)) return false;
        if (state.filters.credits.length && !state.filters.credits.includes(p.credit)) return false;
        if (state.filters.matches.length) {
            return state.matches.some(m => state.filters.matches.includes(m.id) && (m.team_home === pTeam || m.team_away === pTeam));
        }
        return true;
    });

    container.innerHTML = filtered.length ? filtered.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const controls = isMyXi ? `
            <div class="controls">
                <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                <button class="action-btn-circle remove" onclick="togglePlayer('${p.id}')">−</button>
            </div>` : `<button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" onclick="togglePlayer('${p.id}')">${isSelected ? '−' : '+'}</button>`;
        
        return `<div class="player-card ${isSelected ? 'selected' : ''}">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} • ${p.team_code || p.team} • ${p.credit} Cr</span>
            </div>
            ${controls}
        </div>`;
    }).join('') : `<div class="empty-msg">No players match these filters</div>`;
}

// Ensure the rest of your render, togglePlayer, and setRole functions remain intact
function render() {
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const count = state.selectedPlayers.length;
    const subsUsed = state.lockedPlayerIds.length > 0 ? state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length : 0;
    const liveSubs = state.baseSubsRemaining - subsUsed;

    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    document.getElementById("subsRemainingLabel").innerText = liveSubs;

    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const rCount = state.selectedPlayers.filter(p => p.role === role).length;
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = rCount > 0 ? rCount : "";
    });

    renderList("myXIList", state.selectedPlayers, true);  
    renderList("playerPoolList", state.allPlayers, false); 
}

window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
        state.selectedPlayers.splice(idx, 1);
        if (state.captainId === id) state.captainId = null;
        if (state.viceCaptainId === id) state.viceCaptainId = null;
    } else if (state.selectedPlayers.length < 11) {
        state.selectedPlayers.push(state.allPlayers.find(p => p.id === id));
    }
    render();
};

window.setRole = (id, role) => {
    if (role === 'C') state.captainId = state.captainId === id ? null : id;
    else state.viceCaptainId = state.viceCaptainId === id ? null : id;
    render();
};

function setupListeners() {
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .view-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
            document.querySelector(".search-filter-wrapper").style.display = btn.dataset.mode === 'myxi' ? 'none' : 'flex';
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
    document.getElementById("playerSearch").oninput = (e) => { state.filters.search = e.target.value; render(); };
    ['match', 'team', 'credit'].forEach(type => {
        document.getElementById(`${type}Toggle`).onclick = (e) => {
            e.stopPropagation();
            document.getElementById(`${type}Menu`).classList.toggle('show');
        };
    });
    document.addEventListener('click', () => document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show')));
}

init();