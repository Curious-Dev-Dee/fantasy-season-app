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

let savedTeamPlayers = [];   // DB saved XI
let editingPlayers = [];     // Live editing XI

let captainId = null;
let viceCaptainId = null;

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

const playerCountEl = document.getElementById("playerCount");
const creditsLeftEl = document.getElementById("creditsLeft");
const progressFillEl = document.getElementById("progressFill");
const subsInfoEl = document.getElementById("subsInfo");

const toggleButtons = document.querySelectorAll(".toggle-btn");
const editModes = document.querySelectorAll(".edit-mode");

const searchInput = document.getElementById("playerSearch");

const matchToggle = document.getElementById("matchToggle");
const matchMenu = document.getElementById("matchMenu");

const teamToggle = document.getElementById("teamToggle");
const teamMenu = document.getElementById("teamMenu");

const creditToggle = document.getElementById("creditToggle");
const creditMenu = document.getElementById("creditMenu");

/* ================= INIT ================= */

async function init() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
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
  const { data } = await supabase
    .from("players")
    .select("id, name, role, credit, real_team_id")
    .eq("is_active", true);

  allPlayers = data || [];
}

async function loadTeams() {
  const { data } = await supabase
    .from("real_teams")
    .select("id, short_code");

  data?.forEach(t => teamMap[t.id] = t.short_code);
}

async function loadNextMatches() {
  const { data } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "upcoming")
    .order("start_time", { ascending: true })
    .limit(5);

  buildMatchDropdown(data || []);
}

async function loadLastLockedSnapshot(userId) {
  const { data } = await supabase
    .from("user_match_teams")
    .select("total_subs_used")
    .eq("user_id", userId)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return;

  isFirstLock = false;
  lastTotalSubsUsed = data.total_subs_used;
}

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

  savedTeamPlayers = (players || [])
    .map(p => allPlayers.find(ap => ap.id === p.player_id))
    .filter(Boolean);

  editingPlayers = [...savedTeamPlayers];
}

/* ================= TOGGLES ================= */

toggleButtons.forEach(btn => {
  btn.onclick = () => {
    toggleButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    editModes.forEach(m => m.classList.remove("active"));
    document.querySelector(`.${btn.dataset.mode}-mode`)?.classList.add("active");
  };
});

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

/* ================= FILTERS ================= */

searchInput.oninput = e => {
  filters.search = e.target.value;
  renderPool();
};

document.querySelectorAll(".role-filter-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".role-filter-btn")
      .forEach(b => b.classList.remove("active"));
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
    (filters.credit === null || Number(p.credit) === filters.credit)
  );
}

/* ================= RENDER ================= */

function rerenderAll() {
  renderMyXI();
  renderPool();
  renderStatus();
}

function renderStatus() {
  const totalPlayers = editingPlayers.length;

  const totalCredits = editingPlayers.reduce(
    (s, p) => s + Number(p.credit), 0
  );

  const creditsLeft = (MAX_CREDITS - totalCredits).toFixed(1);

  const roleCount = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  editingPlayers.forEach(p => roleCount[p.role]++);

  playerCountEl.textContent = totalPlayers;
  creditsLeftEl.textContent = creditsLeft;
  progressFillEl.style.width =
    `${(totalPlayers / MAX_PLAYERS) * 100}%`;

  document.querySelectorAll(".role-count").forEach(el => {
    el.textContent = roleCount[el.dataset.count];
  });

  subsInfoEl.textContent = isFirstLock
    ? "Subs: Unlimited"
    : `Subs Used: ${lastTotalSubsUsed}`;

  validateSave(roleCount, totalCredits);
}

function renderPool() {
  pool.innerHTML = "";

  applyFilters(allPlayers).forEach(player => {
    const selected = editingPlayers.some(p => p.id === player.id);

    const card = document.createElement("div");
    card.className = "player-card";

    card.innerHTML = `
      <div class="player-info">
        <div class="player-avatar">${player.name.charAt(0)}</div>
        <div class="player-details">
          <strong>${player.name}</strong>
          <div class="player-meta">
            ${player.role} • ${teamMap[player.real_team_id] || ""}
          </div>
        </div>
      </div>

      <div class="player-right">
        <div class="player-credit">${player.credit} cr</div>
        <button class="action-btn ${selected ? "remove" : ""}">
          ${selected ? "−" : "+"}
        </button>
      </div>
    `;

    const btn = card.querySelector(".action-btn");

    if (selected) {
      btn.onclick = () => removePlayer(player.id);
    } else if (canAddPlayer(player)) {
      btn.onclick = () => addPlayer(player);
    } else {
      btn.disabled = true;
    }

    pool.appendChild(card);
  });
}

