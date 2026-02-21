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
    s8BoosterUsed: false, 
    boosterActiveInDraft: false, 
    currentMatchNumber: 0,
    lastLockedMatchNumber: 0, // Tracked to handle abandoned matches
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

/* =========================
   INIT (Auth Guard Protected)
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    init(user); 
});

async function init(user) {
    if (!user) return;

    // 1. Fetch upcoming matches to identify the active match
    const { data: matches } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
        .eq("tournament_id", TOURNAMENT_ID)
        .eq("status", "upcoming") 
        .gt("actual_start_time", new Date().toISOString())
        .order("actual_start_time", { ascending: true })
        .limit(5);

    state.matches = matches || [];
    if (state.matches.length === 0) {
        console.warn("No upcoming matches found.");
        return;
    }

    const currentMatchId = state.matches[0].id;
    state.currentMatchNumber = state.matches[0].match_number || 0;

    // 2. Fetch User Data & History in Parallel
    const [
        { data: players },
        { data: dashboardData }, 
        { data: lastLock },
        { data: currentTeam }
    ] = await Promise.all([
        supabase.from("player_pool_view").select("*").eq("is_active", true),
        supabase.from("home_dashboard_view").select("subs_remaining, s8_booster_used")
            .eq("user_id", user.id).maybeSingle(),
        
        // Fetch last lock AND its match number to handle Stage Transitions
        supabase.from("user_match_teams").select(`
            id, 
            matches!inner(match_number), 
            user_match_team_players(player_id)
        `)
        .eq("user_id", user.id)
        .neq("match_id", currentMatchId) 
        .order("locked_at", { ascending: false }).limit(1).maybeSingle(),

        supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)")
            .eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle(),
    ]);

    state.allPlayers = players || [];
    state.baseSubsRemaining = dashboardData?.subs_remaining ?? 80;
    state.s8BoosterUsed = dashboardData?.s8_booster_used ?? false;
    state.boosterActiveInDraft = currentTeam?.use_booster ?? false;

    // Store the last match number locked to detect if we skipped an abandoned match
    state.lastLockedMatchNumber = lastLock?.matches?.match_number || 0;

    if (lastLock?.user_match_team_players) {
        state.lockedPlayerIds = lastLock.user_match_team_players.map(p => p.player_id);
    }
    
    if (currentTeam) {
        state.captainId = currentTeam.captain_id;
        state.viceCaptainId = currentTeam.vice_captain_id;
        const savedIds = currentTeam.user_fantasy_team_players.map(row => row.player_id);
        state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
    }

    updateHeaderMatch(state.matches[0]);
    initFilters();
    render();
    setupListeners();
}

const getTeamCode = (player) => player.team_short_code || "UNK";

function updateHeaderMatch(match) {
    const nameEl = document.getElementById("upcomingMatchName");
    const timerEl = document.getElementById("headerCountdown");
    if (!nameEl || !timerEl) return;

    nameEl.innerText = `${match.team_a?.short_code || "TBA"} vs ${match.team_b?.short_code || "TBA"}`;
    
    if (countdownInterval) clearInterval(countdownInterval);
    const targetDate = new Date(match.actual_start_time).getTime();
    
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

/* =========================
   RENDER LOGIC
========================= */
function render() {
    // 1. APPLY FILTERS
    const filteredPlayers = state.allPlayers.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(state.filters.search.toLowerCase());
        const matchesRole = state.filters.role === "ALL" || p.role === state.filters.role;
        const matchesTeam = state.filters.teams.length === 0 || state.filters.teams.includes(p.real_team_id);
        const matchesCredit = state.filters.credits.length === 0 || state.filters.credits.includes(p.credit);
        
        const matchesMatch = state.filters.matches.length === 0 || state.filters.matches.some(mId => {
            const m = state.matches.find(match => match.id === mId);
            if (!m) return true; 
            return (p.real_team_id === m.team_a_id || p.real_team_id === m.team_b_id);
        });

        return matchesSearch && matchesRole && matchesTeam && matchesCredit && matchesMatch;
    });

    // 2. DYNAMIC STAGE RESET LOGIC (Handles Abandoned Matches)
    const isSuper8 = state.currentMatchNumber >= 41 && state.currentMatchNumber <= 52;
    const isKnockout = state.currentMatchNumber >= 53;

    // Reset triggers if we are in Super 8 but our last actual play was Group Stage
    const isResetMatch = (isSuper8 && state.lastLockedMatchNumber < 41) || 
                         (isKnockout && state.lastLockedMatchNumber < 53);

    const count = state.selectedPlayers.length;
    let subsUsedInDraft = 0;

    if (isResetMatch) {
        subsUsedInDraft = 0; 
    } else if (state.lockedPlayerIds.length > 0) {
        subsUsedInDraft = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
    }

    const liveSubsRemaining = state.baseSubsRemaining - subsUsedInDraft;
    const isOverLimit = isResetMatch ? false : (liveSubsRemaining < 0);

    // 3. UI LABELS
    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0).toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    
    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) {
        if (isResetMatch) {
            subsEl.innerText = "FREE";
            subsEl.parentElement.style.color = "#9AE000";
        } else {
            subsEl.innerText = liveSubsRemaining;
            subsEl.parentElement.className = isOverLimit ? "subs-text negative" : "subs-text";
            subsEl.parentElement.style.color = isOverLimit ? "#ef4444" : "inherit";
        }
    }

    // 4. BOOSTER WINDOW
    const boosterContainer = document.getElementById("boosterContainer");
    const isBoosterWindow = state.currentMatchNumber >= 43 && state.currentMatchNumber <= 52;
    if (boosterContainer) {
        if (isBoosterWindow && !state.s8BoosterUsed) {
            boosterContainer.classList.remove("hidden");
            document.getElementById("boosterToggle").checked = state.boosterActiveInDraft;
        } else {
            boosterContainer.classList.add("hidden");
        }
    }

    // 5. ROLE COUNTS
    const roles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };
    ["WK", "BAT", "AR", "BOWL"].forEach(r => {
        const el = document.getElementById(`count-${r}`);
        if(el) el.innerText = roles[r] > 0 ? roles[r] : "";
    });

    // 6. RENDER LISTS
    renderList("myXIList", state.selectedPlayers, true);  
    renderList("playerPoolList", filteredPlayers, false); 

    // 7. SAVE BUTTON VALIDATION
    const hasRequiredRoles = roles.WK >= 1 && roles.BAT >= 3 && roles.AR >= 1 && roles.BOWL >= 3;
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100 && !isOverLimit && hasRequiredRoles;

    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;

    if (state.saving) saveBtn.innerText = "SAVING...";
    else if (isOverLimit) saveBtn.innerText = "OUT OF SUBS!";
    else if (count < 11) saveBtn.innerText = `ADD ${11 - count} MORE PLAYERS`;
    else if (!hasRequiredRoles) saveBtn.innerText = "REQ: 1 WK, 3 BAT, 1 AR, 3 BOWL";
    else if (totalCredits > 100) saveBtn.innerText = `EXCEEDED BY ${(totalCredits - 100).toFixed(1)} Cr`;
    else if (!state.captainId) saveBtn.innerText = "SELECT CAPTAIN (C)";
    else if (!state.viceCaptainId) saveBtn.innerText = "SELECT VICE-CAPTAIN (VC)";
    else saveBtn.innerText = "SAVE TEAM";
}

