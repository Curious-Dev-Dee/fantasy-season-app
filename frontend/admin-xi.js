import { supabase } from "./supabase.js";

let currentMatchId    = null;
let playerStatuses    = {};
let cachedPlayers     = [];
let hasUnsavedChanges = false;

async function init() {
    const { data: activeTournament } = await supabase
        .from("active_tournament").select("id").single();

    if (!activeTournament) {
        document.getElementById("matchTitle").textContent = "No active tournament.";
        return;
    }

    const { data: match } = await supabase
        .from("matches")
        .select("*, team_a:real_teams!team_a_id(name), team_b:real_teams!team_b_id(name)")
        .eq("tournament_id", activeTournament.id)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .single();

    if (!match) {
        document.getElementById("matchTitle").textContent = "No Upcoming Matches";
        return;
    }

    currentMatchId  = match.id;
    playerStatuses  = match.player_statuses || {};
    document.getElementById("matchTitle").textContent =
        `Match ${match.match_number}: ${match.team_a.name} vs ${match.team_b.name}`;

    const { data: players } = await supabase
        .from("players")
        .select("id, name, real_team_id")
        .in("real_team_id", [match.team_a_id, match.team_b_id])
        .order("name", { ascending: true }); // alphabetical = easier to find

    cachedPlayers = players || [];
    renderPlayers();
    setupSearch();
}

/* ── RENDER ── */
function renderPlayers(filter = "") {
    const list      = document.getElementById("playerList");
    const noResults = document.getElementById("noResults");
    const query     = filter.toLowerCase().trim();

    list.innerHTML = "";
    let visible = 0;

    cachedPlayers.forEach(p => {
        if (query && !p.name.toLowerCase().includes(query)) return;
        visible++;

        const status = playerStatuses[p.id] || "";
        const row    = document.createElement("div");
        row.className = "player-row";
        row.innerHTML = `
            <div class="player-name">${p.name}</div>
            <div class="btn-group">
                <button class="btn playing ${status === 'playing'      ? 'active' : ''}" data-id="${p.id}" data-status="playing">Playing</button>
                <button class="btn impact  ${status === 'impact'       ? 'active' : ''}" data-id="${p.id}" data-status="impact">Impact</button>
                <button class="btn out     ${status === 'not-playing'  ? 'active' : ''}" data-id="${p.id}" data-status="not-playing">Out</button>
            </div>
        `;
        list.appendChild(row);
    });

    noResults.style.display = visible === 0 ? "block" : "none";
    updateCounter();
}

/* ── COUNTER ── */
function updateCounter() {
    const counts = { playing: 0, impact: 0, "not-playing": 0 };
    Object.values(playerStatuses).forEach(s => {
        if (counts[s] !== undefined) counts[s]++;
    });
    document.getElementById("countPlaying").textContent = `✅ Playing: ${counts.playing}`;
    document.getElementById("countImpact").textContent  = `⚡ Impact: ${counts.impact}`;
    document.getElementById("countOut").textContent     = `❌ Out: ${counts["not-playing"]}`;
}

/* ── BUTTON CLICKS (event delegation — one listener for all buttons) ── */
document.getElementById("playerList").addEventListener("click", (e) => {
    const btn = e.target.closest(".btn");
    if (!btn) return;

    const playerId = btn.dataset.id;
    const status   = btn.dataset.status;
    if (!playerId || !status) return;

    // Toggle: click same = off, click different = switch
    if (playerStatuses[playerId] === status) {
        delete playerStatuses[playerId];
    } else {
        playerStatuses[playerId] = status;
    }

    hasUnsavedChanges = true;

    // Only re-render current search view, not full list
    const searchBox = document.getElementById("searchBox");
    renderPlayers(searchBox?.value || "");
});

/* ── SEARCH ── */
function setupSearch() {
    const searchBox = document.getElementById("searchBox");
    searchBox.addEventListener("input", () => {
        renderPlayers(searchBox.value);
    });
}

/* ── SAVE ── */
document.getElementById("saveBtn").onclick = async () => {
    if (!currentMatchId) return alert("No match loaded.");

    const btn      = document.getElementById("saveBtn");
    btn.textContent = "Saving...";
    btn.disabled    = true;

    const { error } = await supabase
        .from("matches")
        .update({ player_statuses: playerStatuses })
        .eq("id", currentMatchId);

    if (error) {
        alert("Error saving: " + error.message);
    } else {
        hasUnsavedChanges = false;
        btn.textContent   = "✅ Saved!";
        setTimeout(() => { btn.textContent = "Save Lineups"; }, 2000);
    }

    btn.disabled = false;
};

/* ── UNSAVED CHANGES WARNING ── */
window.onbeforeunload = (e) => {
    if (hasUnsavedChanges) return "You have unsaved XI changes!";
};

init();