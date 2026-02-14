import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

/* ================= RULES ================= */
const MAX_PLAYERS = 11;
const MAX_CREDITS = 100;
const MAX_PER_TEAM = 6;
const ROLE_MIN = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
const ROLE_MAX = { WK: 4, BAT: 6, AR: 4, BOWL: 6 };

/* ================= STATE ================= */
let allPlayers = [];
let selectedPlayers = [];
let captainId = null;
let viceCaptainId = null;
let lastLockedPlayers = [];
let lastTotalSubsUsed = 0;
let isFirstLock = true;
let teamMap = {};
let saving = false;

let filters = {
    search: "",
    role: "ALL",
    teams: [],
    credit: null,
    selectedMatchTeamIds: []
};

/* ================= DOM ================= */
const myXI = document.getElementById("myXIList");
const pool = document.getElementById("playerPoolList");
const saveBar = document.querySelector(".save-bar");
const saveBtn = document.querySelector(".save-btn");
const summary = document.querySelector(".team-summary");
const toggleButtons = document.querySelectorAll(".toggle-btn");
const editModes = document.querySelectorAll(".edit-mode");
const searchInput = document.getElementById("playerSearch");

const matchToggle = document.getElementById("matchToggle");
const matchMenu = document.getElementById("matchMenu");
const teamToggle = document.getElementById("teamToggle");
const teamMenu = document.getElementById("teamMenu");
const creditToggle = document.getElementById("creditToggle");
const creditMenu = document.getElementById("creditMenu");

/* ================= UTILS ================= */
function rerenderAll() {
    renderMyXI();
    renderPool();
    renderSummary();
}

/* ================= TOGGLE TAB ================= */
toggleButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        toggleButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        editModes.forEach(m => m.classList.remove("active"));
        const target = document.querySelector(`.${btn.dataset.mode}-mode`);
        if (target) target.classList.add("active");
    });
});

/* ================= DROPDOWN TOGGLES ================= */
matchToggle.onclick = () => matchMenu.classList.toggle("show");
teamToggle.onclick = () => teamMenu.classList.toggle("show");
creditToggle.onclick = () => creditMenu.classList.toggle("show");

document.addEventListener("click", e => {
    if (!e.target.closest(".dropdown")) {
        matchMenu.classList.remove("show");
        teamMenu.classList.remove("show");
        creditMenu.classList.remove("show");
    }
});

/* ================= AUTH ================= */
async function getCurrentUser() {
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
}

/* ================= INIT ================= */
async function init() {
    const user = await getCurrentUser();
    if (!user) return;
    await loadPlayers();
    await loadTeams();
    await loadNextMatches();
    await loadLastLockedSnapshot(user.id);
    await loadSavedSeasonTeam(user.id);
    buildTeamDropdown();
    buildCreditDropdown();
    rerenderAll();
}
init();

/* ================= LOAD DATA ================= */
async function loadPlayers() {
    const { data, error } = await supabase.from("players").select("id, name, role, credit, real_team_id").eq("is_active", true);
    if (error) return console.error(error);
    allPlayers = data || [];
}

async function loadTeams() {
    const { data, error } = await supabase.from("real_teams").select("id, short_code");
    if (error) return console.error(error);
    data.forEach(t => teamMap[t.id] = t.short_code);
}

async function loadNextMatches() {
    const { data, error } = await supabase.from("matches").select("*").eq("status", "upcoming").order("start_time", { ascending: true }).limit(5);
    if (error) return console.error(error);
    buildMatchDropdown(data);
}

