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
    filters: { 
        search: "", 
        role: "ALL", 
        teams: [],   
        credits: [], 
        matches: []  
    }, 
    saving: false 
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch Players
    const { data: pData } = await supabase.from("players").select("*").eq("is_active", true);
    state.allPlayers = pData || [];

    // 2. Fetch Real Teams for Name Mapping
    const { data: teamsData } = await supabase.from("real_teams").select("*");
    state.teams = teamsData || [];
    const teamMap = Object.fromEntries(state.teams.map(t => [t.id, t.short_code]));

    // 3. Fetch Next 5 Matches with Mapped Names
    const { data: matches } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", TOURNAMENT_ID)
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(5);
    
    state.matches = (matches || []).map(m => ({
        ...m,
        team_home: teamMap[m.team_a_id] || "TBD",
        team_away: teamMap[m.team_b_id] || "TBD"
    }));

    // 4. Load User Subs
    const { data: summary } = await supabase.from("dashboard_summary")
        .select("subs_remaining").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle();
    state.baseSubsRemaining = summary?.subs_remaining ?? 80;

    // 5. Load Locked Players
    const { data: lastLock } = await supabase.from("user_match_teams")
        .select("id").eq("user_id", user.id).order("locked_at", { ascending: false }).limit(1).maybeSingle();

    if (lastLock) {
        const { data: lp } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", lastLock.id);
        state.lockedPlayerIds = (lp || []).map(p => p.player_id);
    }

    // 6. Load Current Draft
    const { data: team } = await supabase.from("user_fantasy_teams").select("*")
        .eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle();

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

    let subsUsedInDraft = 0;
    if (state.lockedPlayerIds.length > 0) {
        subsUsedInDraft = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
    }
    
    const liveSubsRemaining = state.baseSubsRemaining - subsUsedInDraft;
    const isOverLimit = liveSubsRemaining < 0;

    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    
    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) subsEl.innerText = liveSubsRemaining;

    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const rCount = state.selectedPlayers.filter(p => p.role === role).length;
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = rCount > 0 ? rCount : "";
    });

    renderList("myXIList", state.selectedPlayers, true);  
    renderList("playerPoolList", state.allPlayers, false); 

    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100 && !isOverLimit;
    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;
    document.querySelector(".save-bar").className = `nav-bar save-bar ${isValid ? 'enabled' : 'disabled'}`;

    if (isOverLimit) {
        saveBtn.innerText = "OUT OF SUBS!";
    } else {
        saveBtn.innerText = state.saving ? "SAVING..." : "SAVE TEAM";
    }
}

function initFilters() {
    const uniqueTeams = [...new Set(state.allPlayers.map(p => p.team_code || p.team))].filter(Boolean).sort();
    renderCheckboxDropdown('teamMenu', uniqueTeams, 'teams', (t) => t);
    const uniqueCredits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b);
    renderCheckboxDropdown('creditMenu', uniqueCredits, 'credits', (c) => `${c} Cr`);
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => `${m.team_home} vs ${m.team_away}`);
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if(!items.length) {
        container.innerHTML = `<div class="filter-item">No upcoming data</div>`;
        return;
    }
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
    document.getElementById(btnId).innerText = state.filters[key].length > 0 ? `${key.charAt(0).toUpperCase() + key.slice(1)} (${state.filters[key].length})` : `${key.charAt(0).toUpperCase() + key.slice(1)} ▼`;
    render();
};

function renderList(containerId, sourceList, isMyXi) {
    const container = document.getElementById(containerId);
    let filtered = sourceList;
    if (!isMyXi) {
        filtered = sourceList.filter(p => {
            const pTeam = p.team_code || p.team;
            if (!p.name.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
            if (state.filters.role !== "ALL" && p.role !== state.filters.role) return false;
            if (state.filters.teams.length > 0 && !state.filters.teams.includes(pTeam)) return false;
            if (state.filters.credits.length > 0 && !state.filters.credits.includes(p.credit)) return false;
            if (state.filters.matches.length > 0) {
                const inMatch = state.matches.some(m => state.filters.matches.includes(m.id) && (m.team_home === pTeam || m.team_away === pTeam));
                if (!inMatch) return false;
            }
            return true;
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:30px; color:#555;">No players found</div>`;
        return;
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
        return `<div class="player-card ${isSelected ? 'selected' : ''}"><div class="avatar-silhouette"></div><div class="player-info"><strong>${p.name} ${isLocked ? '📌' : ''}</strong><span>${p.role} • ${p.team_code || p.team || ''} • ${p.credit} Cr</span></div>${controlsHtml}</div>`;
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
        const btn = document.getElementById(`${type}Toggle`);
        btn.onclick = (e) => { e.stopPropagation(); document.getElementById(`${type}Menu`).classList.toggle('show'); };
    });
    document.addEventListener('click', () => { ['matchMenu', 'teamMenu', 'creditMenu'].forEach(id => document.getElementById(id).classList.remove('show')); });

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
            document.getElementById("saveTeamBtn").innerText = "SAVED ✓";
        } else {
            document.getElementById("saveTeamBtn").innerText = "ERROR";
        }
        setTimeout(() => { state.saving = false; render(); }, 2000);
    };
}

init();