function renderMyXI() {
  myXI.innerHTML = "";

  savedTeamPlayers.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card selected";

    card.innerHTML = `
      <div class="player-info">
        <div class="player-avatar">${p.name.charAt(0)}</div>
        <div class="player-details">
          <strong>${p.name}</strong>
          <div class="player-meta">
            ${p.role} • ${teamMap[p.real_team_id] || ""}
          </div>
        </div>
      </div>

      <div class="player-right">
        <span class="player-credit">${p.credit} cr</span>
        <span class="cv-btn ${captainId === p.id ? "active" : ""}">C</span>
        <span class="cv-btn ${viceCaptainId === p.id ? "active" : ""}">VC</span>
      </div>
    `;

    myXI.appendChild(card);
  });
}

/* ================= LOGIC ================= */

function addPlayer(player) {
  if (!canAddPlayer(player)) return;
  editingPlayers.push(player);
  rerenderAll();
}

function removePlayer(id) {
  editingPlayers = editingPlayers.filter(p => p.id !== id);
  if (captainId === id) captainId = null;
  if (viceCaptainId === id) viceCaptainId = null;
  rerenderAll();
}

function canAddPlayer(player) {
  if (editingPlayers.length >= MAX_PLAYERS) return false;

  const totalCredits = editingPlayers.reduce(
    (s, p) => s + Number(p.credit), 0
  );

  if (totalCredits + Number(player.credit) > MAX_CREDITS) return false;

  if (
    editingPlayers.filter(p => p.role === player.role).length >=
    ROLE_MAX[player.role]
  ) return false;

  if (
    editingPlayers.filter(p => p.real_team_id === player.real_team_id).length >=
    MAX_PER_TEAM
  ) return false;

  return true;
}

function validateSave(roleCount, credits) {
  const valid =
    editingPlayers.length === 11 &&
    captainId &&
    viceCaptainId &&
    credits <= MAX_CREDITS &&
    Object.keys(ROLE_MIN).every(r => roleCount[r] >= ROLE_MIN[r]);

  saveBar.classList.toggle("enabled", valid);
  saveBar.classList.toggle("disabled", !valid);
}

/* ================= SAVE ================= */

saveBtn.addEventListener("click", async () => {
  if (!saveBar.classList.contains("enabled") || saving) return;

  saving = true;
  saveBtn.textContent = "Saving...";

  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  const totalCredits = editingPlayers.reduce(
    (s, p) => s + Number(p.credit), 0
  );

  const { data: existing } = await supabase
    .from("user_fantasy_teams")
    .select("*")
    .eq("user_id", user.id)
    .eq("tournament_id", TOURNAMENT_ID)
    .maybeSingle();

  let teamId = existing?.id;

  if (!existing) {
    const { data } = await supabase
      .from("user_fantasy_teams")
      .insert({
        user_id: user.id,
        tournament_id: TOURNAMENT_ID,
        captain_id: captainId,
        vice_captain_id: viceCaptainId,
        total_credits: totalCredits
      })
      .select()
      .single();

    teamId = data.id;
  } else {
    await supabase
      .from("user_fantasy_teams")
      .update({
        captain_id: captainId,
        vice_captain_id: viceCaptainId,
        total_credits: totalCredits
      })
      .eq("id", teamId);
  }

  await supabase
    .from("user_fantasy_team_players")
    .delete()
    .eq("user_fantasy_team_id", teamId);

  await supabase
    .from("user_fantasy_team_players")
    .insert(
      editingPlayers.map(p => ({
        user_fantasy_team_id: teamId,
        player_id: p.id
      }))
    );

  savedTeamPlayers = [...editingPlayers];
  renderMyXI();

  saveBtn.textContent = "Saved ✓";
  saving = false;
  setTimeout(() => saveBtn.textContent = "Save Team", 1200);
});
