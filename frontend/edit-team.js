import { supabase } from "./supabase.js";

const LEAGUE_STAGE_END = 70;
const PLAYOFF_START_MATCH = 71;
const BOOSTER_WINDOW_START = 2;
const BOOSTER_WINDOW_END = 70;
const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],    
    baseSubsRemaining: 130, 
    captainId: null, 
    viceCaptainId: null, 
    activeBooster: "NONE", 
    usedBoosters: [],      
    currentMatchNumber: 0,
    matches: [],
    filters: { 
        search: "", 
        role: "ALL", 
        teams: [],   
        credits: [], 
        matches: [],  
        type: [] // <--- ADD THIS
    }, 
    saving: false 
    
};

let countdownInterval = null;
let activeTournamentId = null;

/* =========================
   INIT & AUTH
========================= */
window.addEventListener('auth-verified', async (e) => {
    init(e.detail.user); 
});

async function init(user) {
    if (!user) return;
    document.body.classList.add("loading-state");
    
    try {
        const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
        if (!activeTournament) return;
        activeTournamentId = activeTournament.id;

// FETCH ALL UPCOMING MATCHES WITH LOGOS
        const { data: matches } = await supabase.from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code, photo_name), team_b:real_teams!team_b_id(short_code, photo_name)")
            .eq("tournament_id", activeTournamentId)
            .eq("status", "upcoming") 
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true }); // Removed .limit(5)

        state.matches = matches || [];
        if (state.matches.length === 0) return;

        const currentMatchId = state.matches[0].id;
        state.currentMatchNumber = state.matches[0].match_number || 0;

        const [
            { data: players },
            { data: dashData },
            { data: boosterData },
            { data: lastLock },
            { data: currentTeam },
            { data: realTeamsData } // <--- ADDED THIS
        ] = await Promise.all([
            supabase.from("player_pool_view").select("*").eq("is_active", true).eq("tournament_id", activeTournamentId),
            supabase.from("home_dashboard_view").select("subs_remaining").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_tournament_points").select("used_boosters").eq("user_id", user.id).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.from("user_match_teams").select(`id, matches!inner(match_number), user_match_team_players(player_id)`).eq("user_id", user.id).eq("tournament_id", activeTournamentId).neq("match_id", currentMatchId).order("locked_at", { ascending: false }).limit(1).maybeSingle(),
            supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)").eq("user_id", user.id).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.from("real_teams").select("id, name, short_code, photo_name") // <--- ADDED THIS QUERY
        ]);

        // Save it to state so we can use it for the filter!
        state.realTeamsMap = Object.fromEntries((realTeamsData || []).map(t => [t.id, t]));

        state.allPlayers = players || [];
        state.baseSubsRemaining = dashData?.subs_remaining ?? 130;
        state.usedBoosters = boosterData?.used_boosters ?? []; 
        state.activeBooster = currentTeam?.active_booster ?? "NONE"; 
        state.lockedPlayerIds = lastLock?.user_match_team_players?.map(p => p.player_id) || [];

        if (currentTeam) {
            state.captainId = currentTeam.captain_id;
            state.viceCaptainId = currentTeam.vice_captain_id;
            const savedIds = currentTeam.user_fantasy_team_players.map(row => row.player_id);
            state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
        }
        let savedBooster = currentTeam?.active_booster ?? "NONE";

        // If the saved booster is already in the 'used' list, 
        // it means it was for a previous match. Reset it to NONE for the new draft.
        if (state.usedBoosters.includes(savedBooster)) {
        state.activeBooster = "NONE";
        } else {
        state.activeBooster = savedBooster;
        }

        updateHeaderMatch(state.matches[0]);
        initFilters();
        setupListeners();
        render();

    } catch (err) {
        console.error("Init failed:", err);
    } finally {
        document.body.classList.remove("loading-state");
    }
}
function render() {
    // 1. FIRST: Calculate the data
    const stats = {
        count: state.selectedPlayers.length,
        overseas: state.selectedPlayers.filter(p => p.category === "overseas").length,
        credits: state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0),
        roles: {
            WK: state.selectedPlayers.filter(p => p.role === "WK").length,
            BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
            AR: state.selectedPlayers.filter(p => p.role === "AR").length,
            BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
        }
    };

    // 2. SECOND: Update the Tab Numbers (The code you just shared)
    document.getElementById("count-WK").innerText = stats.roles.WK || 0;
    document.getElementById("count-BAT").innerText = stats.roles.BAT || 0;
    document.getElementById("count-AR").innerText = stats.roles.AR || 0;
    document.getElementById("count-BOWL").innerText = stats.roles.BOWL || 0;

    const roles = ['WK', 'BAT', 'AR', 'BOWL'];
    const minReqs = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };

    roles.forEach(role => {
        const el = document.getElementById(`count-${role}`);
        if (el) { // Senior Tip: Add this 'if' check to prevent errors if the element is missing
            el.style.color = (stats.roles[role] >= minReqs[role]) ? "#9AE000" : "";
        }
    });

    const isResetMatch = (state.currentMatchNumber === 1 || state.currentMatchNumber === PLAYOFF_START_MATCH);
    
    let subsUsedInDraft = 0;
    if (!isResetMatch && state.activeBooster !== 'FREE_11' && state.lockedPlayerIds.length > 0) {
        const newPlayers = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));
        const hasUncappedDiscount = newPlayers.some(p => p.category === "uncapped");
        subsUsedInDraft = (hasUncappedDiscount && newPlayers.length > 0) ? newPlayers.length - 1 : newPlayers.length;
    }

    const liveSubsRemaining = isResetMatch ? "FREE" : (state.baseSubsRemaining - subsUsedInDraft);
    const isOverLimit = !isResetMatch && (liveSubsRemaining < 0);

    // Update UI Labels
    document.getElementById("playerCountLabel").innerText = stats.count;
    document.getElementById("overseasCountLabel").innerText = `${stats.overseas}/4`;
    document.getElementById("creditCount").innerText = stats.credits.toFixed(1);
    const activePenalty = state.activeBooster !== 'NONE' ? 1 : 0;
    document.getElementById("boosterUsedLabel").innerText = `${7 - state.usedBoosters.length}/7`;
    document.getElementById("progressFill").style.width = `${(stats.count / 11) * 100}%`;
    
    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) {
        subsEl.innerText = liveSubsRemaining;
        subsEl.parentElement.className = isOverLimit ? "dashboard-item negative" : "dashboard-item";
    }

    renderBoosterUI();

    // Sorting My XI (WK > BAT > AR > BOWL)
    const sortedMyXI = [...state.selectedPlayers].sort((a, b) => {
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        return Number(b.credit) - Number(a.credit);
    });

    // Filtering Pool
    const nextMatch = state.matches[0];
    const filteredPool = state.allPlayers.filter(p => {
        const s = state.filters.search.toLowerCase();
        const pCategory = (p.category || "").toLowerCase();
        
        // 1. Upgraded Search
        const matchesSearch = p.name.toLowerCase().includes(s) || 
                              (p.team_short_code || "").toLowerCase().includes(s) ||
                              pCategory.includes(s);
                              
        const matchesRole = state.filters.role === "ALL" || p.role === state.filters.role;
        const matchesTeam = state.filters.teams.length === 0 || state.filters.teams.includes(p.real_team_id);
        const matchesCredit = state.filters.credits.length === 0 || state.filters.credits.includes(p.credit);
        const matchesType = state.filters.type.length === 0 || state.filters.type.includes(pCategory);

        // 2. MISSING MATCH FILTER LOGIC ADDED HERE:
        // A player passes if NO matches are selected, OR if their team is playing in a selected match.
        const matchesMatch = state.filters.matches.length === 0 || state.matches.some(m => 
            state.filters.matches.includes(m.id) && 
            (p.real_team_id === m.team_a_id || p.real_team_id === m.team_b_id)
        );

        // 3. Make sure to include `matchesMatch` at the end!
        return matchesSearch && matchesRole && matchesTeam && matchesCredit && matchesType && matchesMatch;
    }).sort((a, b) => {
        const aPri = a.real_team_id === nextMatch.team_a_id ? 1 : a.real_team_id === nextMatch.team_b_id ? 2 : 3;
        const bPri = b.real_team_id === nextMatch.team_a_id ? 1 : b.real_team_id === nextMatch.team_b_id ? 2 : 3;
        return aPri - bPri || ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit;
    });

 // At the bottom of render() ...
    
    renderList("myXIList", sortedMyXI, true, stats);
    renderList("playerPoolList", filteredPool, false, stats);
    updateSaveButton(stats, isOverLimit, liveSubsRemaining);
    
    // --- ADD THIS ONE LINE ---
    updateFilterButtonStates(); 
}