/* =========================
   LIST RENDERER
========================= */
function renderList(containerId, sourceList, isMyXi) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const totalCreditsUsed = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const remainingCredits = 100 - totalCreditsUsed;
    const currentCount = state.selectedPlayers.length;
    const slotsLeft = 11 - currentCount;

    const currentRoles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };
    const minRequired = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    let neededSlots = 0;
    const neededRoles = {};
    for (const r in minRequired) {
        const debt = Math.max(0, minRequired[r] - currentRoles[r]);
        neededRoles[r] = debt;
        neededSlots += debt;
    }

    container.innerHTML = sourceList.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const isLocked = state.lockedPlayerIds.includes(p.id);
        let isDisabled = false;
        let fadeClass = "";

        if (!isMyXi && !isSelected) {
            const tooExpensive = Number(p.credit) > remainingCredits;
            const forceMandatory = slotsLeft <= neededSlots;
            const thisRoleNeeded = neededRoles[p.role] > 0;

            if (currentCount >= 11 || tooExpensive || (forceMandatory && !thisRoleNeeded)) {
                isDisabled = true;
                fadeClass = "player-faded"; 
            }
        }

        const photoUrl = p.photo_url 
            ? supabase.storage.from('player-photos').getPublicUrl(p.photo_url).data.publicUrl 
            : 'images/default-avatar.png'; 
        
        let controlsHtml = isMyXi ? `
            <div class="controls">
                <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                <button class="action-btn-circle remove" onclick="togglePlayer('${p.id}')">−</button>
            </div>` 
            : `<button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" 
                ${isDisabled ? 'disabled' : ''} 
                onclick="togglePlayer('${p.id}')">${isSelected ? '−' : '+'}</button>`;
        
        return `
        <div class="player-card ${isSelected ? 'selected' : ''} ${fadeClass}">
            <div class="avatar-container">
                <img src="${photoUrl}" class="player-avatar" alt="${p.name}">
            </div>
            <div class="player-info">
                <strong>${p.name} ${isLocked ? '📌' : ''}</strong>
                <span>${p.role} • ${getTeamCode(p)} • ${p.credit} Cr</span>
            </div>
            ${controlsHtml}
        </div>`;
    }).join('');
}

