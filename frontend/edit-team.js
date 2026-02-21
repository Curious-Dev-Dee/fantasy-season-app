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

    // 1. Fetch Matches first to identify the "Current" match
    const { data: matches } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
        .eq("tournament_id", TOURNAMENT_ID)
        .gt("actual_start_time", new Date().toISOString())
        .order("actual_start_time", { ascending: true }).limit(5);

    state.matches = matches || [];
    const currentMatchId = state.matches[0]?.id; // This is the match we are editing for
    state.currentMatchNumber = state.matches[0]?.match_number || 0;

    // 2. Fetch the rest in parallel, EXCLUDING the currentMatchId from lastLock
    const [
        { data: players },
        { data: dashboardData }, 
        { data: lastLock },
        { data: currentTeam }
    ] = await Promise.all([
        supabase.from("player_pool_view").select("*").eq("is_active", true),
        supabase.from("home_dashboard_view").select("subs_remaining, s8_booster_used")
            .eq("user_id", user.id).maybeSingle(),
        
        // FIX: The query now ignores the current match to survive rain delays
        supabase.from("user_match_teams").select("id, user_match_team_players(player_id)")
            .eq("user_id", user.id)
            .neq("match_id", currentMatchId) 
            .order("locked_at", { ascending: false }).limit(1).maybeSingle(),

        supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)")
            .eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle(),
    ]);

    // ... (rest of your state assignment remains the same)
    state.allPlayers = players || [];
    state.baseSubsRemaining = dashboardData?.subs_remaining ?? 80;
    state.s8BoosterUsed = dashboardData?.s8_booster_used ?? false;
    state.boosterActiveInDraft = currentTeam?.use_booster ?? false;

    if (lastLock?.user_match_team_players) {
        state.lockedPlayerIds = lastLock.user_match_team_players.map(p => p.player_id);
    }
    
    // ... (rest of your function)
    if (currentTeam) {
        state.captainId = currentTeam.captain_id;
        state.viceCaptainId = currentTeam.vice_captain_id;
        const savedIds = currentTeam.user_fantasy_team_players.map(row => row.player_id);
        state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
    }

    if (state.matches.length > 0) {
        updateHeaderMatch(state.matches[0]);
    }

    initFilters();
    render();
    setupListeners();
}
const getTeamCode = (player) => player.team_short_code || "UNK";