async function loadLastLockedSnapshot(userId) {
    const { data } = await supabase.from("user_match_teams").select("id, total_subs_used").eq("user_id", userId).order("locked_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return;
    isFirstLock = false;
    lastTotalSubsUsed = data.total_subs_used;
    const { data: players } = await supabase.from("user_match_team_players").select("player_id").eq("user_match_team_id", data.id);
    lastLockedPlayers = players?.map(p => p.player_id) || [];
}

async function loadSavedSeasonTeam(userId) {
    const { data: team } = await supabase.from("user_fantasy_teams").select("*").eq("user_id", userId).eq("tournament_id", TOURNAMENT_ID).maybeSingle();
    if (!team) return;
    captainId = team.captain_id;
    viceCaptainId = team.vice_captain_id;
    const { data: players } = await supabase.from("user_fantasy_team_players").select("player_id").eq("user_fantasy_team_id", team.id);
    selectedPlayers = (players || []).map(p => allPlayers.find(ap => ap.id === p.player_id)).filter(Boolean);
}

/* ================= FILTER BUILDERS ================= */
function buildMatchDropdown(matches) {
    matchMenu.innerHTML = "";
    matches.forEach(match => {
        const div = document.createElement("div");
        div.textContent = `${teamMap[match.team_a_id]} vs ${teamMap[match.team_b_id]}`;
        div.onclick = () => {
            const teams = [match.team_a_id, match.team_b_id];
            const active = teams.every(t => filters.selectedMatchTeamIds.includes(t));
            filters.selectedMatchTeamIds = active ? filters.selectedMatchTeamIds.filter(id => !teams.includes(id)) : [...new Set([...filters.selectedMatchTeamIds, ...teams])];
            renderPool();
        };
        matchMenu.appendChild(div);
    });
}

function buildTeamDropdown() {
    teamMenu.innerHTML = "";
    [...new Set(allPlayers.map(p => p.real_team_id))].forEach(teamId => {
        const div = document.createElement("div");
        div.textContent = teamMap[teamId] || "Unknown";
        div.onclick = () => {
            filters.teams.includes(teamId) ? filters.teams = filters.teams.filter(t => t !== teamId) : filters.teams.push(teamId);
            renderPool();
        };
        teamMenu.appendChild(div);
    });
}

function buildCreditDropdown() {
    creditMenu.innerHTML = "";
    const allDiv = document.createElement("div");
    allDiv.textContent = "All";
    allDiv.onclick = () => { filters.credit = null; renderPool(); };
    creditMenu.appendChild(allDiv);
    [...new Set(allPlayers.map(p => Number(p.credit)))].sort((a,b)=>a-b).forEach(val => {
        const div = document.createElement("div");
        div.textContent = val;
        div.onclick = () => { filters.credit = val; renderPool(); };
        creditMenu.appendChild(div);
    });
}

/* ================= FILTER EVENTS ================= */
searchInput.oninput = e => { filters.search = e.target.value; renderPool(); };
document.querySelectorAll(".role-filter-btn").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll(".role-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        filters.role = btn.dataset.role;
        renderPool();
    };
});

function applyFilters(players) {
    return players.filter(p => 
        (!filters.search || p.name.toLowerCase().includes(filters.search.toLowerCase())) &&
        (filters.role === "ALL" || p.role === filters.role) &&
        (!filters.teams.length || filters.teams.includes(p.real_team_id)) &&
        (filters.credit === null || Number(p.credit) === filters.credit) &&
        (!filters.selectedMatchTeamIds.length || filters.selectedMatchTeamIds.includes(p.real_team_id))
    );
}

/* ================= RENDER ================= */
function renderPool() {
    pool.innerHTML = "";
    applyFilters(allPlayers).forEach(player => {
        const selected = selectedPlayers.some(p => p.id === player.id);
        const card = document.createElement("div");
        card.className = "player-card";
        card.innerHTML = `
            <div class="player-info">
                <strong>${player.name}</strong>
                <span>${player.role} · ${player.credit} cr</span>
            </div>
            <button class="action-btn ${selected ? "remove" : "add"}">
                ${selected ? "Remove" : "Add"}
            </button>`;
        const btn = card.querySelector("button");
        btn.onclick = selected ? () => removePlayer(player.id) : canAddPlayer(player) ? () => addPlayer(player) : null;
        btn.disabled = !selected && !canAddPlayer(player);
        pool.appendChild(card);
    });
}

function renderMyXI() {
    myXI.innerHTML = "";
    selectedPlayers.forEach(p => {
        const card = document.createElement("div");
        card.className = "player-card selected";
        card.innerHTML = `
            <div class="player-info">
                <strong>${p.name}</strong>
                <span>${p.role} · ${p.credit} cr</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="cv-btn ${captainId === p.id ? "active" : ""}">C</button>
                <button class="cv-btn ${viceCaptainId === p.id ? "active" : ""}">VC</button>
                <button class="action-btn remove">Remove</button>
            </div>`;
        const [c, vc, r] = card.querySelectorAll("button");
        c.onclick = () => setCaptain(p.id);
        vc.onclick = () => setViceCaptain(p.id);
        r.onclick = () => removePlayer(p.id);
        myXI.appendChild(card);
    });
}

