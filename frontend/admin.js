import { supabase } from "./supabase.js";

const matchSelect = document.getElementById("matchSelect");
const scoreboardInput = document.getElementById("scoreboardInput");
const processBtn = document.getElementById("processBtn");
const reportContainer = document.getElementById("reportContainer");
const reportStats = document.getElementById("reportStats");
const missingWrapper = document.getElementById("missingWrapper");
const missingList = document.getElementById("missingList");
const successWrapper = document.getElementById("successWrapper");
const winnerSelect = document.getElementById("winnerSelect");
const pomSelect = document.getElementById("pomSelect");
const finalConfirmBtn = document.getElementById("finalConfirmBtn");
const statusEl = document.getElementById("status");

let activeTournamentId = null;
let activePlayers = [];
let matchesById = new Map();
let pendingAnalysis = null;

init();

async function init() {
    try {
        setStatus("Loading processor...", "loading");

        const { data: activeTournament, error: tournamentError } = await supabase
            .from("active_tournament")
            .select("*")
            .maybeSingle();

        if (tournamentError) throw tournamentError;
        if (!activeTournament) throw new Error("No active tournament found.");

        activeTournamentId = activeTournament.id;

        await Promise.all([loadPlayers(), loadMatches()]);
        setupListeners();
        resetAnalysisUI();
        setStatus("Ready. Select a match and paste scoreboard JSON.", "success");
    } catch (err) {
        console.error("Admin init failed:", err);
        setStatus(err.message || "Failed to load processor.", "error");
    }
}

function setupListeners() {
    processBtn.onclick = analyzeScoreboard;
    finalConfirmBtn.onclick = submitProcessing;

    matchSelect.onchange = () => {
        resetAnalysisUI();
        populateWinnerOptions();
    };

    scoreboardInput.addEventListener("input", () => {
        pendingAnalysis = null;
        resetAnalysisUI(false);
    });

    winnerSelect.onchange = () => {
        const isAbandoned = winnerSelect.value === "abandoned";
        pomSelect.disabled = isAbandoned;
        if (isAbandoned) pomSelect.value = "";
        updateConfirmButton();
    };

    pomSelect.onchange = updateConfirmButton;
}

async function loadPlayers() {
    const { data, error } = await supabase
        .from("players")
        .select("id, name")
        .eq("is_active", true);

    if (error) throw error;
    activePlayers = data || [];
}

async function loadMatches() {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
        .from("matches")
        .select(`
            id,
            tournament_id,
            match_number,
            status,
            points_processed,
            actual_start_time,
            team_a_id,
            team_b_id,
            team_a:real_teams!team_a_id(short_code),
            team_b:real_teams!team_b_id(short_code)
        `)
        .eq("tournament_id", activeTournamentId)
        .lte("actual_start_time", nowIso)
        .order("actual_start_time", { ascending: false });

    if (error) throw error;

    const matches = data || [];
    matchesById = new Map(matches.map((match) => [match.id, match]));

    if (matches.length === 0) {
        matchSelect.innerHTML = `<option value="">No matches waiting for processing</option>`;
        matchSelect.disabled = true;
        return;
    }

    matchSelect.disabled = false;
    matchSelect.innerHTML = [
        `<option value="">-- Choose Match --</option>`,
        ...matches.map((match) => {
            const left = match.team_a?.short_code || "TBA";
            const right = match.team_b?.short_code || "TBA";
            const processedTag = match.points_processed ? "PROCESSED" : "PENDING";
            return `<option value="${match.id}">M#${match.match_number}: ${left} vs ${right} [${match.status.toUpperCase()} | ${processedTag}]</option>`;
        })
    ].join("");
}

function analyzeScoreboard() {
    try {
        const match = getSelectedMatch();
        if (!match) throw new Error("Please select a match first.");

        const scoreboard = parseScoreboard(scoreboardInput.value);
        if (scoreboard.length === 0) throw new Error("Scoreboard JSON is empty.");

        const playerLookup = new Map(
            activePlayers.map((player) => [normalizeName(player.name), player])
        );

        const missingNames = [];
        const matchedPlayers = [];
        const seenPlayerIds = new Set();

        scoreboard.forEach((row, index) => {
            if (typeof row !== "object" || row === null) {
                throw new Error(`Scoreboard row ${index + 1} must be an object.`);
            }

            if (typeof row.player_name !== "string" || !normalizeName(row.player_name)) {
                throw new Error(`Scoreboard row ${index + 1} is missing player_name.`);
            }

            const normalized = normalizeName(row.player_name);
            const matched = playerLookup.get(normalized);

            if (!matched) {
                missingNames.push(row.player_name.trim());
                return;
            }

            if (!seenPlayerIds.has(matched.id)) {
                seenPlayerIds.add(matched.id);
                matchedPlayers.push({ id: matched.id, name: matched.name });
            }
        });

        renderReport({
            totalRows: scoreboard.length,
            uniquePlayers: seenPlayerIds.size + new Set(missingNames.map(normalizeName)).size,
            matchedPlayers,
            missingNames
        });

        pendingAnalysis = missingNames.length === 0
            ? { matchId: match.id, tournamentId: match.tournament_id, scoreboard, matchedPlayers }
            : null;

        populateWinnerOptions(match);
        populatePomOptions(matchedPlayers);

        if (missingNames.length > 0) {
            setStatus("Name mismatch found. Fix the JSON and run the check again.", "error");
        } else {
            setStatus("All player names matched. Select winner and player of the match to continue.", "success");
        }

        updateConfirmButton();
    } catch (err) {
        console.error("Analysis failed:", err);
        pendingAnalysis = null;
        resetAnalysisUI(false);
        setStatus(err.message || "Invalid scoreboard JSON.", "error");
    }
}

