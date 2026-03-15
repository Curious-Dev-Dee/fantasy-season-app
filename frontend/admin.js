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
        pendingAnalysis = null;
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
        if (isAbandoned && !scoreboardInput.value.trim()) {
            setStatus("No scoreboard needed if the match was abandoned before a ball was bowled. You can confirm directly.", "success");
        }
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
    const match = getSelectedMatch();
    const winnerId = winnerSelect.value;
    const pomId = winnerId === "abandoned" ? null : pomSelect.value;
    const isAbandoned = winnerId === "abandoned";

    if (!match) {
        setStatus("Please select a match first.", "error");
        return;
    }

    if (!winnerId) {
        setStatus("Please select the match winner.", "error");
        return;
    }

    if (!isAbandoned && !pendingAnalysis) {
        setStatus("Run the name check before processing.", "error");
        return;
    }

    if (!isAbandoned && !pomId) {
        setStatus("Please select the player of the match.", "error");
        return;
    }

    processBtn.disabled = true;
    finalConfirmBtn.disabled = true;
    finalConfirmBtn.textContent = "PROCESSING...";
    setStatus("Processing points...", "loading");

    try {
        const requestBody = isAbandoned
            ? {
                match_id: match.id,
                tournament_id: match.tournament_id,
                scoreboard: [],
                pom_id: null,
                winner_id: "abandoned"
            }
            : {
                match_id: pendingAnalysis.matchId,
                tournament_id: pendingAnalysis.tournamentId,
                scoreboard: pendingAnalysis.scoreboard,
                pom_id: pomId,
                winner_id: winnerId
            };

        const { data, error } = await supabase.functions.invoke("process_match_points", {
            body: requestBody
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        setStatus(
            data?.mode === "abandoned_before_start"
                ? "Match marked abandoned before first ball. Fantasy impact cleared."
                : "Points processed successfully. Leaderboard updated.",
            "success"
        );
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
        <option value="abandoned">Abandoned Before First Ball</option>
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
    const selectedMatch = getSelectedMatch();
    const isAbandoned = winnerSelect.value === "abandoned";
    const readyForSubmit = Boolean(
        winnerSelect.value &&
        (
            (isAbandoned && selectedMatch) ||
            (pendingAnalysis && pomSelect.value)
        )
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
        throw new Error("Invalid JSON. Please check the format.");
    }

    // If it's the raw API response with 'data.scorecard'
    if (parsed?.data?.scorecard) {
        return flattenScorecard(parsed.data.scorecard);
    }

    // Fallback for your original formats
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.scoreboard)) return parsed.scoreboard;

    throw new Error("Scoreboard format not recognized. Ensure 'data.scorecard' exists.");
}

function normalizeName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\(c\s*&\s*wk\)/g, "") // removes (c & wk)
        .replace(/\(wk\)/g, "")        // removes (wk)
        .replace(/\(c\)/g, "")         // removes (c)
        .replace(/&/g, "")             // removes stray &
        .replace(/\s+/g, " ")          // collapses multiple spaces into one
        .trim();
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

function flattenScorecard(scorecard) {
    const playerStats = new Map();

    const getPlayer = (name) => {
        if (!playerStats.has(name)) {
            playerStats.set(name, {
                player_name: name,
                runs: 0, balls: 0, fours: 0, sixes: 0, is_out: false,
                wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
                catches: 0, stumpings: 0, runouts_direct: 0, runouts_assisted: 0
            });
        }
        return playerStats.get(name);
    };

    scorecard.forEach(inning => {
        // Process Batting
        // Process Batting
        inning.batting?.forEach(b => {
            const p = getPlayer(b.batsman.name);
            p.runs = b.r || 0;
            p.balls = b.b || 0;
            p.fours = b['4s'] || 0; 
            p.sixes = b['6s'] || 0; // Safely falls back to 0 if the API sends "0s" or nothing
            p.is_out = b['dismissal-text'] !== 'not out';
        });

        // Process Bowling
        inning.bowling?.forEach(bw => {
            const p = getPlayer(bw.bowler.name);
            p.wickets = bw.w;
            p.overs = bw.o;
            p.runs_conceded = bw.r;
            p.maidens = bw.m;
        });

        // Process Catching/Fielding
        inning.catching?.forEach(c => {
            const p = getPlayer(c.catcher.name);
            p.catches = c.catch;
            p.stumpings = c.stumped;
            p.runouts_direct = c.runout; // Mapping API runouts to direct for now
        });
    });

    return Array.from(playerStats.values());
}