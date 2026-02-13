// 1. CONFIGURATION
const SUPABASE_URL = "https://tuvqgcosbweljslbfgqc.supabase.co";
// Double check this key in your Supabase Dashboard (Settings -> API -> service_role)
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...ZYYrXkE"; 

const matchSelect = document.getElementById("matchSelect");
const processBtn = document.getElementById("processBtn");
const scoreboardInput = document.getElementById("scoreboardInput");
const statusBox = document.getElementById("statusBox");

async function loadMatches() {
    const tournamentId = "e0416509-f082-4c11-8277-ec351bdc046d";

    try {
        console.log("Starting Database Fetch...");

        const matchRes = await fetch(`${SUPABASE_URL}/rest/v1/matches?tournament_id=eq.${tournamentId}&select=*`, {
            method: 'GET',
            mode: 'cors', // Force CORS mode
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!matchRes.ok) throw new Error(`Matches Fetch Failed: ${matchRes.statusText}`);
        const matches = await matchRes.json();

        const teamRes = await fetch(`${SUPABASE_URL}/rest/v1/real_teams?tournament_id=eq.${tournamentId}&select=id,short_code`, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!teamRes.ok) throw new Error(`Teams Fetch Failed: ${teamRes.statusText}`);
        const teams = await teamRes.json();

        const teamMap = {};
        teams.forEach(t => { teamMap[t.id] = t.short_code; });

        matchSelect.innerHTML = "";
        if (!matches.length) {
            matchSelect.innerHTML = "<option>No matches found</option>";
            return;
        }

        matches.forEach(match => {
            const option = document.createElement("option");
            option.value = match.id;
            const teamA = teamMap[match.team_a_id] || "TBA";
            const teamB = teamMap[match.team_b_id] || "TBA";
            option.textContent = `Match ${match.match_number} • ${teamA} vs ${teamB}`;
            matchSelect.appendChild(option);
        });

        console.log("Successfully Loaded Matches.");

    } catch (err) {
        console.error("Database Connection Error:", err);
        matchSelect.innerHTML = "<option>Error: Check Console (F12)</option>";
        showStatus("Connection Error: Check API Keys and Network.", "error");
    }
}

// ... (keep your existing processBtn listener and showStatus helper below)
loadMatches();
/**
 * Handles the click event to send JSON to the Edge Function
 */
processBtn.addEventListener("click", async () => {
    const matchId = matchSelect.value;
    const rawInput = scoreboardInput.value.trim();

    // Basic Validation
    if (!matchId || !rawInput) {
        showStatus("Error: Select a match and paste JSON.", "error");
        return;
    }

    try {
        showStatus("Processing points... Please wait.", "status");
        
        const scoreboardJson = JSON.parse(rawInput);

        // Call the Edge Function
        const res = await fetch(`${SUPABASE_URL}/functions/v1/process_match_points`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({
                match_id: matchId,
                scoreboard: scoreboardJson
            })
        });

        const resultText = await res.text();

        if (res.ok) {
            showStatus("✅ Success! Match points and leaderboard updated.", "success");
            scoreboardInput.value = ""; // Clear input
        } else {
            throw new Error(resultText);
        }

    } catch (err) {
        console.error("Processing Error:", err);
        showStatus("❌ Error: " + err.message, "error");
    }
});

/**
 * UI helper to show messages
 */
function showStatus(msg, type) {
    statusBox.className = ""; // Reset classes
    statusBox.classList.add(type);
    statusBox.textContent = msg;
    statusBox.style.display = "block";
}

// Initial Load
loadMatches();