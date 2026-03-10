import { supabase } from "./supabase.js";

/* =========================
   IPL 2026 CONFIG & STATE
========================= */
const TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";
const LEAGUE_SUB_LIMIT = 150;
const PLAYOFF_START_MATCH = 71;
const KNOCKOUT_PHASE_MATCH = 72;

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [],
    baseSubsRemaining: 150, 
    matches: [],
    captainId: null, 
    viceCaptainId: null, 
    s8BoosterUsed: false, 
    boosterActiveInDraft: false,
    currentMatchNumber: 0, 
    lastLockedMatchNumber: 0,
    filters: { search: "", role: "ALL", teams: [], credits: [], matches: [] },
    saving: false 
};

let countdownInterval;

/* =========================
   PAGE LOAD TRANSITION
========================= */
function revealApp() {
    if (document.body.classList.contains('loaded')) return;
    document.body.classList.remove('loading-state');
    document.body.classList.add('loaded');
    
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }, 600);
}

// Safety timeout: reveal even if internet/Supabase is lagging
setTimeout(() => {
    if (document.body.classList.contains('loading-state')) {
        console.warn("Safety trigger: Revealing team builder...");
        revealApp();
    }
}, 7000);

/* =========================
   INIT & AUTH
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    if (user) init(user);
});

async function init(user) {
    try {
        // 1. Fetch Context
        const { data: activeT } = await supabase.from('active_tournament').select('*').maybeSingle();
        const tId = activeT?.id || TOURNAMENT_ID;

        // 2. Load match info for the header
        const { data: matches } = await supabase.from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("tournament_id", tId).eq("status", "upcoming") 
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true }).limit(1);

        state.matches = matches || [];
        if (state.matches.length > 0) {
            state.currentMatchNumber = state.matches[0].match_number || 0;
            updateHeaderMatch(state.matches[0]);
        }

        // 3. PARALLEL DATA FETCH
        const [players, dash, lastLock, currentTeam] = await Promise.all([
            supabase.from("player_pool_view").select("*").eq("is_active", true),
            supabase.from("home_dashboard_view").select("subs_remaining, s8_booster_used").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_match_teams").select(`id, matches!inner(match_number), user_match_team_players(player_id)`).eq("user_id", user.id).order("locked_at", { ascending: false }).limit(1).maybeSingle(),
            supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)").eq("user_id", user.id).eq("tournament_id", tId).maybeSingle()
        ]);

        state.allPlayers = players.data || [];
        state.baseSubsRemaining = dash.data?.subs_remaining ?? 150;
        state.s8BoosterUsed = dash.data?.s8_booster_used ?? false;

        if (lastLock.data?.user_match_team_players) {
            state.lockedPlayerIds = lastLock.data.user_match_team_players.map(p => p.player_id);
        }

        if (currentTeam.data) {
            state.captainId = currentTeam.data.captain_id;
            state.viceCaptainId = currentTeam.data.vice_captain_id;
            state.boosterActiveInDraft = currentTeam.data.use_booster;
            const savedIds = currentTeam.data.user_fantasy_team_players.map(row => row.player_id);
            state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
        }

        // 4. Initial Setup
        initFilters();
        render();
        setupListeners();

    } catch (err) {
        console.error("Init Error:", err);
    } finally {
        revealApp();
    }
}

/* =========================
   CORE RENDER LOGIC
========================= */
const getTeamCode = (p) => p.team_short_code || "UNK";

