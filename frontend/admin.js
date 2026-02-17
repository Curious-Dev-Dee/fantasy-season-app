import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const ADMIN_EMAIL = "satyara9jansahoo@gmail.com"; 

const matchSelect = document.getElementById("matchSelect");
const scoreboardInput = document.getElementById("scoreboardInput");
const processBtn = document.getElementById("processBtn");
const reportContainer = document.getElementById("reportContainer");
const finalConfirmBtn = document.getElementById("finalConfirmBtn");
const statusDiv = document.getElementById("status");
const pomSelect = document.getElementById("pomSelect");

async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        window.location.href = "home.html";
        return;
    }
    loadMatches();
}

async function loadMatches() {
    const { data: matches } = await supabase.from('matches').select('*').eq('tournament_id', TOURNAMENT_ID).order('match_number');
    const { data: teams } = await supabase.from('real_teams').select('id, short_code');
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));
    matchSelect.innerHTML = matches.map(m => `<option value="${m.id}">M#${m.match_number}: ${teamMap[m.team_a_id]} vs ${teamMap[m.team_b_id]}</option>`).join('');
}

processBtn.addEventListener("click", async () => {
    const jsonStr = scoreboardInput.value.trim();
    if (!jsonStr) return alert("Paste JSON");

    try {
        const rawData = JSON.parse(jsonStr);
        let playersMap = {};
        const scorecardArray = Array.isArray(rawData) ? rawData : (rawData.data?.scorecard || []);

        scorecardArray.forEach(inning => {
            ["batting", "bowling", "catching"].forEach(key => {
                if (inning[key]) {
                    inning[key].forEach(p => {
                        const name = p.batsman?.name || p.bowler?.name || p.catcher?.name || p.player_name;
                        if (name) {
                            playersMap[name] = {
                                player_name: name,
                                ...playersMap[name],
                                ...p,
                                catches: (playersMap[name]?.catches || 0) + (p.catch || 0),
                                stumpings: (playersMap[name]?.stumpings || 0) + (p.stumped || 0)
                            };
                        }
                    });
                }
            });
        });

        const scoreboard = Object.values(playersMap);
        const { data: match } = await supabase.from('matches').select('team_a_id, team_b_id').eq('id', matchSelect.value).single();
        const { data: dbPlayers } = await supabase.from('players').select('id, name').in('real_team_id', [match.team_a_id, match.team_b_id]);
        const dbPlayerMap = Object.fromEntries(dbPlayers.map(p => [p.name.trim().toLowerCase(), p.id]));

        const fixedScoreboard = scoreboard.map(p => ({
            ...p,
            player_id: dbPlayerMap[p.player_name?.trim().toLowerCase()] || null
        }));

        const missing = fixedScoreboard.filter(p => !p.player_id).map(p => p.player_name);
        reportContainer.style.display = "block";
        document.getElementById("reportStats").innerHTML = `Matched: ${fixedScoreboard.length - missing.length} | Missing: ${missing.length}`;
        
        if (missing.length > 0) {
            document.getElementById("missingWrapper").style.display = "block";
            document.getElementById("successWrapper").style.display = "none";
            document.getElementById("missingList").innerHTML = missing.map(n => `<li>${n}</li>`).join('');
        } else {
            document.getElementById("missingWrapper").style.display = "none";
            document.getElementById("successWrapper").style.display = "block";
            pomSelect.innerHTML = fixedScoreboard.map(p => `<option value="${p.player_id}">${p.player_name}</option>`).join('');
            finalConfirmBtn.onclick = () => executeUpdate(fixedScoreboard);
        }
    } catch (e) { alert(e.message); }
});

async function executeUpdate(fixedScoreboard) {
    updateStatus("Processing points...", "loading");
    try {
        const { error } = await supabase.functions.invoke('process_match_points', {
            body: { 
                match_id: matchSelect.value, 
                tournament_id: TOURNAMENT_ID, 
                scoreboard: fixedScoreboard, 
                pom_id: pomSelect.value 
            }
        });
        if (error) throw error;
        updateStatus("✅ Points and Leaderboard Updated!", "success");
    } catch (err) { updateStatus(`❌ Error: ${err.message}`, "error"); }
}

function updateStatus(m, t) { statusDiv.textContent = m; statusDiv.className = t; statusDiv.style.display = "block"; }
init();