import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

// ─── CONSTANTS & CONFIG ──────────────────────────────────────────────────────
const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };

// ─── STATE ───────────────────────────────────────────────────────────────────
let state = {
    userId: null,
    activePhase: null, // Full object from ppl_fantasy_days
    allPlayers: [],
    selectedPlayers: [],
    captainId: null,
    viceCaptainId: null,
    existingTeamId: null,
    realTeamsMap: {},
    filters: {
        search: "",
        role: "WK",
        teams: [],
        credits: [],
        type: [],
    },
    saving: false,
};

let countdownInterval = null;
let audioCtx = null;

// ─── INIT ────────────────────────────────────────────────────────────────────
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
    document.body.classList.add("loading-state");

    try {
        // 1. Fetch Active Phase
        const { data: phases } = await supabase.from("ppl_fantasy_days")
            .select("*").order("created_at");
            
        state.activePhase = phases.find(p => !p.is_locked);
        if (!state.activePhase) {
            showEmptyState("Phase locked. You cannot edit your team right now.");
            return;
        }

        // Setup Header Data
        const pName = state.activePhase.phase === 'group_a' ? 'Group A' : 
                      state.activePhase.phase === 'group_b' ? 'Group B' : 'Knockout';
        document.getElementById("phaseTitle").textContent = `${pName} Phase`;
        document.getElementById("upcomingMatchName").textContent = `Deadline: ${new Date(state.activePhase.lock_deadline).toLocaleDateString('en-GB')}`;
        startCountdown(state.activePhase.lock_deadline);

        // 2. Fetch Teams & Players
        const [{ data: teams }, { data: players }, { data: userTeam }] = await Promise.all([
            supabase.from("ppl_teams").select("*"),
            supabase.from("ppl_players").select("*, ppl_teams(short_name, group_name)").eq("is_active", true),
            supabase.from("ppl_user_teams")
                .select("*, ppl_user_team_players(player_id)")
                .eq("user_id", state.userId)
                .eq("phase_id", state.activePhase.id)
                .maybeSingle()
        ]);

        state.realTeamsMap = Object.fromEntries((teams || []).map(t => [t.id, t]));

        // Filter players strictly by the active phase group (unless knockout, then all)
        if (state.activePhase.phase === "group_a") {
            state.allPlayers = players.filter(p => p.fantasy_group === 'A' || p.ppl_teams?.group_name === 'A');
        } else if (state.activePhase.phase === "group_b") {
            state.allPlayers = players.filter(p => p.fantasy_group === 'B' || p.ppl_teams?.group_name === 'B');
        } else {
            state.allPlayers = players || [];
        }

        if (state.allPlayers.length === 0) {
            showEmptyState("No players assigned to this phase yet.");
            return;
        }

        // 3. Load Existing Team State
        if (userTeam) {
            state.existingTeamId = userTeam.id;
            state.captainId = userTeam.captain_player_id;
            state.viceCaptainId = userTeam.vice_captain_player_id;
            const savedIds = userTeam.ppl_user_team_players.map(r => r.player_id);
            state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
        }

        initFilters();
        setupListeners();
        render();

    } catch (err) {
        console.error("Init failed:", err);
        showEmptyState("Failed to load. Please try again.");
    } finally {
        document.body.classList.remove("loading-state");
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = "none";
    }
}

function showEmptyState(msg) {
    document.body.classList.remove("loading-state");
    const main = document.querySelector(".content-area");
    if (main) main.innerHTML = `<p class="empty-pool-msg" style="text-align:center;padding:40px 20px">${msg}</p>`;
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.style.display = "none";
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
    const selected = state.selectedPlayers;
    const roles = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
    let overseas = 0, credits = 0;

    for (const p of selected) {
        roles[p.role] = (roles[p.role] || 0) + 1;
        if (p.category === "overseas") overseas++;
        credits += Number(p.fantasy_price || 0);
    }
    return { count: selected.length, overseas, credits, roles };
}

