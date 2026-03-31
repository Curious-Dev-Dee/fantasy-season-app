import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const LEAGUE_STAGE_END       = 70;
const PLAYOFF_START_MATCH    = 71;
const BOOSTER_WINDOW_START   = 2;
const BOOSTER_WINDOW_END     = 70;
const ROLE_PRIORITY          = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };
const MATCH_SHIFT_DELAY_MS   = 30000; // 30s after lock before moving to next match

// ─── STATE ───────────────────────────────────────────────────────────────────
let state = {
    allPlayers:        [],
    selectedPlayers:   [],
    lockedPlayerIds:   [],
    baseSubsRemaining: 130,
    captainId:         null,
    viceCaptainId:     null,
    activeBooster:     "NONE",
    usedBoosters:      [],
    currentMatchNumber: 0,
    matches:           [],
    realTeamsMap:      {},
    filters: {
        search:  "",
        role:    "WK",
        teams:   [],
        credits: [],
        matches: [],
        type:    [],
    },
    saving: false,
};

let isTransitioning  = false;
let countdownInterval = null;
let activeTournamentId = null;
// BUG FIX #5: AudioContext module-level, cleaned up on page hide
let audioCtx = null;

// ─── INIT ────────────────────────────────────────────────────────────────────
// BUG FIX #1 & #7: Migrated from CustomEvent race condition to shared Promise
async function boot() {
    try {
        const user = await authReady;
        init(user);
    } catch (err) {
        console.warn("Auth failed on edit-team:", err.message);
    }
}

boot();

async function init(user) {
    if (!user) return;
    document.body.classList.add("loading-state");

    try {
        const { data: activeTournament } = await supabase
            .from("active_tournament")
            .select("*")
            .maybeSingle();

        if (!activeTournament) return;
        activeTournamentId = activeTournament.id;

        const { data: matches } = await supabase
            .from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code, photo_name), team_b:real_teams!team_b_id(short_code, photo_name)")
            .eq("tournament_id", activeTournamentId)
            .eq("status", "upcoming")
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true });

        state.matches = matches || [];
        if (state.matches.length === 0) {
            showEmptyState();
            return;
        }

        const currentMatchId    = state.matches[0].id;
        state.currentMatchNumber = state.matches[0].match_number || 0;

        const [
            { data: players },
            { data: dashData },
            { data: boosterData },
            { data: lastLock },
            { data: currentTeam },
            { data: realTeamsData },
        ] = await Promise.all([
            supabase.from("player_pool_view").select("*").eq("is_active", true).eq("tournament_id", activeTournamentId),
            supabase.from("home_dashboard_view").select("subs_remaining").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_tournament_points").select("used_boosters").eq("user_id", user.id).eq("tournament_id", activeTournamentId).maybeSingle(),
            supabase.from("user_match_teams")
                .select("id, matches!inner(match_number), user_match_team_players(player_id)")
                .eq("user_id", user.id)
                .eq("tournament_id", activeTournamentId)
                .neq("match_id", currentMatchId)
                .order("locked_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase.from("user_fantasy_teams")
                .select("*, user_fantasy_team_players(player_id)")
                .eq("user_id", user.id)
                .eq("tournament_id", activeTournamentId)
                .maybeSingle(),
            supabase.from("real_teams").select("id, name, short_code, photo_name"),
        ]);

        state.realTeamsMap      = Object.fromEntries((realTeamsData || []).map(t => [t.id, t]));
state.baseSubsRemaining = dashData?.subs_remaining ?? 130;
state.usedBoosters      = boosterData?.used_boosters ?? [];

// Compute real season points from match stats and merge into players
const { data: seasonTotals } = await supabase
    .from("player_match_stats")
    .select("player_id, fantasy_points")
    .eq("tournament_id", activeTournamentId);

const seasonPtsMap = {};
for (const row of seasonTotals || []) {
    seasonPtsMap[row.player_id] = (seasonPtsMap[row.player_id] || 0) + (row.fantasy_points || 0);
}

state.allPlayers = (players || []).map(p => ({
    ...p,
    season_points: seasonPtsMap[p.id] || 0,
}));

        state.lockedPlayerIds   = lastLock?.user_match_team_players?.map(p => p.player_id) || [];

        if (currentTeam) {
            state.captainId    = currentTeam.captain_id;
            state.viceCaptainId = currentTeam.vice_captain_id;
            const savedIds      = currentTeam.user_fantasy_team_players.map(r => r.player_id);
            state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
        }

        // If the saved booster is already in usedBoosters it was for a previous match — reset
        const savedBooster = currentTeam?.active_booster ?? "NONE";
        state.activeBooster = state.usedBoosters.includes(savedBooster) ? "NONE" : savedBooster;

        updateHeaderMatch(state.matches[0]);
        initFilters();
        setupListeners();
        render();

    } catch (err) {
        console.error("Init failed:", err);
        showEmptyState("Failed to load. Please try again.");
    } finally {
        document.body.classList.remove("loading-state");
    }
}

function showEmptyState(msg = "No upcoming matches.") {
    document.body.classList.remove("loading-state");
    const main = document.querySelector(".content-area");
    if (main) main.innerHTML = `<p class="empty-pool-msg">${msg}</p>`;
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
function render() {
    const stats = calcStats();
    updateDashboard(stats);
    renderBoosterUI();
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
        credits += Number(p.credit);
    }

    const isResetMatch = state.currentMatchNumber === 1 || state.currentMatchNumber === PLAYOFF_START_MATCH;
    let subsUsed = 0;
    if (!isResetMatch && state.activeBooster !== "FREE_11" && state.lockedPlayerIds.length > 0) {
        const newPlayers = selected.filter(p => !state.lockedPlayerIds.includes(p.id));
        const hasUncappedDiscount = newPlayers.some(p => p.category === "uncapped");
        subsUsed = (hasUncappedDiscount && newPlayers.length > 0) ? newPlayers.length - 1 : newPlayers.length;
    }

    const liveSubs    = isResetMatch ? "FREE" : (state.baseSubsRemaining - subsUsed);
    const isOverLimit = !isResetMatch && liveSubs < 0;

    return { count: selected.length, overseas, credits, roles, liveSubs, isOverLimit, isResetMatch };
}

