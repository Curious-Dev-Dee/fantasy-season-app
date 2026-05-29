import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

// No WK priority needed
const ROLE_PRIORITY = { BAT: 1, AR: 2, BOWL: 3 };
const MIN_REQ = { BAT: 3, AR: 1, BOWL: 2 }; 

let state = {
    userId: null,
    openPhases: [],
    activePhaseIndex: 0,
    masterPlayers: [], // Stores everyone
    allPlayers: [],    // Stores only players for the active phase
    realTeamsMap: {},
    phaseStates: {},
    filters: { search: "", role: "BAT", teams: [], credits: [] },
    saving: false,
};

let countdownInterval = null;

async function boot() {
    try {
        const user = await authReady;
        state.userId = user.id;
        init();
    } catch (err) {
        window.location.href = "index.html";
    }
}
boot();

async function init() {
    try {
        // 1. Fetch Open Phases
        const { data: phases } = await supabase.from("ppl_fantasy_days").select("*").eq("is_locked", false).order("created_at");
        if (!phases || phases.length === 0) {
            showEmptyState("Fantasy is currently locked for all phases.");
            return;
        }
        state.openPhases = phases;

        // 2. Fetch Teams & Active Players
        const [{ data: teams }, { data: players }] = await Promise.all([
            supabase.from("ppl_teams").select("*"),
            supabase.from("ppl_players").select("*, ppl_teams(short_name, group_name)").eq("is_active", true)
        ]);

        state.realTeamsMap = Object.fromEntries((teams || []).map(t => [t.id, t]));
        state.masterPlayers = players || [];

        // 3. Fetch User's Existing Teams for Open Phases
        const phaseIds = state.openPhases.map(p => p.id);
        const { data: existingTeams } = await supabase.from("ppl_user_teams")
            .select("*, ppl_user_team_players(player_id)")
            .eq("user_id", state.userId)
            .in("phase_id", phaseIds);

        // Initialize Phase Memory States
        state.openPhases.forEach(p => {
            const t = (existingTeams || []).find(x => x.phase_id === p.id);
            state.phaseStates[p.id] = {
                teamId: t ? t.id : null,
                captainId: t ? t.captain_player_id : null,
                viceCaptainId: t ? t.vice_captain_player_id : null,
                selectedPlayers: t ? state.masterPlayers.filter(pl => t.ppl_user_team_players.some(x => x.player_id === pl.id)) : []
            };
        });

        renderPhaseTabs();
        initStaticFilters();
        setupListeners();
        
        // This handles isolating players & teams based on the group
        window.switchPhase(0); 

    } catch (err) {
        console.error(err);
        showEmptyState("Failed to load data.");
    } finally {
        document.body.classList.remove("loading-state");
        document.getElementById("loadingOverlay").style.display = "none";
    }
}

function showEmptyState(msg) {
    document.body.classList.remove("loading-state");
    const main = document.querySelector(".content-area");
    if (main) main.innerHTML = `<p class="empty-pool-msg" style="text-align:center;padding:40px 20px">${msg}</p>`;
    document.getElementById("loadingOverlay").style.display = "none";
}

// ─── PHASE SWITCHING & GROUP ISOLATION ────────────────────────────────────────
function renderPhaseTabs() {
    const row = document.getElementById("phaseToggleRow");
    if (!row) return;

    row.innerHTML = state.openPhases.map((p, idx) => {
        const name = p.phase === 'group_a' ? 'Group A' : p.phase === 'group_b' ? 'Group B' : 'Knockout';
        return `<button class="phase-tab ${idx === state.activePhaseIndex ? 'active' : ''}" onclick="window.switchPhase(${idx})">${name}</button>`;
    }).join('');
}

window.switchPhase = (index) => {
    state.activePhaseIndex = index;
    const phase = state.openPhases[index];

    // Update UI Toggles
    document.querySelectorAll(".phase-tab").forEach((btn, idx) => btn.classList.toggle("active", idx === index));
    
    // Set Header Info
    const pName = phase.phase === 'group_a' ? 'Group A' : phase.phase === 'group_b' ? 'Group B' : 'Knockout';
    document.getElementById("phaseTitle").textContent = `${pName} Phase`;
    document.getElementById("upcomingMatchName").textContent = `Deadline: ${new Date(phase.lock_deadline).toLocaleDateString('en-GB')}`;
    startCountdown(phase.lock_deadline);

    // Filter Players strictly by the active phase group
    if (phase.phase === "group_a") {
        state.allPlayers = state.masterPlayers.filter(p => p.fantasy_group === 'A' || p.ppl_teams?.group_name === 'A');
    } else if (phase.phase === "group_b") {
        state.allPlayers = state.masterPlayers.filter(p => p.fantasy_group === 'B' || p.ppl_teams?.group_name === 'B');
    } else {
        state.allPlayers = [...state.masterPlayers]; // Knockout has all active teams
    }

    // Reset UI & Filters for the new tab
    state.filters.search = "";
    state.filters.teams = [];
    state.filters.role = "BAT";
    document.getElementById("playerSearch").value = "";
    
    document.querySelectorAll(".role-tab").forEach(t => t.classList.toggle("active", t.dataset.role === "BAT"));
    
    // Rebuild the team dropdown so it only shows teams in THIS group
    updateTeamFilterDropdown();
    
    render();
};

