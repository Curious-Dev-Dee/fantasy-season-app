import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const ADMIN_EMAIL = "satyara9jansahoo@gmail.com"; 

// --- DOM ELEMENTS ---
const matchSelect = document.getElementById("matchSelect");
const scoreboardInput = document.getElementById("scoreboardInput");
const processBtn = document.getElementById("processBtn");
const reportContainer = document.getElementById("reportContainer");
const finalConfirmBtn = document.getElementById("finalConfirmBtn");
const statusDiv = document.getElementById("status");
const pomSelect = document.getElementById("pomSelect");

const delayMatchSelect = document.getElementById("delayMatchSelect");
const delayStatus = document.getElementById("delayStatus");
const customTimeInput = document.getElementById("customTimeInput");
const setCustomTimeBtn = document.getElementById("setCustomTimeBtn");
const forceNowBtn = document.getElementById("forceNowBtn");
const abandonBtn = document.getElementById("abandonBtn");

/**
 * 1. AUTH & INIT
 */
async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        alert("Authorized Admin Access Only.");
        window.location.href = "home.html";
        return;
    }
    console.log("✅ Admin verified.");
    await Promise.all([loadMatches(), loadDelayMatches()]);
}

/**
 * 2. DATA LOADING
 */
async function loadMatches() {
    const { data: matches } = await supabase.from('matches')
        .select('*').eq('tournament_id', TOURNAMENT_ID).order('match_number');
    const { data: teams } = await supabase.from('real_teams').select('id, short_code');
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t.short_code]));

    matchSelect.innerHTML = matches.map(m => `
        <option value="${m.id}">M#${m.match_number}: ${teamMap[m.team_a_id]} vs ${teamMap[m.team_b_id]}</option>
    `).join('');
}

async function loadDelayMatches() {
    const { data: matches } = await supabase.from('matches')
        .select('id, match_number, actual_start_time')
        .eq('tournament_id', TOURNAMENT_ID)
        .eq('lock_processed', false)
        .order('match_number');

    if (matches) {
        delayMatchSelect.innerHTML = matches.map(m => `
            <option value="${m.id}">Match ${m.match_number} (Now: ${new Date(m.actual_start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})</option>
        `).join('');
    }
}

/**
 * 3. DELAY & LOCK LOGIC
 */
async function updateMatchState(matchId, updates, label) {
    updateDelayStatus(`Updating: ${label}...`, "loading");
    try {
        const { data, error } = await supabase.from('matches').update(updates).eq('id', matchId).select();
        if (error) throw error;
        updateDelayStatus(`✅ Success! ${label}`, "success");
        await loadDelayMatches();
    } catch (err) {
        updateDelayStatus(`❌ Error: ${err.message}`, "error");
    }
}

document.querySelectorAll('.delay-btn').forEach(btn => {
    if (btn.id === "abandonBtn" || btn.id === "forceNowBtn") return;
    btn.addEventListener('click', async () => {
        const matchId = delayMatchSelect.value;
        const mins = parseInt(btn.getAttribute('data-mins'));
        const { data } = await supabase.from('matches').select('actual_start_time').eq('id', matchId).single();
        const newTime = new Date(new Date(data.actual_start_time).getTime() + (mins * 60000));
        await updateMatchState(matchId, { actual_start_time: newTime.toISOString() }, `+${mins}m Delay`);
    });
});

forceNowBtn.addEventListener('click', async () => {
    const matchId = delayMatchSelect.value;
    if (confirm("FORCE LOCK? The Edge function will process this in 60s.")) {
        const pastTime = new Date(Date.now() - 5000).toISOString();
        await updateMatchState(matchId, { actual_start_time: pastTime, status: 'upcoming' }, "Triggering Lock...");
    }
});

abandonBtn.addEventListener('click', async () => {
    const matchId = delayMatchSelect.value;
    if (confirm("🚨 ABANDON MATCH? No subs will be charged.")) {
        await updateMatchState(matchId, { status: 'abandoned', lock_processed: true, locked_at: new Date().toISOString() }, "Match Abandoned");
    }
});

/**
 * 4. POINTS PROCESSING (Typo Hunter)
 */
processBtn.addEventListener("click", async () => {
    const jsonStr = scoreboardInput.value.trim();
    if (!jsonStr) return alert("Paste JSON");

    try {
        const rawData = JSON.parse(jsonStr);
        let playersMap = {};
        const scorecardArray = Array.isArray(rawData) ? rawData : (rawData.data?.scorecard || []);

        // Flatten data and handle merge
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

        // Create the FIXED payload with IDs
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
            
            // Critical: Pass the fixed list to execute
            finalConfirmBtn.onclick = () => executeUpdate(fixedScoreboard, matchSelect.value);
        }
    } catch (e) { alert("JSON Error: " + e.message); }
});

async function executeUpdate(fixedScoreboard, matchId) {
    updateStatus("Processing points...", "loading");
    try {
        const { error } = await supabase.functions.invoke('process_match_points', {
            body: { 
                match_id: matchId, 
                tournament_id: TOURNAMENT_ID, 
                scoreboard: fixedScoreboard, 
                pom_id: pomSelect.value 
            }
        });
        if (error) throw error;
        updateStatus("✅ Points and Leaderboard Updated!", "success");
        reportContainer.style.display = "none";
        scoreboardInput.value = "";
    } catch (err) { updateStatus(`❌ Error: ${err.message}`, "error"); }
}

function updateStatus(m, t) { statusDiv.textContent = m; statusDiv.className = t; statusDiv.style.display = "block"; }
function updateDelayStatus(m, t) { delayStatus.textContent = m; delayStatus.className = t; delayStatus.style.display = "block"; }

init();