function renderTeamDots() {
    const container = document.getElementById("teamDotsRow");
    if (!container) return;

    const bucket = supabase.storage.from("team-logos");
    const frag = document.createDocumentFragment();

    for (let i = 0; i < 11; i++) {
        const player = state.selectedPlayers[i];
        const dot = document.createElement("div");
        dot.className = "team-dot";

        if (player) {
            const team = state.realTeamsMap[player.real_team_id];
            if (team?.photo_name) {
                const url = bucket.getPublicUrl(team.photo_name).data.publicUrl;
                dot.style.backgroundImage = `url('${url}')`;
                dot.classList.add("filled");
            } else {
                dot.classList.add("filled", "no-logo");
                dot.textContent = team?.short_code?.[0] || "?";
            }
        } else if (i === 10) {
            dot.classList.add("no-logo", "dot-eleven");
            dot.textContent = "11";
        }

        frag.appendChild(dot);
    }

    container.innerHTML = "";
    container.appendChild(frag);
}

function updateDashboard(stats) {
    renderTeamDots();
    const minReqs = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };



    setText("playerCountLabel",  stats.count);
    setText("overseasCountLabel", `${stats.overseas}/4`);
setText("creditCount", (100 - stats.credits).toFixed(1));
const creditEl = document.getElementById("creditCount");
if (creditEl) {
    const remaining = 100 - stats.credits;
    creditEl.closest(".dashboard-item")?.classList.toggle("negative", remaining < 5);
}
    setText("boosterUsedLabel",   `${7 - state.usedBoosters.length}/7`);

    const fill = document.getElementById("progressFill");
    if (fill) fill.style.width = `${(stats.count / 11) * 100}%`;

    const subsEl = document.getElementById("subsRemainingLabel");
    if (subsEl) {
        subsEl.textContent = stats.liveSubs;
        subsEl.closest(".dashboard-item")?.classList.toggle("negative", stats.isOverLimit);
    }
    updateRoleTabStates();
}

function renderMyXI(stats) {
    const sorted = [...state.selectedPlayers].sort((a, b) => {
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role])
            return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        return Number(b.credit) - Number(a.credit);
    });
    renderList("myXIList", sorted, true, stats);
}

function renderPlayerPool(stats) {
    const nextMatch = state.matches[0];
    const s = state.filters.search.toLowerCase();

    const filtered = state.allPlayers.filter(p => {
        const cat = (p.category || "").toLowerCase();
        if (s && !p.name.toLowerCase().includes(s) &&
            !(p.team_short_code || "").toLowerCase().includes(s) &&
            !cat.includes(s)) return false;
if (!state.filters.search && p.role !== state.filters.role) return false;
        if (state.filters.teams.length && !state.filters.teams.includes(p.real_team_id)) return false;
        if (state.filters.credits.length && !state.filters.credits.includes(p.credit)) return false;
        if (state.filters.type.length && !state.filters.type.includes(cat)) return false;
        if (state.filters.matches.length) {
            const inMatch = state.matches.some(m =>
                state.filters.matches.includes(m.id) &&
                (p.real_team_id === m.team_a_id || p.real_team_id === m.team_b_id)
            );
            if (!inMatch) return false;
        }
        return true;
    }).sort((a, b) => {
        const pri = id =>
            id === nextMatch?.team_a_id ? 1 :
            id === nextMatch?.team_b_id ? 2 : 3;
        return pri(a.real_team_id) - pri(b.real_team_id)
            || ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]
            || b.credit - a.credit;
    });

    renderList("playerPoolList", filtered, false, stats);
}

// ─── NEXT MATCH LABEL ─────────────────────────────
function getNextMatchLabel(realTeamId) {
    for (let i = 0; i < state.matches.length; i++) {
        const m = state.matches[i];
        if (m.team_a_id === realTeamId || m.team_b_id === realTeamId) {
            if (i === 0) return { text: "Plays next match", urgent: true };
            if (i === 1) return { text: "Plays after 1 match", urgent: false };
            return { text: `Plays after ${i} matches`, urgent: false };
        }
    }
    return null;
}
// ─── LIST RENDERER ────────────────────────────────────────────────────────────
// PERF FIX #11 & #12: Uses DocumentFragment + element creation instead of
// one giant innerHTML string for 250 players. Avoids a single 250-node parse
// blocking the main thread. Also separates XI render from pool render so a
// C/VC tap only rebuilds the XI (11 nodes), not the full pool.
function renderList(containerId, list, isMyXi, stats) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const minReq     = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    const curRoles   = {
        WK:   state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT:  state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR:   state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length,
    };
    const neededSlots = Object.keys(minReq)
        .reduce((acc, r) => acc + Math.max(0, minReq[r] - curRoles[r]), 0);

    const bucket = supabase.storage.from("player-photos");
    const frag   = document.createDocumentFragment();

    if (list.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-pool-msg";
        empty.textContent = isMyXi ? "Select players from the Edit tab." : "No players match your filters.";
        frag.appendChild(empty);
        container.innerHTML = "";
        container.appendChild(frag);
        return;
    }

    for (const p of list) {
        const isSelected    = state.selectedPlayers.some(sp => sp.id === p.id);
        const tooExpensive  = p.credit > (100 - stats.credits + (isSelected ? p.credit : 0));
        const overseasLimit = stats.overseas >= 4 && p.category === "overseas" && !isSelected;
        const roleLocked    = !isSelected && (11 - stats.count) <= neededSlots &&
                              (minReq[p.role] - curRoles[p.role]) <= 0;
        const isDisabled    = !isMyXi && !isSelected &&
                              (stats.count >= 11 || tooExpensive || overseasLimit || roleLocked);

        const photoUrl = p.photo_url
            ? bucket.getPublicUrl(p.photo_url).data.publicUrl
            : "images/default-avatar.png";

        const cat = (p.category || "").toLowerCase();
        const catBadge = cat === "overseas" ? '<span class="cat-badge overseas">✈</span>'
                       : cat === "uncapped"  ? '<span class="cat-badge uncapped">U</span>'
                       : "";

        // Is this player locked from the previous match?
        const isLocked = state.lockedPlayerIds.includes(p.id);

        const nextMatchInfo = getNextMatchLabel(p.real_team_id);
        const nextMatchHtml = nextMatchInfo
            ? `<span class="p-next-match ${nextMatchInfo.urgent ? "urgent" : ""}">${nextMatchInfo.text}</span>`
            : "";

        // --- NEW: CHECK PLAYING XI STATUS ---
        const currentMatch = state.matches[0];
        const status = currentMatch?.player_statuses?.[p.id];
        let statusDot = "";
        if (status === "playing") statusDot = '<span class="status-dot playing" title="Playing"></span>';
        else if (status === "impact") statusDot = '<span class="status-dot impact" title="Impact Player"></span>';
        else if (status === "not-playing") statusDot = '<span class="status-dot not-playing" title="Not Playing"></span>';
        // ------------------------------------

        const card = document.createElement("div");
        card.className = `player-card ${isSelected ? "selected" : ""} ${isDisabled ? "player-faded" : ""}`;
        card.dataset.id = p.id;

        card.innerHTML = `
    <div class="avatar-col" onclick="openPlayerProfile('${p.id}')" style="cursor:pointer">
        <div class="avatar-wrap">
            <img src="${photoUrl}" class="player-avatar" loading="lazy" alt="${p.name}">
            ${catBadge}
        </div>
        <span class="p-team-badge">${p.team_short_code}</span>
    </div>
    <div class="player-info">
        <strong class="p-name">${p.name} ${statusDot}</strong>
        <span class="p-meta">${p.credit} Cr · ${p.selected_by_percent ?? "—"}% · ${p.season_points ?? 0} pts</span>
        ${isLocked ? '<span class="locked-badge">PREV</span>' : ""}
        ${nextMatchHtml}
    </div>
    <div class="controls">
        ${isMyXi ? `
            <button class="role-btn ${state.captainId === p.id ? "active-c" : ""}"
                data-action="C" data-id="${p.id}"
                aria-label="Set captain">C</button>
            <button class="role-btn ${state.viceCaptainId === p.id ? "active-vc" : ""}"
                data-action="VC" data-id="${p.id}"
                aria-label="Set vice-captain">VC</button>
        ` : ""}
        <button class="action-btn ${isSelected ? "remove" : "add"}"
            data-action="toggle" data-id="${p.id}"
            ${isDisabled ? "disabled" : ""}
            aria-label="${isSelected ? "Remove player" : "Add player"}">
            ${isSelected ? "−" : "+"}
        </button>
    </div>`;

        frag.appendChild(card);
    }

    container.innerHTML = "";
    container.appendChild(frag);
}

