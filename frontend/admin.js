import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const ADMIN_EMAIL = "your-email@gmail.com"; // 👈 PUT YOUR EMAIL HERE

// DOM Elements
const matchSelect = document.getElementById("matchSelect");
const scoreboardInput = document.getElementById("scoreboardInput");
const processBtn = document.getElementById("processBtn");
const statusDiv = document.getElementById("status");

// Report Elements
const reportContainer = document.getElementById("reportContainer");
const reportStats = document.getElementById("reportStats");
const missingPlayersWrapper = document.getElementById("missingPlayersWrapper");
const missingPlayersList = document.getElementById("missingPlayersList");
const successWrapper = document.getElementById("successWrapper");
const finalConfirmBtn = document.getElementById("finalConfirmBtn");

/* =========================================
   1. AUTH & INITIALIZATION
   ========================================= */
async function checkAdminAccess() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email !== ADMIN_EMAIL) {
        alert("Access Denied: Restricted to the League Commissioner.");
        window.location.href = "home.html";
        return false;
    }
    return true;
}

async function loadMatches() {
    try {
        updateStatus("Fetching matches...", "loading");

        const { data: matches, error: mError } = await supabase
            .from('matches')
            .select('*')
            .eq('tournament_id', TOURNAMENT_ID)
            .order('match_number', { ascending: true });

        if (mError) throw mError;

        const { data: teams, error: tError } = await supabase
            .from('real_teams')
            .select('id, short_code');

        if (tError) throw tError;

        const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

        matchSelect.innerHTML = matches.length 
            ? matches.map(m => `
                <option value="${m.id}">
                    Match ${m.match_number}: ${teamMap[m.team_a_id] || 'TBA'} vs ${teamMap[m.team_b_id] || 'TBA'} (${m.venue})
                </option>`).join('')
            : '<option value="">No matches found</option>';

        updateStatus("", "");
    } catch (err) {
        console.error(err);
        updateStatus("Connection Error: Check console.", "error");
    }
}

/* =========================================
   2. STAGE 1: THE TYPO HUNTER (ANALYZE)
   ========================================= */
processBtn.addEventListener("click", async () => {
    const matchId = matchSelect.value;
    const jsonStr = scoreboardInput.value.trim();

    if (!matchId || !jsonStr) {
        return updateStatus("Please select a match and paste JSON.", "error");
    }

    try {
        const scoreboard = JSON.parse(jsonStr);
        const scoreboardNames = scoreboard.map(p => p.player_name.trim());

        // A. Fetch current match teams
        const { data: match } = await supabase
            .from('matches')
            .select('team_a_id, team_b_id')
            .eq('id', matchId)
            .single();

        // B. Fetch all valid players for these two teams
        const { data: dbPlayers } = await supabase
            .from('players')
            .select('name')
            .in('team_id', [match.team_a_id, match.team_b_id]);

        const dbNames = dbPlayers.map(p => p.name.trim());

        // C. Cross-Reference
        const missing = scoreboardNames.filter(name => !dbNames.includes(name));

        // D. Show Report
        showReport(scoreboardNames.length, missing, scoreboard);

    } catch (err) {
        updateStatus("Invalid JSON: Please check your formatting.", "error");
    }
});

function showReport(total, missing, scoreboard) {
    reportContainer.style.display = "block";
    
    reportStats.innerHTML = `
        <span>Matched: <strong>${total - missing.length}</strong></span>
        <span>Missing: <strong style="color: red">${missing.length}</strong></span>
    `;

    if (missing.length > 0) {
        missingPlayersWrapper.style.display = "block";
        successWrapper.style.display = "none";
        finalConfirmBtn.disabled = true; // Block processing
        missingPlayersList.innerHTML = missing.map(name => `<li>${name}</li>`).join('');
    } else {
        missingPlayersWrapper.style.display = "none";
        successWrapper.style.display = "block";
        finalConfirmBtn.disabled = false;
        
        // Prepare final execution
        finalConfirmBtn.onclick = () => executePointsProcess(scoreboard);
    }
}

/* =========================================
   3. STAGE 2: EXECUTE (INVOKE EDGE FUNCTION)
   ========================================= */
async function executePointsProcess(scoreboard) {
    const matchId = matchSelect.value;

    try {
        updateStatus("🚀 Processing points & updating leaderboard...", "loading");
        finalConfirmBtn.disabled = true;

        const { data, error } = await supabase.functions.invoke('process_match_points', {
            body: { 
                match_id: matchId, 
                tournament_id: TOURNAMENT_ID,
                scoreboard: scoreboard 
            }
        });

        if (error) throw error;

        updateStatus("✅ Success! Match results finalized and rankings updated.", "success");
        reportContainer.style.display = "none";
        scoreboardInput.value = "";
        
    } catch (err) {
        updateStatus("Error: " + (err.message || "Execution failed"), "error");
        finalConfirmBtn.disabled = false;
    }
}

function updateStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = type;
    statusDiv.style.display = msg ? "block" : "none";
}

// Start
(async () => {
    const isAdmin = await checkAdminAccess();
    if (isAdmin) loadMatches();
})();