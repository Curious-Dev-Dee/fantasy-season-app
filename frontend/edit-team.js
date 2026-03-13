import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

const LEAGUE_SUB_LIMIT = 150;
const KNOCKOUT_SUB_LIMIT = 10;
const PLAYOFF_START_MATCH = 71;
const LEAGUE_STAGE_END = 70;

const ROLE_PRIORITY = { WK: 1, BAT: 2, AR: 3, BOWL: 4 };

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
   AUTH INIT
========================= */

window.addEventListener("auth-verified", (e) => {
    init(e.detail.user);
});


async function init(user) {

    if (!user) return;

    document.body.classList.add("loading-state");

    try {

        const { data: matches } = await supabase
            .from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("tournament_id", TOURNAMENT_ID)
            .eq("status", "upcoming")
            .gt("actual_start_time", new Date().toISOString())
            .order("actual_start_time", { ascending: true })
            .limit(5);

        state.matches = matches || [];

        if (!state.matches.length) return;

        const currentMatchId = state.matches[0].id;

        state.currentMatchNumber = state.matches[0].match_number || 0;

        const [
            { data: players },
            { data: dashData },
            { data: boosterData },
            { data: lastLock },
            { data: currentTeam }
        ] = await Promise.all([

            supabase.from("player_pool_view")
                .select("*")
                .eq("is_active", true)
                .eq("tournament_id", TOURNAMENT_ID),

            supabase.from("home_dashboard_view")
                .select("subs_remaining")
                .eq("user_id", user.id)
                .maybeSingle(),

            supabase.from("user_tournament_points")
                .select("used_boosters")
                .eq("user_id", user.id)
                .eq("tournament_id", TOURNAMENT_ID)
                .maybeSingle(),

            supabase.from("user_match_teams")
                .select(`id, matches!inner(match_number), user_match_team_players(player_id)`)
                .eq("user_id", user.id)
                .neq("match_id", currentMatchId)
                .order("locked_at", { ascending: false })
                .limit(1)
                .maybeSingle(),

            supabase.from("user_fantasy_teams")
                .select("*, user_fantasy_team_players(player_id)")
                .eq("user_id", user.id)
                .eq("tournament_id", TOURNAMENT_ID)
                .maybeSingle()

        ]);


        state.allPlayers = players || [];
        state.baseSubsRemaining = dashData?.subs_remaining ?? 150;
        state.usedBoosters = boosterData?.used_boosters ?? [];

        state.lockedPlayerIds = lastLock?.user_match_team_players?.map(p => p.player_id) || [];

        state.activeBooster = currentTeam?.active_booster ?? "NONE";


        if (currentTeam) {

            state.captainId = currentTeam.captain_id;
            state.viceCaptainId = currentTeam.vice_captain_id;

            const savedIds = currentTeam.user_fantasy_team_players.map(p => p.player_id);

            state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
        }


        updateHeaderMatch(state.matches[0]);
        initFilters();
        setupListeners();
        render();

    }
    catch (err) {

        console.error("Init failed", err);

    }
    finally {

        document.body.classList.remove("loading-state");

    }

}


/* =========================
   TEAM STATS ENGINE
========================= */

function getTeamStats() {

    const count = state.selectedPlayers.length;

    const overseas = state.selectedPlayers.filter(p => p.category === "overseas").length;

    const credits = state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);

    const roles = {
        WK: state.selectedPlayers.filter(p => p.role === "WK").length,
        BAT: state.selectedPlayers.filter(p => p.role === "BAT").length,
        AR: state.selectedPlayers.filter(p => p.role === "AR").length,
        BOWL: state.selectedPlayers.filter(p => p.role === "BOWL").length
    };

    return { count, overseas, credits, roles };

}


/* =========================
   SUB CALCULATION
========================= */

