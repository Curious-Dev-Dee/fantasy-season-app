import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const ADMIN_EMAIL = "satyara9jansahoo@gmail.com"; 

// DOM Elements
const matchSelect = document.getElementById("matchSelect");
const scoreboardInput = document.getElementById("scoreboardInput");
const processBtn = document.getElementById("processBtn");
const reportContainer = document.getElementById("reportContainer");
const finalConfirmBtn = document.getElementById("finalConfirmBtn");
const statusDiv = document.getElementById("status");
const winnerSelect = document.getElementById("winnerSelect");
const pomSelect = document.getElementById("pomSelect");


/**
 * 1. INITIALIZATION & AUTH
 */
async function init() {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
        alert("Please log in first.");
        window.location.href = "login.html";
        return;
    }

    const loggedInEmail = user.email.trim().toLowerCase();
    const authorizedEmail = ADMIN_EMAIL.trim().toLowerCase();

    if (loggedInEmail !== authorizedEmail) {
        alert(`Access Denied: ${user.email} is not authorized.`);
        window.location.href = "home.html";
        return;
    }

    console.log("✅ Admin verified. Loading matches...");
    loadMatches();
}

async function loadMatches() {
    try {
        const { data: matches } = await supabase
            .from('matches')
            .select('*')
            .eq('tournament_id', TOURNAMENT_ID)
            .order('match_number');
            
        const { data: teams } = await supabase
            .from('real_teams')
            .select('id, short_code');
            
        const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

        matchSelect.innerHTML = matches.map(m => `
            <option value="${m.id}">Match ${m.match_number}: ${teamMap[m.team_a_id] || 'TBA'} vs ${teamMap[m.team_b_id] || 'TBA'}</option>
        `).join('');
    } catch (e) { 
        console.error("Match load failed", e); 
    }
}

/**
 * 2. STAGE 1: ANALYZE & TYPO HUNTER
 */
processBtn.addEventListener("click", async () => {
    const jsonStr = scoreboardInput.value.trim();
    if (!jsonStr) return alert("Paste JSON first");

    try {
        let rawData = JSON.parse(jsonStr);
        let scoreboard = [];

        if (rawData && rawData.data && rawData.data.scorecard) {
            const playersMap = {};
            rawData.data.scorecard.forEach(inning => {
                if (inning.batting) {
                    inning.batting.forEach(b => {
                        const name = b.batsman?.name;
                        if (name) {
                            playersMap[name] = { 
                                ...playersMap[name],
                                player_name: name, 
                                runs: b.r || 0, 
                                balls: b.b || 0, 
                                fours: b["4s"] || 0, 
                                sixes: b["6s"] || 0,
                                is_out: b["dismissal-text"] !== "not out"
                            };
                        }
                    });
                }
                if (inning.bowling) {
                    inning.bowling.forEach(bw => {
                        const name = bw.bowler?.name;
                        if (name) {
                            playersMap[name] = {
                                ...playersMap[name],
                                player_name: name,
                                wickets: bw.w || 0,
                                maidens: bw.m || 0,
                                overs: bw.o || 0,
                                runs_conceded: bw.r || 0
                            };
                        }
                    });
                }
                if (inning.catching) {
                    inning.catching.forEach(c => {
                        const name = c.catcher?.name;
                        if (name) {
                            playersMap[name] = {
                                ...playersMap[name],
                                player_name: name,
                                catches: (playersMap[name]?.catches || 0) + (c.catch || 0),
                                stumpings: (playersMap[name]?.stumpings || 0) + (c.stumped || 0),
                                runouts_direct: (playersMap[name]?.runouts_direct || 0) + (c.runout || 0)
                            };
                        }
                    });
                }
            });
            scoreboard = Object.values(playersMap);
        } else if (Array.isArray(rawData)) {
            scoreboard = rawData; 
        } else {
            throw new Error("Format not recognized.");
        }

        if (!scoreboard.length) throw new Error("No player data found in JSON.");

        // --- TYPO HUNTER ---
        const { data: match } = await supabase
            .from('matches')
            .select('team_a_id, team_b_id')
            .eq('id', matchSelect.value)
            .single();

        const { data: dbPlayers } = await supabase
            .from('players')
            .select('id, name')
            .in('real_team_id', [match.team_a_id, match.team_b_id]);
        
        const dbPlayerMap = Object.fromEntries((dbPlayers || []).map(p => [p.name.trim().toLowerCase(), p.id]));
        const dbNames = Object.keys(dbPlayerMap);

        const scoreboardWithIds = scoreboard.map(p => ({
            ...p,
            player_id: dbPlayerMap[p.player_name.trim().toLowerCase()] || null
        }));

        const missing = scoreboardWithIds.filter(p => !p.player_id).map(p => p.player_name);

        reportContainer.style.display = "block";
        document.getElementById("reportStats").innerHTML = `
            <span>Matched: <strong>${scoreboardWithIds.length - missing.length}</strong></span>
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

            updateStatus("✨ Data verified. Select Winner and POM.", "success");  
            
            // NEW: Populate Winner Dropdown (Team A and Team B)
        const { data: mData } = await supabase.from('matches').select('team_a:real_teams!team_a_id(id, short_code), team_b:real_teams!team_b_id(id, short_code)').eq('id', matchSelect.value).single();

        winnerSelect.innerHTML = `
        <option value="">-- Select Winner --</option>
        <option value="${mData.team_a.id}">${mData.team_a.short_code}</option>
        <option value="${mData.team_b.id}">${mData.team_b.short_code}</option>
        <option value="abandoned">Match Abandoned/No Result</option>`;

            // Populate POM Dropdown
            pomSelect.innerHTML = `<option value="">-- Select POM --</option>` + 
                scoreboardWithIds.map(p => `<option value="${p.player_id}">${p.player_name}</option>`).join('');

            finalConfirmBtn.onclick = () => executeUpdate(scoreboardWithIds);
        }
    } catch (e) { 
        console.error(e);
        alert("Error: " + e.message); 
    }
});

/**
 * 3. STAGE 2: EXECUTE UPDATE
 */
async function executeUpdate(scoreboard) {
    const pomId = pomSelect.value;
    const winnerId = winnerSelect.value; // NEW

    if (!pomId || !winnerId) return alert("Please select both Match Winner and POM!");

    updateStatus("🚀 Processing points and updating predictions...", "loading");
    finalConfirmBtn.disabled = true;

    try {
        const { data, error } = await supabase.functions.invoke('process_match_points', {
            body: { 
                match_id: matchSelect.value, 
                tournament_id: TOURNAMENT_ID, 
                scoreboard: scoreboard,
                pom_id: pomId,
                winner_id: winnerId // NEW: Send this to Edge Function
            }
        });
        // ... rest of your existing logic

        if (error) throw error;

        updateStatus("✅ Success! Match points, Leaderboard updated and Prediction updated.", "success");
        scoreboardInput.value = "";
        reportContainer.style.display = "none";
        
    } catch (err) {
        updateStatus("Error: " + (err.message || "Failed to process"), "error");
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