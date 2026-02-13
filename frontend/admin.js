// 1. CONFIGURATION
const SUPABASE_URL = "https://tuvqgcosbweljslbfgqc.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...ZYYrXkE"; // Ensure this is your full secret key

// 2. DOM ELEMENTS
const matchSelect = document.getElementById("matchSelect");
const processBtn = document.getElementById("processBtn");
const scoreboardInput = document.getElementById("scoreboardInput");
const statusBox = document.getElementById("statusBox");

/**
 * Loads matches and team names from the database
 * strictly using the IDs verified in our previous steps.
 */
async function loadMatches() {
    const tournamentId = "e0416509-f082-4c11-8277-ec351bdc046d";

    try {
        console.log("Fetching data for tournament:", tournamentId);

        // Fetch Matches
        const matchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/matches?tournament_id=eq.${tournamentId}&select=*&order=match_number.asc`,
            {
                headers: {
                    apikey: SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SERVICE_ROLE_KEY}`
                }
            }
        );
        const matches = await matchRes.json();

        // Fetch Teams to map names to IDs
        const teamRes = await fetch(
            `${SUPABASE_URL}/rest/v1/real_teams?tournament_id=eq.${tournamentId}&select=id,short_code`,
            {
                headers: {
                    apikey: SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SERVICE_ROLE_KEY}`
                }
            }
        );
        const teams = await teamRes.json();

        // Create a lookup map: { "team-uuid": "IND" }
        const teamMap = {};
        teams.forEach(t => { teamMap[t.id] = t.short_code; });

        // Clear dropdown
        matchSelect.innerHTML = "";

        if (!matches || matches.length === 0) {
            matchSelect.innerHTML = "<option>No matches found in database</option>";
            return;
        }

        // Populate dropdown
        matches.forEach(match => {
            const option = document.createElement("option");
            option.value = match.id;

            const teamA = teamMap[match.team_a_id] || "Unknown";
            const teamB = teamMap[match.team_b_id] || "Unknown";
            
            // Result: "Match 13 • IND vs NAM • Ahmedabad"
            option.textContent = `Match ${match.match_number} • ${teamA} vs ${teamB} • ${match.venue}`;
            matchSelect.appendChild(option);
        });

    } catch (err) {
        console.error("Initialization Error:", err);
        matchSelect.innerHTML = "<option>Error connecting to database</option>";
    }
}

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