import { supabase } from "./supabase.js";

let currentMatchId = null;
let playerStatuses = {}; // Will hold { "player-uuid": "playing", "player-uuid": "impact" }

async function init() {
    // 1. Get Active Tournament
    const { data: activeTournament } = await supabase.from("active_tournament").select("id").single();
    
    // 2. Get Next Upcoming Match
    const { data: match } = await supabase
        .from("matches")
        .select("*, team_a:real_teams!team_a_id(name), team_b:real_teams!team_b_id(name)")
        .eq("tournament_id", activeTournament.id)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .single();

    if (!match) return document.getElementById("matchTitle").textContent = "No Upcoming Matches";
    
    currentMatchId = match.id;
    playerStatuses = match.player_statuses || {}; // Load existing data if any
    document.getElementById("matchTitle").textContent = `Match ${match.match_number}: ${match.team_a.name} vs ${match.team_b.name}`;

    // 3. Get Players for both teams
    const { data: players } = await supabase
        .from("players")
        .select("id, name, real_team_id")
        .in("real_team_id", [match.team_a_id, match.team_b_id]);

    renderPlayers(players);
}

function renderPlayers(players) {
    const list = document.getElementById("playerList");
    list.innerHTML = "";

    players.forEach(p => {
        const status = playerStatuses[p.id] || "";
        const row = document.createElement("div");
        row.className = "player-row";
        row.innerHTML = `
            <div><strong>${p.name}</strong></div>
            <div>
                <button class="btn playing ${status === 'playing' ? 'active' : ''}" onclick="setStatus('${p.id}', 'playing')">Playing</button>
                <button class="btn impact ${status === 'impact' ? 'active' : ''}" onclick="setStatus('${p.id}', 'impact')">Impact</button>
                <button class="btn out ${status === 'not-playing' ? 'active' : ''}" onclick="setStatus('${p.id}', 'not-playing')">Out</button>
            </div>
        `;
        list.appendChild(row);
    });
}

window.setStatus = (playerId, status) => {
    // If clicking the same status, toggle it off. Otherwise, set it.
    if (playerStatuses[playerId] === status) {
        delete playerStatuses[playerId];
    } else {
        playerStatuses[playerId] = status;
    }
    // Re-render UI to update button highlighting
    init(); 
};

document.getElementById("saveBtn").onclick = async () => {
    if (!currentMatchId) return alert("No match loaded.");
    
    document.getElementById("saveBtn").textContent = "Saving...";
    
    const { error } = await supabase
        .from("matches")
        .update({ player_statuses: playerStatuses })
        .eq("id", currentMatchId);

    if (error) alert("Error saving: " + error.message);
    else alert("Saved Successfully! Edit page will now show dots.");
    
    document.getElementById("saveBtn").textContent = "Save Lineups";
};

init();