/* =========================
   LISTENERS (Search/Filters Fixed)
========================= */
function setupListeners() {
    // 1. Upgraded Search Logic with Debounce!
    const searchInput = document.getElementById("playerSearch");
    let searchTimeout;
    if(searchInput) {
        searchInput.oninput = (e) => { 
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                state.filters.search = e.target.value; 
                render(); 
            }, 300); // Waits 300ms before doing the heavy lifting
        };
    }

    // 2. Dropdown Toggle Logic
    const backdrop = document.getElementById("filterBackdrop");
    ['match', 'team', 'credit', 'type'].forEach(type => { // <-- Added 'type'
        const btn = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);
        if(btn && menu) {
            btn.onclick = (e) => { 
                e.stopPropagation(); 
                document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
                menu.classList.add('show');
                backdrop?.classList.remove('hidden');
                document.body.style.overflow = 'hidden'; 
            };
        }
    });

    backdrop.onclick = () => {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        backdrop.classList.add('hidden');
        document.body.style.overflow = ''; 
    };

    // 3. Existing View/Role Logic
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

    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true;
        render();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            // --- ADD THIS SAFETY CHECK ---
            if (authError || !user) {
                throw new Error("Session expired! Please refresh the page to save.");
            }
            // -----------------------------
            const { error } = await supabase.rpc('save_fantasy_team', {
                p_user_id: user.id,
                p_tournament_id: activeTournamentId,
                p_captain_id: state.captainId,
                p_vice_captain_id: state.viceCaptainId,
                p_total_credits: state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0),
                p_active_booster: state.activeBooster,
                p_player_ids: state.selectedPlayers.map(p => p.id)
            });
            if (error) throw error;
            window.triggerHaptic('success');
            showSuccessModal();
      } catch (err) { 
        window.triggerHaptic('error');
            // --- TRANSLATE NERDY ERRORS TO PLAIN ENGLISH ---
            let errorMsg = err.message;
            if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError")) {
                errorMsg = "Weak internet! Please tap save again.";
            }
            window.showToast(errorMsg, "error"); 
        }
        finally { state.saving = false; render(); }
    };
}