function calculateSubs() {

    const matchNum = state.currentMatchNumber;

    const isResetMatch = (matchNum === 1 || matchNum === PLAYOFF_START_MATCH);

    let subsUsed = 0;

    if (!isResetMatch && state.lockedPlayerIds.length) {

        const newPlayers = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id));

        const hasUncapped = newPlayers.some(p => p.category === "uncapped");

        subsUsed = hasUncapped && newPlayers.length > 0 ? newPlayers.length - 1 : newPlayers.length;

    }

    if (state.activeBooster === "FREE_11") subsUsed = 0;

    const remaining = isResetMatch ? "FREE" : state.baseSubsRemaining - subsUsed;

    return { remaining, isOverLimit: remaining < 0 && remaining !== "FREE" };

}


/* =========================
   RENDER
========================= */

function render() {

    const stats = getTeamStats();

    const subs = calculateSubs();

    document.getElementById("playerCountLabel").innerText = stats.count;

    document.getElementById("overseasCountLabel").innerText = `${stats.overseas}/4`;

    document.getElementById("creditCount").innerText = stats.credits.toFixed(1);

    document.getElementById("boosterUsedLabel").innerText = `${6 - state.usedBoosters.length}/6`;

    document.getElementById("progressFill").style.width = `${(stats.count / 11) * 100}%`;

    const subsEl = document.getElementById("subsRemainingLabel");

    subsEl.innerText = subs.remaining;

    subsEl.parentElement.className = subs.isOverLimit ? "dashboard-item negative" : "dashboard-item";

    renderBoosterUI();

    renderPlayerLists(stats);

    updateSaveButton(stats, subs);

}


/* =========================
   PLAYER LIST RENDER
========================= */

function renderPlayerLists(stats) {

    const nextMatch = state.matches[0];

    const filtered = state.allPlayers.filter(p => {

        const s = state.filters.search.toLowerCase();

        const matchesSearch =
            p.name.toLowerCase().includes(s) ||
            (p.team_short_code || "").toLowerCase().includes(s) ||
            (p.category || "").toLowerCase().includes(s);

        const matchesRole = state.filters.role === "ALL" || p.role === state.filters.role;

        return matchesSearch && matchesRole;

    })
        .sort((a, b) => {

            const aPri = a.real_team_id === nextMatch.team_a_id ? 1 :
                a.real_team_id === nextMatch.team_b_id ? 2 : 3;

            const bPri = b.real_team_id === nextMatch.team_a_id ? 1 :
                b.real_team_id === nextMatch.team_b_id ? 2 : 3;

            return aPri - bPri || ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit;

        });


    renderList("playerPoolList", filtered, false, stats);

    const sortedXI = [...state.selectedPlayers]
        .sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.credit - a.credit);

    renderList("myXIList", sortedXI, true, stats);

}


function renderList(containerId, list, isMyXi, stats) {

    const container = document.getElementById(containerId);

    if (!container) return;

    const minReq = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };

    const remainingCredits = 100 - stats.credits;

    const neededSlots = Object.keys(minReq)
        .reduce((acc, r) => acc + Math.max(0, minReq[r] - stats.roles[r]), 0);


    container.innerHTML = list.map(p => {

        const isSelected = state.selectedPlayers.some(sp => sp.id === p.id);

        const tooExpensive = p.credit > remainingCredits;

        const overseasLimit = stats.overseas >= 4 && p.category === "overseas";

        const roleLocked = (11 - stats.count) <= neededSlots && (minReq[p.role] - stats.roles[p.role]) <= 0;

        const isDisabled = !isMyXi && !isSelected &&
            (stats.count >= 11 || tooExpensive || overseasLimit || roleLocked);


        const photo = p.photo_url
            ? supabase.storage.from("player-photos").getPublicUrl(p.photo_url).data.publicUrl
            : "images/default-avatar.png";


        return `
<div class="player-card ${isSelected ? "selected" : ""} ${isDisabled ? "player-faded" : ""}">
<div class="avatar-container">
<img src="${photo}" class="player-avatar">
</div>

<div class="player-info">
<strong>${p.name}</strong>
<span>${p.role} • ${p.team_short_code} • ${p.credit} Cr</span>
</div>

<div class="controls">

${isMyXi ? `
<button class="cv-btn ${state.captainId === p.id ? "active" : ""}" onclick="setRole('${p.id}','C')">C</button>
<button class="cv-btn ${state.viceCaptainId === p.id ? "active" : ""}" onclick="setRole('${p.id}','VC')">VC</button>
` : ""}

<button class="action-btn-circle ${isSelected ? "remove" : "add"}"
${isDisabled ? "disabled" : ""}
onclick="togglePlayer('${p.id}')">${isSelected ? "−" : "+"}</button>

</div>
</div>`;

    }).join("");

}