function updateHeaderMatch(match) {
    const nameEl = document.getElementById("upcomingMatchName");
    const timerEl = document.getElementById("headerCountdown");
    if (!nameEl || !timerEl) return;

    const teamA = match.team_a?.short_code || "TBA";
    const teamB = match.team_b?.short_code || "TBA";
    nameEl.innerText = `${teamA} vs ${teamB}`;
    
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
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const count = state.selectedPlayers.length;

    /* Inside the render() function */

// 1. Existing logic for subsUsed
let subsUsedInDraft = 0;
const isResetMatch = state.currentMatchNumber === 41 || state.currentMatchNumber === 53;

if (isResetMatch) {
    subsUsedInDraft = 0; 
} else if (state.lockedPlayerIds.length > 0) {
    subsUsedInDraft = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
}

// 2. THE FIX: Ensure isOverLimit is FALSE if it's a reset match
const liveSubsRemaining = state.baseSubsRemaining - subsUsedInDraft;

// UPDATED LINE: If it's a reset match, it can NEVER be over the limit
const isOverLimit = (state.currentMatchNumber === 41 || state.currentMatchNumber === 53) ? false : (liveSubsRemaining < 0);    // BOOSTER LOGIC - Updated for "Use Once" rule
    const boosterContainer = document.getElementById("boosterContainer");
    const isBoosterWindow = state.currentMatchNumber >= 43 && state.currentMatchNumber <= 52;
    
    if (boosterContainer) {
        if (isBoosterWindow && state.s8BoosterUsed === false) {
            boosterContainer.classList.remove("hidden");
            document.getElementById("boosterToggle").checked = state.boosterActiveInDraft;
        } else {
            boosterContainer.classList.add("hidden");
        }
    }

    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = totalCredits.toFixed(1);
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

    const roles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };

    ["WK", "BAT", "AR", "BOWL"].forEach(role => {
        const el = document.getElementById(`count-${role}`);
        if(el) el.innerText = roles[role] > 0 ? roles[role] : "";
    });

    renderList("myXIList", state.selectedPlayers, true);  
    renderList("playerPoolList", state.allPlayers, false); 

    /* --- DYNAMIC VALIDATION LOGIC --- */
    /* --- UPDATED DYNAMIC VALIDATION LOGIC --- */
    const hasRequiredRoles = roles.WK >= 1 && roles.BAT >= 3 && roles.AR >= 1 && roles.BOWL >= 3;
    
    // THE FIX: Added explicit check for state.captainId AND state.viceCaptainId
    const isValid = count === 11 && 
                    state.captainId && 
                    state.viceCaptainId && 
                    totalCredits <= 100 && 
                    !isOverLimit && 
                    hasRequiredRoles;

    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;

    // Priority-based messaging (The user sees the most important error first)
    if (state.saving) {
        saveBtn.innerText = "SAVING...";
    } else if (isOverLimit) {
        saveBtn.innerText = "OUT OF SUBS!";
    } else if (count < 11) {
        saveBtn.innerText = `ADD ${11 - count} MORE PLAYERS`;
    } else if (count > 11) {
        saveBtn.innerText = `REMOVE ${count - 11} PLAYERS`;
    } else if (!hasRequiredRoles) {
        saveBtn.innerText = "REQ: 1 WK, 3 BAT, 1 AR, 3 BOWL";
    } else if (totalCredits > 100) {
        saveBtn.innerText = `EXCEEDED BY ${(totalCredits - 100).toFixed(1)} Cr`;
    } else if (!state.captainId) {
        saveBtn.innerText = "SELECT CAPTAIN (C)";
    } else if (!state.viceCaptainId) {
        saveBtn.innerText = "SELECT VICE-CAPTAIN (VC)";
    } else {
        saveBtn.innerText = "SAVE TEAM";
    }
}

/* =========================
   FILTER LOGIC
========================= */
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
    
    renderCheckboxDropdown('matchMenu', state.matches, 'matches', (m) => 
        `M#${m.match_number}: ${m.team_a?.short_code} vs ${m.team_b?.short_code}`
    );
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if(!container) return;

    const listHtml = items.map(item => {
        const value = item.id || item; 
        const label = labelFn(item);
        const isChecked = state.filters[filterKey].includes(value) ? 'checked' : ''; 
        return `
            <label class="filter-item">
                <input type="checkbox" value="${value}" ${isChecked} 
                       onchange="toggleFilter('${filterKey}', '${value}', this)">
                <span>${label}</span>
            </label>`;
    }).join('');

    container.innerHTML = `
        <div class="dropdown-content">${listHtml}</div>
        <div class="dropdown-actions">
            <button class="filter-action-btn clear" onclick="clearFilters('${filterKey}')">Clear</button>
            <button class="filter-action-btn all" onclick="selectAllFilters('${filterKey}', '${elementId}')">All</button>
        </div>
    `;
}

window.selectAllFilters = (key, menuId) => {
    const checkboxes = document.querySelectorAll(`#${menuId} input[type="checkbox"]`);
    state.filters[key] = Array.from(checkboxes).map(cb => {
        cb.checked = true;
        return key === 'credits' ? parseFloat(cb.value) : cb.value;
    });
    render();
};

window.clearFilters = (key) => {
    state.filters[key] = [];
    const menuId = key === 'teams' ? 'teamMenu' : key === 'matches' ? 'matchMenu' : 'creditMenu';
    const checkboxes = document.querySelectorAll(`#${menuId} input[type="checkbox"]`);
    checkboxes.forEach(cb => cb.checked = false);
    render();
};