function updateHeaderMatch(match) {
    const nameEl = document.getElementById("upcomingMatchName");
    const timerEl = document.getElementById("headerCountdown");
    if (!nameEl || !timerEl) return;
    
    nameEl.innerText = `${match.team_a?.short_code || "TBA"} vs ${match.team_b?.short_code || "TBA"}`;
    if (countdownInterval) clearInterval(countdownInterval);
    
    const target = new Date(match.actual_start_time).getTime();
    const update = () => {
        const diff = target - Date.now();
        if (diff <= 0) { timerEl.innerText = "MATCH LIVE"; clearInterval(countdownInterval); return; }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        timerDisplay(h, m, s);
    };
    
    function timerDisplay(h, m, s) {
        timerEl.innerText = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    
    update();
    countdownInterval = setInterval(update, 1000);
}

function render() {
    const filtered = state.allPlayers.filter(p => {
        const mSearch = p.name.toLowerCase().includes(state.filters.search.toLowerCase());
        const mRole = state.filters.role === "ALL" || p.role === state.filters.role;
        const mTeam = state.filters.teams.length === 0 || state.filters.teams.includes(p.real_team_id);
        const mCredit = state.filters.credits.length === 0 || state.filters.credits.includes(p.credit);
        return mSearch && mRole && mTeam && mCredit;
    });

    const isResetMatch = (state.currentMatchNumber === 1 || state.currentMatchNumber === PLAYOFF_START_MATCH);
    const count = state.selectedPlayers.length;
    const subsUsed = isResetMatch ? 0 : state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
    const liveSubsRemaining = isResetMatch ? "FREE" : (state.baseSubsRemaining - subsUsed);
    const isOverLimit = !isResetMatch && (liveSubsRemaining < 0);

    // Update Progress Labels
    document.getElementById("playerCountLabel").innerText = count;
    document.getElementById("creditCount").innerText = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0).toFixed(1);
    document.getElementById("progressFill").style.width = `${(count / 11) * 100}%`;
    document.getElementById("subsRemainingLabel").innerText = liveSubsRemaining;

    // List Renders
    renderList("myXIList", state.selectedPlayers, true);
    renderList("playerPoolList", filtered, false);

    // Role Counts logic
    const roles = { 
        WK: state.selectedPlayers.filter(p => p.role === "WK").length, 
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length, 
        AR: state.selectedPlayers.filter(p => p.role === "AR").length, 
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length 
    };
    ["WK", "BAT", "AR", "BOWL"].forEach(r => {
        const countEl = document.getElementById(`count-${r}`);
        if(countEl) countEl.innerText = roles[r] || "";
    });
    
    // Save Button Validation
    const hasRequiredRoles = roles.WK >= 1 && roles.BAT >= 3 && roles.AR >= 1 && roles.BOWL >= 3;
    const currentCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
    const isValid = count === 11 && state.captainId && state.viceCaptainId && !isOverLimit && hasRequiredRoles && currentCredits <= 100;
    
    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.disabled = !isValid;
    
    if (state.saving) saveBtn.innerText = "SAVING...";
    else if (isOverLimit) saveBtn.innerText = "OUT OF SUBS";
    else if (count < 11) saveBtn.innerText = `ADD ${11 - count} MORE`;
    else if (!hasRequiredRoles) saveBtn.innerText = "REQ: 1WK, 3BAT, 1AR, 3BOWL";
    else if (currentCredits > 100) saveBtn.innerText = "OVER BUDGET";
    else if (!state.captainId || !state.viceCaptainId) saveBtn.innerText = "PICK C & VC";
    else saveBtn.innerText = "SAVE TEAM";
}

function renderList(containerId, list, isMyXi) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = list.map(p => {
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const photoUrl = p.photo_url ? supabase.storage.from('player-photos').getPublicUrl(p.photo_url).data.publicUrl : 'images/default-avatar.png';
        
        let actions = isMyXi ? `
            <div class="controls">
                <button class="cv-btn ${state.captainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'C')">C</button>
                <button class="cv-btn ${state.viceCaptainId === p.id ? 'active' : ''}" onclick="setRole('${p.id}', 'VC')">VC</button>
                <button class="action-btn-circle remove" onclick="togglePlayer('${p.id}')"><i class="fas fa-minus"></i></button>
            </div>` : 
            `<button class="action-btn-circle ${isSelected ? 'remove' : 'add'}" onclick="togglePlayer('${p.id}')">
                <i class="fas ${isSelected ? 'fa-minus' : 'fa-plus'}"></i>
            </button>`;

        return `
        <div class="player-card ${isSelected ? 'selected' : ''}">
            <div class="avatar-container"><img src="${photoUrl}" class="player-avatar"></div>
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} • ${getTeamCode(p)} • ${p.credit} Cr</span>
            </div>
            ${actions}
        </div>`;
    }).join('');
}