/* =========================
   BOOSTER UI
========================= */

function renderBoosterUI() {

    const container = document.getElementById("boosterContainer");

    if (!container) return;

    const isBoosterWindow =
        state.currentMatchNumber >= 1 &&
        state.currentMatchNumber <= LEAGUE_STAGE_END;

    if (!isBoosterWindow) {

        container.classList.add("hidden");
        return;

    }

    container.classList.remove("hidden");

    const boosterNames = {
        TOTAL_2X: "Shaitan 💀",
        CAPPED_2X: "Jay Hind 🔱",
        UNCAPPED_2X: "Mirikaali 🦈",
        OVERSEAS_2X: "Angrej",
        FREE_11: "Free 11",
        CAPTAIN_3X: "Hero"
    };

    let html = `<option value="NONE">-- Select Booster --</option>`;

    Object.keys(boosterNames).forEach(key => {

        const used = state.usedBoosters.includes(key);

        html += `<option value="${key}" ${used ? "disabled" : ""} ${state.activeBooster === key ? "selected" : ""}>
${used ? "🚫 " : ""}${boosterNames[key]}</option>`;

    });

    container.innerHTML = `
<select id="boosterSelect" class="booster-dropdown"
onchange="handleBoosterChange(this.value)">
${html}
</select>
`;

}


/* =========================
   SAVE BUTTON
========================= */

function updateSaveButton(stats, subs) {

    const btn = document.getElementById("saveTeamBtn");

    const hasRoles =
        stats.roles.WK >= 1 &&
        stats.roles.BAT >= 3 &&
        stats.roles.AR >= 1 &&
        stats.roles.BOWL >= 3;

    const valid =
        stats.count === 11 &&
        state.captainId &&
        state.viceCaptainId &&
        stats.credits <= 100 &&
        !subs.isOverLimit &&
        hasRoles &&
        stats.overseas <= 4;

    btn.disabled = !valid || state.saving;

    if (state.saving) btn.innerText = "SAVING...";
    else if (!valid) btn.innerText = "CHECK REQUIREMENTS";
    else btn.innerText = "SAVE TEAM";

}


/* =========================
   USER ACTIONS
========================= */

window.togglePlayer = (id) => {

    const idx = state.selectedPlayers.findIndex(p => p.id === id);

    if (idx > -1) {

        state.selectedPlayers.splice(idx, 1);

        if (state.captainId === id) state.captainId = null;

        if (state.viceCaptainId === id) state.viceCaptainId = null;

    }
    else if (state.selectedPlayers.length < 11) {

        const p = state.allPlayers.find(p => p.id === id);

        if (p) state.selectedPlayers.push(p);

    }

    render();

};


window.setRole = (id, role) => {

    if (role === "C") {

        state.captainId = state.captainId === id ? null : id;

        if (state.captainId === state.viceCaptainId)
            state.viceCaptainId = null;

    }
    else {

        state.viceCaptainId = state.viceCaptainId === id ? null : id;

        if (state.viceCaptainId === state.captainId)
            state.captainId = null;

    }

    render();

};


window.handleBoosterChange = (val) => {

    if (val === "NONE") {

        state.activeBooster = "NONE";
        render();
        return;

    }

    if (confirm("Apply booster?")) {

        state.activeBooster = val;

    }

    render();

};


/* =========================
   SAVE TEAM
========================= */

