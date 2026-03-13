import { supabase } from "./supabase.js";

const matchSelect = document.getElementById("matchSelect");
const newStartTimeInput = document.getElementById("newStartTime");
const resetBtn = document.getElementById("resetBtn");
const abandonBtn = document.getElementById("abandonBtn");
const statusLog = document.getElementById("statusLog");

let matchesById = new Map();

async function loadMatches() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = yesterday.toISOString();

    const { data: matches, error } = await supabase
        .from("matches")
        .select("id, tournament_id, match_number, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code), status")
        .gt("actual_start_time", yesterdayISO)
        .order("actual_start_time", { ascending: true })
        .in("status", ["upcoming", "locked"])
        .limit(20);

    if (error) {
        console.error("Fetch Error:", error);
        statusLog.innerText = "Failed to load matches.";
        return;
    }

    matchesById = new Map((matches || []).map((match) => [match.id, match]));

    if (!matches || matches.length === 0) {
        matchSelect.innerHTML = '<option value="">No active matches found for today</option>';
        return;
    }

    matchSelect.innerHTML = matches.map((match) => `
        <option value="${match.id}">
            M#${match.match_number}: ${match.team_a.short_code} vs ${match.team_b.short_code} [${match.status.toUpperCase()}]
        </option>
    `).join("");
}

async function handleAdminMatchReset() {
    const matchId = matchSelect.value;
    const localTime = newStartTimeInput.value;

    if (!matchId || !localTime) {
        return alert("Please select a match and a new time.");
    }

    const newIsoTime = new Date(localTime).toISOString();
    const confirmation = confirm(
        `Are you sure? This will:\n1. Change status to UPCOMING\n2. Set time to ${newIsoTime}\n3. Delete any locked fantasy team for this match.`
    );

    if (!confirmation) return;

    resetBtn.disabled = true;
    resetBtn.innerText = "PROCESSING...";

    const { error } = await supabase.rpc("reset_delayed_match", {
        target_match_id: matchId,
        new_start_time: newIsoTime
    });

    if (error) {
        alert("Error: " + error.message);
        console.error(error);
    } else {
        statusLog.innerText = "Match reset successfully. Editing is open again.";
        alert("Success! Locked team impact for this match was cleared.");
        await loadMatches();
    }

    resetBtn.disabled = false;
    resetBtn.innerText = "RESET & OPEN EDITING";
}

async function handleAbandonBeforeFirstBall() {
    const matchId = matchSelect.value;
    const match = matchesById.get(matchId);

    if (!matchId || !match) {
        return alert("Please select a match first.");
    }

    const confirmation = confirm(
        `Are you sure? This will mark Match ${match.match_number} as abandoned before first ball and remove any fantasy lock impact for this match.`
    );

    if (!confirmation) return;

    abandonBtn.disabled = true;
    abandonBtn.innerText = "PROCESSING...";

    const { data, error } = await supabase.functions.invoke("process_match_points", {
        body: {
            match_id: match.id,
            tournament_id: match.tournament_id,
            scoreboard: [],
            pom_id: null,
            winner_id: "abandoned"
        }
    });

    if (error || data?.error) {
        const message = error?.message || data?.error || "Failed to mark match abandoned.";
        alert("Error: " + message);
        console.error(error || data);
    } else {
        statusLog.innerText = "Match marked abandoned before first ball. No fantasy impact remains.";
        alert("Match marked abandoned successfully.");
        await loadMatches();
    }

    abandonBtn.disabled = false;
    abandonBtn.innerText = "MARK ABANDONED BEFORE FIRST BALL";
}

resetBtn.onclick = handleAdminMatchReset;
abandonBtn.onclick = handleAbandonBeforeFirstBall;
loadMatches();