function getActivePhaseState() {
    const phase = state.openPhases[state.activePhaseIndex];
    return state.phaseStates[phase.id];
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
function render() {
    const stats = calcStats();
    updateDashboard(stats);
    renderMyXI(stats);
    renderPlayerPool(stats);
    updateSaveButton(stats);
    updateFilterButtonStates();
}

function calcStats() {
    const pState = getActivePhaseState();
    const selected = pState.selectedPlayers;
    const roles = { BAT: 0, AR: 0, BOWL: 0 };
    let stars = 0, credits = 0;

    for (const p of selected) {
        // Fallback: Treat any WK in DB as a BAT
        const r = p.role === 'WK' ? 'BAT' : p.role;
        roles[r] = (roles[r] || 0) + 1;
        if (p.is_star) stars++;
        credits += Number(p.fantasy_price || 0);
    }
    return { count: selected.length, stars, credits, roles };
}

function updateDashboard(stats) {
    const pState = getActivePhaseState();
    const container = document.getElementById("teamDotsRow");
    if (container) {
        const frag = document.createDocumentFragment();
        const bucket = supabase.storage.from("player-photos"); 
        for (let i = 0; i < 11; i++) {
            const player = pState.selectedPlayers[i];
            const dot = document.createElement("div");
            dot.className = "team-dot";
            if (player) {
                if (player.photo_url) {
                    dot.style.backgroundImage = `url('${bucket.getPublicUrl(player.photo_url).data.publicUrl}')`;
                    dot.classList.add("filled");
                } else {
                    dot.classList.add("filled", "no-logo");
                    dot.textContent = player.name[0];
                }
            } else if (i === 10) {
                dot.classList.add("no-logo", "dot-eleven");
                dot.textContent = "11";
            }
            frag.appendChild(dot);
        }
        container.replaceChildren(frag);
    }

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt("playerCountLabel", stats.count);
    setTxt("creditCount", (100 - stats.credits).toFixed(1));

    const creditEl = document.getElementById("creditCount");
    if (creditEl) creditEl.closest(".dashboard-item")?.classList.toggle("negative", (100 - stats.credits) < 0);

    document.querySelectorAll(".role-tab[data-role]").forEach(tab => {
        const role = tab.dataset.role;
        const count = stats.roles[role] || 0;
        const badge = tab.querySelector("span");
        if (badge) badge.textContent = count;
        tab.classList.remove("req-met", "req-unmet");
        tab.classList.add(count >= MIN_REQ[role] ? "req-met" : "req-unmet");
    });
}

function renderMyXI(stats) {
    const pState = getActivePhaseState();
    const sorted = [...pState.selectedPlayers].sort((a, b) => {
        const rA = a.role === 'WK' ? 'BAT' : a.role;
        const rB = b.role === 'WK' ? 'BAT' : b.role;
        if (ROLE_PRIORITY[rA] !== ROLE_PRIORITY[rB]) return ROLE_PRIORITY[rA] - ROLE_PRIORITY[rB];
        return Number(b.fantasy_price) - Number(a.fantasy_price);
    });
    renderList("myXIList", sorted, true, stats);
}

function renderPlayerPool(stats) {
    const s = state.filters.search.toLowerCase();

    const filtered = state.allPlayers.filter(p => {
        const r = p.role === 'WK' ? 'BAT' : p.role;
        if (s && !p.name.toLowerCase().includes(s) && !(p.ppl_teams?.short_name || "").toLowerCase().includes(s)) return false;
        if (!state.filters.search && r !== state.filters.role) return false;
        if (state.filters.teams.length && !state.filters.teams.includes(p.team_id)) return false;
        if (state.filters.credits.length && !state.filters.credits.includes(p.fantasy_price)) return false;
        return true;
    }).sort((a, b) => {
        const rA = a.role === 'WK' ? 'BAT' : a.role;
        const rB = b.role === 'WK' ? 'BAT' : b.role;
        return ROLE_PRIORITY[rA] - ROLE_PRIORITY[rB] || b.fantasy_price - a.fantasy_price;
    });

    renderList("playerPoolList", filtered, false, stats);
}

function renderList(containerId, list, isMyXi, stats) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const pState = getActivePhaseState();
    const neededSlots = Object.keys(MIN_REQ).reduce((acc, r) => acc + Math.max(0, MIN_REQ[r] - stats.roles[r]), 0);
    const bucket = supabase.storage.from("player-photos");
    const frag = document.createDocumentFragment();

    if (list.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-pool-msg";
        empty.textContent = isMyXi ? "Select players from the Edit Squad tab." : "No players match your filters.";
        frag.appendChild(empty);
        container.replaceChildren(frag);
        return;
    }

    for (const p of list) {
        const r = p.role === 'WK' ? 'BAT' : p.role;
        const isSelected = pState.selectedPlayers.some(sp => sp.id === p.id);
        const tooExpensive = p.fantasy_price > (100 - stats.credits + (isSelected ? p.fantasy_price : 0));
        const roleLocked = !isSelected && (11 - stats.count) <= neededSlots && (MIN_REQ[r] - stats.roles[r]) <= 0;
        const isDisabled = !isMyXi && !isSelected && (stats.count >= 11 || tooExpensive || roleLocked);

        const photoUrl = p.photo_url ? bucket.getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";

        const card = document.createElement("div");
        card.className = `player-card ${isSelected ? "selected" : ""} ${isDisabled ? "player-faded" : ""}`;
        
        const isC = pState.captainId === p.id;
        const isVC = pState.viceCaptainId === p.id;
        const checkTxt = isC ? "C" : isVC ? "VC" : isSelected ? "✓" : "+";

        const cvBtns = (isSelected || isC || isVC) ? `
            <div class="cv-btns" onclick="event.stopPropagation()">
                <button class="cv-btn ${isC ? "active-gold" : ""}" data-action="C" data-id="${p.id}">C</button>
                <button class="cv-btn ${isVC ? "active-silver" : ""}" data-action="VC" data-id="${p.id}">VC</button>
            </div>` : "";

        card.innerHTML = `
        <div class="avatar-col">
            <div class="avatar-wrap">
                <img src="${photoUrl}" class="player-avatar" loading="lazy">
            </div>
            <span class="p-team-badge">${p.ppl_teams?.short_name || 'TBA'}</span>
        </div>
        <div class="player-info">
            <strong class="p-name">${p.name} ${starBadge}</strong>
            <span class="p-meta">${p.fantasy_price} Cr · ${r}</span>
        </div>
        <div class="controls">
            ${isMyXi ? `
                <button class="role-btn ${isC ? "active-c" : ""}" data-action="C" data-id="${p.id}">C</button>
                <button class="role-btn ${isVC ? "active-vc" : ""}" data-action="VC" data-id="${p.id}">VC</button>
            ` : ""}
            <button class="action-btn ${isSelected ? "remove" : "add"}" data-action="toggle" data-id="${p.id}" ${isDisabled ? "disabled" : ""}>
                ${isSelected ? "−" : "+"}
            </button>
        </div>`;
        frag.appendChild(card);
    }
    container.replaceChildren(frag);
}