function renderSummary() {
    const credits = selectedPlayers.reduce((s,p)=>s+Number(p.credit),0).toFixed(1);
    const roleCount = { WK:0, BAT:0, AR:0, BOWL:0 };
    selectedPlayers.forEach(p => roleCount[p.role]++);
    summary.innerHTML = `
        <div>Credits: ${credits} / 100</div>
        <div>WK ${roleCount.WK} | BAT ${roleCount.BAT} | AR ${roleCount.AR} | BOWL ${roleCount.BOWL}</div>
        ${isFirstLock ? "<div><strong>Subs:</strong> Unlimited</div>" : ""}`;
    validateSave(roleCount, credits);
}

/* ================= ACTIONS ================= */
function addPlayer(player) {
    if (selectedPlayers.some(p => p.id === player.id)) return;
    selectedPlayers.push(player);
    rerenderAll();
}

function removePlayer(id) {
    selectedPlayers = selectedPlayers.filter(p => p.id !== id);
    if (captainId === id) captainId = null;
    if (viceCaptainId === id) viceCaptainId = null;
    rerenderAll();
}

function setCaptain(id) {
    if (viceCaptainId === id) viceCaptainId = null;
    captainId = id;
    renderMyXI();
}

function setViceCaptain(id) {
    if (captainId === id) captainId = null;
    viceCaptainId = id;
    renderMyXI();
}

function canAddPlayer(player) {
    if (selectedPlayers.length >= MAX_PLAYERS) return false;
    const currentCredits = selectedPlayers.reduce((s,p)=>s+Number(p.credit),0);
    if (currentCredits + Number(player.credit) > MAX_CREDITS) return false;
    if (selectedPlayers.filter(p => p.role === player.role).length >= ROLE_MAX[player.role]) return false;
    if (selectedPlayers.filter(p => p.real_team_id === player.real_team_id).length >= MAX_PER_TEAM) return false;
    return true;
}

function validateSave(roleCount, credits) {
    let valid = selectedPlayers.length === 11 && 
                captainId && 
                viceCaptainId && 
                credits <= MAX_CREDITS && 
                Object.keys(ROLE_MIN).every(r => roleCount[r] >= ROLE_MIN[r]);
    
    saveBar.classList.remove("enabled", "disabled");
    saveBar.classList.add(valid ? "enabled" : "disabled");
}

/* ================= SAVE FIX ================= */
saveBtn.addEventListener("click", async () => {
    if (!saveBar.classList.contains("enabled") || saving) return;
    
    saving = true;
    saveBtn.textContent = "Saving...";

    try {
        const user = await getCurrentUser();
        if (!user) throw new Error("No User Found");

        const totalCredits = selectedPlayers.reduce((s,p)=>s+Number(p.credit), 0);

        // 1. Update or Insert Team
        const { data: team, error: teamError } = await supabase
            .from("user_fantasy_teams")
            .upsert({
                user_id: user.id,
                tournament_id: TOURNAMENT_ID,
                captain_id: captainId,
                vice_captain_id: viceCaptainId,
                total_credits: totalCredits
            }, { onConflict: 'user_id, tournament_id' })
            .select()
            .single();

        if (teamError) throw teamError;

        // 2. Clear old players
        await supabase
            .from("user_fantasy_team_players")
            .delete()
            .eq("user_fantasy_team_id", team.id);

        // 3. Insert new players
        const playerMapping = selectedPlayers.map(p => ({
            user_fantasy_team_id: team.id,
            player_id: p.id
        }));

        const { error: playersError } = await supabase
            .from("user_fantasy_team_players")
            .insert(playerMapping);

        if (playersError) throw playersError;

        saveBtn.textContent = "Saved ✓";
        setTimeout(() => {
            saveBtn.textContent = "Save Team";
            saving = false;
        }, 1500);

    } catch (error) {
        console.error("Save Error:", error);
        saveBtn.textContent = "Error saving";
        saving = false;
        setTimeout(() => saveBtn.textContent = "Save Team", 2000);
    }
});