// ─── DELEGATED EVENT LISTENERS ────────────────────────────────────────────────
// Instead of inline onclick on every card (re-created each render),
// one listener on each container handles all player interactions.
function setupListeners() {
    // Player pool — delegated
    document.getElementById("playerPoolList")?.addEventListener("click", e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn || btn.disabled) return;
        const id = btn.dataset.id;
        if (btn.dataset.action === "toggle") togglePlayer(id);
    });

    // My XI — delegated (C, VC, and remove)
    document.getElementById("myXIList")?.addEventListener("click", e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.action === "toggle") togglePlayer(id);
        else if (btn.dataset.action === "C")  setRole(id, "C");
        else if (btn.dataset.action === "VC") setRole(id, "VC");
    });

    // Search with debounce
    // Search icon toggle
const searchIconBtn  = document.getElementById("searchIconBtn");
const searchOverlay  = document.getElementById("searchOverlayRow");
const searchCloseBtn = document.getElementById("searchCloseBtn");
const searchInput    = document.getElementById("playerSearch");
let searchTimeout;

if (searchIconBtn) {
    searchIconBtn.onclick = () => {
        searchOverlay?.classList.remove("hidden");
        searchIconBtn.classList.add("active");
        searchInput?.focus();
    };
}

if (searchCloseBtn) {
    searchCloseBtn.onclick = () => {
        searchOverlay?.classList.add("hidden");
        searchIconBtn?.classList.remove("active");
        if (searchInput) searchInput.value = "";
        state.filters.search = "";
        renderPlayerPool(calcStats());
        updateFilterButtonStates();
    };
}

if (searchInput) {
    searchInput.oninput = e => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const term = e.target.value.toLowerCase().trim();
            state.filters.search = term;

            if (term) {
                // Find first matching player's role and auto-switch tab
                const match = state.allPlayers.find(p =>
                    p.name.toLowerCase().includes(term) ||
                    (p.team_short_code || "").toLowerCase().includes(term)
                );
                if (match && match.role !== state.filters.role) {
                    // Auto switch role tab
                    state.filters.role = match.role;
                    document.querySelectorAll(".role-tab").forEach(t => {
                        t.classList.toggle("active", t.dataset.role === match.role);
                    });
                }
            }

            renderPlayerPool(calcStats());
            updateFilterButtonStates();
        }, 250);
    };
}
    // Filter dropdowns
    const backdrop = document.getElementById("filterBackdrop");
    for (const type of ["match", "team", "credit", "type"]) {
        const btn  = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);
        if (btn && menu) {
            btn.onclick = e => {
                e.stopPropagation();
                document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show"));
                menu.classList.add("show");
                backdrop?.classList.remove("hidden");
                document.body.style.overflow = "hidden";
            };
        }
    }

    if (backdrop) {
        backdrop.onclick = closeFilters;
    }

    // View tabs (MY XI / EDIT)
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

    // Role filter tabs
    document.querySelectorAll(".role-tab").forEach(tab => {
    tab.onclick = () => {
        document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        state.filters.role = tab.dataset.role;
        // Clear search when switching tabs
        if (searchInput) searchInput.value = "";
        state.filters.search = "";
        searchOverlay?.classList.add("hidden");
        searchIconBtn?.classList.remove("active");
        renderPlayerPool(calcStats());
        updateFilterButtonStates();
    };
});

    // Save button
    document.getElementById("saveTeamBtn")?.addEventListener("click", handleSave);

    document.getElementById("transferBackdrop")
    ?.addEventListener("click", closeTransferSheet);
    
    // BUG FIX #5: Clean up AudioContext on page hide
    window.addEventListener("pagehide", () => {
        if (audioCtx) {
            audioCtx.close();
            audioCtx = null;
        }
        if (countdownInterval) clearInterval(countdownInterval);
        
    });
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────
async function handleSave() {
    if (state.saving || isTransitioning) return;
    showTransferSheet();
}