/* =========================
   UI HELPERS (Renderers)
========================= */
function renderList(containerId, list, isMyXi, stats) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    const currentRoles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };
    const neededSlots = Object.keys(minReq).reduce((acc, r) => acc + Math.max(0, minReq[r] - currentRoles[r]), 0);

    container.innerHTML = list.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const tooExpensive = p.credit > (100 - stats.credits);
        const overseasLimit = stats.overseas >= 4 && p.category === "overseas";
        const roleLocked = (11 - stats.count) <= neededSlots && (minReq[p.role] - currentRoles[p.role]) <= 0;
        const isDisabled = !isMyXi && !isSelected && (stats.count >= 11 || tooExpensive || overseasLimit || roleLocked);
        const photoUrl = p.photo_url ? supabase.storage.from('player-photos').getPublicUrl(p.photo_url).data.publicUrl : 'images/default-avatar.png';
const category = (p.category || "").toLowerCase(); // Safety check
        return `
            <div class="player-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'player-faded' : ''}">
<div class="avatar-container"><img src="${photoUrl}" class="player-avatar" loading="lazy"></div>                <div class="player-info">
<strong>
                ${p.name} 
                ${category === 'overseas' ? '<span class="category-emoji">✈️</span>' : ''}
                ${category === 'uncapped' ? '<span class="category-emoji">🧢</span>' : ''}
            </strong>

                    <span>${p.role} • ${p.team_short_code} • ${p.credit} Cr</span>
                </div>
                <div class="controls">
                    ${isMyXi ? `
                        <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                        <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                    ` : ''}
                    <button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" ${isDisabled ? 'disabled' : ''} onclick="togglePlayer('${p.id}')">${isSelected ? '−' : '+'}</button>
                </div>
            </div>`;
    }).join('');
}

