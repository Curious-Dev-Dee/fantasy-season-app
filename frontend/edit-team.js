import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

// IPL 2026 CONFIG
const LEAGUE_SUB_LIMIT = 150;
const KNOCKOUT_SUB_LIMIT = 10;
const PLAYOFF_START_MATCH = 71;
const KNOCKOUT_PHASE_MATCH = 72;
const LEAGUE_STAGE_END = 70;

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],    
    baseSubsRemaining: 150, 
    captainId: null, 
    viceCaptainId: null, 
    activeBooster: "NONE", // The new String-based booster state
    usedBoosters: [],      // Array of used boosters
    currentMatchNumber: 0,
    lastLockedMatchNumber: 0, 
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
    
    try {
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
            { data: dashData },      // For subs_remaining
            { data: boosterData },   // For used_boosters
            { data: lastLock },
            { data: currentTeam }
        ] = await Promise.all([
            supabase.from("player_pool_view").select("*").eq("is_active", true).eq("tournament_id", TOURNAMENT_ID),
            supabase.from("home_dashboard_view").select("subs_remaining").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_tournament_points").select("used_boosters").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle(),
            supabase.from("user_match_teams").select(`id, matches!inner(match_number), user_match_team_players(player_id)`).eq("user_id", user.id).neq("match_id", currentMatchId).order("locked_at", { ascending: false }).limit(1).maybeSingle(),
            supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)").eq("user_id", user.id).eq("tournament_id", TOURNAMENT_ID).maybeSingle(),
        ]);

        state.allPlayers = players || [];
        state.baseSubsRemaining = dashData?.subs_remaining ?? 150;
        state.usedBoosters = boosterData?.used_boosters ?? []; 
        state.activeBooster = currentTeam?.active_booster ?? "NONE"; 

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

    } catch (err) {
        console.error("Init failed:", err);
    } finally {
        document.body.classList.remove("loading-state");
    }
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
            timerEl.style.color = "var(--danger-red)";
            clearInterval(countdownInterval);
            return;
        }

        const totalMinutes = Math.floor(diff / (1000 * 60));
        if (totalMinutes < 10) {
            timerEl.style.color = "#ef4444"; // Red
        } else if (totalMinutes < 30) {
            timerEl.style.color = "#f97316"; // Orange
        } else {
            timerEl.style.color = "var(--primary-green)"; // Green
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
    const nextMatch = state.matches?.[0];
    const teamA = nextMatch?.team_a_id;
    const teamB = nextMatch?.team_b_id;

    const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };

    // 1. APPLY FILTERS
    const filteredPlayers = state.allPlayers
    .filter(p => {
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
    })
    .sort((a, b) => {
        const aTeamPriority = a.real_team_id === teamA ? 1 : a.real_team_id === teamB ? 2 : 3;
        const bTeamPriority = b.real_team_id === teamA ? 1 : b.real_team_id === teamB ? 2 : 3;
        if (aTeamPriority !== bTeamPriority) return aTeamPriority - bTeamPriority;
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        return Number(b.credit) - Number(a.credit);
    });
    
    // 2. DYNAMIC STAGE RESET LOGIC & SUBS
    const matchNum = state.currentMatchNumber;
    const isResetMatch = (matchNum === 1 || matchNum === PLAYOFF_START_MATCH);
    const count = state.selectedPlayers.length;
    const overseasCount = state.selectedPlayers.filter(p => p.category === "overseas").length;
    
    let subsUsedInDraft = 0;

    if (isResetMatch) {
        subsUsedInDraft = 0; 
    } else if (state.lockedPlayerIds.length > 0) {
        const newPlayers = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));
        const hasUncappedDiscount = newPlayers.some(p => p.category === "uncapped");
        let rawSubCount = newPlayers.length;
        subsUsedInDraft = (hasUncappedDiscount && rawSubCount > 0) ? rawSubCount - 1 : rawSubCount;
    }

    // BOOSTER OVERRIDE: If Free 11 is selected, subs cost 0
    if (state.activeBooster === 'FREE_11') {
        subsUsedInDraft = 0; 
    }

    const liveSubsRemaining = isResetMatch ? "FREE" : (state.baseSubsRemaining - subsUsedInDraft);
    const isOverLimit = !isResetMatch && (liveSubsRemaining < 0);

    // 3. UI LABELS
    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("overseasCountLabel").innerText = `${overseasCount}/4`;
    document.getElementById("creditCount").innerText = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0).toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    
    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) {
        subsEl.innerText = liveSubsRemaining;
        subsEl.parentElement.className = isOverLimit ? "subs-text negative" : "subs-text";
        if (liveSubsRemaining === "FREE" || state.activeBooster === 'FREE_11') {
            subsEl.parentElement.style.borderColor = "var(--primary-green)";
            subsEl.parentElement.style.boxShadow = "0 0 10px rgba(154, 224, 0, 0.3)";
        } else {
            subsEl.parentElement.style.boxShadow = "none";
        }
    }

    // 4. BOOSTER UI
    const boosterContainer = document.getElementById("boosterContainer");
    const isBoosterWindow = matchNum >= 11 && matchNum <= LEAGUE_STAGE_END;

    if (boosterContainer) {
        if (isBoosterWindow) {
            boosterContainer.classList.remove("hidden");
            
            const boosterNames = {
                TOTAL_2X: "Total 2X Points",
                CAPPED_2X: "Indian Capped 2X",
                UNCAPPED_2X: "Uncapped 2X",
                OVERSEAS_2X: "Overseas 2X",
                FREE_11: "Free 11 (Unlimited Subs)",
                CAPTAIN_3X: "3X Captain"
            };

            let optionsHtml = `<option value="NONE" ${state.activeBooster === 'NONE' ? 'selected' : ''}>-- Select Booster --</option>`;
            
            Object.keys(boosterNames).forEach(key => {
                const isUsed = state.usedBoosters.includes(key);
                const isCurrent = state.activeBooster === key;
                optionsHtml += `<option value="${key}" ${isUsed ? 'disabled' : ''} ${isCurrent ? 'selected' : ''}>
                    ${isUsed ? '🚫 ' : ''}${boosterNames[key]}
                </option>`;
            });

            boosterContainer.innerHTML = `
                <div class="booster-header">
                    <span class="booster-icon">🚀</span>
                    <select id="boosterSelect" class="booster-dropdown" onchange="handleBoosterChange(this.value)">
                        ${optionsHtml}
                    </select>
                </div>
                <div class="booster-hint" style="color: var(--primary-green); font-size: 11px; margin-top: 5px;">
                    ${state.activeBooster !== 'NONE' ? '✅ Booster Selected for this Match' : 'Pick a strategy for this match!'}
                </div>
            `;
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
    const sortedMyXI = [...state.selectedPlayers].sort((a, b) => {
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        return Number(b.credit) - Number(a.credit);
    });

    renderList("myXIList", sortedMyXI, true);
    renderList("playerPoolList", filteredPlayers, false); 

    // 7. SAVE BUTTON VALIDATION
    const hasRequiredRoles = roles.WK >= 1 && roles.BAT >= 3 && roles.AR >= 1 && roles.BOWL >= 3;
    const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const isValid = count === 11 && state.captainId && state.viceCaptainId && totalCredits <= 100 && !isOverLimit && hasRequiredRoles && overseasCount <= 4;

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
    
    const overseasCount = state.selectedPlayers.filter(p => p.category === "overseas").length;
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
            const isOverseas = p.category === "overseas";
            const overseasLimitReached = overseasCount >= 4;

            if (currentCount >= 11 || tooExpensive || (forceMandatory && !thisRoleNeeded) || (isOverseas && overseasLimitReached)) {
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

        const categoryIcon = p.category === "overseas" ? "✈️" : p.category === "uncapped" ? "💎" : "";
        
        return `
        <div class="player-card ${isSelected ? 'selected' : ''} ${fadeClass}">
            <div class="avatar-container">
                <img src="${photoUrl}" class="player-avatar" alt="${p.name}">
            </div>
            <div class="player-info">
            <strong>${p.name} ${categoryIcon} ${isLocked ? '📌' : ''}</strong>
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

window.handleBoosterChange = (val) => {
    if (val === "NONE") {
        state.activeBooster = "NONE";
        render();
        return;
    }

    const boosterNames = {
        TOTAL_2X: "Total 2X Points",
        CAPPED_2X: "Indian Capped 2X",
        UNCAPPED_2X: "Uncapped 2X",
        OVERSEAS_2X: "Overseas 2X",
        FREE_11: "Free 11 (Unlimited Subs)",
        CAPTAIN_3X: "3X Captain"
    };

    const confirmMsg = `Apply ${boosterNames[val]}?\n\n⚠️ IMPORTANT: Each booster can only be used ONCE per season. Once the match locks, you cannot use this booster again!`;

    if (confirm(confirmMsg)) {
        state.activeBooster = val;
        render(); // Recalculates subs if FREE_11 is picked
    } else {
        render(); // Reset dropdown visually if they hit cancel
    }
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
    // 1. View Toggle Logic
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".view-mode").forEach(v => v.classList.remove("active"));
            
            btn.classList.add("active");
            const targetView = document.getElementById(`${btn.dataset.mode}-view`);
            if (targetView) targetView.classList.add("active");

            const filterWrap = document.querySelector(".search-filter-wrapper");
            if(filterWrap) filterWrap.style.display = btn.dataset.mode === 'myxi' ? 'none' : 'flex';
        };
    });

    // 2. Role Filter Logic
    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    // 3. Premium Filter Popup Logic
    const backdrop = document.getElementById("filterBackdrop");
    ['match', 'team', 'credit'].forEach(type => {
        const btn = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);
        if(btn && menu) {
            btn.onclick = (e) => { 
                e.stopPropagation(); 
                document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
                menu.classList.add('show');
                if (backdrop) backdrop.classList.remove('hidden');
                document.body.style.overflow = 'hidden'; 
            };
        }
    });

    if (backdrop) {
        backdrop.onclick = () => {
            document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
            backdrop.classList.add('hidden');
            document.body.style.overflow = '';
        };
    }

    // 4. Search logic
    const searchInput = document.getElementById("playerSearch");
    if(searchInput) searchInput.oninput = (e) => { state.filters.search = e.target.value; render(); };

    // 5. NEW & SECURE Save Team Logic
    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true;
        render(); 

        try {
            const { data: { user } } = await supabase.auth.getUser();
            const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
            const playerIds = state.selectedPlayers.map(p => p.id);

            const { error } = await supabase.rpc('save_fantasy_team', {
                p_user_id: user.id,
                p_tournament_id: TOURNAMENT_ID,
                p_captain_id: state.captainId,
                p_vice_captain_id: state.viceCaptainId,
                p_total_credits: totalCredits,
                p_active_booster: state.activeBooster, // Sending the String
                p_player_ids: playerIds
            });

            if (error) throw error;
            showSuccessModal();

        } catch (err) {
            console.error("Save error:", err.message);
            alert("Critical Error: Your team could not be saved. Please check your internet and try again.");
        } finally {
            state.saving = false;
            render();
        }
    };
}

function showSuccessModal() {
    const modal = document.createElement("div");
    modal.className = "success-modal-overlay";

    const matchNum = state.currentMatchNumber;
    const isResetMatch = (matchNum === 1 || matchNum === 71);
    
    // Calculate current draft usage with discounts
    let subsUsedInDraft = 0;
    if (!isResetMatch && state.lockedPlayerIds.length > 0) {
        const newPlayers = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));
        const hasUncappedDiscount = newPlayers.some(p => p.category === "uncapped");
        const rawCost = newPlayers.length;
        subsUsedInDraft = (hasUncappedDiscount && rawCost > 0) ? rawCost - 1 : rawCost;
    }
    
    // FORCE FREE 11 FOR MODAL DISPLAY
    if (state.activeBooster === 'FREE_11') {
        subsUsedInDraft = 0; 
    }

    const remaining = isResetMatch ? "UNLIMITED" : (state.baseSubsRemaining - subsUsedInDraft);

    modal.innerHTML = `
        <div class="success-modal">
            <div class="icon">✅</div>
            <h2>Team Saved!</h2>
            <p>Your XI is ready for Match #${matchNum}.</p>
            
            <div style="margin: 15px 0; padding: 10px; background: rgba(154, 224, 0, 0.1); border-radius: 10px; border: 1px solid rgba(154, 224, 0, 0.2);">
                <small style="color: #94a3b8; display: block; margin-bottom: 4px; text-transform: uppercase; font-size: 10px; font-weight: 800;">Subs Remaining</small>
                <strong style="color: #9AE000; font-size: 18px;">${remaining}</strong>
            </div>

            <div class="modal-actions">
                <button class="modal-btn primary" id="btnGoHome">Go to Dashboard</button>
                <button class="modal-btn secondary" id="btnChangeAgain">Make More Changes</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const autoRedirect = setTimeout(() => { 
        if (document.body.contains(modal)) window.location.href = "home.html"; 
    }, 4000);

    document.getElementById("btnChangeAgain").onclick = () => { 
        clearTimeout(autoRedirect); 
        modal.remove(); 
    };

    document.getElementById("btnGoHome").onclick = () => { 
        window.location.href = "home.html"; 
    };
}