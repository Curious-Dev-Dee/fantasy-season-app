import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

// IPL 2026 CONFIG
const LEAGUE_STAGE_END = 70;
const PLAYOFF_START_MATCH = 71;

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],    
    baseSubsRemaining: 150, 
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
        // 1. Fetch upcoming matches
        const { data: matches } = await supabase.from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("tournament_id", TOURNAMENT_ID)
            .eq("status", "upcoming") 
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true })
            .limit(5);

        state.matches = matches || [];
        if (state.matches.length === 0) return;

        const currentMatchId = state.matches[0].id;
        state.currentMatchNumber = state.matches[0].match_number || 0;

        // 2. Parallel Data Fetching
        const [
            { data: players },
            { data: dashData },
            { data: boosterData },
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

/* =========================
   CORE LOGIC (Optimized)
========================= */
function render() {
    // 1. Calculate Constraints ONCE (Senior approach: Don't calculate inside loops)
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

    const isResetMatch = (state.currentMatchNumber === 1 || state.currentMatchNumber === PLAYOFF_START_MATCH);
    
    // Subs Calculation
    let subsUsedInDraft = 0;
    if (!isResetMatch && state.activeBooster !== 'FREE_11' && state.lockedPlayerIds.length > 0) {
        const newPlayers = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));
        const hasUncappedDiscount = newPlayers.some(p => p.category === "uncapped");
        subsUsedInDraft = (hasUncappedDiscount && newPlayers.length > 0) ? newPlayers.length - 1 : newPlayers.length;
    }

    const liveSubsRemaining = isResetMatch ? "FREE" : (state.baseSubsRemaining - subsUsedInDraft);
    const isOverLimit = !isResetMatch && (liveSubsRemaining < 0);

    // 2. Update Global UI Labels
    document.getElementById("playerCountLabel").innerText = stats.count;
    document.getElementById("overseasCountLabel").innerText = `${stats.overseas}/4`;
    document.getElementById("creditCount").innerText = stats.credits.toFixed(1);
    document.getElementById("boosterUsedLabel").innerText = `${6 - state.usedBoosters.length}/6`;
    document.getElementById("progressFill").style.width = `${(stats.count / 11) * 100}%`;
    
    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) {
        subsEl.innerText = liveSubsRemaining;
        subsEl.parentElement.className = isOverLimit ? "dashboard-item negative" : "dashboard-item";
    }

    // 3. Render Booster Dropdown
    renderBoosterUI();

    // 4. Role Validation Dot Logic
    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    ["WK", "BAT", "AR", "BOWL"].forEach(r => {
        const el = document.getElementById(`count-${r}`);
        const tab = document.querySelector(`.role-tab[data-role="${r}"]`);
        if (el) el.innerText = stats.roles[r] || "";
        if (tab) {
            tab.classList.toggle("requirement-met", stats.roles[r] >= minReq[r]);
            tab.classList.toggle("requirement-missing", stats.roles[r] < minReq[r]);
        }
    });

    // 5. Filter & Sort Player Pool
    const nextMatch = state.matches[0];
    const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };
    
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

    // 6. Draw Lists
    renderList("myXIList", state.selectedPlayers, true, stats);
    renderList("playerPoolList", filteredPool, false, stats);

    // 7. Save Button State
    updateSaveButton(stats, isOverLimit, liveSubsRemaining);
}

/* =========================
   UI HELPERS
========================= */
function renderList(containerId, list, isMyXi, stats) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    const neededSlots = Object.keys(minReq).reduce((acc, r) => acc + Math.max(0, minReq[r] - stats.roles[r]), 0);

    container.innerHTML = list.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const isLocked = state.lockedPlayerIds.includes(p.id);
        const tooExpensive = p.credit > (100 - stats.credits);
        const overseasLimit = stats.overseas >= 4 && p.category === "overseas";
        const roleLocked = (11 - stats.count) <= neededSlots && (minReq[p.role] - stats.roles[p.role]) <= 0;

        const isDisabled = !isMyXi && !isSelected && (stats.count >= 11 || tooExpensive || overseasLimit || roleLocked);

        const photoUrl = p.photo_url 
            ? supabase.storage.from('player-photos').getPublicUrl(p.photo_url).data.publicUrl 
            : 'images/default-avatar.png';

        const categoryIcon = p.category === "overseas" ? "✈️" : p.category === "uncapped" ? "💎" : "";
        const lockIcon = isLocked ? '📌' : '';

        return `
            <div class="player-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'player-faded' : ''}">
                <div class="avatar-container">
                    <img src="${photoUrl}" class="player-avatar" loading="lazy">
                </div>
                <div class="player-info">
                    <strong>${p.name} <span class="player-category-icon">${categoryIcon} ${lockIcon}</span></strong>
                    <span>${p.role} • ${p.team_short_code} • ${p.credit} Cr</span>
                </div>
                <div class="controls">
                    ${isMyXi ? `
                        <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                        <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                    ` : ''}
                    <button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" 
                        ${isDisabled ? 'disabled' : ''} 
                        onclick="togglePlayer('${p.id}')">
                        ${isSelected ? '−' : '+'}
                    </button>
                </div>
            </div>`;
    }).join('');
}