function renderBoosterUI() {
    const boosterContainer = document.getElementById("boosterContainer");
    if (!boosterContainer) return;

    const isBoosterWindow = state.currentMatchNumber >= BOOSTER_WINDOW_START && state.currentMatchNumber <= BOOSTER_WINDOW_END;
    if (!isBoosterWindow) { 
        boosterContainer.classList.add("hidden"); 
        return; 
    }
    
    boosterContainer.classList.remove("hidden");

    const boosterConfigs = {
        TOTAL_2X: { name: "Total 2X", icon: "🚀" },
        INDIAN_2X: { name: "Indian 2X", icon: "🇮🇳" },
        OVERSEAS_2X: { name: "Overseas 2X", icon: "✈️" },
        UNCAPPED_2X: { name: "Uncapped 2X", icon: "🧢" },
        CAPTAIN_3X: { name: "Captain 3X",  icon: "👑" },
        MOM_2X: { name: "MOM 2X", icon: "🏆" },
        FREE_11: { name: "Free 11", icon: "🆓" }
    };

    const activePenalty = state.activeBooster !== 'NONE' ? 1 : 0;
    const boostersLeft = 7 - state.usedBoosters.length - activePenalty;

    let cardsHtml = Object.keys(boosterConfigs).map(key => {
        const config = boosterConfigs[key];
        const isUsed = state.usedBoosters.includes(key);
        const isActive = state.activeBooster === key;
        
        let statusClass = "";
        if (isActive) statusClass = "active";
        else if (isUsed) statusClass = "used";

        return `
            <div class="booster-card ${statusClass}" onclick="${isUsed ? '' : `handleBoosterChange('${isActive ? 'NONE' : key}')`}">
                <div class="booster-icon">${config.icon}</div>
                <div class="booster-info">
                    <div class="b-name">${config.name}</div>
                </div>
                ${isActive ? '<div class="active-badge">Applied!</div>' : ''}
                ${isUsed ? '<div class="used-overlay"><span>USED</span></div>' : ''}
            </div>
        `;
    }).join('');

    boosterContainer.innerHTML = `
        <div class="premium-booster-shelf">
            <div class="booster-header">
                <div class="b-title">MATCH BOOSTERS</div>
                <div class="b-count">${boostersLeft} LEFT</div>
            </div>
            <div class="booster-scroll-pane">
                ${cardsHtml}
            </div>
        </div>
    `;
}
/* =========================
   UTILITIES (Filters/Roles)
========================= */
window.togglePlayer = (id) => {
    window.triggerHaptic('light');
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

window.setRole = (id, type) => {
    window.triggerHaptic('light');
    if (type === 'C') { state.captainId = (state.captainId === id) ? null : id; if (state.captainId === state.viceCaptainId) state.viceCaptainId = null; }
    else { state.viceCaptainId = (state.viceCaptainId === id) ? null : id; if (state.viceCaptainId === state.captainId) state.captainId = null; }
    render();
};

// --- 1. BULLETPROOF TOAST ---
window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    // Guaranteed to remove after 3 seconds, no CSS keyframes required!
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => toast.remove(), 300); // Wait for the visual fade out
    }, 3000); 
};

// --- 2. CUSTOM CONFIRM MODAL ---
window.showConfirm = (title, message) => {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customConfirmOverlay');
        const titleEl = document.getElementById('confirmTitle');
        const textEl = document.getElementById('confirmText');
        const btnCancel = document.getElementById('confirmCancelBtn');
        const btnApply = document.getElementById('confirmApplyBtn');

        if (!overlay) return resolve(true); // Safety fallback

        titleEl.textContent = title;
        textEl.textContent = message;
        overlay.classList.remove('hidden');

        const cleanup = () => {
            overlay.classList.add('hidden');
            btnCancel.onclick = null;
            btnApply.onclick = null;
        };

        btnCancel.onclick = () => { cleanup(); resolve(false); }; // User clicked Cancel
        btnApply.onclick = () => { cleanup(); resolve(true); };   // User clicked Apply
    });
};

