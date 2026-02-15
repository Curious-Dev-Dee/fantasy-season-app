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

    // 1. Fetch Players & Teams
    const [{ data: pData }, { data: teamsData }] = await Promise.all([
        supabase.from("players").select("*").eq("is_active", true),
        supabase.from("real_teams").select("*")
    ]);
    state.allPlayers = pData || [];
    state.teams = teamsData || [];
    const teamMap = Object.fromEntries(state.teams.map(t => [t.id, t.short_code]));

    // 2. Fetch Next 5 Matches (Fixed undefined labels)
    const { data: matches } = await supabase.from("matches").select("*")
        .eq("tournament_id", TOURNAMENT_ID)
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true }).limit(5);
    
    state.matches = (matches || []).map(m => ({
        ...m,
        team_home: teamMap[m.team_a_id] || "TBD",
        team_away: teamMap[m.team_b_id] || "TBD"
    }));

    // 3. Load Subs & Draft
    const [{ data: summary }, { data: team }] = await Promise.all([
        supabase.from("dashboard_summary").select("subs_remaining").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle(),
        supabase.from("user_fantasy_teams").select("*").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle()
    ]);
    state.baseSubsRemaining = summary?.subs_remaining ?? 80;

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

    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100 && liveSubs >= 0;
    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;
    saveBtn.innerText = state.saving ? "SAVING..." : (liveSubs < 0 ? "OUT OF SUBS" : "SAVE TEAM");
}

function initFilters() {
    const uniqueTeams = [...new Set(state.allPlayers.map(p => p.team_code || p.team))].filter(Boolean).sort();
    renderCheckboxDropdown('teamMenu', uniqueTeams, 'teams', (t) => t);
    renderCheckboxDropdown('creditMenu', [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b), 'credits', (c) => `${c} Cr`);
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => `${m.team_home} vs ${m.team_away}`);
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    container.innerHTML = items.length ? items.map(item => {
        const val = typeof item === 'object' ? item.id : item;
        return `<label class="filter-item"><input type="checkbox" value="${val}" onchange="toggleFilter('${filterKey}', '${val}', this)"><span>${labelFn(item)}</span></label>`;
    }).join('') : `<div class="filter-item">No data</div>`;
}

window.toggleFilter = (key, value, checkbox) => {
    if (checkbox.checked) state.filters[key].push(key === 'credits' ? parseFloat(value) : value);
    else state.filters[key] = state.filters[key].filter(i => String(i) !== String(value));
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
    }).join('') : `<div class="empty-msg">No players found</div>`;
}

window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) state.selectedPlayers.splice(idx, 1);
    else if (state.selectedPlayers.length < 11) state.selectedPlayers.push(state.allPlayers.find(p => p.id === id));
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