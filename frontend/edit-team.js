import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

/* ================= RULES ================= */

const MAX_PLAYERS = 11;
const MAX_CREDITS = 100;
const MAX_PER_TEAM = 6;
const MAX_SUBS = 20;

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

let currentTab = "myxi";
let saving = false;

/* ================= DOM ================= */

const myXIContainer = document.getElementById("myXIList");
const poolContainer = document.getElementById("playerPoolList");
const summary = document.querySelector(".team-summary");
const saveBar = document.querySelector(".save-bar");
const saveBtn = document.querySelector(".save-btn");

const toggleButtons = document.querySelectorAll(".toggle-btn");
const editModes = document.querySelectorAll(".edit-mode");

/* ================= INIT ================= */

init();

async function init() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  await loadPlayers();
  await loadLastLockedSnapshot(user.id);
  await loadSavedSeasonTeam(user.id);

  renderEverything();
}

/* ================= LOAD DATA ================= */

async function loadPlayers() {
  const { data } = await supabase
    .from("players")
    .select("id, name, role, credit, real_team_id")
    .eq("is_active", true);

  allPlayers = data || [];
}

async function loadLastLockedSnapshot(userId) {
  const { data } = await supabase
    .from("user_match_teams")
    .select("id, total_subs_used")
    .eq("user_id", userId)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return;

  isFirstLock = false;
  lastTotalSubsUsed = data.total_subs_used || 0;

  const { data: players } = await supabase
    .from("user_match_team_players")
    .select("player_id")
    .eq("user_match_team_id", data.id);

  lastLockedPlayers = players?.map(p => p.player_id) || [];
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

  selectedPlayers = (players || [])
    .map(p => allPlayers.find(ap => ap.id === p.player_id))
    .filter(Boolean);
}

/* ================= TAB SWITCH ================= */

toggleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    toggleButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    editModes.forEach(m => m.classList.remove("active"));

    const mode = btn.dataset.mode;
    currentTab = mode;

    document.querySelector(`.${mode}-mode`).classList.add("active");

    renderEverything();
  });
});

/* ================= RENDER ================= */

function renderEverything() {
  renderSummary();

  if (currentTab === "myxi") {
    renderMyXI();
  } else {
    renderPool();
  }
}

function renderMyXI() {
  myXIContainer.innerHTML = "";

  if (selectedPlayers.length === 0) {
    myXIContainer.innerHTML =
      '<div style="text-align:center;color:#888;">No players selected</div>';
    return;
  }

  selectedPlayers.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card selected";

    card.innerHTML = `
      <div class="player-info">
        <strong>${p.name}</strong>
        <span>${p.role} · ${p.credit} cr</span>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="cv-btn ${captainId === p.id ? "active" : ""}">C</button>
        <button class="cv-btn ${viceCaptainId === p.id ? "active" : ""}">VC</button>
        <button class="action-btn remove">Remove</button>
      </div>
    `;

    const buttons = card.querySelectorAll("button");

    buttons[0].onclick = () => setCaptain(p.id);
    buttons[1].onclick = () => setViceCaptain(p.id);
    buttons[2].onclick = () => removePlayer(p.id);

    myXIContainer.appendChild(card);
  });
}

function renderPool() {
  poolContainer.innerHTML = "";

  allPlayers.forEach(player => {
    const selected = selectedPlayers.some(p => p.id === player.id);

    const card = document.createElement("div");
    card.className = "player-card";

    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr</span>
      </div>
      <button class="action-btn ${selected ? "remove" : "add"}">
        ${selected ? "Remove" : "+"}
      </button>
    `;

    const btn = card.querySelector("button");

    if (selected) {
      btn.onclick = () => removePlayer(player.id);
    } else {
      btn.onclick = () => addPlayer(player);
      btn.disabled = !canAddPlayer(player);
    }

    poolContainer.appendChild(card);
  });
}

function renderSummary() {
  const credits = selectedPlayers.reduce(
    (sum, p) => sum + Number(p.credit),
    0
  );

  const subsUsed = calculateSubs();
  const totalSubs = lastTotalSubsUsed + subsUsed;

  summary.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:13px;">
      <span>${selectedPlayers.length}/11</span>
      <span>${(MAX_CREDITS - credits).toFixed(1)} cr left</span>
    </div>
    <div style="font-size:11px;color:#aaa;margin-top:4px;">
      Subs: ${isFirstLock ? "Unlimited" : totalSubs + "/" + MAX_SUBS}
    </div>
  `;

  validateSave(credits, totalSubs);
}

/* ================= SUBS ================= */

function calculateSubs() {
  if (isFirstLock) return 0;

  const currentIds = selectedPlayers.map(p => p.id);

  const removed = lastLockedPlayers.filter(
    id => !currentIds.includes(id)
  );

  return removed.length;
}

/* ================= ACTIONS ================= */

function addPlayer(player) {
  if (!canAddPlayer(player)) return;
  selectedPlayers.push(player);
  renderEverything();
}

function removePlayer(id) {
  selectedPlayers = selectedPlayers.filter(p => p.id !== id);

  if (captainId === id) captainId = null;
  if (viceCaptainId === id) viceCaptainId = null;

  renderEverything();
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

  const totalCredits = selectedPlayers.reduce(
    (s, p) => s + Number(p.credit),
    0
  );

  if (totalCredits + Number(player.credit) > MAX_CREDITS) return false;

  if (
    selectedPlayers.filter(p => p.role === player.role).length >=
    ROLE_MAX[player.role]
  )
    return false;

  if (
    selectedPlayers.filter(p => p.real_team_id === player.real_team_id)
      .length >= MAX_PER_TEAM
  )
    return false;

  return true;
}

function validateSave(credits, subs) {
  const valid =
    selectedPlayers.length === 11 &&
    captainId &&
    viceCaptainId &&
    credits <= MAX_CREDITS &&
    subs <= MAX_SUBS;

  saveBar.classList.toggle("enabled", valid);
  saveBar.classList.toggle("disabled", !valid);
}