// --- 3. UPDATED BOOSTER LOGIC ---
// Notice the 'async' added here!
window.handleBoosterChange = async (val) => {
    if (val === "NONE") { 
        state.activeBooster = "NONE"; 
        render(); 
        return; 
    }

    // A map to get the pretty name for the UI
    const boosterNames = {
        TOTAL_2X: "Total 2X", INDIAN_2X: "Indian 2X", OVERSEAS_2X: "Overseas 2X",
        UNCAPPED_2X: "Uncapped 2X", CAPTAIN_3X: "Captain 3X", MOM_2X: "MOM 2X", FREE_11: "Free 11"
    };
    
    const prettyName = boosterNames[val] || val;

    // Trigger our custom popup and wait for their answer
    const isConfirmed = await window.showConfirm(
        `Apply ${prettyName} Booster?`, 
        "Note: You can only use this booster once and once the team locks you cannot undo!"
    );

    // If they clicked Apply, update state and show the toast!
    if (isConfirmed) {
        window.triggerHaptic('success');
        state.activeBooster = val;
        window.showToast(`${prettyName} Applied Successfully!`, "success");
        render();
    }
    // If they clicked Cancel, the state remains unchanged.
};

function initFilters() {
    renderTeamDropdown();
    const uniqueCredits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => a - b);
    renderCheckboxDropdown('creditMenu', uniqueCredits, 'credits', (c) => `${c} Cr`);
renderMatchDropdown();    const playerTypes = [
        { id: 'uncapped', label: 'Uncapped 🧢' },
        { id: 'overseas', label: 'Overseas ✈️' }
    ];
    renderCheckboxDropdown('typeMenu', playerTypes, 'type', (t) => t.label);
}

// Add this helper function anywhere in your UTILITIES section
window.closeFilters = () => {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    document.getElementById("filterBackdrop").classList.add('hidden');
    document.body.style.overflow = ''; 
};

// Replace your existing renderCheckboxDropdown with this updated one:
function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if(!container) return;
    
    const listHtml = items.map(item => {
        const val = item.id || item;
        return `<label class="filter-item"><span>${labelFn(item)}</span><input type="checkbox" value="${val}" ${state.filters[filterKey].includes(val) ? 'checked' : ''} onchange="toggleFilter('${filterKey}', '${val}', this)"></label>`;
    }).join('');
    
    // Now includes both Clear and Apply buttons!
    container.innerHTML = `
        <div class="dropdown-content">${listHtml}</div>
        <div class="dropdown-actions">
            <button onclick="clearFilters('${filterKey}')">Clear</button>
            <button onclick="closeFilters()">Apply</button>
        </div>
    `;
}

window.toggleFilter = (k, v, el) => { const val = (k === 'credits') ? parseFloat(v) : v; if (el.checked) state.filters[k].push(val); else state.filters[k] = state.filters[k].filter(i => i !== val); render(); };
window.clearFilters = (k) => { state.filters[k] = []; render(); initFilters(); };