// ─── PLAYER INTERACTIONS ──────────────────────────────────────────────────────
function setupListeners() {
    document.getElementById("playerPoolList")?.addEventListener("click", e => {
        const btn = e.target.closest("button[data-action]");
        if (btn && !btn.disabled && btn.dataset.action === "toggle") togglePlayer(btn.dataset.id);
    });

    document.getElementById("myXIList")?.addEventListener("click", e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.action === "toggle") togglePlayer(id);
        else if (btn.dataset.action === "C") setRole(id, "C");
        else if (btn.dataset.action === "VC") setRole(id, "VC");
    });

    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".view-mode").forEach(v => v.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.mode}-view`)?.classList.add("active");
            const fw = document.querySelector(".search-filter-wrapper");
            if (fw) fw.style.display = btn.dataset.mode === "myxi" ? "none" : "flex";
        };
    });

    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            renderPlayerPool(calcStats());
        };
    });

    document.getElementById("saveTeamBtn")?.addEventListener("click", savePhaseTeam);
    document.getElementById("previewTeamBtn")?.addEventListener("click", openPreviewPopup);
    document.getElementById("previewCloseBtn")?.addEventListener("click", () => document.getElementById("previewOverlay").classList.add("hidden"));

    const backdrop = document.getElementById("filterBackdrop");
    for (const type of ["team", "credit"]) {
        const btn = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);
        if (btn && menu) {
            btn.onclick = e => {
                e.stopPropagation();
                document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show"));
                menu.classList.add("show");
                backdrop?.classList.remove("hidden");
            };
        }
    }
    if (backdrop) backdrop.onclick = window.closeFilters;
}

function togglePlayer(id) {
    if (navigator.vibrate) navigator.vibrate(40);
    const pState = getActivePhaseState();
    const idx = pState.selectedPlayers.findIndex(p => p.id === id);
    
    if (idx > -1) {
        pState.selectedPlayers.splice(idx, 1);
        if (pState.captainId === id) pState.captainId = null;
        if (pState.viceCaptainId === id) pState.viceCaptainId = null;
    } else if (pState.selectedPlayers.length < 11) {
        const p = state.allPlayers.find(p => p.id === id);
        if (p) pState.selectedPlayers.push(p);
    }
    render();

    const stats = calcStats();
const allRolesMet = stats.roles.BAT >= 3 && stats.roles.AR >= 1 && stats.roles.BOWL >= 2;
    if (stats.count === 11 && allRolesMet && (!pState.captainId || !pState.viceCaptainId)) {
        document.querySelector(".toggle-btn[data-mode='myxi']")?.click();
        showToast("11 players added! Now set your C & VC 👑", "success");
    }
}

function setRole(id, type) {
    if (navigator.vibrate) navigator.vibrate(40);
    const pState = getActivePhaseState();
    if (type === "C") {
        pState.captainId = pState.captainId === id ? null : id;
        if (pState.captainId === pState.viceCaptainId) pState.viceCaptainId = null;
    } else {
        pState.viceCaptainId = pState.viceCaptainId === id ? null : id;
        if (pState.viceCaptainId === pState.captainId) pState.captainId = null;
    }
    render();
}

function updateSaveButton(stats) {
    const pState = getActivePhaseState();
    const btn = document.getElementById("saveTeamBtn");
    const hint = document.getElementById("saveHint");
    if (!btn) return;

    const checks = [
        [state.saving, "SAVING...", ""],
        [stats.count < 11, "SAVE TEAM", `Add ${11 - stats.count} more player${11 - stats.count > 1 ? "s" : ""}`],
        [!pState.captainId || !pState.viceCaptainId, "SAVE TEAM", "Select your Captain & Vice-Captain"],
        [stats.roles.BAT < 3, "SAVE TEAM", "Need at least 3 Batters"],
        [stats.roles.AR < 1, "SAVE TEAM", "Need at least 1 All-Rounder"],
        [stats.roles.BOWL < 2, "SAVE TEAM", "Need at least 2 Bowlers"],
        [stats.stars > 4, "SAVE TEAM", "Max 4 Star Players allowed"],
        [stats.credits > 100.05, "SAVE TEAM", "Credits exceeded — remove a player"],
    ];

    for (const [condition, label, hintText] of checks) {
        if (condition) {
            btn.disabled = true;
            btn.textContent = label;
            if (hint) hint.textContent = hintText;
            return;
        }
    }
    btn.disabled = false;
    btn.textContent = "SAVE TEAM";
    if (hint) hint.textContent = "Ready to save";
}

// ─── SAVE PHASE TEAM ──────────────────────────────────────────────────────────
async function savePhaseTeam() {
    const phase = state.openPhases[state.activePhaseIndex];
    const pState = getActivePhaseState();
    state.saving = true;
    render();

    try {
        const payload = {
            user_id: state.userId,
            phase_id: phase.id,
            phase: phase.phase,
            captain_player_id: pState.captainId,
            vice_captain_player_id: pState.viceCaptainId,
            total_credits_used: calcStats().credits,
        };

        let teamId = pState.teamId;

        if (teamId) {
            await supabase.from("ppl_user_teams").update(payload).eq("id", teamId);
            await supabase.from("ppl_user_team_players").delete().eq("user_team_id", teamId);
        } else {
            const { data: p } = await supabase.from("user_profiles").select("team_name, full_name").eq("user_id", state.userId).single();
            payload.user_name = p.team_name || p.full_name;
            const { data: newTeam, error } = await supabase.from("ppl_user_teams").insert(payload).select("id").single();
            if (error) throw error;
            teamId = newTeam.id;
            pState.teamId = teamId; // Cache it
        }

        const playersData = pState.selectedPlayers.map(p => ({
            user_team_id: teamId,
            user_id: state.userId,
            player_id: p.id,
            is_captain: p.id === pState.captainId,
            is_vice_captain: p.id === pState.viceCaptainId
        }));

        const { error: pErr } = await supabase.from("ppl_user_team_players").insert(playersData);
        if (pErr) throw pErr;

        if (navigator.vibrate) navigator.vibrate([50, 80, 50]);
        showToast("Team Saved!", "success");

    } catch (err) {
        showToast(err.message, "error");
    } finally {
        state.saving = false;
        render();
    }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function startCountdown(deadlineStr) {
    const el = document.getElementById("headerCountdown");
    if (!el || !deadlineStr) return;
    if (countdownInterval) clearInterval(countdownInterval);
    const target = new Date(deadlineStr).getTime();

    countdownInterval = setInterval(() => {
        const diff = target - Date.now();
        if (diff <= 0) {
            el.textContent = "LOCKED";
            clearInterval(countdownInterval);
            return;
        }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        el.textContent = d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`;
    }, 1000);
}