/* =========================
   ACTIONS & FILTERS
========================= */
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

function initFilters() {
    const teams = [];
    const seenTeams = new Set();
    state.allPlayers.forEach(p => {
        if(!seenTeams.has(p.real_team_id)) {
            seenTeams.add(p.real_team_id);
            teams.push({ id: p.real_team_id, label: p.team_short_code });
        }
    });
    renderCheckboxDropdown('teamMenu', teams, 'teams', (t) => t.label);
    const uniqueCredits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b);
    renderCheckboxDropdown('creditMenu', uniqueCredits, 'credits', (c) => `${c} Cr`);
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => `M#${m.match_number}: ${m.team_a?.short_code} vs ${m.team_b?.short_code}`);
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if(!container) return;
    const listHtml = items.map(item => {
        const value = item.id || item; 
        const isChecked = state.filters[filterKey].includes(value) ? 'checked' : ''; 
        return `<label class="filter-item"><input type="checkbox" value="${value}" ${isChecked} onchange="toggleFilter('${filterKey}', '${value}', this)"><span>${labelFn(item)}</span></label>`;
    }).join('');
    container.innerHTML = `<div class="dropdown-content">${listHtml}</div><div class="dropdown-actions"><button class="filter-action-btn clear" onclick="clearFilters('${filterKey}')">Clear</button><button class="filter-action-btn all" onclick="selectAllFilters('${filterKey}', '${elementId}')">All</button></div>`;
}

window.toggleFilter = (key, value, el) => {
    const val = key === 'credits' ? parseFloat(value) : value;
    if (el.checked) state.filters[key].push(val);
    else state.filters[key] = state.filters[key].filter(v => v !== val);
    render();
};

window.clearFilters = (key) => {
    state.filters[key] = [];
    const menuId = key === 'teams' ? 'teamMenu' : key === 'matches' ? 'matchMenu' : 'creditMenu';
    document.querySelectorAll(`#${menuId} input[type="checkbox"]`).forEach(cb => cb.checked = false);
    render();
};

window.selectAllFilters = (key, menuId) => {
    const checkboxes = document.querySelectorAll(`#${menuId} input[type="checkbox"]`);
    state.filters[key] = Array.from(checkboxes).map(cb => {
        cb.checked = true;
        return key === 'credits' ? parseFloat(cb.value) : cb.value;
    });
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
        const boosterToggled = document.getElementById("boosterToggle")?.checked || false;

        const { data: team, error } = await supabase.from("user_fantasy_teams").upsert({
            user_id: user.id, 
            tournament_id: TOURNAMENT_ID,
            captain_id: state.captainId, 
            vice_captain_id: state.viceCaptainId,
            total_credits: totalCredits,
            use_booster: boosterToggled 
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
            console.error(error);
        }
        state.saving = false;
        render();
    };
}

function showSuccessModal() {
    const modal = document.createElement("div");
    modal.className = "success-modal-overlay";
    modal.innerHTML = `
        <div class="success-modal">
            <div class="icon">✅</div>
            <h2>Team Saved!</h2>
            <p>Your XI is ready for the upcoming match.</p>
            <div class="modal-actions">
                <button class="modal-btn primary" id="btnGoHome">Go to Home</button>
                <button class="modal-btn secondary" id="btnChangeAgain">Change Again</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("btnChangeAgain").onclick = () => { clearTimeout(autoRedirect); modal.remove(); };
    document.getElementById("btnGoHome").onclick = () => { window.location.href = "home.html"; };
    const autoRedirect = setTimeout(() => { if (document.body.contains(modal)) window.location.href = "home.html"; }, 3000);
}