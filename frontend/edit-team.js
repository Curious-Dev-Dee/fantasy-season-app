import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

let state = {
    allPlayers: [],
    selectedIds: [],
    captainId: null,
    viceCaptainId: null,
    filters: { search: "", role: "ALL" }
};

const dom = {
    myXI: document.getElementById("myXIList"),
    pool: document.getElementById("playerPool"),
    countLabel: document.getElementById("playerCountLabel"),
    creditCount: document.getElementById("creditCount"),
    progress: document.getElementById("progressFill"),
    saveBtn: document.getElementById("saveTeamBtn")
};

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: players } = await supabase.from("players").select("*").eq("is_active", true);
    state.allPlayers = players || [];

    const { data: team } = await supabase.from("user_fantasy_teams")
        .select(`*, user_fantasy_team_players(player_id)`)
        .eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle();

    if (team) {
        state.captainId = team.captain_id;
        state.viceCaptainId = team.vice_captain_id;
        state.selectedIds = team.user_fantasy_team_players.map(p => p.player_id);
    }

    render();
    setupEventListeners();
}

function render() {
    const selectedPlayers = state.allPlayers.filter(p => state.selectedIds.includes(p.id));
    const totalCredits = selectedPlayers.reduce((acc, p) => acc + Number(p.credit), 0);

    // Update Progress & Credits
    const count = state.selectedIds.length;
    dom.countLabel.innerText = count;
    dom.creditCount.innerText = totalCredits.toFixed(1);
    dom.progress.style.width = `${(count / 11) * 100}%`;

    // Update Role Counters
    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const roleCount = selectedPlayers.filter(p => p.role === role).length;
        const badge = document.getElementById(`count-${role}`);
        badge.innerText = roleCount;
        badge.style.display = roleCount > 0 ? "inline" : "none";
    });

    // Render Lists
    dom.myXI.innerHTML = selectedPlayers.length ? 
        selectedPlayers.map(p => createPlayerRow(p, true)).join('') : 
        `<div style="color:var(--text-dim); text-align:center; padding:50px;">Start adding players to your XI</div>`;

    const poolList = state.allPlayers.filter(p => 
        (state.filters.role === "ALL" || p.role === state.filters.role) &&
        (p.name.toLowerCase().includes(state.filters.search.toLowerCase()))
    );
    dom.pool.innerHTML = poolList.map(p => createPlayerRow(p, false)).join('');

    // Save Button Logic
    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100;
    dom.saveBtn.disabled = !isValid;
    dom.saveBtn.className = `save-btn ${isValid ? '' : 'disabled'}`;
}

function createPlayerRow(p, isMyXIMode) {
    const isSelected = state.selectedIds.includes(p.id);
    return `
        <div class="player-card ${isSelected ? 'selected' : ''}" data-id="${p.id}">
            <div class="avatar-silhouette"></div>
            <div class="player-info">
                <span class="player-name">${p.name}</span>
                <span class="player-meta">${p.role} • ${p.credit} Cr</span>
            </div>
            <div class="controls">
                ${isMyXIMode ? `
                    <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" data-action="cap">C</button>
                    <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" data-action="vcap">VC</button>
                    <button class="btn-round remove" data-action="remove">−</button>
                ` : `
                    <button class="btn-round ${isSelected ? 'remove' : 'add'}" data-action="${isSelected ? 'remove' : 'add'}">
                        ${isSelected ? '−' : '+'}
                    </button>
                `}
            </div>
        </div>
    `;
}

function setupEventListeners() {
    [dom.myXI, dom.pool].forEach(list => {
        list.onclick = (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const id = e.target.closest('.player-card').dataset.id;
            const action = btn.dataset.action;

            if (action === 'add' && state.selectedIds.length < 11) state.selectedIds.push(id);
            if (action === 'remove') {
                state.selectedIds = state.selectedIds.filter(sid => sid !== id);
                if (state.captainId === id) state.captainId = null;
                if (state.viceCaptainId === id) state.viceCaptainId = null;
            }
            if (action === 'cap') {
                if (state.viceCaptainId === id) state.viceCaptainId = null;
                state.captainId = (state.captainId === id) ? null : id;
            }
            if (action === 'vcap') {
                if (state.captainId === id) state.captainId = null;
                state.viceCaptainId = (state.viceCaptainId === id) ? null : id;
            }
            render();
        };
    });

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.nav-item, .view-mode').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.target}-view`).classList.add('active');
        };
    });

    document.querySelectorAll('.role-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    document.getElementById('playerSearch').oninput = (e) => {
        state.filters.search = e.target.value;
        render();
    };
}

init();