function showToast(msg, type = "success") {
    const c = document.getElementById("toastContainer");
    if (!c) return;
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 400); }, 3000);
}

function openPreviewPopup() {
    const overlay = document.getElementById("previewOverlay");
    const field = document.getElementById("previewField");
    const pState = getActivePhaseState();
    
    const roles = ["BAT", "AR", "BOWL"];
    let html = "";
    
    roles.forEach(r => {
        const players = pState.selectedPlayers.filter(p => {
            const pr = p.role === 'WK' ? 'BAT' : p.role;
            return pr === r;
        });
        if (!players.length) return;
        
        const tiles = players.map(p => {
            const isC = p.id === pState.captainId;
            const isVC = p.id === pState.viceCaptainId;
            const badge = isC ? '<span class="preview-cvc-badge c">C</span>' : isVC ? '<span class="preview-cvc-badge vc">VC</span>' : '';
            const ring = isC ? 'captain-ring' : isVC ? 'vc-ring' : '';
            const url = p.photo_url ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";
            return `
            <div class="preview-player-tile">
                <div class="preview-avatar-wrap">
                    <img src="${url}" class="preview-avatar ${ring}">
                    ${badge}
                </div>
                <span class="preview-player-name">${p.name.split(" ").pop()}</span>
            </div>`;
        }).join("");
        
        html += `<div class="preview-role-row"><div class="preview-role-label">${r}</div><div class="preview-players-row">${tiles}</div></div>`;
    });
    
    field.innerHTML = html || '<p class="preview-empty">No players selected.</p>';
    overlay.classList.remove("hidden");
}

