const SUPABASE_URL = "https://tuvqgcosbweljslbfgqc.supabase.co";
const SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"; // Ensure this is your secret key

const matchSelect = document.getElementById("matchSelect");
const processBtn = document.getElementById("processBtn");
const scoreboardInput = document.getElementById("scoreboardInput");
const statusBox = document.getElementById("statusBox");

// Load matches from the database to populate the dropdown
async function loadMatches() {
  const tournamentId = "e0416509-f082-4c11-8277-ec351bdc046d"; 
  
  // Querying matches and joining with real_teams to get short_codes
  const query = `tournament_id=eq.${tournamentId}&select=id,match_number,venue,team_a:real_teams!team_a_id(short_code),team_b:real_teams!team_b_id(short_code)`;
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/matches?${query}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  const matches = await res.json();
  matchSelect.innerHTML = "";

  if (!matches.length) {
    matchSelect.innerHTML = "<option>No matches found</option>";
    return;
  }

  matches.forEach(match => {
    const option = document.createElement("option");
    option.value = match.id;
    // Format: Match 19 • AUS vs ZIM • Venue
    const teamA = match.team_a?.short_code || "TBA";
    const teamB = match.team_b?.short_code || "TBA";
    option.textContent = `Match ${match.match_number} • ${teamA} vs ${teamB} • ${match.venue}`;
    matchSelect.appendChild(option);
  });
}

processBtn.addEventListener("click", async () => {
  const matchId = matchSelect.value;
  const rawInput = scoreboardInput.value.trim();

  if (!matchId || !rawInput) return alert("Select match and paste JSON.");

  statusBox.classList.remove("hidden");
  statusBox.textContent = "Processing...";

  try {
    const scoreboardJson = JSON.parse(rawInput);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/process_match_points`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ match_id: matchId, scoreboard: scoreboardJson })
    });

    if (res.ok) {
      statusBox.textContent = "Match processed successfully.";
      scoreboardInput.value = "";
    } else {
      const err = await res.text();
      throw new Error(err);
    }
  } catch (err) {
    statusBox.textContent = "Error: " + err.message;
  }
});

loadMatches();