// ─── TRANSFER SHEET ───────────────────────────────────────────────────────────
function showTransferSheet() {
    const sheet    = document.getElementById("transferSheet");
    const body     = document.getElementById("transferSheetBody");
    const backdrop = document.getElementById("transferBackdrop");
    if (!sheet || !body) return;

    const stats   = calcStats();
    const captain = state.allPlayers.find(p => p.id === state.captainId);
    const vc      = state.allPlayers.find(p => p.id === state.viceCaptainId);

    const boosterNames = {
        TOTAL_2X: "Total 2X", INDIAN_2X: "Indian 2X", OVERSEAS_2X: "Overseas 2X",
        UNCAPPED_2X: "Uncapped 2X", CAPTAIN_3X: "Captain 3X",
        MOM_2X: "MOM 2X", FREE_11: "Free 11",
    };
    const boosterIcons = {
        TOTAL_2X: "🚀", INDIAN_2X: "🇮🇳", OVERSEAS_2X: "✈️",
        UNCAPPED_2X: "🧢", CAPTAIN_3X: "👑", MOM_2X: "🏆", FREE_11: "🆓",
    };

    // CVC block
    const cvcHtml = `
        <div class="ts-cvc-grid">
            <div class="ts-cvc-block">
                <span class="ts-cvc-block-label">👑 Captain</span>
                <span class="ts-cvc-name captain">${captain?.name || "—"}</span>
            </div>
            <div class="ts-cvc-block">
                <span class="ts-cvc-block-label">VC Vice-Captain</span>
                <span class="ts-cvc-name vc">${vc?.name || "—"}</span>
            </div>
        </div>`;

    // Tags — booster + uncapped
    const newPlayers     = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));
    const hasUncapped    = !stats.isResetMatch && newPlayers.some(p => p.category === "uncapped") && newPlayers.length > 0;
    const boosterHtml    = state.activeBooster !== "NONE"
        ? `<span class="ts-tag booster">${boosterIcons[state.activeBooster]} ${boosterNames[state.activeBooster]}</span>`
        : "";
    const uncappedHtml   = hasUncapped
        ? `<span class="ts-tag uncapped">🧢 Uncapped Free Sub</span>`
        : "";
    const tagsHtml       = (boosterHtml || uncappedHtml)
        ? `<div class="ts-tags-row">${boosterHtml}${uncappedHtml}</div>`
        : "";

    // Reset match — fresh team
const isFreeChange = stats.isResetMatch || state.activeBooster === "FREE_11";
const freeReason = state.activeBooster === "FREE_11"
    ? "🆓 Free 11 Booster Active — No Subs Deducted"
    : state.currentMatchNumber === 1
    ? "🏏 Match 1 — Fresh Start, No Subs Deducted"
    : "🔄 Playoff Reset — No Subs Deducted";

if (isFreeChange) {
    body.innerHTML = `
        <div class="ts-inner">
            <div class="ts-header">
                <span class="ts-title">Confirm Team</span>
                <button class="ts-close" onclick="closeTransferSheet()">✕</button>
            </div>
            <div class="ts-fresh">${freeReason}</div>
            ${cvcHtml}
            ${tagsHtml}
            <p class="ts-note">Your team will lock at match start time.</p>
            <button class="ts-confirm-btn" onclick="confirmAndSave()">Confirm & Save</button>
        </div>`;
    openTransferSheet(sheet, backdrop);
    return;
}

    // Normal match — IN / OUT
    const currentIds = state.selectedPlayers.map(p => p.id);
    const playersIn  = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));
    const playersOut = state.allPlayers.filter(p =>
        state.lockedPlayerIds.includes(p.id) && !currentIds.includes(p.id)
    );

    const pillHtml = (players, type) =>
        players.length > 0
            ? players.map(p => `
                <div class="ts-player-pill ${type}">
                    <div class="ts-pill-dot"></div>
                    <span class="ts-pill-name">${p.name}</span>
                </div>`).join("")
            : `<div class="ts-player-pill ${type}" style="opacity:0.4">
                   <div class="ts-pill-dot"></div>
                   <span class="ts-pill-name">None</span>
               </div>`;

    const subsUsed = state.baseSubsRemaining - (typeof stats.liveSubs === "number" ? stats.liveSubs : state.baseSubsRemaining);
    const subsClass = stats.isOverLimit ? "danger" : subsUsed > 0 ? "warning" : "";

    body.innerHTML = `
        <div class="ts-inner">
            <div class="ts-header">
                <span class="ts-title">Confirm Transfer</span>
                <button class="ts-close" onclick="closeTransferSheet()">✕</button>
            </div>
            <div class="ts-inout-grid">
                <div>
                    <div class="ts-col-label out">▼ Out</div>
                    ${pillHtml(playersOut, "out")}
                </div>
                <div>
                    <div class="ts-col-label in">▲ In</div>
                    ${pillHtml(playersIn, "in")}
                </div>
            </div>
            ${cvcHtml}
            <div class="ts-stats-row">
                <div class="ts-stat-pill">
                    <span class="ts-stat-value ${subsClass}">${subsUsed}</span>
                    <span class="ts-stat-label">Subs Used</span>
                </div>
                <div class="ts-stat-pill">
                    <span class="ts-stat-value ${stats.isOverLimit ? "danger" : ""}">${stats.liveSubs}</span>
                    <span class="ts-stat-label">Subs Left</span>
                </div>
                <div class="ts-stat-pill">
                    <span class="ts-stat-value">${state.selectedPlayers.length}</span>
                    <span class="ts-stat-label">Players</span>
                </div>
            </div>
            ${tagsHtml}
            <p class="ts-note">Subs will be deducted and team locked at next match start time.</p>
            <button class="ts-confirm-btn" onclick="confirmAndSave()">Confirm & Save</button>
        </div>`;

    openTransferSheet(sheet, backdrop);
}

function openTransferSheet(sheet, backdrop) {
    backdrop?.classList.remove("hidden");
    sheet.classList.remove("hidden");
    setTimeout(() => sheet.classList.add("show"), 10);
    document.body.style.overflow = "hidden";
}

window.closeTransferSheet = () => {
    const sheet    = document.getElementById("transferSheet");
    const backdrop = document.getElementById("transferBackdrop");
    sheet?.classList.remove("show");
    backdrop?.classList.add("hidden");
    document.body.style.overflow = "";
    setTimeout(() => sheet?.classList.add("hidden"), 400);
};

window.confirmAndSave = async () => {
    closeTransferSheet();
    state.saving = true;
    updateSaveButton(calcStats());

    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.rpc("save_fantasy_team", {
            p_user_id:         user.id,
            p_tournament_id:   activeTournamentId,
            p_captain_id:      state.captainId,
            p_vice_captain_id: state.viceCaptainId,
            p_total_credits:   state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0),
            p_active_booster:  state.activeBooster,
            p_player_ids:      state.selectedPlayers.map(p => p.id),
        });

        if (error) throw error;

        triggerHaptic("success");
        showToast("Team saved successfully!", "success");
        localStorage.setItem("last_action", "team_saved");
        setTimeout(() => { window.location.href = "/home"; }, 1500);

    } catch (err) {
        triggerHaptic("error");
        let msg = err.message;
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
            msg = "Weak internet! Please try again.";
        showToast(msg, "error");
    } finally {
        state.saving = false;
        updateSaveButton(calcStats());
    }
};

