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

const playerCount = document.getElementById("playerCount");
const progressFill = document.getElementById("progressFill");

const toggleButtons = document.querySelectorAll(".toggle-btn");
const editModes = document.querySelectorAll(".edit-mode");
const searchInput = document.getElementById("playerSearch");

/* ================= INIT ================= */
async function init() {
  const { data } = await supabase.auth.getUser();
  if (!data?.user) return;

  await loadPlayers();
  await loadTeams();
  await loadSavedTeam(data.user.id);
  rerenderAll();
}
init();

/* ================= LOADERS ================= */
async function loadPlayers() {
  const { data } = await supabase
    .from("players")
    .select("id, name, role, credit, real_team_id")
    .eq("is_active", true);
  allPlayers = data || [];
}

async function loadTeams() {
  const { data } = await supabase.from("real_teams").select("id, short_code");
  data?.forEach(t => teamMap[t.id] = t.short_code);
}

async function loadSavedTeam(userId) {
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

  selectedPlayers = players
    .map(p => allPlayers.find(ap => ap.id === p.player_id))
    .filter(Boolean);
}

/* ================= UI ================= */
toggleButtons.forEach(btn => {
  btn.onclick = () => {
    toggleButtons.forEach(b => b.classList.remove("active"));
    editModes.forEach(m => m.classList.remove("active"));
    btn.classList.add("active");
    document.querySelector(`.${btn.dataset.mode}-mode`).classList.add("active");
  };
});

searchInput.oninput = e => {
  filters.search = e.target.value;
  renderPool();
};

/* ================= FILTER ================= */
function applyFilters(players) {
  return players.filter(p =>
    (!filters.search || p.name.toLowerCase().includes(filters.search.toLowerCase())) &&
    (filters.role === "ALL" || p.role === filters.role)
  );
}

/* ================= RENDER ================= */
function rerenderAll() {
  renderMyXI();
  renderPool();
  renderSummary();
  updateProgress();
}

function updateProgress() {
  playerCount.textContent = selectedPlayers.length;
  progressFill.style.width =
    (selectedPlayers.length / MAX_PLAYERS) * 100 + "%";
}

function renderPool() {
  pool.innerHTML = "";

  applyFilters(allPlayers).forEach(player => {
    const selected = selectedPlayers.some(p => p.id === player.id);

    const card = document.createElement("div");
    card.className = "dream11-card";

    card.innerHTML = `
        <div class="player-name">${player.name}</div>
        <div class="player-meta">
          ${player.role} • ${player.credit} cr<br/>
          <span class="played">● Played last match</span>
        </div>
      </div>
      <div class="right">
        <div class="credit">${player.credit}</div>
        <button class="circle-btn ${selected ? "remove" : "add"}">
          ${selected ? "−" : "+"}
        </button>
      </div>
    `;

    const btn = card.querySelector("button");
    btn.onclick = selected
      ? () => removePlayer(player.id)
      : canAddPlayer(player)
        ? () => addPlayer(player)
        : null;

    btn.disabled = !selected && !canAddPlayer(player);
    pool.appendChild(card);
  });
}

function renderMyXI() {
  myXI.innerHTML = "";
  selectedPlayers.forEach(p => {
    const div = document.createElement("div");
    div.className = "player-card selected";
    div.innerHTML = `
      <strong>${p.name}</strong>
      <div>
        <button class="cv-btn ${captainId === p.id ? "active" : ""}">C</button>
        <button class="cv-btn ${viceCaptainId === p.id ? "active" : ""}">VC</button>
        <button class="circle-btn remove">−</button>
      </div>
    `;

    const [c, vc, r] = div.querySelectorAll("button");
    c.onclick = () => setCaptain(p.id);
    vc.onclick = () => setViceCaptain(p.id);
    r.onclick = () => removePlayer(p.id);
    myXI.appendChild(div);
  });
}

function renderSummary() {
  const credits = selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);
  summary.innerHTML = `
    <div>Credits: ${credits}/100</div>
    <div>Players: ${selectedPlayers.length}/11</div>
  `;
  validateSave();
}

/* ================= ACTIONS ================= */
function addPlayer(player) {
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

/* ================= VALIDATION ================= */
function canAddPlayer(player) {
  if (selectedPlayers.length >= MAX_PLAYERS) return false;
  if (
    selectedPlayers.reduce((s, p) => s + Number(p.credit), 0) +
    Number(player.credit) > MAX_CREDITS
  ) return false;
  if (
    selectedPlayers.filter(p => p.real_team_id === player.real_team_id).length >=
    MAX_PER_TEAM
  ) return false;
  return true;
}

function validateSave() {
  const valid =
    selectedPlayers.length === 11 &&
    captainId &&
    viceCaptainId;

  saveBar.classList.toggle("enabled", valid);
  saveBar.classList.toggle("disabled", !valid);
}

/* ================= SAVE ================= */
saveBtn.onclick = async () => {
  if (!saveBar.classList.contains("enabled") || saving) return;
  saving = true;

  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  const credits = selectedPlayers.reduce((s, p) => s + Number(p.credit), 0);

  const { data: team } = await supabase
    .from("user_fantasy_teams")
    .upsert({
      user_id: user.id,
      tournament_id: TOURNAMENT_ID,
      captain_id: captainId,
      vice_captain_id: viceCaptainId,
      total_credits: credits
    })
    .select()
    .single();

  await supabase
    .from("user_fantasy_team_players")
    .delete()
    .eq("user_fantasy_team_id", team.id);

  await supabase
    .from("user_fantasy_team_players")
    .insert(
      selectedPlayers.map(p => ({
        user_fantasy_team_id: team.id,
        player_id: p.id
      }))
    );

  saveBtn.textContent = "Saved ✓";
  saving = false;
};