window.toggleFilter = (key, value, el) => {
    const val = key === 'credits' ? parseFloat(value) : value;
    if (el.checked) {
        state.filters[key].push(val);
    } else {
        state.filters[key] = state.filters[key].filter(v => v !== val);
    }
    render();
};

/* =========================
   LIST RENDERER
========================= */
function renderList(containerId, sourceList, isMyXi) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // 1. Current Stats
    const totalCreditsUsed = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const remainingCredits = 100 - totalCreditsUsed;
    const currentCount = state.selectedPlayers.length;
    const slotsLeft = 11 - currentCount;

    // 2. Calculate Role Requirements (Minimums: 1 WK, 3 BAT, 1 AR, 3 BOWL)
    const currentRoles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };

    const minRequired = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    
    // Calculate how many more players we NEED for each role
    const neededRoles = {};
    let totalNeededSlots = 0;
    
    for (const role in minRequired) {
        const debt = Math.max(0, minRequired[role] - currentRoles[role]);
        neededRoles[role] = debt;
        totalNeededSlots += debt;
    }

    let filtered = sourceList;
    if (!isMyXi) {
        // ... keep your existing search/team/credit filters here ...
    }

    container.innerHTML = filtered.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const isLocked = state.lockedPlayerIds.includes(p.id);
        
        let isDisabled = false;
        let fadeClass = "";

        if (!isMyXi && !isSelected) {
            const tooExpensive = Number(p.credit) > remainingCredits;
            const squadFull = currentCount >= 11;
            
            // --- DYNAMIC ROLE FADING LOGIC ---
            // If the slots remaining exactly match the number of players still needed for roles
            const forceMandatoryRoles = (slotsLeft <= totalNeededSlots);
            const thisRoleIsNeeded = neededRoles[p.role] > 0;

            // FADE if: Squad is full, OR too expensive, OR we must pick a specific role and this isn't it
            if (squadFull || tooExpensive || (forceMandatoryRoles && !thisRoleIsNeeded)) {
                isDisabled = true;
                fadeClass = "player-faded"; 
            }
        }

        const photoUrl = p.photo_url 
            ? supabase.storage.from('player-photos').getPublicUrl(p.photo_url).data.publicUrl 
            : 'images/default-avatar.png'; 
        
        // ... (Keep the rest of your button and template logic here) ...        
        let controlsHtml = isMyXi ? `
            <div class="controls">
                <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                <button class="action-btn-circle remove" onclick="togglePlayer('${p.id}')">−</button>
            </div>` 
            : `<button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" 
                ${isDisabled ? 'disabled' : ''} 
                onclick="togglePlayer('${p.id}')">${isSelected ? '−' : '+'}</button>`;
        
        // --- UPDATED RETURN TEMPLATE ---
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
   ACTIONS
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
    const nextMatch = state.matches[0];
    const matchLabel = nextMatch 
        ? `${nextMatch.team_a?.short_code} vs ${nextMatch.team_b?.short_code}` 
        : "Next Match";
    
    const modal = document.createElement("div");
    modal.className = "success-modal-overlay";
    modal.innerHTML = `
        <div class="success-modal">
            <div class="icon">✅</div>
            <h2>Team Saved!</h2>
            <p>Your XI is ready for <strong>${matchLabel}</strong></p>
            <div class="modal-actions">
                <button class="modal-btn primary" id="btnGoHome">Go to Home</button>
                <button class="modal-btn secondary" id="btnChangeAgain">Change Again</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("btnChangeAgain").onclick = () => {
        clearTimeout(autoRedirect); 
        modal.remove();
    };
    
    document.getElementById("btnGoHome").onclick = () => {
        window.location.href = "home.html";
    };

    const autoRedirect = setTimeout(() => {
        if (document.body.contains(modal)) {
            window.location.href = "home.html";
        }
    }, 3000);
}