function closePreviewPopup() {
    document.getElementById("previewOverlay")?.classList.add("hidden");
}

function initStaticFilters() {
    // Unique credits across masterPlayers
    const uniqueCredits = [...new Set(state.masterPlayers.map(p => p.fantasy_price))].sort((a,b)=>a-b);
    renderCheckboxDropdown("creditMenu", uniqueCredits, "credits", c => `${c} Cr`);
}

function updateTeamFilterDropdown() {
    // Determine the unique teams present in state.allPlayers
    const teamIdsInPhase = [...new Set(state.allPlayers.map(p => p.team_id))];
    const teams = teamIdsInPhase.map(id => state.realTeamsMap[id]).filter(Boolean);
    
    renderCheckboxDropdown("teamMenu", teams, "teams", t => t.short_name);
}

function renderCheckboxDropdown(id, items, key, lblFn) {
    const c = document.getElementById(id);
    if (!c) return;
    const html = items.map(i => {
        const v = i.id ?? i;
        return `<label class="filter-item"><span>${lblFn(i)}</span><input type="checkbox" value="${v}" onchange="toggleFilter('${key}', '${v}', this)"></label>`;
    }).join("");
    c.innerHTML = `<div class="dropdown-content">${html}</div><div class="dropdown-actions"><button onclick="clearFilters('${key}')">Clear</button><button onclick="closeFilters()">Apply</button></div>`;
}

window.toggleFilter = (k, v, el) => {
    const val = k === "credits" ? parseFloat(v) : v;
    if (el.checked) state.filters[k].push(val); else state.filters[k] = state.filters[k].filter(i => i !== val);
    renderPlayerPool(calcStats()); updateFilterButtonStates();
};
window.clearFilters = k => { state.filters[k] = []; renderPlayerPool(calcStats()); updateFilterButtonStates(); };
window.closeFilters = () => { document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show")); document.getElementById("filterBackdrop")?.classList.add("hidden"); };
function updateFilterButtonStates() {
    document.getElementById("teamToggle")?.classList.toggle("active-filter", state.filters.teams.length > 0);
    document.getElementById("creditToggle")?.classList.toggle("active-filter", state.filters.credits.length > 0);
}