function renderMatchDropdown() {
    const container = document.getElementById('matchMenu');
    if(!container) return;
    
    const bucket = supabase.storage.from("team-logos");

    const listHtml = state.matches.map(m => {
        const isSelected = state.filters.matches.includes(m.id);
        
        const logoA = m.team_a?.photo_name ? bucket.getPublicUrl(m.team_a.photo_name).data.publicUrl : 'images/default-team.png';
        const logoB = m.team_b?.photo_name ? bucket.getPublicUrl(m.team_b.photo_name).data.publicUrl : 'images/default-team.png';
        
        // Format the Date & Time
        const dateObj = new Date(m.actual_start_time);
        const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); // e.g., 22 Mar 2026
        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); // e.g., 07:30 PM

        return `
            <div class="match-filter-card ${isSelected ? 'selected' : ''}" onclick="toggleMatchFilterCard('${m.id}', this)">
                <div class="mfc-header">Match #${m.match_number}</div>
                <div class="mfc-teams">
                    <div class="mfc-logo" style="background-image: url('${logoA}')"></div>
                    <div class="mfc-team-name">${m.team_a?.short_code}</div>
                    <div class="mfc-vs">VS</div>
                    <div class="mfc-team-name">${m.team_b?.short_code}</div>
                    <div class="mfc-logo" style="background-image: url('${logoB}')"></div>
                </div>
                <div class="mfc-details">
                    <div>🏟️ ${m.venue || 'Venue TBA'}</div>
                    <div><i class="far fa-clock"></i> ${dateStr}, ${timeStr}</div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `
        <div class="dropdown-content match-filter-grid">${listHtml}</div>
        <div class="dropdown-actions">
            <button onclick="clearFilters('matches')">Clear</button>
            <button onclick="closeFilters()">Apply</button>
        </div>
    `;
}

window.toggleTeamFilterCard = (teamId, element) => {
    if (state.filters.teams.includes(teamId)) {
        state.filters.teams = state.filters.teams.filter(id => id !== teamId);
        element.classList.remove('selected');
    } else {
        state.filters.teams.push(teamId);
        element.classList.add('selected');
    }
    render(); // Updates the player list instantly
};

function renderTeamDropdown() {
    const container = document.getElementById('teamMenu');
    if(!container) return;
    
    const bucket = supabase.storage.from("team-logos");

    // Get the unique team IDs that actually have players in the pool
    const uniqueTeamIds = [...new Set(state.allPlayers.map(p => p.real_team_id))];

    const listHtml = uniqueTeamIds.map(teamId => {
        const isSelected = state.filters.teams.includes(teamId);
        const teamInfo = state.realTeamsMap[teamId] || { name: 'Unknown', short_code: 'UNK' };
        
        const logoUrl = teamInfo.photo_name ? bucket.getPublicUrl(teamInfo.photo_name).data.publicUrl : 'images/default-team.png';

        return `
            <div class="team-filter-card ${isSelected ? 'selected' : ''}" onclick="toggleTeamFilterCard('${teamId}', this)">
                <div class="tfc-logo" style="background-image: url('${logoUrl}')"></div>
                <div class="tfc-name">${teamInfo.name} (${teamInfo.short_code})</div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `
        <div class="dropdown-content team-filter-grid">${listHtml}</div>
        <div class="dropdown-actions">
            <button onclick="clearFilters('teams')">Clear</button>
            <button onclick="closeFilters()">Apply</button>
        </div>
    `;
}

function updateHeaderMatch() {
    // 1. Make sure we actually have an upcoming match
    if (state.matches.length === 0) {
        document.getElementById("headerCountdown").innerText = "NO MATCHES";
        document.getElementById("upcomingMatchName").innerText = "Tournament Ended";
        return;
    }

    const match = state.matches[0];
    const timerEl = document.getElementById("headerCountdown");
    const saveBtn = document.getElementById("saveTeamBtn");
    
    document.getElementById("upcomingMatchName").innerText = `${match.team_a?.short_code} vs ${match.team_b?.short_code}`;
    
    const target = new Date(match.actual_start_time).getTime();
    if (countdownInterval) clearInterval(countdownInterval);
    
    countdownInterval = setInterval(() => {
        const diff = target - Date.now();
        
        if (diff <= 0) { 
            // 2. Match hits zero! Stop the timer, lock the UI temporarily
            clearInterval(countdownInterval);
            timerEl.innerText = "LOCKED"; 
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerText = "MATCH LOCKED";
            }

            // 3. Wait 3 seconds so the user sees it locked, then shift to the next match
            setTimeout(() => {
                state.matches.shift(); // Remove Match 3 from the array
                
                if (state.matches.length > 0) {
                    // Update state to Match 4
                    state.currentMatchNumber = state.matches[0].match_number;
                    
                    // Restart the header UI for Match 4
                    updateHeaderMatch(); 
                    
                    // Re-render the whole page! (Crucial because subs/boosters depend on currentMatchNumber)
                    render(); 
                } else {
                    timerEl.innerText = "NO MATCHES";
                }
            }, 300000); // 5 minutes delay before moving to the next match, giving users a moment to see the "LOCKED" state
            
            return; 
        }
        
        // Normal countdown logic
        const h = Math.floor(diff/3600000); 
        const m = Math.floor((diff%3600000)/60000); 
        const s = Math.floor((diff%60000)/1000);
        timerEl.innerText = `${h}h ${m}m ${s}s`;
    }, 1000);
}

