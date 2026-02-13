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

let teamMap = {};

let filters = {
  search: "",
  role: "ALL",
  teams: [],
  credit: null,
  selectedMatchTeamIds: []
};

/* =========================
   DOM
========================= */

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

/* =========================
   TOGGLE TAB
========================= */

toggleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    toggleButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    editModes.forEach(m => m.classList.remove("active"));
    const target = document.querySelector(`.${btn.dataset.mode}-mode`);
    if (target) target.classList.add("active");
  });
});

/* =========================
   DROPDOWN TOGGLES
========================= */

if (matchToggle && matchMenu) {
  matchToggle.addEventListener("click", () => {
    matchMenu.classList.toggle("show");
  });
}

if (teamToggle && teamMenu) {
  teamToggle.addEventListener("click", () => {
    teamMenu.classList.toggle("show");
  });
}

if (creditToggle && creditMenu) {
  creditToggle.addEventListener("click", () => {
    creditMenu.classList.toggle("show");
  });
}

/* =========================
   AUTH
========================= */

async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

/* =========================
   INIT
========================= */

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

  renderAll();
}

init();

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
   LOAD TEAMS
========================= */

async function loadTeams() {
  const { data } = await supabase
    .from("real_teams")
    .select("id, short_code");

  if (!data) return;

  data.forEach(team => {
    teamMap[team.id] = team.short_code;
  });
}

/* =========================
   LOAD NEXT 5 MATCHES
========================= */

async function loadNextMatches() {
  const { data } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "upcoming")
    .order("start_time", { ascending: true })
    .limit(5);

  if (!data) return;

  buildMatchDropdown(data);
}

/* =========================
   BUILD MATCH DROPDOWN
========================= */

function buildMatchDropdown(matches) {
  if (!matchMenu) return;

  matchMenu.innerHTML = "";

  matches.forEach(match => {

    const teamA = teamMap[match.team_a_id] || "T1";
    const teamB = teamMap[match.team_b_id] || "T2";

    const div = document.createElement("div");
    div.textContent = `${teamA} vs ${teamB}`;

    div.addEventListener("click", () => {

      const teams = [match.team_a_id, match.team_b_id];

      const alreadySelected =
        filters.selectedMatchTeamIds.some(id =>
          teams.includes(id)
        );

      if (alreadySelected) {
        filters.selectedMatchTeamIds =
          filters.selectedMatchTeamIds.filter(
            id => !teams.includes(id)
          );
        div.style.background = "";
      } else {
        filters.selectedMatchTeamIds.push(...teams);
        div.style.background = "#9be15d33";
      }

      renderAll();
    });

    matchMenu.appendChild(div);
  });
}

/* =========================
   BUILD TEAM DROPDOWN
========================= */

function buildTeamDropdown() {
  if (!teamMenu) return;

  const uniqueTeams = [...new Set(allPlayers.map(p => p.real_team_id))];

  teamMenu.innerHTML = "";

  uniqueTeams.forEach(teamId => {
    const div = document.createElement("div");
    div.textContent = teamMap[teamId] || teamId;

    div.addEventListener("click", () => {
      if (filters.teams.includes(teamId)) {
        filters.teams = filters.teams.filter(t => t !== teamId);
        div.style.background = "";
      } else {
        filters.teams.push(teamId);
        div.style.background = "#9be15d33";
      }
      renderAll();
    });

    teamMenu.appendChild(div);
  });
}

/* =========================
   BUILD CREDIT DROPDOWN
========================= */

function buildCreditDropdown() {
  if (!creditMenu) return;

  const credits = [...new Set(allPlayers.map(p => Number(p.credit)))]
    .sort((a,b)=>a-b);

  creditMenu.innerHTML = "";

  const allDiv = document.createElement("div");
  allDiv.textContent = "All";
  allDiv.addEventListener("click", () => {
    filters.credit = null;
    creditMenu.classList.remove("show");
    renderAll();
  });
  creditMenu.appendChild(allDiv);

  credits.forEach(value => {
    const div = document.createElement("div");
    div.textContent = value;
    div.addEventListener("click", () => {
      filters.credit = value;
      creditMenu.classList.remove("show");
      renderAll();
    });
    creditMenu.appendChild(div);
  });
}