// ─── PLAYER ACTIONS ───────────────────────────────────────────────────────────
function togglePlayer(id) {
    triggerHaptic("light");
    const idx = state.selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
        state.selectedPlayers.splice(idx, 1);
        if (state.captainId === id)    state.captainId = null;
        if (state.viceCaptainId === id) state.viceCaptainId = null;
    } else if (state.selectedPlayers.length < 11) {
        const p = state.allPlayers.find(p => p.id === id);
        if (p) state.selectedPlayers.push(p);
    }
    // PERF: Only re-render what changed — XI is small, pool needs credit/count recheck
    const stats = calcStats();
    updateDashboard(stats);
    renderMyXI(stats);
    renderPlayerPool(stats);
    updateSaveButton(stats);
    // Auto switch to My XI when 11 players done but C/VC pending
const allRolesMet = stats.roles.WK >= 1 && stats.roles.BAT >= 3 &&
                    stats.roles.AR >= 1 && stats.roles.BOWL >= 3;

if (stats.count === 11 && allRolesMet && (!state.captainId || !state.viceCaptainId)) {
    const myXiBtn = document.querySelector(".toggle-btn[data-mode='myxi']");
    const editBtn = document.querySelector(".toggle-btn[data-mode='playerPool']");
    const myXiView  = document.getElementById("myxi-view");
    const poolView  = document.getElementById("playerPool-view");
    const fw = document.querySelector(".search-filter-wrapper");

    if (myXiBtn && myXiView) {
        // Switch tabs
        myXiBtn.classList.add("active");
        editBtn?.classList.remove("active");
        myXiView.classList.add("active");
        poolView?.classList.remove("active");
        if (fw) fw.style.display = "none";

        // Toast hint
        showToast("11 players added! Now set your C & VC 👑", "success");
        triggerHaptic("success");
    }
}
}

function setRole(id, type) {
    triggerHaptic("light");
    if (type === "C") {
        state.captainId = state.captainId === id ? null : id;
        if (state.captainId === state.viceCaptainId) state.viceCaptainId = null;
    } else {
        state.viceCaptainId = state.viceCaptainId === id ? null : id;
        if (state.viceCaptainId === state.captainId) state.captainId = null;
    }
    // PERF: C/VC only changes the XI appearance — pool doesn't need rebuild
    const stats = calcStats();
    updateDashboard(stats);
    renderMyXI(stats);
    updateSaveButton(stats);
}

// ─── BOOSTER ──────────────────────────────────────────────────────────────────
function renderBoosterUI() {
    const container = document.getElementById("boosterContainer");
    if (!container) return;

    const afterTournament = state.currentMatchNumber > BOOSTER_WINDOW_END;
    if (afterTournament) { container.classList.add("hidden"); return; }
    container.classList.remove("hidden");

    const isMatch1 = state.currentMatchNumber < BOOSTER_WINDOW_START;

    const configs = {
        TOTAL_2X:    { name: "Total 2X",    icon: "🚀" },
        INDIAN_2X:   { name: "Indian 2X",   icon: "🇮🇳" },
        OVERSEAS_2X: { name: "Overseas 2X", icon: "✈️" },
        UNCAPPED_2X: { name: "Uncapped 2X", icon: "🧢" },
        CAPTAIN_3X:  { name: "Captain 3X",  icon: "👑" },
        MOM_2X:      { name: "MOM 2X",      icon: "🏆" },
        FREE_11:     { name: "Free 11",     icon: "🆓" },
    };

    const activePenalty = state.activeBooster !== "NONE" ? 1 : 0;
    const boostersLeft  = 7 - state.usedBoosters.length - activePenalty;

    const cards = Object.entries(configs).map(([key, cfg]) => {
        const isUsed   = state.usedBoosters.includes(key);
        const isActive = state.activeBooster === key;
        const disabled = isUsed || isMatch1;

        return `
            <div class="booster-card ${isActive ? "active" : ""} ${isUsed ? "used" : ""} ${isMatch1 && !isUsed ? "locked" : ""}"
                 ${disabled ? "" : `onclick="handleBoosterChange('${isActive ? "NONE" : key}')"`}>
                <div class="booster-icon">${cfg.icon}</div>
                <div class="b-name">${cfg.name}</div>
                ${isActive ? '<div class="active-badge">On</div>' : ""}
                ${isUsed   ? '<div class="used-overlay"><span>USED</span></div>' : ""}
            </div>`;
    }).join("");

    container.innerHTML = `
        <div class="booster-shelf">
            <div class="booster-header">
                <span class="b-title">BOOSTERS</span>
                ${isMatch1
                    ? '<span class="b-count b-count-locked">From Match 2</span>'
                    : `<span class="b-count">${boostersLeft} left</span>`}
            </div>
            <div class="booster-scroll">${cards}</div>
        </div>`;
}

window.handleBoosterChange = async val => {
    if (val === "NONE") { state.activeBooster = "NONE"; render(); return; }

    const names = {
        TOTAL_2X: "Total 2X", INDIAN_2X: "Indian 2X", OVERSEAS_2X: "Overseas 2X",
        UNCAPPED_2X: "Uncapped 2X", CAPTAIN_3X: "Captain 3X", MOM_2X: "MOM 2X", FREE_11: "Free 11",
    };

    const confirmed = await showConfirm(
        `Apply ${names[val]}?`,
        "Once the match locks you cannot undo this. You can only use each booster once."
    );

    if (confirmed) {
        triggerHaptic("success");
        state.activeBooster = val;
        showToast(`${names[val]} applied!`, "success");
        render();
    }
};

