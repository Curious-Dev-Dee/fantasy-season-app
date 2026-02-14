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

let savedPlayers = [];     // DB version
let editingPlayers = [];   // Live edit version

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

    renderSummary(); // refresh summary on tab switch
  });
});

/* ================= RENDER ================= */

function rerenderAll() {
  renderMyXI();
  renderPool();
  renderSummary();
}

/* -------- MY XI (Saved only) -------- */

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
      <div style="display:flex; gap:6px;">
        <button class="cv-btn ${captainId === p.id ? "active" : ""}">C</button>
        <button class="cv-btn ${viceCaptainId === p.id ? "active" : ""}">VC</button>
      </div>
    `;

    const [c, vc] = card.querySelectorAll(".cv-btn");

    c.onclick = () => setCaptain(p.id);
    vc.onclick = () => setViceCaptain(p.id);

    myXI.appendChild(card);
  });
}

/* -------- CHANGE TAB (Editing only) -------- */

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
        ${selected ? "−" : "+"}
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

/* -------- SUMMARY -------- */

function renderSummary() {
  const source =
    document.querySelector(".myxi-mode").classList.contains("active")
      ? savedPlayers
      : editingPlayers;

  const credits = source.reduce((s,p)=>s+Number(p.credit),0).toFixed(1);
  const count = source.length;

  summary.innerHTML = `
    <div style="display:flex; justify-content:space-between; font-size:13px;">
      <div><strong>${count}</strong>/11</div>
      <div style="color:#9be15d">${MAX_CREDITS - credits} cr left</div>
    </div>
    <div style="margin-top:6px; font-size:11px; color:#aaa;">
      Subs Used: ${isFirstLock ? 0 : lastTotalSubsUsed}
    </div>
  `;

  validateSave(source, credits);
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

function setCaptain(id) {
  captainId = id;
  renderMyXI();
}

function setViceCaptain(id) {
  viceCaptainId = id;
  renderMyXI();
}

function validateSave(source, credits) {
  const roleCount = { WK:0, BAT:0, AR:0, BOWL:0 };
  source.forEach(p => roleCount[p.role]++);

  let valid =
    source.length === 11 &&
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

  const totalCredits = editingPlayers.reduce((s,p)=>s+Number(p.credit),0);

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

  savedPlayers = [...editingPlayers];
  renderMyXI();
  renderSummary();

  saveBtn.textContent = "Saved ✓";
  saving = false;
});