function updateSaveButton(stats, isOverLimit, liveSubs) {
    const btn = document.getElementById("saveTeamBtn");
    const hasRoles = stats.roles.WK >= 1 && stats.roles.BAT >= 3 && stats.roles.AR >= 1 && stats.roles.BOWL >= 3;
    const isValid = stats.count === 11 && state.captainId && state.viceCaptainId && stats.credits <= 100 && !isOverLimit && hasRoles;

    btn.disabled = !isValid || state.saving;
    
    if (state.saving) btn.innerText = "SAVING...";
    else if (isOverLimit) btn.innerText = "OUT OF SUBS!";
    else if (stats.count < 11) btn.innerText = `ADD ${11 - stats.count} MORE`;
    else if (!hasRoles) btn.innerText = "CHECK ROLE LIMITS";
    else if (stats.credits > 100) btn.innerText = "OVER BUDGET";
    else if (!state.captainId || !state.viceCaptainId) btn.innerText = "SELECT C/VC";
    else btn.innerText = "SAVE TEAM";
}

/* =========================
   INTERACTIONS
========================= */
window.togglePlayer = (id) => {
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
        state.selectedPlayers.splice(idx, 1);
        if (state.captainId === id) state.captainId = null;
        if (state.viceCaptainId === id) state.viceCaptainId = null;
    } else if (state.selectedPlayers.length < 11) {
        const player = state.allPlayers.find(p => p.id === id);
        if (player) state.selectedPlayers.push(player);
    }
    render();
};

window.setRole = (id, type) => {
    if (type === 'C') {
        state.captainId = (state.captainId === id) ? null : id;
        if (state.captainId === state.viceCaptainId) state.viceCaptainId = null;
    } else {
        state.viceCaptainId = (state.viceCaptainId === id) ? null : id;
        if (state.viceCaptainId === state.captainId) state.captainId = null;
    }
    render();
};

window.handleBoosterChange = (val) => {
    if (val === "NONE") { state.activeBooster = "NONE"; render(); return; }
    if (confirm(`Apply this booster? Each can be used once per season.`)) {
        state.activeBooster = val;
    }
    render();
};

function updateHeaderMatch(match) {
    const timerEl = document.getElementById("headerCountdown");
    const nameEl = document.getElementById("upcomingMatchName");
    if (!timerEl || !nameEl) return;

    nameEl.innerText = `${match.team_a?.short_code} vs ${match.team_b?.short_code}`;
    
    if (countdownInterval) clearInterval(countdownInterval);
    const target = new Date(match.actual_start_time).getTime();
    
    const update = () => {
        const diff = target - Date.now();
        if (diff <= 0) {
            timerEl.innerText = "LIVE";
            return clearInterval(countdownInterval);
        }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        timerEl.innerText = `${h}h ${m}m ${s}s`;
    };
    update();
    countdownInterval = setInterval(update, 1000);
}

function setupListeners() {
    // View Toggles
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn, .view-mode").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
            document.querySelector(".search-filter-wrapper").style.display = btn.dataset.mode === 'myxi' ? 'none' : 'flex';
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

    // Save Logic
    document.getElementById("saveTeamBtn").onclick = async () => {
        state.saving = true;
        render();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase.rpc('save_fantasy_team', {
                p_user_id: user.id,
                p_tournament_id: TOURNAMENT_ID,
                p_captain_id: state.captainId,
                p_vice_captain_id: state.viceCaptainId,
                p_total_credits: state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0),
                p_active_booster: state.activeBooster,
                p_player_ids: state.selectedPlayers.map(p => p.id)
            });
            if (error) throw error;
            showSuccessModal();
        } catch (err) {
            alert("Error saving team: " + err.message);
        } finally {
            state.saving = false;
            render();
        }
    };
}

// Keep your existing initFilters, renderCheckboxDropdown, and showSuccessModal as they are mostly UI-binding.

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