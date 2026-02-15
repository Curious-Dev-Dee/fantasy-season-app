import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

// Extended State to handle multi-select filters
let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    matches: [], // Stores upcoming match data
    captainId: null, 
    viceCaptainId: null, 
    filters: { 
        search: "", 
        role: "ALL", 
        teams: [],   // Array of selected team names
        credits: [], // Array of selected credit values
        matches: []  // Array of selected match IDs
    }, 
    saving: false 
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch Players
    const { data: pData } = await supabase.from("players").select("*").eq("is_active", true);
    state.allPlayers = pData || [];

    // 2. Fetch User Team
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

    // 3. Fetch Matches (Next 5)
    // Assumes table 'matches' has: id, team_home, team_away, start_time
    const { data: matches } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", TOURNAMENT_ID)
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(5);
    
    state.matches = matches || [];

    // Initialize UI
    initFilters();
    render();
    setupListeners();
}

// --- FILTER LOGIC START ---

function initFilters() {
    // A. Populate Team Filter (Unique teams from player list)
    const uniqueTeams = [...new Set(state.allPlayers.map(p => p.team_code || p.team))].sort();
    renderCheckboxDropdown('teamMenu', uniqueTeams, 'teams', (t) => t);

    // B. Populate Credit Filter (Unique credits)
    const uniqueCredits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b);
    renderCheckboxDropdown('creditMenu', uniqueCredits, 'credits', (c) => c);

    // C. Populate Match Filter (From fetched matches)
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => `${m.team_home} vs ${m.team_away}`);
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if(!items.length) {
        container.innerHTML = `<div class="filter-item">No items found</div>`;
        return;
    }

    container.innerHTML = items.map(item => {
        // Handle object (match) vs primitive (string/number)
        const value = typeof item === 'object' ? item.id : item;
        const label = labelFn(item);
        const isChecked = state.filters[filterKey].includes(value) ? 'checked' : '';

        return `
            <label class="filter-item">
                <input type="checkbox" value="${value}" ${isChecked} onchange="toggleFilter('${filterKey}', '${value}', this)">
                <span>${label}</span>
            </label>
        `;
    }).join('');
}

// Global function for inline checkbox events
window.toggleFilter = (key, value, checkbox) => {
    // If credit, convert value back to number
    if (key === 'credits') value = parseFloat(value);
    
    if (checkbox.checked) {
        state.filters[key].push(value);
    } else {
        state.filters[key] = state.filters[key].filter(item => String(item) !== String(value));
    }

    // Update button visual state
    const btnId = key === 'teams' ? 'teamToggle' : key === 'matches' ? 'matchToggle' : 'creditToggle';
    const btn = document.getElementById(btnId);
    if(state.filters[key].length > 0) {
        btn.classList.add('has-value');
        btn.innerText = `${key.charAt(0).toUpperCase() + key.slice(1)} (${state.filters[key].length}) ▼`;
    } else {
        btn.classList.remove('has-value');
        // Reset text
        const defaultText = key === 'teams' ? 'Team' : key === 'matches' ? 'Match' : 'Credit';
        btn.innerText = `${defaultText} ▼`;
    }

    renderPool();
};

// --- FILTER LOGIC END ---

function render() {
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const count = state.selectedPlayers.length;

    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;

    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const rCount = state.selectedPlayers.filter(p => p.role === role).length;
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = rCount > 0 ? rCount : "";
    });

    renderMyXI();
    renderPool();

    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100;
    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;
    document.querySelector(".save-bar").className = `nav-bar save-bar ${isValid ? 'enabled' : 'disabled'}`;
}

function renderMyXI() {
    const container = document.getElementById("myXIList");
    container.innerHTML = state.selectedPlayers.map(p => `
        <div class="player-card selected">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} • ${p.credit} Cr</span>
            </div>
            <div class="controls">
                <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                <button class="action-btn-circle remove" onclick="togglePlayer('${p.id}')">−</button>
            </div>
        </div>`).join('');
}

function renderPool() {
    const container = document.getElementById("playerPoolList");
    
    // MASTER FILTERING LOGIC
    const filtered = state.allPlayers.filter(p => {
        // 1. Text Search
        if (!p.name.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
        
        // 2. Role Tab
        if (state.filters.role !== "ALL" && p.role !== state.filters.role) return false;

        // 3. Team Filter (Checkbox)
        if (state.filters.teams.length > 0 && !state.filters.teams.includes(p.team_code || p.team)) return false;

        // 4. Credit Filter (Checkbox)
        if (state.filters.credits.length > 0 && !state.filters.credits.includes(p.credit)) return false;

        // 5. Match Filter (Checkbox) - Advanced
        // If matches selected, player's team must match team_home or team_away of ANY selected match
        if (state.filters.matches.length > 0) {
            const playerTeam = p.team_code || p.team;
            const isPlayingInSelectedMatches = state.matches.some(m => 
                state.filters.matches.includes(m.id) && 
                (m.team_home === playerTeam || m.team_away === playerTeam)
            );
            if (!isPlayingInSelectedMatches) return false;
        }

        return true;
    });

    if(filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 20px; color:#555;">No players found</div>`;
        return;
    }

    container.innerHTML = filtered.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const actionClass = isSelected ? 'remove' : 'add';
        const actionSymbol = isSelected ? '−' : '+';
        const teamName = p.team_code || p.team || ''; // Show team name

        return `
        <div class="player-card ${isSelected ? 'selected' : ''}">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} • ${teamName} • ${p.credit} Cr</span>
            </div>
            <button class="action-btn-circle ${actionClass}" onclick="togglePlayer('${p.id}')">${actionSymbol}</button>
        </div>`;
    }).join('');
}

window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
        state.selectedPlayers.splice(idx, 1);
        if (state.captainId === id) state.captainId = null;
        if (state.viceCaptainId === id) state.viceCaptainId = null;
    } else {
        if (state.selectedPlayers.length < 11) {
            state.selectedPlayers.push(state.allPlayers.find(p => p.id === id));
        }
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
    // View Toggles
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .view-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
        };
    });

    // Role Tabs
    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    // Search
    document.getElementById("playerSearch").oninput = (e) => { 
        state.filters.search = e.target.value; 
        render(); 
    };

    // Dropdown Toggles (Click to open, click outside to close)
    const dropdowns = ['match', 'team', 'credit'];
    dropdowns.forEach(type => {
        const btn = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);
        
        btn.onclick = (e) => {
            e.stopPropagation();
            // Close others
            dropdowns.forEach(other => {
                if(other !== type) document.getElementById(`${other}Menu`).classList.remove('show');
            });
            menu.classList.toggle('show');
        };
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        dropdowns.forEach(type => {
            document.getElementById(`${type}Menu`).classList.remove('show');
        });
    });

    // Prevent menu closing when clicking inside the menu
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.onclick = (e) => e.stopPropagation();
    });

    // Save Button
    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true;
        const btn = document.getElementById("saveTeamBtn");
        btn.innerText = "SAVING...";

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
            btn.innerText = "SAVED ✓";
        } else {
            console.error(error);
            btn.innerText = "ERROR";
        }
        
        setTimeout(() => { btn.innerText = "SAVE TEAM"; state.saving = false; }, 2000);
    };
}

init();