// ─── HEADER COUNTDOWN ────────────────────────────────────────────────────────
function updateHeaderMatch() {
    if (state.matches.length === 0) {
        setText("headerCountdown", "NO MATCHES");
        setText("upcomingMatchName", "Tournament Ended");
        return;
    }

    const match  = state.matches[0];
    const timerEl = document.getElementById("headerCountdown");
    const saveBtn = document.getElementById("saveTeamBtn");
    const teamA   = match.team_a?.short_code || "TBA";
    const teamB   = match.team_b?.short_code || "TBA";

    setText("upcomingMatchName", `${teamA} vs ${teamB}`);

    const target = new Date(match.actual_start_time).getTime();
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const diff = target - Date.now();

        if (diff <= 0) {
            clearInterval(countdownInterval);
            isTransitioning = true;
            if (timerEl) {
                timerEl.textContent = "LOCKED";
                timerEl.classList.remove("timer-warning");
            }
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = "MATCH LOCKED";
            }

            const nextMatch     = state.matches[1];
            const nextMatchInfo = nextMatch
                ? `${nextMatch.team_a?.short_code || "TBA"} vs ${nextMatch.team_b?.short_code || "TBA"}`
                : "end of tournament";

            // BUG FIX #4: textContent used for trusted parts, not innerHTML
            // Lock toast uses structured HTML but team names are not user-input
            showToast(`🔒 Locked! Next: ${nextMatchInfo}`, "error");
            triggerHaptic("error");

            // BUG FIX: 30 seconds (was 300,000ms with misleading "5 seconds" comment)
            setTimeout(() => {
                state.matches.shift();
                isTransitioning = false;
                if (state.matches.length > 0) {
                    state.currentMatchNumber = state.matches[0].match_number;
                    updateHeaderMatch();
                    render();
                } else {
                    setText("headerCountdown", "NO MATCHES");
                }
            }, MATCH_SHIFT_DELAY_MS);

            return;
        }

        const days    = Math.floor(diff / 86400000);
        const hours   = Math.floor((diff % 86400000) / 3600000);
        const minutes = Math.floor((diff % 3600000)  / 60000);
        const seconds = Math.floor((diff % 60000)    / 1000);
        const secStr  = seconds < 10 ? `0${seconds}` : `${seconds}`;

        if (timerEl) {
            timerEl.textContent = days >= 1
                ? `${days}d ${hours}h ${minutes}m`
                : `${hours}h ${minutes}m ${secStr}s`;
        }

        if (timerEl) timerEl.classList.toggle("timer-warning", (diff / 60000) < 15);

    }, 1000);
}

