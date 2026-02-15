import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const ADMIN_EMAIL = "your-email@gmail.com"; // 👈 DOUBLE CHECK THIS

// DOM Elements
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
    try {
        const { data: matches } = await supabase.from('matches').select('*').eq('tournament_id', TOURNAMENT_ID).order('match_number');
        const { data: teams } = await supabase.from('real_teams').select('id, short_code');
        const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

        matchSelect.innerHTML = matches.map(m => `
            <option value="${m.id}">Match ${m.match_number}: ${teamMap[m.team_a_id]} vs ${teamMap[m.team_b_id]}</option>
        `).join('');
    } catch (e) { console.error("Match load failed", e); }
}

/* =========================================
   STAGE 1: THE SMART ANALYZER (TYPO HUNTER)
   ========================================= */
processBtn.addEventListener("click", async () => {
    const jsonStr = scoreboardInput.value.trim();
    if (!jsonStr) return alert("Paste JSON first");

    try {
        let rawData = JSON.parse(jsonStr);
        let scoreboard = [];

        // 🛠️ SMART DETECTOR: Flattens raw CricAPI response automatically
        if (rawData.data && rawData.data.scorecard) {
            console.log("CricAPI Format Detected. Flattening...");
            const playersMap = {};

            rawData.data.scorecard.forEach(inning => {
                // Extract Batsmen
                inning.batting.forEach(b => {
                    const name = b.batsman.name;
                    playersMap[name] = { 
                        player_name: name, 
                        runs: b.r || 0, 
                        balls: b.b || 0, 
                        fours: b["4s"] || 0, 
                        sixes: b["6s"] || 0,
                        is_out: b["dismissal-text"] !== "not out"
                    };
                });
                // Extract Bowlers
                inning.bowling.forEach(bw => {
                    const name = bw.bowler.name;
                    if (!playersMap[name]) playersMap[name] = { player_name: name };
                    playersMap[name].wickets = bw.w || 0;
                    playersMap[name].maidens = bw.m || 0;
                    playersMap[name].overs = bw.o || 0;
                    playersMap[name].runs_conceded = bw.r || 0;
                });
            });
            scoreboard = Object.values(playersMap);
        } else if (Array.isArray(rawData)) {
            scoreboard = rawData; // Already in flat format
        } else {
            throw new Error("Format not recognized. Use a list or raw CricAPI data.");
        }

        const scoreboardNames = scoreboard.map(p => p.player_name.trim());

        // Cross-reference names with Database
        const { data: match } = await supabase.from('matches').select('team_a_id, team_b_id').eq('id', matchSelect.value).single();
        const { data: dbPlayers } = await supabase.from('players').select('name').in('team_id', [match.team_a_id, match.team_b_id]);
        const dbNames = dbPlayers.map(p => p.name.trim());

        // Find Typos/Missing Players
        const missing = scoreboardNames.filter(name => !dbNames.includes(name));

        // Update Report UI
        reportContainer.style.display = "block";
        document.getElementById("reportStats").innerHTML = `
            <span>Matched: <strong>${scoreboardNames.length - missing.length}</strong></span>
            <span style="margin-left:20px;">Missing: <strong style="color:red">${missing.length}</strong></span>
        `;
        
        if (missing.length > 0) {
            document.getElementById("missingWrapper").style.display = "block";
            document.getElementById("successWrapper").style.display = "none";
            document.getElementById("missingList").innerHTML = missing.map(n => `<li>${n}</li>`).join('');
            finalConfirmBtn.style.display = "none";
            updateStatus("⚠️ Fix typos in JSON names and click Analyze again.", "error");
        } else {
            document.getElementById("missingWrapper").style.display = "none";
            document.getElementById("successWrapper").style.display = "block";
            finalConfirmBtn.style.display = "block";
            updateStatus("✨ Data verified. Ready to process.", "success");
            
            // Link the finalized scoreboard to the confirm button
            finalConfirmBtn.onclick = () => executeUpdate(scoreboard);
        }
    } catch (e) { 
        console.error(e);
        alert("Error: " + e.message); 
    }
});

/* =========================================
   STAGE 2: EXECUTE (INVOKE EDGE FUNCTION)
   ========================================= */
async function executeUpdate(scoreboard) {
    statusDiv.className = "status loading";
    statusDiv.textContent = "🚀 Processing points and updating rankings...";
    statusDiv.style.display = "block";
    finalConfirmBtn.disabled = true;

    try {
        const { data, error } = await supabase.functions.invoke('process_match_points', {
            body: { 
                match_id: matchSelect.value, 
                tournament_id: TOURNAMENT_ID, 
                scoreboard: scoreboard 
            }
        });

        if (error) throw error;

        statusDiv.className = "status success";
        statusDiv.textContent = "✅ Success! Leaderboard and stats updated.";
        scoreboardInput.value = "";
        reportContainer.style.display = "none";
        
    } catch (err) {
        statusDiv.className = "status error";
        statusDiv.textContent = "Error: " + (err.message || "Failed to process");
    } finally {
        finalConfirmBtn.disabled = false;
    }
}

function updateStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = msg ? "block" : "none";
}

init();