/* =========================
   INTERACTIONS & FILTERS
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
        state.captainId = state.captainId === id ? null : id;
        if (state.captainId === state.viceCaptainId) state.viceCaptainId = null;
    } else {
        state.viceCaptainId = state.viceCaptainId === id ? null : id;
        if (state.viceCaptainId === state.captainId) state.captainId = null;
    }
    render();
};

function initFilters() {
    // 1. Teams Menu
    const teams = [];
    const seenTeams = new Set();
    state.allPlayers.forEach(p => {
        if(!seenTeams.has(p.real_team_id)) {
            seenTeams.add(p.real_team_id);
            teams.push({ id: p.real_team_id, code: p.team_short_code });
        }
    });
    
    document.getElementById("teamMenu").innerHTML = `
        <div class="dropdown-content">
            ${teams.map(t => `
                <label class="filter-item">
                    <span>${t.code}</span>
                    <input type="checkbox" value="${t.id}" onchange="toggleFilter('teams', '${t.id}', this)">
                </label>
            `).join('')}
        </div>
    `;

    // 2. Credits Menu
    const credits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a,b) => b-a);
    document.getElementById("creditMenu").innerHTML = `
        <div class="dropdown-content">
            ${credits.map(c => `
                <label class="filter-item">
                    <span>${c} Cr</span>
                    <input type="checkbox" value="${c}" onchange="toggleFilter('credits', ${c}, this)">
                </label>
            `).join('')}
        </div>
    `;
}

window.toggleFilter = (key, val, el) => {
    if (el.checked) state.filters[key].push(val);
    else state.filters[key] = state.filters[key].filter(v => v !== val);
    render();
};

/* =========================
   EVENT LISTENERS
========================= */
function setupListeners() {
    // 1. Tab Switcher (FIXED: Hides Filter bar in MY XI)
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".view-mode").forEach(v => v.classList.remove("active"));
            
            btn.classList.add("active");
            const mode = btn.dataset.mode;
            document.getElementById(`${mode}-view`).classList.add("active");

            const filterBar = document.querySelector(".search-filter-wrapper");
            if (filterBar) filterBar.style.display = (mode === 'myxi') ? 'none' : 'flex';
        };
    });

    // 2. Filter Button Dropdowns (FIXED: Working Toggle)
    ['match', 'team', 'credit'].forEach(type => {
        const btn = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);
        const backdrop = document.getElementById("filterBackdrop");

        if (btn && menu) {
            btn.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
                menu.classList.add('show');
                backdrop.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            };
        }
    });

    document.getElementById("filterBackdrop").onclick = () => {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        document.getElementById("filterBackdrop").classList.add('hidden');
        document.body.style.overflow = '';
    };

    // 3. Role switcher
    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    // 4. Search logic
    document.getElementById("playerSearch").oninput = (e) => {
        state.filters.search = e.target.value;
        render();
    };

    // 5. Save Action
    document.getElementById("saveTeamBtn").onclick = async () => {
        if (state.saving) return;
        state.saving = true; render();
        
        const { data: { user } } = await supabase.auth.getUser();
        const totalCredits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
        
        const { data: team, error } = await supabase.from("user_fantasy_teams").upsert({
            user_id: user.id, tournament_id: TOURNAMENT_ID,
            captain_id: state.captainId, vice_captain_id: state.viceCaptainId,
            total_credits: totalCredits,
            use_booster: state.boosterActiveInDraft
        }).select().single();

        if (team) {
            await supabase.from("user_fantasy_team_players").delete().eq("user_fantasy_team_id", team.id);
            await supabase.from("user_fantasy_team_players").insert(
                state.selectedPlayers.map(p => ({ user_fantasy_team_id: team.id, player_id: p.id }))
            );
            alert("XI Saved Successfully!");
            window.location.href = "home.html";
        }
        state.saving = false; render();
    };
}