function updateDashboard(stats) {
    // Render Dots
    const container = document.getElementById("teamDotsRow");
    if (container) {
        const frag = document.createDocumentFragment();
        const bucket = supabase.storage.from("player-photos"); // Or team-logos depending on PPL
        for (let i = 0; i < 11; i++) {
            const player = state.selectedPlayers[i];
            const dot = document.createElement("div");
            dot.className = "team-dot";
            if (player) {
                // If you use player faces for dots
                if (player.photo_url) {
                    const url = bucket.getPublicUrl(player.photo_url).data.publicUrl;
                    dot.style.backgroundImage = `url('${url}')`;
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
    setTxt("overseasCountLabel", `${stats.overseas}/4`);
    setTxt("creditCount", (100 - stats.credits).toFixed(1));

    const creditEl = document.getElementById("creditCount");
    if (creditEl) creditEl.closest(".dashboard-item")?.classList.toggle("negative", (100 - stats.credits) < 0);

    // Role Requirements Badges
    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    document.querySelectorAll(".role-tab[data-role]").forEach(tab => {
        const role = tab.dataset.role;
        const count = stats.roles[role] || 0;
        const badge = tab.querySelector("span");
        if (badge) badge.textContent = count;
        tab.classList.remove("req-met", "req-unmet");
        tab.classList.add(count >= minReq[role] ? "req-met" : "req-unmet");
    });
}

function renderMyXI(stats) {
    const sorted = [...state.selectedPlayers].sort((a, b) => {
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        return Number(b.fantasy_price) - Number(a.fantasy_price);
    });
    renderList("myXIList", sorted, true, stats);
}

function renderPlayerPool(stats) {
    const s = state.filters.search.toLowerCase();
    const filtered = state.allPlayers.filter(p => {
        const cat = (p.category || "").toLowerCase();
        if (s && !p.name.toLowerCase().includes(s) && !(p.ppl_teams?.short_name || "").toLowerCase().includes(s)) return false;
        if (!state.filters.search && p.role !== state.filters.role) return false;
        if (state.filters.teams.length && !state.filters.teams.includes(p.team_id)) return false;
        if (state.filters.credits.length && !state.filters.credits.includes(p.fantasy_price)) return false;
        if (state.filters.type.length && !state.filters.type.includes(cat)) return false;
        return true;
    }).sort((a, b) => {
        return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.fantasy_price - a.fantasy_price;
    });

    renderList("playerPoolList", filtered, false, stats);
}

function renderList(containerId, list, isMyXi, stats) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    const neededSlots = Object.keys(minReq).reduce((acc, r) => acc + Math.max(0, minReq[r] - stats.roles[r]), 0);
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
        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const tooExpensive = p.fantasy_price > (100 - stats.credits + (isSelected ? p.fantasy_price : 0));
        const overseasLimit = stats.overseas >= 4 && p.category === "overseas" && !isSelected;
        const roleLocked = !isSelected && (11 - stats.count) <= neededSlots && (minReq[p.role] - stats.roles[p.role]) <= 0;
        const isDisabled = !isMyXi && !isSelected && (stats.count >= 11 || tooExpensive || overseasLimit || roleLocked);

        const photoUrl = p.photo_url ? bucket.getPublicUrl(p.photo_url).data.publicUrl : "images/default-avatar.png";
        const cat = (p.category || "").toLowerCase();
        const catBadge = cat === "overseas" ? '<span class="cat-badge overseas">✈</span>' : cat === "uncapped" ? '<span class="cat-badge uncapped">U</span>' : "";

        const card = document.createElement("div");
        card.className = `player-card ${isSelected ? "selected" : ""} ${isDisabled ? "player-faded" : ""}`;
        
        const checkTxt = state.captainId === p.id ? "C" : state.viceCaptainId === p.id ? "VC" : isSelected ? "✓" : "+";
        const isC = state.captainId === p.id;
        const isVC = state.viceCaptainId === p.id;

        const cvBtns = (isSelected || isC || isVC) ? `
            <div class="cv-btns" onclick="event.stopPropagation()">
                <button class="cv-btn ${isC ? "active-gold" : ""}" data-action="C" data-id="${p.id}">C</button>
                <button class="cv-btn ${isVC ? "active-silver" : ""}" data-action="VC" data-id="${p.id}">VC</button>
            </div>` : "";

        card.innerHTML = `
        <div class="avatar-col" onclick="openPlayerProfile('${p.id}')">
            <div class="avatar-wrap">
                <img src="${photoUrl}" class="player-avatar" loading="lazy">
                ${catBadge}
            </div>
            <span class="p-team-badge">${p.ppl_teams?.short_name || 'TBA'}</span>
        </div>
        <div class="player-info">
            <strong class="p-name">${p.name} ${p.is_star ? '<span style="color:#fbbf24;font-size:10px">⭐</span>' : ''}</strong>
            <span class="p-meta">${p.fantasy_price} Cr · ${p.role}</span>
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

// ─── ACTIONS & LISTENERS ──────────────────────────────────────────────────────
function setupListeners() {
    // Delegated clicks for XI and Pool
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

    // View Tabs
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

    // Role Tabs
    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.filters.role = tab.dataset.role;
            renderPlayerPool(calcStats());
        };
    });

    // Save Button
    document.getElementById("saveTeamBtn")?.addEventListener("click", showTransferSheet);
    
    // Preview
    document.getElementById("previewTeamBtn")?.addEventListener("click", openPreviewPopup);
    document.getElementById("previewCloseBtn")?.addEventListener("click", closePreviewPopup);

    // Filters
    const backdrop = document.getElementById("filterBackdrop");
    for (const type of ["team", "credit", "type"]) {
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
    document.getElementById("transferBackdrop")?.addEventListener("click", window.closeTransferSheet);
}

function togglePlayer(id) {
    triggerHaptic();
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

    // Auto-switch to My XI when full
    const stats = calcStats();
    const allRolesMet = stats.roles.WK >= 1 && stats.roles.BAT >= 3 && stats.roles.AR >= 1 && stats.roles.BOWL >= 3;
    if (stats.count === 11 && allRolesMet && (!state.captainId || !state.viceCaptainId)) {
        document.querySelector(".toggle-btn[data-mode='myxi']")?.click();
        showToast("11 players added! Now set your C & VC 👑", "success");
    }
}

function setRole(id, type) {
    triggerHaptic();
    if (type === "C") {
        state.captainId = state.captainId === id ? null : id;
        if (state.captainId === state.viceCaptainId) state.viceCaptainId = null;
    } else {
        state.viceCaptainId = state.viceCaptainId === id ? null : id;
        if (state.viceCaptainId === state.captainId) state.captainId = null;
    }
    render();
}

function updateSaveButton(stats) {
    const btn = document.getElementById("saveTeamBtn");
    const hint = document.getElementById("saveHint");
    if (!btn) return;

    const checks = [
        [state.saving, "SAVING...", ""],
        [stats.count < 11, "NEXT →", `Add ${11 - stats.count} more player${11 - stats.count > 1 ? "s" : ""}`],
        [!state.captainId || !state.viceCaptainId, "NEXT →", "Select your Captain & Vice-Captain"],
        [stats.roles.WK < 1, "NEXT →", "Need at least 1 Wicket-Keeper"],
        [stats.roles.BAT < 3, "NEXT →", "Need at least 3 Batters"],
        [stats.roles.AR < 1, "NEXT →", "Need at least 1 All-Rounder"],
        [stats.roles.BOWL < 3, "NEXT →", "Need at least 3 Bowlers"],
        [stats.overseas > 4, "NEXT →", "Max 4 overseas players allowed"],
        [stats.credits > 100.05, "NEXT →", "Credits exceeded — remove a player"],
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
    btn.textContent = "NEXT →";
    if (hint) hint.textContent = "Tap to review your changes";
}

// ─── SAVING (TRANSFER SHEET) ──────────────────────────────────────────────────
function showTransferSheet() {
    const sheet = document.getElementById("transferSheet");
    const body = document.getElementById("transferSheetBody");
    const backdrop = document.getElementById("transferBackdrop");
    
    const captain = state.allPlayers.find(p => p.id === state.captainId);
    const vc = state.allPlayers.find(p => p.id === state.viceCaptainId);

    body.innerHTML = `
        <div class="ts-inner">
            <div class="ts-header">
                <span class="ts-title">Confirm Phase XI</span>
                <button class="ts-close" onclick="closeTransferSheet()">✕</button>
            </div>
            <div class="ts-cvc-grid" style="margin-top:10px">
                <div class="ts-cvc-block">
                    <span class="ts-cvc-block-label">👑 Captain</span>
                    <span class="ts-cvc-name captain">${captain?.name || "—"}</span>
                </div>
                <div class="ts-cvc-block">
                    <span class="ts-cvc-block-label">VC Vice-Captain</span>
                    <span class="ts-cvc-name vc">${vc?.name || "—"}</span>
                </div>
            </div>
            <p class="ts-note">Your team will lock at the phase deadline.</p>
            <button class="ts-confirm-btn" onclick="confirmAndSave()">Confirm & Save</button>
        </div>`;

    backdrop?.classList.remove("hidden");
    sheet.classList.remove("hidden");
    setTimeout(() => sheet.classList.add("show"), 10);
}

window.closeTransferSheet = () => {
    const sheet = document.getElementById("transferSheet");
    const backdrop = document.getElementById("transferBackdrop");
    sheet?.classList.remove("show");
    backdrop?.classList.add("hidden");
    setTimeout(() => sheet?.classList.add("hidden"), 400);
};

window.confirmAndSave = async () => {
    window.closeTransferSheet();
    state.saving = true;
    render();

    try {
        const payload = {
            user_id: state.userId,
            phase_id: state.activePhase.id,
            phase: state.activePhase.phase,
            captain_player_id: state.captainId,
            vice_captain_player_id: state.viceCaptainId,
            total_credits_used: calcStats().credits,
        };

        let teamId = state.existingTeamId;

        // Upsert Team
        if (teamId) {
            await supabase.from("ppl_user_teams").update(payload).eq("id", teamId);
            await supabase.from("ppl_user_team_players").delete().eq("user_team_id", teamId);
        } else {
            // Need user profile name for insert
            const { data: p } = await supabase.from("user_profiles").select("team_name, full_name").eq("user_id", state.userId).single();
            payload.user_name = p.team_name || p.full_name;
            const { data: newTeam, error } = await supabase.from("ppl_user_teams").insert(payload).select("id").single();
            if (error) throw error;
            teamId = newTeam.id;
        }

        // Insert Players
        const playersData = state.selectedPlayers.map(p => ({
            user_team_id: teamId,
            user_id: state.userId,
            player_id: p.id,
            is_captain: p.id === state.captainId,
            is_vice_captain: p.id === state.viceCaptainId
        }));

        const { error: pErr } = await supabase.from("ppl_user_team_players").insert(playersData);
        if (pErr) throw pErr;

        triggerHaptic("success");
        showToast("Phase XI Saved!", "success");
        setTimeout(() => window.location.href = "ppl-home.html", 1500);

    } catch (err) {
        showToast(err.message, "error");
        state.saving = false;
        render();
    }
};

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

function triggerHaptic(style = "light") {
    if (navigator.vibrate) navigator.vibrate(style === "success" ? [50, 80, 50] : [40]);
}

// Preview Popup Logic
function openPreviewPopup() {
    const overlay = document.getElementById("previewOverlay");
    const field = document.getElementById("previewField");
    
    const roles = ["WK", "BAT", "AR", "BOWL"];
    let html = "";
    
    roles.forEach(r => {
        const players = state.selectedPlayers.filter(p => p.role === r);
        if (!players.length) return;
        
        const tiles = players.map(p => {
            const isC = p.id === state.captainId;
            const isVC = p.id === state.viceCaptainId;
            const badge = isC ? '<span class="preview-cvc-badge c">C</span>' : isVC ? '<span class="preview-cvc-badge vc">VC</span>' : '';
            const ring = isC ? 'captain-ring' : isVC ? 'vc-ring' : '';
            return `
            <div class="preview-player-tile">
                <div class="preview-avatar-wrap">
                    <img src="${getPhotoUrl(p.photo_url)}" class="preview-avatar ${ring}">
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

function getPhotoUrl(path) {
    return path ? supabase.storage.from("player-photos").getPublicUrl(path).data.publicUrl : "images/default-avatar.png";
}

// Filters logic
function initFilters() {
    renderCheckboxDropdown("teamMenu", Object.values(state.realTeamsMap), "teams", t => t.short_name);
    renderCheckboxDropdown("creditMenu", [...new Set(state.allPlayers.map(p => p.fantasy_price))].sort((a,b)=>a-b), "credits", c => `${c} Cr`);
    renderCheckboxDropdown("typeMenu", [{id:"uncapped", label:"Uncapped 🧢"}, {id:"overseas", label:"Overseas ✈️"}], "type", t => t.label);
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
window.clearFilters = k => { state.filters[k] = []; renderPlayerPool(calcStats()); updateFilterButtonStates(); initFilters(); };
window.closeFilters = () => { document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show")); document.getElementById("filterBackdrop")?.classList.add("hidden"); };
function updateFilterButtonStates() {
    const map = { teamToggle: state.filters.teams, creditToggle: state.filters.credits, typeToggle: state.filters.type };
    for (const [id, arr] of Object.entries(map)) document.getElementById(id)?.classList.toggle("active-filter", arr.length > 0);
}