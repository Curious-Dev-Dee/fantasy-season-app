import { supabase } from "./supabase.js";

const matchSelect = document.getElementById("matchSelect");
const newStartTimeInput = document.getElementById("newStartTime");
const resetBtn = document.getElementById("resetBtn");
const statusLog = document.getElementById("statusLog");

// 1. Load locked or soon-to-start matches
async function loadMatches() {
    const { data: matches, error } = await supabase
        .from("matches")
        .select("id, match_number, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code), status")
        .order("actual_start_time", { ascending: false })
        .limit(10);

    if (error) return console.error(error);

    matchSelect.innerHTML = matches.map(m => `
        <option value="${m.id}">
            M#${m.match_number}: ${m.team_a.short_code} vs ${m.team_b.short_code} (${m.status.toUpperCase()})
        </option>
    `).join("");
}

// 2. The Reset Logic
async function handleAdminMatchReset() {
    const matchId = matchSelect.value;
    const localTime = newStartTimeInput.value;

    if (!matchId || !localTime) {
        return alert("Please select a match and a new time.");
    }

    // Convert local input time to ISO (UTC) for Supabase
    const newIsoTime = new Date(localTime).toISOString();

    const confirmation = confirm(`Are you sure? This will:\n1. Change status to UPCOMING\n2. Set time to ${newIsoTime}\n3. DELETE all locked teams for this match.`);
    
    if (!confirmation) return;

    resetBtn.disabled = true;
    resetBtn.innerText = "PROCESSING...";

    const { error } = await supabase.rpc('reset_delayed_match', {
        target_match_id: matchId,
        new_start_time: newIsoTime
    });

    if (error) {
        alert("Error: " + error.message);
        console.error(error);
    } else {
        statusLog.innerText = "✅ Match reset successfully. Editing is now open.";
        alert("Success! Substitution history for this match has been wiped.");
    }

    resetBtn.disabled = false;
    resetBtn.innerText = "RESET MATCH & OPEN EDITING";
}

resetBtn.onclick = handleAdminMatchReset;
loadMatches();