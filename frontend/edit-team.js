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

let savedPlayers = [];     // DB state
let editingPlayers = [];   // Live editing

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

/* ================= INIT ================= */

init();

async function init() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  await loadPlayers();
  await loadTeams();
  await loadSavedSeasonTeam(user.id);

  rerenderAll();
}

/* ================= LOAD ================= */

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

  savedPlayers = (players || [])
    .map(p => allPlayers.find(ap => ap.id === p.player_id))
    .filter(Boolean);

  editingPlayers = [...savedPlayers];
}

/* ================= TOGGLE ================= */

toggleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    toggleButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    editModes.forEach(m => m.classList.remove("active"));
    const target = document.querySelector(`.${btn.dataset.mode}-mode`);
    if (target) target.classList.add("active");
  });
});

/* ================= RENDER ================= */

function rerenderAll() {
  renderMyXI();
  renderPool();
  renderSummary();
}

function renderMyXI() {
  myXI.innerHTML = "";

  savedPlayers.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card selected";
    card.innerHTML = `
      <div class="player-info">
        <strong>${p.name}</strong>
        <span>${p.role} · ${p.credit} cr</span>
      </div>
    `;
    myXI.appendChild(card);
  });
}

function renderPool() {
  pool.innerHTML = "";

  allPlayers.forEach(player => {
    const selected = editingPlayers.some(p => p.id === player.id);

    const card = document.createElement("div");
    card.className = "player-card";

    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr</span>
      </div>
      <button class="action-btn ${selected ? "remove" : "add"}">
        ${selected ? "Remove" : "Add"}
      </button>
    `;

    const btn = card.querySelector("button");

    if (selected) {
      btn.onclick = () => removePlayer(player.id);
    } else {
      btn.onclick = () => addPlayer(player);
    }

    pool.appendChild(card);
  });
}

function renderSummary() {
  const credits = editingPlayers
    .reduce((s,p)=>s+Number(p.credit),0)
    .toFixed(1);

  summary.innerHTML = `
    <div>Credits: ${credits} / 100</div>
  `;
}

/* ================= LOGIC ================= */

function addPlayer(player) {
  if (editingPlayers.some(p => p.id === player.id)) return;
  editingPlayers.push(player);
  rerenderAll();
}

function removePlayer(id) {
  editingPlayers = editingPlayers.filter(p => p.id !== id);
  rerenderAll();
}

/* ================= SAVE ================= */

saveBtn.addEventListener("click", async () => {
  if (saving) return;
  saving = true;

  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  const totalCredits = editingPlayers
    .reduce((s,p)=>s+Number(p.credit),0);

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
        total_credits: totalCredits
      })
      .select()
      .single();

    teamId = data.id;
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

  savedPlayers = [...editingPlayers];
  renderMyXI();

  saving = false;
});
