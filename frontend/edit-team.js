import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

/* =========================
   RULES
========================= */

const MAX_PLAYERS = 11;
const MAX_CREDITS = 100;
const MAX_PER_TEAM = 6;

const ROLE_MIN = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
const ROLE_MAX = { WK: 4, BAT: 6, AR: 4, BOWL: 6 };

/* =========================
   STATE
========================= */

let allPlayers = [];
let selectedPlayers = [];

let captainId = null;
let viceCaptainId = null;

let lastLockedPlayers = [];
let lastTotalSubsUsed = 0;
let isFirstLock = true;

let nextMatchTeamIds = [];

let filters = {
  search: "",
  roles: [],
  teams: [],
  upcomingOnly: false,
  credit: null
};

/* =========================
   DOM
========================= */

const myXI = document.getElementById("myXIList");
const pool = document.getElementById("playerPoolList");

const saveBar = document.querySelector(".save-bar");
const saveBtn = document.querySelector(".save-btn");
const summary = document.querySelector(".team-summary");

const searchInput = document.getElementById("playerSearch");
const roleButtons = document.querySelectorAll(".role-filter-btn");

const matchToggle = document.getElementById("matchToggle");
const matchMenu = document.getElementById("matchMenu");

const teamToggle = document.getElementById("teamToggle");
const teamMenu = document.getElementById("teamMenu");

const creditToggle = document.getElementById("creditToggle");
const creditMenu = document.getElementById("creditMenu");

/* =========================
   INIT
========================= */

async function init() {
  const user = await getCurrentUser();
  if (!user) return;

  await loadPlayers();
  await loadNextMatchTeams();
  await loadLastLockedSnapshot(user.id);
  await loadSavedSeasonTeam(user.id);

  buildTeamDropdown();
  buildCreditDropdown();

  renderAll();
}

init();

/* =========================
   AUTH
========================= */

async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

/* =========================
   LOAD PLAYERS
========================= */

async function loadPlayers() {
  const { data } = await supabase
    .from("players")
    .select("id, name, role, credit, real_team_id")
    .eq("is_active", true);

  allPlayers = data || [];
}

/* =========================
   NEXT MATCH
========================= */

async function loadNextMatchTeams() {
  const { data } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "upcoming")
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return;

  nextMatchTeamIds = [data.team_a_id, data.team_b_id];
}

/* =========================
   LOAD LOCK SNAPSHOT
========================= */

async function loadLastLockedSnapshot(userId) {
  const { data } = await supabase
    .from("user_match_teams")
    .select("id, total_subs_used")
    .eq("user_id", userId)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    isFirstLock = true;
    return;
  }

  isFirstLock = false;
  lastTotalSubsUsed = data.total_subs_used;

  const { data: players } = await supabase
    .from("user_match_team_players")
    .select("player_id")
    .eq("user_match_team_id", data.id);

  lastLockedPlayers = players ? players.map(p => p.player_id) : [];
}

/* =========================
   LOAD SAVED TEAM
========================= */

async function loadSavedSeasonTeam(userId) {
  const { data: team } = await supabase
    .from("user_fantasy_teams")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", TOURNAMENT_ID)
    .maybeSingle();

  if (!team) return;

  captainId = team.captain_id;
  viceCaptainId = team.vice_captain_id;

  const { data: players } = await supabase
    .from("user_fantasy_team_players")
    .select("player_id")
    .eq("user_fantasy_team_id", team.id);

  const ids = players ? players.map(p => p.player_id) : [];
  selectedPlayers = allPlayers.filter(p => ids.includes(p.id));
}

/* =========================
   FILTER BUILDERS
========================= */

function buildTeamDropdown() {
  const uniqueTeams = [...new Set(allPlayers.map(p => p.real_team_id))];

  teamMenu.innerHTML = "";

  uniqueTeams.forEach(teamId => {
    const div = document.createElement("div");
    div.textContent = teamId;
    div.onclick = () => {
      if (filters.teams.includes(teamId)) {
        filters.teams = filters.teams.filter(t => t !== teamId);
        div.style.background = "";
      } else {
        filters.teams.push(teamId);
        div.style.background = "#9be15d33";
      }
      renderAll();
    };
    teamMenu.appendChild(div);
  });
}