async function submitProcessing() {
    if (!pendingAnalysis) {
        setStatus("Run the name check before processing.", "error");
        return;
    }

    const winnerId = winnerSelect.value;
    const pomId = winnerId === "abandoned" ? null : pomSelect.value;

    if (!winnerId) {
        setStatus("Please select the match winner.", "error");
        return;
    }

    if (winnerId !== "abandoned" && !pomId) {
        setStatus("Please select the player of the match.", "error");
        return;
    }

    processBtn.disabled = true;
    finalConfirmBtn.disabled = true;
    finalConfirmBtn.textContent = "PROCESSING...";
    setStatus("Processing points...", "loading");

    try {
        const { data, error } = await supabase.functions.invoke("process_match_points", {
            body: {
                match_id: pendingAnalysis.matchId,
                tournament_id: pendingAnalysis.tournamentId,
                scoreboard: pendingAnalysis.scoreboard,
                pom_id: pomId,
                winner_id: winnerId
            }
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        setStatus("Points processed successfully. Leaderboard updated.", "success");
        scoreboardInput.value = "";
        pendingAnalysis = null;
        resetAnalysisUI();
        await loadMatches();
    } catch (err) {
        console.error("Processing failed:", err);
        setStatus(err.message || "Failed to process points.", "error");
    } finally {
        processBtn.disabled = false;
        finalConfirmBtn.disabled = false;
        finalConfirmBtn.textContent = "Confirm & Process Points";
        updateConfirmButton();
    }
}

function renderReport({ totalRows, uniquePlayers, matchedPlayers, missingNames }) {
    reportContainer.style.display = "block";
    reportStats.innerHTML = `
        <div><strong>Rows:</strong> ${totalRows}</div>
        <div><strong>Unique Names:</strong> ${uniquePlayers}</div>
        <div><strong>Matched:</strong> ${matchedPlayers.length}</div>
        <div><strong>Missing:</strong> ${missingNames.length}</div>
    `;

    const uniqueMissing = [...new Set(missingNames)];
    missingList.innerHTML = uniqueMissing.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
    missingWrapper.style.display = uniqueMissing.length > 0 ? "block" : "none";
    successWrapper.style.display = uniqueMissing.length === 0 ? "block" : "none";
}

function populateWinnerOptions(match = getSelectedMatch()) {
    winnerSelect.innerHTML = `<option value="">-- Choose Winner --</option>`;

    if (!match) return;

    const left = match.team_a?.short_code || "Team A";
    const right = match.team_b?.short_code || "Team B";
    winnerSelect.innerHTML += `
        <option value="${match.team_a_id}">${left}</option>
        <option value="${match.team_b_id}">${right}</option>
        <option value="abandoned">Abandoned / No Result</option>
    `;
}

function populatePomOptions(players = []) {
    pomSelect.innerHTML = `<option value="">-- Choose POM --</option>`;
    players
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((player) => {
            pomSelect.innerHTML += `<option value="${player.id}">${escapeHtml(player.name)}</option>`;
        });
    pomSelect.disabled = false;
}

function updateConfirmButton() {
    const readyForSubmit = Boolean(
        pendingAnalysis &&
        winnerSelect.value &&
        (winnerSelect.value === "abandoned" || pomSelect.value)
    );

    finalConfirmBtn.style.display = readyForSubmit ? "block" : "none";
}

function resetAnalysisUI(resetSelectors = true) {
    reportContainer.style.display = "none";
    missingWrapper.style.display = "none";
    successWrapper.style.display = "none";
    missingList.innerHTML = "";
    reportStats.innerHTML = "";

    if (resetSelectors) {
        populateWinnerOptions();
        pomSelect.innerHTML = `<option value="">-- Choose POM --</option>`;
        pomSelect.disabled = false;
    }

    updateConfirmButton();
}

function getSelectedMatch() {
    return matchesById.get(matchSelect.value) || null;
}

function parseScoreboard(rawValue) {
    let parsed;

    try {
        parsed = JSON.parse(rawValue);
    } catch {
        throw new Error("Invalid JSON. Paste a valid scoreboard array.");
    }

    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.scoreboard)) return parsed.scoreboard;

    throw new Error("Scoreboard JSON must be an array or an object with a scoreboard array.");
}

function normalizeName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = type;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