// ─── SAVE BUTTON STATE ────────────────────────────────────────────────────────
function updateSaveButton(stats) {
    const btn  = document.getElementById("saveTeamBtn");
    const hint = document.getElementById("saveHint");
    if (!btn) return;

    if (isTransitioning) {
        btn.disabled = true;
        btn.textContent = "LOCKED";
        if (hint) hint.textContent = `Team locked for this match`;
        return;
    }

    const checks = [
        [state.saving,                              "SAVING...",   ""],
        [stats.count < 11,                          "NEXT →",      `Add ${11 - stats.count} more player${11 - stats.count > 1 ? "s" : ""}`],
        [!state.captainId || !state.viceCaptainId,  "NEXT →",      "Select your Captain & Vice-Captain"],
        [stats.roles.WK   < 1,                     "NEXT →",      "Need at least 1 Wicket-Keeper"],
        [stats.roles.BAT  < 3,                     "NEXT →",      "Need at least 3 Batters"],
        [stats.roles.AR   < 1,                     "NEXT →",      "Need at least 1 All-Rounder"],
        [stats.roles.BOWL < 3,                     "NEXT →",      "Need at least 3 Bowlers"],
        [stats.overseas   > 4,                     "NEXT →",      "Max 4 overseas players allowed"],
        [stats.credits    > 100.05,                "NEXT →",      "Credits exceeded — remove a player"],
        [stats.isOverLimit,                         "NEXT →",      "Not enough subs remaining"],
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

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function initFilters() {
    renderTeamDropdown();
    renderMatchDropdown();

    const uniqueCredits = [...new Set(state.allPlayers.map(p => p.credit))].sort((a, b) => a - b);
    renderCheckboxDropdown("creditMenu", uniqueCredits, "credits", c => `${c} Cr`);

    renderCheckboxDropdown("typeMenu",
        [{ id: "uncapped", label: "Uncapped 🧢" }, { id: "overseas", label: "Overseas ✈️" }],
        "type",
        t => t.label
    );
}

function renderCheckboxDropdown(elementId, items, filterKey, labelFn) {
    const container = document.getElementById(elementId);
    if (!container) return;

    const listHtml = items.map(item => {
        const val = item.id ?? item;
        return `<label class="filter-item">
            <span>${labelFn(item)}</span>
            <input type="checkbox" value="${val}"
                ${state.filters[filterKey].includes(val) ? "checked" : ""}
                onchange="toggleFilter('${filterKey}', '${val}', this)">
        </label>`;
    }).join("");

    container.innerHTML = `
        <div class="dropdown-content">${listHtml || '<p class="empty-pool-msg">No options.</p>'}</div>
        <div class="dropdown-actions">
            <button onclick="clearFilters('${filterKey}')">Clear</button>
            <button onclick="closeFilters()">Apply</button>
        </div>`;
}

function renderMatchDropdown() {
    const container = document.getElementById("matchMenu");
    if (!container) return;

    // BUG FIX #10: Guard against empty matches
    if (state.matches.length === 0) {
        container.innerHTML = `
            <p class="empty-pool-msg" style="padding:20px;text-align:center;">No upcoming matches.</p>
            <div class="dropdown-actions"><button onclick="closeFilters()">Close</button></div>`;
        return;
    }

    const bucket  = supabase.storage.from("team-logos");
    const listHtml = state.matches.map(m => {
        const isSelected = state.filters.matches.includes(m.id);
        const logoA = m.team_a?.photo_name
            ? bucket.getPublicUrl(m.team_a.photo_name).data.publicUrl
            : "images/default-team.png";
        const logoB = m.team_b?.photo_name
            ? bucket.getPublicUrl(m.team_b.photo_name).data.publicUrl
            : "images/default-team.png";
        const d    = new Date(m.actual_start_time);
        const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

        return `
            <div class="match-filter-card ${isSelected ? "selected" : ""}"
                 onclick="toggleMatchFilterCard('${m.id}', this)">
                <span class="mfc-selected-tick">✔</span>
                <div class="mfc-top-row">
                    <span class="mfc-match-num">Match ${m.match_number}</span>
                    <span class="mfc-venue">${m.venue || "Venue TBA"}</span>
                </div>
                <div class="mfc-main-row">
                    <div class="mfc-team-side">
                        <div class="mfc-logo" style="background-image:url('${logoA}')"></div>
                        <span class="mfc-team-name">${m.team_a?.short_code}</span>
                    </div>
                    <div class="mfc-center">
                        <span class="mfc-vs">vs</span>
                        <span class="mfc-datetime">${date}, ${time}</span>
                    </div>
                    <div class="mfc-team-side right">
                        <div class="mfc-logo" style="background-image:url('${logoB}')"></div>
                        <span class="mfc-team-name">${m.team_b?.short_code}</span>
                    </div>
                </div>
            </div>`;
    }).join("");

    container.innerHTML = `
        <div class="dropdown-content match-filter-grid">${listHtml}</div>
        <div class="dropdown-actions">
            <button onclick="clearFilters('matches')">Clear</button>
            <button onclick="closeFilters()">Apply</button>
        </div>`;
}

function renderTeamDropdown() {
    const container = document.getElementById("teamMenu");
    if (!container) return;

    const bucket       = supabase.storage.from("team-logos");
    const uniqueTeamIds = [...new Set(state.allPlayers.map(p => p.real_team_id))];

    const listHtml = uniqueTeamIds.map(teamId => {
        const isSelected = state.filters.teams.includes(teamId);
        const info       = state.realTeamsMap[teamId] || { name: "Unknown", short_code: "UNK" };
        const logoUrl    = info.photo_name
            ? bucket.getPublicUrl(info.photo_name).data.publicUrl
            : "images/default-team.png";

        return `
            <div class="team-filter-card ${isSelected ? "selected" : ""}"
                 onclick="toggleTeamFilterCard('${teamId}', this)">
                <div class="tfc-logo" style="background-image:url('${logoUrl}')"></div>
                <span class="tfc-name">${info.name} (${info.short_code})</span>
            </div>`;
    }).join("");

    container.innerHTML = `
        <div class="dropdown-content team-filter-grid">${listHtml}</div>
        <div class="dropdown-actions">
            <button onclick="clearFilters('teams')">Clear</button>
            <button onclick="closeFilters()">Apply</button>
        </div>`;
}

// ─── FILTER UTILITIES ─────────────────────────────────────────────────────────
window.toggleFilter = (k, v, el) => {
    const val = k === "credits" ? parseFloat(v) : v;
    if (el.checked) state.filters[k].push(val);
    else state.filters[k] = state.filters[k].filter(i => i !== val);
    renderPlayerPool(calcStats());
    updateFilterButtonStates();
};

window.clearFilters = k => {
    state.filters[k] = [];
    renderPlayerPool(calcStats());
    updateFilterButtonStates();
    initFilters();
};

window.closeFilters = () => {
    document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show"));
    document.getElementById("filterBackdrop")?.classList.add("hidden");
    document.body.style.overflow = "";
};

window.toggleTeamFilterCard = (teamId, el) => {
    if (state.filters.teams.includes(teamId)) {
        state.filters.teams = state.filters.teams.filter(id => id !== teamId);
        el.classList.remove("selected");
    } else {
        state.filters.teams.push(teamId);
        el.classList.add("selected");
    }
    renderPlayerPool(calcStats());
    updateFilterButtonStates();
};

window.toggleMatchFilterCard = (matchId, el) => {
    if (state.filters.matches.includes(matchId)) {
        state.filters.matches = state.filters.matches.filter(id => id !== matchId);
        el.classList.remove("selected");
    } else {
        state.filters.matches.push(matchId);
        el.classList.add("selected");
    }
    renderPlayerPool(calcStats());
    updateFilterButtonStates();
};

function updateFilterButtonStates() {
    const map = {
        matchToggle:  state.filters.matches,
        teamToggle:   state.filters.teams,
        creditToggle: state.filters.credits,
        typeToggle:   state.filters.type,
    };
    for (const [id, arr] of Object.entries(map)) {
        document.getElementById(id)?.classList.toggle("active-filter", arr.length > 0);
    }
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// BUG FIX #4: Toast uses textContent for plain strings (no innerHTML injection risk)
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className   = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity    = "0";
        toast.style.transform  = "translateX(120%)";
        toast.style.transition = "all 0.4s ease";
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

window.showConfirm = (title, message) => {
    return new Promise(resolve => {
        const overlay  = document.getElementById("customConfirmOverlay");
        const titleEl  = document.getElementById("confirmTitle");
        const textEl   = document.getElementById("confirmText");
        const btnCancel = document.getElementById("confirmCancelBtn");
        const btnApply  = document.getElementById("confirmApplyBtn");
        if (!overlay) return resolve(true);

        // textContent — never innerHTML for user-readable confirm dialogs
        titleEl.textContent = title;
        textEl.textContent  = message;
        overlay.classList.remove("hidden");

        const cleanup = () => {
            overlay.classList.add("hidden");
            btnCancel.onclick = null;
            btnApply.onclick  = null;
        };

        btnCancel.onclick = () => { cleanup(); resolve(false); };
        btnApply.onclick  = () => { cleanup(); resolve(true); };
    });
};

// ─── HAPTIC & AUDIO ───────────────────────────────────────────────────────────
function triggerHaptic(style = "light") {
    if (navigator.vibrate) {
        const patterns = {
            light:   [40],
            medium:  [80],
            success: [50, 80, 50],
            error:   [80, 50, 80, 50, 80],
        };
        navigator.vibrate(patterns[style] || [40]);
    }

    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();

        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;

        switch (style) {
            case "light":
                osc.type = "sine";
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
                osc.start(now); osc.stop(now + 0.05);
                break;
            case "success":
                osc.type = "triangle";
                osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.setValueAtTime(659.25, now + 0.1);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.linearRampToValueAtTime(0, now + 0.3);
                osc.start(now); osc.stop(now + 0.3);
                break;
            case "error":
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(150, now);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.linearRampToValueAtTime(0, now + 0.2);
                osc.start(now); osc.stop(now + 0.2);
                break;
        }
    } catch (_) { /* device blocks Web Audio — silent fail */ }
}

// ─── PLAYER PROFILE ───────────────────────────────────────────────────────────
window.openPlayerProfile = async (playerId) => {
    const overlay = document.getElementById("playerProfileOverlay");
    const content = document.getElementById("profileContent");
    if (!overlay || !content) return;

    // Show overlay with spinner
    content.innerHTML = '<div class="profile-loading"><div class="tb-spinner"></div></div>';
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    try {
        // Fetch player info + match stats in parallel
        const [playerRes, statsRes] = await Promise.all([
            supabase.from("player_pool_view")
                .select("*")
                .eq("id", playerId)
                .maybeSingle(),
            supabase.from("player_match_stats")
                .select("*, match:matches!inner(match_number)")
                .eq("player_id", playerId)
                .order("match_id", { ascending: true }),
        ]);

        const p     = playerRes.data;
        const stats = statsRes.data || [];

        if (!p) {
            content.innerHTML = '<p class="profile-no-history">Player not found.</p>';
            return;
        }

        const bucket   = supabase.storage.from("player-photos");
        const photoUrl = p.photo_url
            ? bucket.getPublicUrl(p.photo_url).data.publicUrl
            : "images/default-avatar.png";

        const totalPts = stats.reduce((s, m) => s + (m.fantasy_points || 0), 0);
        const cat      = (p.category || "").toLowerCase();

        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);
        const stats2     = calcStats();
        const canAdd     = !isSelected && stats2.count < 11 &&
                           !(stats2.overseas >= 4 && cat === "overseas");

        // Category badge
        const catBadge = cat === "overseas"
            ? '<span class="profile-badge overseas">✈ Overseas</span>'
            : cat === "uncapped"
            ? '<span class="profile-badge uncapped">🧢 Uncapped</span>'
            : "";

        // Match history rows
        const historyHtml = stats.length > 0
            ? stats.map(m => {
                const isBig = m.fantasy_points >= 100;
                const chips = buildProfileChips(m);
                return `
                    <div class="profile-match-row ${isBig ? "big-game" : ""}">
                        <div class="pmr-top">
                            <span class="pmr-match">Match ${m.match?.match_number || "#"}</span>
                            <span class="pmr-pts">${isBig ? "🌟 " : ""}+${m.fantasy_points} pts</span>
                        </div>
                        ${chips.length > 0 ? `<div class="pmr-chips">${chips.join("")}</div>` : ""}
                    </div>`;
            }).join("")
            : '<p class="profile-no-history">No match data yet.</p>';

        // Action button — only show if on edit page (state exists)
        const actionHtml = typeof state !== "undefined" ? `
            <div class="profile-action-wrap">
                <button class="profile-action-btn ${isSelected ? "remove" : "add"}"
                    ${!isSelected && !canAdd ? "disabled" : ""}
                    onclick="profileTogglePlayer('${p.id}')">
                    ${isSelected ? "− Remove from XI" : "+ Add to XI"}
                </button>
            </div>` : "";

        content.innerHTML = `
            <div class="profile-hero">
                <img src="${photoUrl}" class="profile-avatar" alt="${p.name}">
                <span class="profile-name">${p.name}</span>
                <div class="profile-badges">
                    <span class="profile-badge role">${p.role}</span>
                    <span class="profile-badge team">${p.team_short_code}</span>
                    ${catBadge}
                </div>
            </div>
            <div class="profile-stats-row">
                <div class="profile-stat">
                    <span class="ps-value">${p.credit} Cr</span>
                    <span class="ps-label">Credits</span>
                </div>
                <div class="profile-stat">
                    <span class="ps-value">${totalPts}</span>
                    <span class="ps-label">Season Pts</span>
                </div>
                <div class="profile-stat">
                    <span class="ps-value">${p.selected_by_percent ?? "—"}%</span>
                    <span class="ps-label">Selected By</span>
                </div>
                <div class="profile-stat">
                    <span class="ps-value">${stats.length}</span>
                    <span class="ps-label">Matches</span>
                </div>
            </div>
            <div class="profile-history">
                <div class="profile-history-label">Match Breakdown</div>
                ${historyHtml}
            </div>
            ${actionHtml}`;

    } catch (err) {
        console.error("Profile load error:", err);
        content.innerHTML = '<p class="profile-no-history">Failed to load. Try again.</p>';
    }
};

function updateRoleTabStates() {
    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
    const counts = {
        WK:   state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT:  state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR:   state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length,
    };

    document.querySelectorAll(".role-tab[data-role]").forEach(tab => {
        const role = tab.dataset.role;
        if (!role) return;

        const count = counts[role] || 0;
        const min   = minReq[role] || 0;

        // Update count badge
        const badge = tab.querySelector("span");
        if (badge) badge.textContent = count;

        // Clear state classes
        tab.classList.remove("req-met", "req-unmet");

        // Always apply — 0 is still below minimum so red
        if (count >= min) {
            tab.classList.add("req-met");
        } else {
            tab.classList.add("req-unmet");
        }
    });
}

function buildProfileChips(m) {
    const chips = [];
    const chip  = (text, type) => `<span class="stat-tag ${type}">${text}</span>`;

    if (m.runs   > 0) chips.push(chip(`🏏 ${m.runs}${m.balls ? ` (${m.balls}b)` : ""}`, "bat"));
    if (m.fours  > 0 || m.sixes > 0) chips.push(chip(`🎯 ${m.fours||0}×4 ${m.sixes||0}×6`, "boundary"));
    if (m.sr_points && m.sr_points !== 0) chips.push(chip(`⚡ SR ${m.sr_points > 0 ? "+" : ""}${m.sr_points}`, "bonus"));
    if (m.milestone_points > 0) chips.push(chip(`🏆 +${m.milestone_points}`, "bonus"));
    if (m.duck_penalty && m.duck_penalty < 0) chips.push(chip(`🦆 Duck ${m.duck_penalty}`, "penalty"));
    if (m.wickets  > 0) chips.push(chip(`🎳 ${m.wickets}W`, "bowl"));
    if (m.maidens  > 0) chips.push(chip(`🧱 ${m.maidens} Maiden${m.maidens > 1 ? "s" : ""}`, "bowl"));
    if (m.er_points && m.er_points !== 0) chips.push(chip(`📉 Econ ${m.er_points > 0 ? "+" : ""}${m.er_points}`, "bonus"));
    if (m.catches   > 0) chips.push(chip(`🧤 ${m.catches}C`, "field"));
    if (m.stumpings > 0) chips.push(chip(`🏃 ${m.stumpings}St`, "field"));
    const ro = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (ro > 0) chips.push(chip(`🎯 ${ro}RO`, "field"));
    if (m.is_player_of_match) chips.push(chip("🏆 POM +20", "gold"));

    return chips;
}

window.profileTogglePlayer = (id) => {
    closePlayerProfile();
    setTimeout(() => togglePlayer(id), 200);
};

window.closePlayerProfile = (e) => {
    if (e && e.target !== document.getElementById("playerProfileOverlay")) return;
    document.getElementById("playerProfileOverlay")?.classList.add("hidden");
    document.body.style.overflow = "";
};

// Expose for booster onclick (called from innerHTML)
window.triggerHaptic = triggerHaptic;