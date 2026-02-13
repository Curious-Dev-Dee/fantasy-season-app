// CONFIGURATION
const SUPABASE_URL = "https://tuvqgcosbweljslbfgqc.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY1OTI1OCwiZXhwIjoyMDg2MjM1MjU4fQ.ZqeBiAlM9dem6bn-TM3hDrw1tSb7xSp_rAK6zYYrXkE"; 
const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

const matchSelect = document.getElementById("matchSelect");
const processBtn = document.getElementById("processBtn");
const scoreboardInput = document.getElementById("scoreboardInput");
const statusDiv = document.getElementById("status");

/**
 * Loads matches and maps team names for the dropdown
 */
async function loadMatches() {
    try {
        updateStatus("Fetching matches...", "loading");

        // 1. Fetch Matches
        const matchRes = await fetch(`${SUPABASE_URL}/rest/v1/matches?tournament_id=eq.${TOURNAMENT_ID}&select=*&order=match_number.asc`, {
            headers: { 'apikey': SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` }
        });
        if (!matchRes.ok) throw new Error("Failed to load matches");
        const matches = await matchRes.json();

        // 2. Fetch Teams (to show short codes like 'IND' instead of UUIDs)
        const teamRes = await fetch(`${SUPABASE_URL}/rest/v1/real_teams?tournament_id=eq.${TOURNAMENT_ID}&select=id,short_code`, {
            headers: { 'apikey': SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` }
        });
        const teams = await teamRes.json();
        const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

        // 3. Populate Select
        matchSelect.innerHTML = matches.length 
            ? matches.map(m => `<option value="${m.id}">Match ${m.match_number}: ${teamMap[m.team_a_id] || 'TBA'} vs ${teamMap[m.team_b_id] || 'TBA'} (${m.venue})</option>`).join('')
            : '<option value="">No matches found</option>';

        updateStatus("", ""); // Clear loading status
    } catch (err) {
        console.error(err);
        updateStatus("Connection Error: Check console for details.", "error");
    }
}

/**
 * Sends data to Supabase Edge Function
 */
processBtn.addEventListener("click", async () => {
    const matchId = matchSelect.value;
    const jsonStr = scoreboardInput.value.trim();

    if (!matchId || !jsonStr) {
        return updateStatus("Please select a match and paste JSON.", "error");
    }

    try {
        updateStatus("Processing match data... Please wait.", "loading");
        processBtn.disabled = true;

        const scoreboard = JSON.parse(jsonStr);

        const res = await fetch(`${SUPABASE_URL}/functions/v1/process_match_points`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ match_id: matchId, scoreboard: scoreboard })
        });

        const result = await res.json();

        if (res.ok) {
            updateStatus("✅ Success! Player stats and user points updated.", "success");
            scoreboardInput.value = ""; 
        } else {
            throw new Error(result.error || "Processing failed");
        }
    } catch (err) {
        updateStatus("Error: " + err.message, "error");
    } finally {
        processBtn.disabled = false;
    }
});

function updateStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = type;
    statusDiv.style.display = msg ? "block" : "none";
}

// Initial Load
loadMatches();