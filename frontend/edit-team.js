import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

/* =========================
   TEAM RULES
========================= */

const MAX_PLAYERS = 11;
const MAX_CREDITS = 100;
const MAX_PER_TEAM = 6;

const ROLE_MIN = { WK: 1, BAT: 3, AR: 1, BOWL: 3 };
const ROLE_MAX = { WK: 4, BAT: 6, AR: 4, BOWL: 6 };

/* =========================
   STATE
========================= */

let selectedPlayers = [];
let allPlayers = [];
let lastLockedPlayers = [];
let lastTotalSubsUsed = 0;
let isFirstLock = true;

/* =========================
   DOM
========================= */

const myXI = document.querySelector(".myxi-mode .player-list");
const pool = document.querySelector(".change-mode .player-list");
const saveBtn = document.querySelector(".save-btn");
const saveBar = document.querySelector(".save-bar");
const summary = document.querySelector(".team-summary");

/* =========================
   AUTH
========================= */

async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/* =========================
   INIT
========================= */

async function init() {
  const user = await getCurrentUser();
  if (!user) return;

  await loadLastLockedSnapshot(user.id);
  await loadPlayers();
  await loadSavedSeasonTeam();
  updateUI();
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

  allPlayers = data;
  renderPool();
}

/* =========================
   RENDER POOL
========================= */

function renderPool() {
  pool.innerHTML = "";

  allPlayers.forEach(player => {
    const card = createPlayerCard(player);
    pool.appendChild(card);
  });
}

/* =========================
   CREATE CARD
========================= */

function createPlayerCard(player) {
  const card = document.createElement("div");
  card.className = "player-card";
  card.dataset.id = player.id;

  card.innerHTML = `
    <div class="player-info">
      <strong>${player.name}</strong>
      <span>${player.role} · ${player.credit} cr</span>
    </div>
    <button class="action-btn"></button>
  `;

  updateCardState(card, player);

  return card;
}

/* =========================
   UPDATE CARD STATE
========================= */

function updateCardState(card, player) {
  const btn = card.querySelector(".action-btn");
  const isSelected = selectedPlayers.some(p => p.id === player.id);

  if (isSelected) {
    btn.textContent = "Remove";
    btn.className = "action-btn remove";
    btn.onclick = () => removePlayer(player.id);
  } else {
    btn.textContent = "Add";
    btn.className = "action-btn add";

    if (canAddPlayer(player)) {
      btn.disabled = false;
      btn.onclick = () => addPlayer(player);
    } else {
      btn.disabled = true;
    }
  }
}

/* =========================
   ADD PLAYER
========================= */

function addPlayer(player) {
  if (!canAddPlayer(player)) return;

  selectedPlayers.push(player);
  updateUI();
}

/* =========================
   REMOVE PLAYER
========================= */

function removePlayer(playerId) {
  selectedPlayers = selectedPlayers.filter(p => p.id !== playerId);
  updateUI();
}

/* =========================
   VALIDATION
========================= */

function canAddPlayer(player) {
  if (selectedPlayers.length >= MAX_PLAYERS) return false;

  const creditsUsed = getCreditsUsed();
  if (creditsUsed + Number(player.credit) > MAX_CREDITS) return false;

  const roleCount = getRoleCount();
  if (roleCount[player.role] >= ROLE_MAX[player.role]) return false;

  const teamCount = getTeamCount();
  if (teamCount[player.real_team_id] >= MAX_PER_TEAM) return false;

  return true;
}

function getCreditsUsed() {
  return selectedPlayers.reduce((sum, p) => sum + Number(p.credit), 0);
}

function getRoleCount() {
  const count = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  selectedPlayers.forEach(p => count[p.role]++);
  return count;
}

function getTeamCount() {
  const count = {};
  selectedPlayers.forEach(p => {
    count[p.real_team_id] = (count[p.real_team_id] || 0) + 1;
  });
  return count;
}

/* =========================
   UI UPDATE
========================= */

function updateUI() {
  renderMyXI();
  renderPool();
  updateSummary();
}

/* =========================
   RENDER MY XI
========================= */

function renderMyXI() {
  myXI.innerHTML = "";

  selectedPlayers.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card selected";
    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr</span>
      </div>
      <button class="action-btn remove">Remove</button>
    `;
    card.querySelector("button").onclick = () => removePlayer(player.id);
    myXI.appendChild(card);
  });
}

/* =========================
   SUMMARY
========================= */

function updateSummary() {
  const credits = getCreditsUsed();
  const roleCount = getRoleCount();

  let subsHTML = "";

  if (isFirstLock) {
    subsHTML = `<div><strong>Subs:</strong> Unlimited</div>`;
  } else {
    const subsUsed = selectedPlayers
      .map(p => p.id)
      .filter(id => !lastLockedPlayers.includes(id)).length;

    const remaining = 80 - lastTotalSubsUsed;

    subsHTML = `
      <div>
        <strong>Subs Used:</strong> ${subsUsed} |
        <strong>Remaining:</strong> ${remaining}
      </div>
    `;
  }

  summary.innerHTML = `
    <div>Credits: ${credits} / 100</div>
    <div>WK ${roleCount.WK} | BAT ${roleCount.BAT} | AR ${roleCount.AR} | BOWL ${roleCount.BOWL}</div>
    ${subsHTML}
  `;

  validateSaveButton(roleCount, credits);
}

/* =========================
   SAVE VALIDATION
========================= */

function validateSaveButton(roleCount, credits) {
  let valid = true;

  if (selectedPlayers.length !== 11) valid = false;
  if (credits > MAX_CREDITS) valid = false;

  for (let role in ROLE_MIN) {
    if (roleCount[role] < ROLE_MIN[role]) valid = false;
  }

  if (!valid) {
    saveBar.classList.add("disabled");
    saveBar.classList.remove("enabled");
    return;
  }

  saveBar.classList.add("enabled");
  saveBar.classList.remove("disabled");
}

/* =========================
   LAST LOCKED SNAPSHOT
========================= */

async function loadLastLockedSnapshot(userId) {
  const { data: snapshot } = await supabase
    .from("user_match_teams")
    .select("id, total_subs_used")
    .eq("user_id", userId)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot) {
    isFirstLock = true;
    return;
  }

  isFirstLock = false;
  lastTotalSubsUsed = snapshot.total_subs_used;

  const { data: players } = await supabase
    .from("user_match_team_players")
    .select("player_id")
    .eq("user_match_team_id", snapshot.id);

  lastLockedPlayers = players.map(p => String(p.player_id));
}

/* =========================
   LOAD SAVED TEAM
========================= */

async function loadSavedSeasonTeam() {
  const user = await getCurrentUser();
  if (!user) return;

  const { data: team } = await supabase
    .from("user_fantasy_teams")
    .select("*")
    .eq("user_id", user.id)
    .eq("tournament_id", TOURNAMENT_ID)
    .maybeSingle();

  if (!team) return;

  const { data: players } = await supabase
    .from("user_fantasy_team_players")
    .select("player_id")
    .eq("user_fantasy_team_id", team.id);

  const savedIds = players.map(p => String(p.player_id));
  selectedPlayers = allPlayers.filter(p => savedIds.includes(p.id));
  updateUI();
}