/* =========================
   FILTER EVENTS
========================= */

if (searchInput) {
  searchInput.addEventListener("input", e => {
    filters.search = e.target.value;
    renderAll();
  });
}

document.querySelectorAll(".role-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {

    document.querySelectorAll(".role-filter-btn")
      .forEach(b => b.classList.remove("active"));

    btn.classList.add("active");
    filters.role = btn.dataset.role;

    renderAll();
  });
});

/* =========================
   APPLY FILTERS
========================= */

function applyFilters(players) {
  return players.filter(p => {

    if (filters.search &&
        !p.name.toLowerCase().includes(filters.search.toLowerCase()))
      return false;

    if (filters.role !== "ALL" &&
        p.role !== filters.role)
      return false;

    if (filters.teams.length &&
        !filters.teams.includes(p.real_team_id))
      return false;

    if (filters.credit !== null &&
        Number(p.credit) !== filters.credit)
      return false;

    if (filters.selectedMatchTeamIds.length &&
        !filters.selectedMatchTeamIds.includes(p.real_team_id))
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

      if (canAddPlayer(player)) {
        btn.onclick = () => addPlayer(player);
      } else {
        btn.disabled = true;
      }
    }

    pool.appendChild(card);
  });
}

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

/* =========================
   ADD / REMOVE
========================= */

function addPlayer(player) {
  selectedPlayers.push(player);
  renderAll();
}

function removePlayer(id) {
  selectedPlayers = selectedPlayers.filter(p => p.id !== id);

  if (captainId === id) captainId = null;
  if (viceCaptainId === id) viceCaptainId = null;

  renderAll();
}

/* =========================
   C / VC
========================= */

function setCaptain(id) {
  if (viceCaptainId === id) viceCaptainId = null;
  captainId = id;
  renderAll();
}

function setViceCaptain(id) {
  if (captainId === id) captainId = null;
  viceCaptainId = id;
  renderAll();
}

/* =========================
   VALIDATION
========================= */

function canAddPlayer(player) {
  if (selectedPlayers.length >= MAX_PLAYERS) return false;

  const credits = selectedPlayers.reduce((sum, p) => sum + Number(p.credit), 0);
  if (credits + Number(player.credit) > MAX_CREDITS) return false;

  const roleCount = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  selectedPlayers.forEach(p => roleCount[p.role]++);
  if (roleCount[player.role] >= ROLE_MAX[player.role]) return false;

  const teamCount = {};
  selectedPlayers.forEach(p => {
    teamCount[p.real_team_id] =
      (teamCount[p.real_team_id] || 0) + 1;
  });
  if (teamCount[player.real_team_id] >= MAX_PER_TEAM) return false;

  return true;
}

/* =========================
   SUMMARY
========================= */

function renderSummary() {
  const credits = selectedPlayers.reduce(
    (sum, p) => sum + Number(p.credit),
    0
  );

  const roleCount = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  selectedPlayers.forEach(p => roleCount[p.role]++);

  let subsHTML = "";

  if (isFirstLock) {
    subsHTML = `<div><strong>Subs:</strong> Unlimited</div>`;
  } else {
    const currentIds = selectedPlayers.map(p => p.id);

    const subsUsedNow = currentIds.filter(
      id => !lastLockedPlayers.includes(id)
    ).length;

    const remaining = 80 - lastTotalSubsUsed;

    subsHTML = `
      <div>
        <strong>Subs Used:</strong> ${subsUsedNow}
        |
        <strong>Remaining:</strong> ${remaining}
      </div>
    `;
  }

  summary.innerHTML = `
    <div>Credits: ${credits} / 100</div>
    <div>WK ${roleCount.WK} | BAT ${roleCount.BAT} | AR ${roleCount.AR} | BOWL ${roleCount.BOWL}</div>
    ${subsHTML}
  `;

  validateSave(roleCount, credits);
}
