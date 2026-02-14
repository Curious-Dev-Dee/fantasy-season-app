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

let teamMap = {};
let saving = false;

let currentTab = "myxi";

/* ================= DOM ================= */

const myXI = document.getElementById("myXIList");
const pool = document.getElementById("playerPoolList");

const saveBar = document.querySelector(".save-bar");
const saveBtn = document.querySelector(".save-btn");
const summary = document.querySelector(".team-summary");

const toggleButtons = document.querySelectorAll(".toggle-btn");
const editModes = document.querySelectorAll(".edit-mode");

/* ================= INIT ================= */

init();

async function init() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  await loadPlayers();
  await loadTeams();
  await loadLastLockedSnapshot(user.id);
  await loadSavedSeasonTeam(user.id);

  renderAll();
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

  (data || []).forEach(t => {
    teamMap[t.id] = t.short_code;
  });
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

    renderAll();
  });
});

/* ================= RENDER ================= */

function renderAll() {
  renderSummary();

  if (currentTab === "myxi") {
    renderMyXI();
  } else {
    renderPool();
  }
}

function renderMyXI() {
  myXI.innerHTML = "";

  selectedPlayers.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card selected";

    card.innerHTML = `
      <div class="player-info">
        <strong>${p.name}</strong>
        <span>${p.role} · ${p.credit} cr · ${teamMap[p.real_team_id] || ""}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="cv-btn ${captainId === p.id ? "active" : ""}">C</button>
        <button class="cv-btn ${viceCaptainId === p.id ? "active" : ""}">VC</button>
        <button class="action-btn remove">Remove</button>
      </div>
    `;

    const [cBtn, vcBtn, rBtn] = card.querySelectorAll("button");

    cBtn.onclick = () => setCaptain(p.id);
    vcBtn.onclick = () => setViceCaptain(p.id);
    rBtn.onclick = () => removePlayer(p.id);

    myXI.appendChild(card);
  });
}

function renderPool() {
  pool.innerHTML = "";

  allPlayers.forEach(player => {
    const selected = selectedPlayers.some(p => p.id === player.id);

    const card = document.createElement("div");
    card.className = "player-card";

    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr · ${teamMap[player.real_team_id] || ""}</span>
      </div>
      <button class="action-btn ${selected ? "remove" : "add"}">
        ${selected ? "Remove" : "Add"}
      </button>
    `;

    const btn = card.querySelector("button");

    btn.onclick = selected
      ? () => removePlayer(player.id)
      : () => addPlayer(player);

    btn.disabled = !selected && !canAddPlayer(player);

    pool.appendChild(card);
  });
}

function renderSummary() {
  const credits = selectedPlayers.reduce(
    (sum, p) => sum + Number(p.credit),
    0
  );

  const roleCount = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  selectedPlayers.forEach(p => roleCount[p.role]++);

  const subsUsed = calculateSubs();
  const totalSubs = lastTotalSubsUsed + subsUsed;

  summary.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:12px;">
      <span>${selectedPlayers.length}/11</span>
      <span>${credits.toFixed(1)} cr</span>
      <span>Subs ${totalSubs}/${MAX_SUBS}</span>
    </div>
    <div style="font-size:11px;color:#aaa;margin-top:4px;">
      WK ${roleCount.WK} | BAT ${roleCount.BAT} | AR ${roleCount.AR} | BOWL ${roleCount.BOWL}
    </div>
  `;

  validateSave(roleCount, credits);
}

/* ================= SUBS LOGIC ================= */

function calculateSubs() {
  if (isFirstLock) return 0;

  const currentIds = selectedPlayers.map(p => p.id);

  const removed = lastLockedPlayers.filter(
    id => !currentIds.includes(id)
  );

  return removed.length;
}

/* ================= TEAM ACTIONS ================= */

function addPlayer(player) {
  if (!canAddPlayer(player)) return;
  selectedPlayers.push(player);
  renderAll();
}

function removePlayer(id) {
  selectedPlayers = selectedPlayers.filter(p => p.id !== id);

  if (captainId === id) captainId = null;
  if (viceCaptainId === id) viceCaptainId = null;

  renderAll();
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

function validateSave(roleCount, credits) {
  const subs = lastTotalSubsUsed + calculateSubs();

  const valid =
    selectedPlayers.length === 11 &&
    captainId &&
    viceCaptainId &&
    credits <= MAX_CREDITS &&
    Object.keys(ROLE_MIN).every(r => roleCount[r] >= ROLE_MIN[r]) &&
    subs <= MAX_SUBS;

  saveBar.classList.toggle("enabled", valid);
  saveBar.classList.toggle("disabled", !valid);
}