function buildCreditDropdown() {
  const credits = [...new Set(allPlayers.map(p => Number(p.credit)))]
    .sort((a,b)=>a-b);

  creditMenu.innerHTML = "";

  const allDiv = document.createElement("div");
  allDiv.textContent = "All";
  allDiv.onclick = () => {
    filters.credit = null;
    renderAll();
  };
  creditMenu.appendChild(allDiv);

  credits.forEach(value => {
    const div = document.createElement("div");
    div.textContent = value;
    div.onclick = () => {
      filters.credit = value;
      renderAll();
    };
    creditMenu.appendChild(div);
  });
}

/* =========================
   FILTER EVENTS
========================= */

searchInput.addEventListener("input", e => {
  filters.search = e.target.value;
  renderAll();
});

roleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const role = btn.dataset.role;

    roleButtons.forEach(b => b.classList.remove("active"));

    if (role === "ALL") {
      filters.roles = [];
      btn.classList.add("active");
    } else {
      filters.roles = [role];
      btn.classList.add("active");
    }

    renderAll();
  });
});

matchMenu.querySelectorAll("div").forEach(div => {
  div.addEventListener("click", () => {
    const type = div.dataset.match;
    filters.upcomingOnly = type === "next";
    renderAll();
  });
});

matchToggle.onclick = () => matchMenu.classList.toggle("show");
teamToggle.onclick = () => teamMenu.classList.toggle("show");
creditToggle.onclick = () => creditMenu.classList.toggle("show");

/* =========================
   APPLY FILTERS
========================= */

function applyFilters(players) {
  return players.filter(p => {

    if (filters.search &&
        !p.name.toLowerCase().includes(filters.search.toLowerCase()))
      return false;

    if (filters.roles.length &&
        !filters.roles.includes(p.role))
      return false;

    if (filters.teams.length &&
        !filters.teams.includes(p.real_team_id))
      return false;

    if (filters.credit !== null &&
        Number(p.credit) !== filters.credit)
      return false;

    if (filters.upcomingOnly &&
        !nextMatchTeamIds.includes(p.real_team_id))
      return false;

    return true;
  });
}

/* =========================
   RENDER
========================= */

function renderAll() {
  renderMyXI();
  renderPool();
  renderSummary();
}

function renderPool() {
  pool.innerHTML = "";

  const playersToRender = applyFilters(allPlayers);

  playersToRender.forEach(player => {
    const selected = selectedPlayers.some(p => p.id === player.id);

    const card = document.createElement("div");
    card.className = "player-card";

    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr</span>
      </div>
      <button class="action-btn"></button>
    `;

    const btn = card.querySelector("button");

    if (selected) {
      btn.textContent = "Remove";
      btn.className = "action-btn remove";
      btn.onclick = () => removePlayer(player.id);
    } else {
      btn.textContent = "Add";
      btn.className = "action-btn add";
      btn.onclick = () => addPlayer(player);
    }

    pool.appendChild(card);
  });
}

/* =========================
   REST OF YOUR ENGINE
========================= */

function renderMyXI() {
  myXI.innerHTML = "";

  selectedPlayers.forEach(player => {
    const isC = captainId === player.id;
    const isVC = viceCaptainId === player.id;

    const card = document.createElement("div");
    card.className = "player-card selected";

    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr</span>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="cv-btn ${isC ? "active" : ""}">C</button>
        <button class="cv-btn ${isVC ? "active" : ""}">VC</button>
        <button class="action-btn remove">Remove</button>
      </div>
    `;

    const [cBtn, vcBtn, removeBtn] = card.querySelectorAll("button");

    cBtn.onclick = () => setCaptain(player.id);
    vcBtn.onclick = () => setViceCaptain(player.id);
    removeBtn.onclick = () => removePlayer(player.id);

    myXI.appendChild(card);
  });
}

function addPlayer(player) {
  selectedPlayers.push(player);
  renderAll();
}

function removePlayer(id) {
  selectedPlayers = selectedPlayers.filter(p => p.id !== id);
  renderAll();
}

function setCaptain(id) {
  captainId = id;
  renderAll();
}

function setViceCaptain(id) {
  viceCaptainId = id;
  renderAll();
}
