import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    captainId: null, 
    viceCaptainId: null, 
    filters: { search: "", role: "ALL" }, 
    saving: false 
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch players
    const { data: pData } = await supabase.from("players").select("*").eq("is_active", true);
    state.allPlayers = pData || [];

    // Fetch existing team
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
    render();
    setupListeners();
}

function render() {
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const count = state.selectedPlayers.length;

    // Summary Update
    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;

    // Role Counters
    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const rCount = state.selectedPlayers.filter(p => p.role === role).length;
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = rCount > 0 ? rCount : "";
    });

    // Render Lists
    renderMyXI();
    renderPool();

    // Save Button Logic
    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100;
    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;
    document.querySelector(".save-bar").className = `nav-bar save-bar ${isValid ? 'enabled' : 'disabled'}`;
}

// UPDATED: Now uses circular +/- buttons
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

// UPDATED: Now uses circular +/- buttons
function renderPool() {
    const container = document.getElementById("playerPoolList");
    
    // Filter logic
    const filtered = state.allPlayers.filter(p => 
        (state.filters.role === "ALL" || p.role === state.filters.role) &&
        (p.name.toLowerCase().includes(state.filters.search.toLowerCase()))
    );

    container.innerHTML = filtered.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const actionClass = isSelected ? 'remove' : 'add';
        const actionSymbol = isSelected ? '−' : '+'; // Using minus sign HTML entity usually looks better centered

        return `
        <div class="player-card ${isSelected ? 'selected' : ''}">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} • ${p.credit} Cr</span>
            </div>
            <button class="action-btn-circle ${actionClass}" onclick="togglePlayer('${p.id}')">${actionSymbol}</button>
        </div>`;
    }).join('');
}

// Logic functions (Global scope for inline HTML onclick)
window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
        // Remove
        state.selectedPlayers.splice(idx, 1);
        if (state.captainId === id) state.captainId = null;
        if (state.viceCaptainId === id) state.viceCaptainId = null;
    } else {
        // Add (Limit 11)
        if (state.selectedPlayers.length < 11) {
            state.selectedPlayers.push(state.allPlayers.find(p => p.id === id));
        }
    }
    render();
};

window.setRole = (id, role) => {
    // Basic C/VC toggle logic
    if (role === 'C') {
        if (state.captainId === id) {
            state.captainId = null; // Toggle off
        } else {
            if (state.viceCaptainId === id) state.viceCaptainId = null;
            state.captainId = id;
        }
    } else {
        if (state.viceCaptainId === id) {
            state.viceCaptainId = null; // Toggle off
        } else {
            if (state.captainId === id) state.captainId = null;
            state.viceCaptainId = id;
        }
    }
    render();
};

function setupListeners() {
    // View toggling (My Team vs Player Pool)
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .view-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
        };
    });

    // Role Filtering
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

    // Save Button
    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true;
        const btn = document.getElementById("saveTeamBtn");
        const originalText = btn.innerText;
        btn.innerText = "SAVING...";

        const { data: { user } } = await supabase.auth.getUser();
        const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);

        // Upsert Team Header
        const { data: team, error } = await supabase.from("user_fantasy_teams").upsert({
            user_id: user.id, 
            tournament_id: TOURNAMENT_ID,
            captain_id: state.captainId, 
            vice_captain_id: state.viceCaptainId,
            total_credits: totalCredits
        }, { onConflict: 'user_id, tournament_id' }).select().single();

        if(!error && team) {
            // Replace Team Players
            await supabase.from("user_fantasy_team_players").delete().eq("user_fantasy_team_id", team.id);
            if(state.selectedPlayers.length > 0) {
                await supabase.from("user_fantasy_team_players").insert(
                    state.selectedPlayers.map(p => ({ user_fantasy_team_id: team.id, player_id: p.id }))
                );
            }
            btn.innerText = "SAVED ✓";
        } else {
            btn.innerText = "ERROR";
        }
        
        setTimeout(() => { btn.innerText = "SAVE TEAM"; state.saving = false; }, 2000);
    };
}

init();