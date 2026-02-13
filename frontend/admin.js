const SUPABASE_URL = "https://tuvqgcosbweljslbfgqc.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY1OTI1OCwiZXhwIjoyMDg2MjM1MjU4fQ.ZqeBiAlM9dem6bn-TM3hDrw1tSb7xSp_rAK6zYYrXkE";

const matchSelect = document.getElementById("matchSelect");
const processBtn = document.getElementById("processBtn");
const scoreboardInput = document.getElementById("scoreboardInput");
const statusBox = document.getElementById("statusBox");

// Load locked & unprocessed matches
async function loadMatches() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?status=eq.locked&points_processed=eq.false`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`
      }
    }
  );

  const matches = await res.json();

  matchSelect.innerHTML = "";

  if (!matches.length) {
    const option = document.createElement("option");
    option.textContent = "No eligible matches";
    matchSelect.appendChild(option);
    return;
  }

  matches.forEach(match => {
    const option = document.createElement("option");
    option.value = match.id;
    option.textContent = `Match ${match.match_number} • ${match.venue}`;
    matchSelect.appendChild(option);
  });
}

processBtn.addEventListener("click", async () => {
  try {
    statusBox.classList.remove("hidden", "success", "error");
    statusBox.textContent = "Processing...";
    statusBox.classList.add("status");

    const matchId = matchSelect.value;
    const scoreboardJson = JSON.parse(scoreboardInput.value);

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

    const result = await res.text();

    if (res.ok) {
      statusBox.classList.add("success");
      statusBox.textContent = "Match processed successfully.";
      loadMatches();
    } else {
      throw new Error(result);
    }

  } catch (err) {
    statusBox.classList.add("error");
    statusBox.textContent = "Error: " + err.message;
  }
});

loadMatches();