document.getElementById("saveTeamBtn").onclick = async () => {

    if (state.saving) return;

    state.saving = true;

    render();

    try {

        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.rpc("save_fantasy_team", {

            p_user_id: user.id,
            p_tournament_id: TOURNAMENT_ID,
            p_captain_id: state.captainId,
            p_vice_captain_id: state.viceCaptainId,
            p_total_credits: state.selectedPlayers.reduce((s, p) => s + Number(p.credit), 0),
            p_active_booster: state.activeBooster,
            p_player_ids: state.selectedPlayers.map(p => p.id)

        });

        if (error) throw error;

        alert("Team Saved Successfully");

        window.location.href = "home.html";

    }
    catch (err) {

        alert(err.message);

    }
    finally {

        state.saving = false;

        render();

    }

};


/* =========================
   SEARCH / FILTERS
========================= */

function setupListeners() {

    /* =========================
       SEARCH
    ========================= */

    const search = document.getElementById("playerSearch");

    if (search) {
        search.oninput = (e) => {
            state.filters.search = e.target.value;
            render();
        };
    }



    /* =========================
       VIEW TABS (MY XI / CHANGE)
    ========================= */

    document.querySelectorAll(".toggle-btn").forEach(btn => {

        btn.onclick = () => {

            document.querySelectorAll(".toggle-btn")
                .forEach(b => b.classList.remove("active"));

            document.querySelectorAll(".view-mode")
                .forEach(v => v.classList.remove("active"));

            btn.classList.add("active");

            const targetView = document.getElementById(`${btn.dataset.mode}-view`);

            if (targetView) targetView.classList.add("active");


            const filterWrap = document.querySelector(".search-filter-wrapper");

            if (filterWrap)
                filterWrap.style.display =
                    btn.dataset.mode === "myxi" ? "none" : "flex";

        };

    });



    /* =========================
       ROLE FILTER TABS
    ========================= */

    document.querySelectorAll(".role-tab").forEach(tab => {

        tab.onclick = () => {

            document.querySelectorAll(".role-tab")
                .forEach(t => t.classList.remove("active"));

            tab.classList.add("active");

            state.filters.role = tab.dataset.role;

            render();

        };

    });



    /* =========================
       FILTER DROPDOWN BUTTONS
    ========================= */

    const backdrop = document.getElementById("filterBackdrop");

    ["match", "team", "credit"].forEach(type => {

        const btn = document.getElementById(`${type}Toggle`);
        const menu = document.getElementById(`${type}Menu`);

        if (btn && menu) {

            btn.onclick = (e) => {

                e.stopPropagation();

                document.querySelectorAll(".dropdown-menu")
                    .forEach(m => m.classList.remove("show"));

                menu.classList.add("show");

                if (backdrop) backdrop.classList.remove("hidden");

                document.body.style.overflow = "hidden";

            };

        }

    });



    /* =========================
       CLOSE FILTER SHEETS
    ========================= */

    if (backdrop) {

        backdrop.onclick = () => {

            document.querySelectorAll(".dropdown-menu")
                .forEach(m => m.classList.remove("show"));

            backdrop.classList.add("hidden");

            document.body.style.overflow = "";

        };

    }

}

function initFilters() {
    // placeholder so filters don't break
}


/* =========================
   MATCH TIMER
========================= */

function updateHeaderMatch(match) {

    const nameEl = document.getElementById("upcomingMatchName");

    const timerEl = document.getElementById("headerCountdown");

    nameEl.innerText = `${match.team_a?.short_code} vs ${match.team_b?.short_code}`;

    const target = new Date(match.actual_start_time).getTime();

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {

        const diff = target - Date.now();

        if (diff <= 0) {

            timerEl.innerText = "LIVE";

            clearInterval(countdownInterval);

            return;

        }

        const h = Math.floor(diff / 3600000);

        const m = Math.floor((diff % 3600000) / 60000);

        const s = Math.floor((diff % 60000) / 1000);

        timerEl.innerText = `${h}h ${m}m ${s}s`;

    }, 1000);

}