function updateSaveButton(stats, isOverLimit, liveSubs) {
    const btn = document.getElementById("saveTeamBtn");
    let btnText = "SAVE TEAM";
    let isValid = true;

    // 1. Check if we are currently in the middle of a save
    if (state.saving) {
        btnText = "SAVING...";
        isValid = false;
    } 
    // 2. Check total player count first (High priority)
    else if (stats.count < 11) {
        btnText = `ADD ${11 - stats.count} MORE PLAYERS`;
        isValid = false;
    } 
    // 3. Check for Captain and Vice-Captain
    else if (!state.captainId || !state.viceCaptainId) {
        btnText = "SELECT C & VC";
        isValid = false;
    } 
    // 4. Role Requirements (Middle priority)
    else if (stats.roles.WK < 1) {
        btnText = "NEED A WICKETKEEPER";
        isValid = false;
    } 
    else if (stats.roles.BAT < 3) {
        btnText = "NEED MIN 3 BATTERS";
        isValid = false;
    } 
    else if (stats.roles.AR < 1) {
        btnText = "NEED AN ALL-ROUNDER";
        isValid = false;
    } 
    else if (stats.roles.BOWL < 3) {
        btnText = "NEED MIN 3 BOWLERS";
        isValid = false;
    } 
    // 5. Constraints (Technical priority)
    else if (stats.overseas > 4) {
        btnText = "MAX 4 OVERSEAS ALLOWED";
        isValid = false;
    } 
    else if (stats.credits > 100.1) { // Added a tiny buffer to prevent floating point issues
        btnText = "CREDITS EXCEEDED";
        isValid = false;
    } 
    else if (isOverLimit) {
        btnText = "NOT ENOUGH SUBS";
        isValid = false;
    }

    // Apply the state to the button
    btn.disabled = !isValid;
    btn.innerText = btnText;
}

function showSuccessModal() {
    window.showToast("Team Saved Successfully!", "success");
    setTimeout(() => {
        window.location.href = "home.html";
    }, 1500); // Give them 1.5s to read the toast before leaving
}

window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000); 
};

window.toggleMatchFilterCard = (matchId, element) => {
    if (state.filters.matches.includes(matchId)) {
        // If already selected, remove it
        state.filters.matches = state.filters.matches.filter(id => id !== matchId);
        element.classList.remove('selected');
    } else {
        // If not selected, add it
        state.filters.matches.push(matchId);
        element.classList.add('selected');
    }
    render(); // Updates the background player list immediately!
};

// --- ADD THIS HELPER FUNCTION AT THE BOTTOM ---
function updateFilterButtonStates() {
    // Map the HTML button IDs to their respective arrays in our state
    const mappings = {
        'matchToggle': state.filters.matches,
        'teamToggle': state.filters.teams,
        'creditToggle': state.filters.credits,
        'typeToggle': state.filters.type
    };

    for (const [btnId, filterArray] of Object.entries(mappings)) {
        const btn = document.getElementById(btnId);
        if (btn) {
            // If there is anything inside the filter array, highlight the button!
            if (filterArray && filterArray.length > 0) {
                btn.classList.add('active-filter');
            } else {
                btn.classList.remove('active-filter');
            }
        }
    }
}

// =========================
//    HAPTIC ENGINE
// =========================
window.triggerHaptic = (style = 'light') => {
    // Safety check: If the device doesn't support it (like iPhones or Desktops), just ignore.
    if (!navigator.vibrate) return;

    switch (style) {
        case 'light':
            navigator.vibrate(15); // A tiny, crisp tap
            break;
        case 'medium':
            navigator.vibrate(30); // A slightly heavier thud
            break;
        case 'success':
            navigator.vibrate([30, 60, 30]); // A double-pulse "ba-dum"
            break;
        case 'error':
            navigator.vibrate([50, 50, 50, 50, 50]); // An angry stutter
            break;
    }
};