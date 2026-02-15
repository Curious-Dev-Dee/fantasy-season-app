import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const ADMIN_EMAIL = "satyara9jansahoo@gmail.com"; // 👈 DOUBLE CHECK THIS

const matchSelect = document.getElementById("matchSelect");
const scoreboardInput = document.getElementById("scoreboardInput");
const processBtn = document.getElementById("processBtn");
const reportContainer = document.getElementById("reportContainer");
const finalConfirmBtn = document.getElementById("finalConfirmBtn");
const statusDiv = document.getElementById("status");

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email !== ADMIN_EMAIL) {
        window.location.href = "home.html";
        return;
    }
    loadMatches();
}

async function loadMatches() {
    const { data: matches } = await supabase.from('matches').select('*').eq('tournament_id', TOURNAMENT_ID).order('match_number');
    const { data: teams } = await supabase.from('real_teams').select('id, short_code');
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

    matchSelect.innerHTML = matches.map(m => `
        <option value="${m.id}">Match ${m.match_number}: ${teamMap[m.team_a_id]} vs ${teamMap[m.team_b_id]}</option>
    `).join('');
}

// STEP 1: TYPO HUNTER (ANALYZE)
processBtn.addEventListener("click", async () => {
    const jsonStr = scoreboardInput.value.trim();
    if (!jsonStr) return alert("Paste JSON first");

    try {
        const scoreboard = JSON.parse(jsonStr);
        const scoreboardNames = scoreboard.map(p => p.player_name.trim());

        // Fetch valid players for the selected match
        const { data: match } = await supabase.from('matches').select('team_a_id, team_b_id').eq('id', matchSelect.value).single();
        const { data: dbPlayers } = await supabase.from('players').select('name').in('team_id', [match.team_a_id, match.team_b_id]);
        const dbNames = dbPlayers.map(p => p.name.trim());

        // Find Typos
        const missing = scoreboardNames.filter(name => !dbNames.includes(name));

        // UI Update
        reportContainer.style.display = "block";
        document.getElementById("reportStats").innerHTML = `Matched: ${scoreboardNames.length - missing.length} | Missing: ${missing.length}`;
        
        if (missing.length > 0) {
            document.getElementById("missingWrapper").style.display = "block";
            document.getElementById("successWrapper").style.display = "none";
            document.getElementById("missingList").innerHTML = missing.map(n => `<li>${n}</li>`).join('');
            finalConfirmBtn.style.display = "none";
        } else {
            document.getElementById("missingWrapper").style.display = "none";
            document.getElementById("successWrapper").style.display = "block";
            finalConfirmBtn.style.display = "block";
            finalConfirmBtn.onclick = () => executeUpdate(scoreboard);
        }
    } catch (e) { alert("Invalid JSON format"); }
});

// STEP 2: ACTUAL PROCESS
async function executeUpdate(scoreboard) {
    statusDiv.className = "status loading";
    statusDiv.textContent = "Processing points...";
    statusDiv.style.display = "block";
    finalConfirmBtn.disabled = true;

    const { error } = await supabase.functions.invoke('process_match_points', {
        body: { match_id: matchSelect.value, tournament_id: TOURNAMENT_ID, scoreboard: scoreboard }
    });

    if (error) {
        statusDiv.className = "status error";
        statusDiv.textContent = "Error: " + error.message;
    } else {
        statusDiv.className = "status success";
        statusDiv.textContent = "✅ Leaderboard Updated!";
        scoreboardInput.value = "";
        reportContainer.style.display = "none";
    }
    finalConfirmBtn.disabled = false;
}

init();