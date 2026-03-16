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
        matches: []  
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

        const { data: matches } = await supabase.from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("tournament_id", activeTournamentId)
            .eq("status", "upcoming") 
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true })
            .limit(5);

        state.matches = matches || [];
        if (state.matches.length === 0) return;

        const currentMatchId = state.matches[0].id;
        state.currentMatchNumber = state.matches[0].match_number || 0;

        const [
            { data: players },
            { data: dashData },
            { data: boosterData },
            { data: lastLock },
            { data: currentTeam }
        ] = await Promise.all([
            supabase.from("player_pool_view").select("*").eq("is_active", true).eq("tournament_id", activeTournamentId),
            supabase.from("home_dashboard_view").select("subs_remaining").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_tournament_points").select("used_boosters").eq("user_id", user.id).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.from("user_match_teams").select(`id, matches!inner(match_number), user_match_team_players(player_id)`).eq("user_id", user.id).eq("tournament_id", activeTournamentId).neq("match_id", currentMatchId).order("locked_at", { ascending: false }).limit(1).maybeSingle(),
            supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)").eq("user_id", user.id).eq("tournament_id", activeTournamentId).maybeSingle(),
        ]);

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
        const matchesSearch = p.name.toLowerCase().includes(s) || (p.team_short_code || "").toLowerCase().includes(s);
        const matchesRole = state.filters.role === "ALL" || p.role === state.filters.role;
        const matchesTeam = state.filters.teams.length === 0 || state.filters.teams.includes(p.real_team_id);
        const matchesCredit = state.filters.credits.length === 0 || state.filters.credits.includes(p.credit);
        return matchesSearch && matchesRole && matchesTeam && matchesCredit;
    }).sort((a, b) => {
        const aPri = a.real_team_id === nextMatch.team_a_id ? 1 : a.real_team_id === nextMatch.team_b_id ? 2 : 3;
        const bPri = b.real_team_id === nextMatch.team_a_id ? 1 : b.real_team_id === nextMatch.team_b_id ? 2 : 3;
        return aPri - bPri || ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit;
    });

    renderList("myXIList", sortedMyXI, true, stats);
    renderList("playerPoolList", filteredPool, false, stats);
    updateSaveButton(stats, isOverLimit, liveSubsRemaining);
}

/* =========================
   LISTENERS (Search/Filters Fixed)
========================= */
function setupListeners() {
    // 1. Search Logic
    const searchInput = document.getElementById("playerSearch");
    if(searchInput) {
        searchInput.oninput = (e) => { 
            state.filters.search = e.target.value; 
            render(); 
        };
    }

    // 2. Dropdown Toggle Logic
    const backdrop = document.getElementById("filterBackdrop");
    ['match', 'team', 'credit'].forEach(type => {
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
            showSuccessModal();
        } catch (err) { alert(err.message); }
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
                <div class="avatar-container"><img src="${photoUrl}" class="player-avatar"></div>
                <div class="player-info">
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

    // Check if we are inside the booster window (e.g., Match 2 to 70)
    const isBoosterWindow = state.currentMatchNumber >= BOOSTER_WINDOW_START && state.currentMatchNumber <= BOOSTER_WINDOW_END;
    if (!isBoosterWindow) { 
        boosterContainer.classList.add("hidden"); 
        return; 
    }
    
    boosterContainer.classList.remove("hidden");

    // UPGRADED BOOSTER DICTIONARY
    const boosterNames = { 
        TOTAL_2X: "TOTAL 2X (2X All Players)", 
        INDIAN_2X: "INDIAN 2X! 🇮🇳 (2x Indian Players)", 
        OVERSEAS_2X: "OVERSEAS 2X ✈️ (2x Overseas Players)",
        UNCAPPED_2X: "UNCAPPED 2X 🦈 (2x Uncapped Players)", 
        CAPTAIN_3X: "Captain 3x (3x Captain)",
        MOM_2X: "MOM 2x! 🏆 (2x Man of the Match)",
        FREE_11: "Free 11 🆓 (Zero Sub Cost)",
    };

    let optionsHtml = `<option value="NONE" ${state.activeBooster === 'NONE' ? 'selected' : ''}>-- 🎯 Tap to Select a Power-Up --</option>`;
    
    Object.keys(boosterNames).forEach(key => {
        const isUsed = state.usedBoosters.includes(key);
        const isSelected = state.activeBooster === key;
        
        // If used, disable it. If selected, mark it.
        optionsHtml += `<option value="${key}" 
            ${isUsed && !isSelected ? 'disabled' : ''} 
            ${isSelected ? 'selected' : ''}>
            ${isUsed && !isSelected ? '🚫 ' : ''}${boosterNames[key]}
        </option>`;
    });

    // NEW: Calculate simulated remaining boosters for instant UI feedback
    const activePenalty = state.activeBooster !== 'NONE' ? 1 : 0;
    const boostersLeft = 7 - state.usedBoosters.length - activePenalty;

    // We add a dynamic class if a booster is active to make the UI "glow"
    const isActiveClass = state.activeBooster !== 'NONE' ? 'booster-active-glow' : '';

    boosterContainer.innerHTML = `
        <div class="booster-header">
            <span>⚡ Available Boosters</span>
            <span class="booster-count">${boostersLeft}/7 Remaining</span>
        </div>
        <div class="select-wrapper">
            <select id="boosterSelect" class="booster-dropdown ${isActiveClass}" onchange="handleBoosterChange(this.value)">
                ${optionsHtml}
            </select>
        </div>
    `;
}
/* =========================
   UTILITIES (Filters/Roles)
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

window.setRole = (id, type) => {
    if (type === 'C') { state.captainId = (state.captainId === id) ? null : id; if (state.captainId === state.viceCaptainId) state.viceCaptainId = null; }
    else { state.viceCaptainId = (state.viceCaptainId === id) ? null : id; if (state.viceCaptainId === state.captainId) state.captainId = null; }
    render();
};

window.handleBoosterChange = (val) => {
    if (val === "NONE") { state.activeBooster = "NONE"; render(); return; }
    if (confirm(`Apply booster?`)) state.activeBooster = val;
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
        const val = item.id || item;
        return `<label class="filter-item"><span>${labelFn(item)}</span><input type="checkbox" value="${val}" ${state.filters[filterKey].includes(val) ? 'checked' : ''} onchange="toggleFilter('${filterKey}', '${val}', this)"></label>`;
    }).join('');
    container.innerHTML = `<div class="dropdown-content">${listHtml}</div><div class="dropdown-actions"><button onclick="clearFilters('${filterKey}')">Clear</button></div>`;
}

window.toggleFilter = (k, v, el) => { const val = (k === 'credits') ? parseFloat(v) : v; if (el.checked) state.filters[k].push(val); else state.filters[k] = state.filters[k].filter(i => i !== val); render(); };
window.clearFilters = (k) => { state.filters[k] = []; render(); initFilters(); };

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
    else if (stats.credits > 100) {
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
    alert("Team Saved Successfully!");
    window.location.href = "home.html";
}
