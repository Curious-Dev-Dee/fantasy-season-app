import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const CONFIG = { MAX_PLAYERS: 11, MAX_CREDITS: 100, MAX_TEAM: 6 };

let state = {
    allPlayers: [],
    selectedIds: [], // Store IDs for quick lookups
    captainId: null,
    viceCaptainId: null,
    currentRole: "ALL",
    searchTerm: "",
    isSaving: false
};

const dom = {
    myXI: document.getElementById("myXIList"),
    pool: document.getElementById("playerPoolList"),
    saveBtn: document.getElementById("mainSaveBtn"),
    countLabel: document.getElementById("count"),
    creditLabel: document.getElementById("credits"),
    progress: document.getElementById("progressFill"),
    roleBtns: document.querySelectorAll(".role-filter-btn")
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return window.location.href = "login.html";

    await Promise.all([fetchPlayers(), fetchUserTeam(user.id)]);
    renderAll();
    setupListeners();
}

async function fetchPlayers() {
    const { data } = await supabase.from("players").select("*").eq("is_active", true);
    state.allPlayers = data || [];
}

async function fetchUserTeam(userId) {
    const { data: team } = await supabase.from("user_fantasy_teams")
        .select(`*, user_fantasy_team_players(player_id)`)
        .eq("user_id", userId)
        .eq("tournament_id", TOURNAMENT_ID)
        .maybeSingle();

    if (team) {
        state.captainId = team.captain_id;
        state.viceCaptainId = team.vice_captain_id;
        state.selectedIds = team.user_fantasy_team_players.map(p => p.player_id);
    }
}

function renderAll() {
    const selectedPlayers = state.allPlayers.filter(p => state.selectedIds.includes(p.id));
    const totalCredits = selectedPlayers.reduce((sum, p) => sum + Number(p.credit), 0);
    
    // Update Stats
    dom.countLabel.textContent = state.selectedIds.length;
    dom.creditLabel.textContent = totalCredits.toFixed(1);
    dom.progress.style.width = `${(state.selectedIds.length / CONFIG.MAX_PLAYERS) * 100}%`;

    // Render My XI
    dom.myXI.innerHTML = selectedPlayers.length ? "" : '<p style="text-align:center; padding:20px; color:#64748b;">No players selected yet.</p>';
    selectedPlayers.forEach(p => {
        const card = createPlayerCard(p, true);
        dom.myXI.appendChild(card);
    });

    // Render Pool
    const filtered = state.allPlayers.filter(p => {
        const matchesRole = state.currentRole === "ALL" || p.role === state.currentRole;
        const matchesSearch = p.name.toLowerCase().includes(state.searchTerm.toLowerCase());
        return matchesRole && matchesSearch;
    });

    dom.pool.innerHTML = "";
    filtered.forEach(p => {
        const isSelected = state.selectedIds.includes(p.id);
        dom.pool.appendChild(createPlayerCard(p, false, isSelected));
    });

    // Validate Save Button
    const isValid = state.selectedIds.length === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100;
    dom.saveBtn.disabled = !isValid;
    dom.saveBtn.classList.toggle("disabled", !isValid);
}

function createPlayerCard(player, isMyXIMode, isSelectedInPool = false) {
    const div = document.createElement("div");
    div.className = `player-card ${isSelectedInPool || isMyXIMode ? 'selected' : ''}`;
    
    if (isMyXIMode) {
        div.innerHTML = `
            <div class="avatar"></div>
            <div class="info">
                <span class="name">${player.name}</span>
                <span class="meta">${player.role} • ${player.credit} Cr</span>
            </div>
            <div class="actions">
                <button class="cv-btn ${state.captainId === player.id ? 'active' : ''}" data-action="cap">C</button>
                <button class="cv-btn ${state.viceCaptainId === player.id ? 'active' : ''}" data-action="vcap">VC</button>
                <button class="circle-btn remove" data-action="remove">−</button>
            </div>
        `;
    } else {
        div.innerHTML = `
            <div class="avatar"></div>
            <div class="info">
                <span class="name">${player.name}</span>
                <span class="meta">${player.role} • ${player.credit} Cr</span>
            </div>
            <div class="actions">
                <button class="circle-btn ${isSelectedInPool ? 'remove' : 'add'}" data-action="${isSelectedInPool ? 'remove' : 'add'}">
                    ${isSelectedInPool ? '−' : '+'}
                </button>
            </div>
        `;
    }

    div.addEventListener('click', (e) => {
        const action = e.target.closest('button')?.dataset.action;
        if (!action) return;

        if (action === 'add') addPlayer(player);
        if (action === 'remove') removePlayer(player.id);
        if (action === 'cap') setRole(player.id, 'C');
        if (action === 'vcap') setRole(player.id, 'VC');
    });

    return div;
}

function addPlayer(player) {
    if (state.selectedIds.length >= CONFIG.MAX_PLAYERS) return alert("Team full!");
    if (!state.selectedIds.includes(player.id)) {
        state.selectedIds.push(player.id);
        renderAll();
    }
}

function removePlayer(id) {
    state.selectedIds = state.selectedIds.filter(pid => pid !== id);
    if (state.captainId === id) state.captainId = null;
    if (state.viceCaptainId === id) state.viceCaptainId = null;
    renderAll();
}

function setRole(id, role) {
    if (role === 'C') {
        if (state.viceCaptainId === id) state.viceCaptainId = null;
        state.captainId = id;
    } else {
        if (state.captainId === id) state.captainId = null;
        state.viceCaptainId = id;
    }
    renderAll();
}

function setupListeners() {
    // Mode Toggles
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .edit-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-section`).classList.add("active");
        };
    });

    // Filters
    dom.roleBtns.forEach(btn => {
        btn.onclick = () => {
            dom.roleBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.currentRole = btn.dataset.role;
            renderAll();
        };
    });

    document.getElementById("playerSearch").oninput = (e) => {
        state.searchTerm = e.target.value;
        renderAll();
    };

    dom.saveBtn.onclick = handleSave;
}

async function handleSave() {
    if (state.isSaving) return;
    state.isSaving = true;
    dom.saveBtn.textContent = "SAVING...";

    try {
        const { data: { user } } = await supabase.auth.getUser();
        const totalCredits = state.allPlayers
            .filter(p => state.selectedIds.includes(p.id))
            .reduce((s, p) => s + Number(p.credit), 0);

        const { data: team, error: teamErr } = await supabase
            .from("user_fantasy_teams")
            .upsert({
                user_id: user.id,
                tournament_id: TOURNAMENT_ID,
                captain_id: state.captainId,
                vice_captain_id: state.viceCaptainId,
                total_credits: totalCredits
            })
            .select().single();

        if (teamErr) throw teamErr;

        // Clean and Re-insert players
        await supabase.from("user_fantasy_team_players").delete().eq("user_fantasy_team_id", team.id);
        const playerInserts = state.selectedIds.map(pid => ({ user_fantasy_team_id: team.id, player_id: pid }));
        await supabase.from("user_fantasy_team_players").insert(playerInserts);

        dom.saveBtn.textContent = "SUCCESS ✓";
        setTimeout(() => { dom.saveBtn.textContent = "SAVE TEAM"; state.isSaving = false; }, 2000);
    } catch (err) {
        console.error(err);
        alert("Error saving team");
        state.isSaving = false;
        dom.saveBtn.textContent = "SAVE TEAM";
    }
}

init();