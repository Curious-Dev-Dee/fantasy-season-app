import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

// =========================
// GLOBAL STATE
// =========================
let lastLockedPlayers = [];
let lastTotalSubsUsed = 0;
let isFirstLock = true;

// =========================
// AUTH
// =========================
async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// =========================
// DOM
// =========================
const toggleButtons = document.querySelectorAll(".toggle-btn");
const editModes = document.querySelectorAll(".edit-mode");
const myXI = document.querySelector(".myxi-mode .player-list");
const pool = document.querySelector(".change-mode .player-list");
const saveBtn = document.querySelector(".save-btn");

// =========================
// MODE TOGGLE
// =========================
toggleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    toggleButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    editModes.forEach(m => m.classList.remove("active"));
    document.querySelector(`.${btn.dataset.mode}-mode`)?.classList.add("active");

    updateSummary();
  });
});

// =========================
// CAPTAIN / VC
// =========================
document.addEventListener("click", e => {
  const t = e.target;

  if (t.classList.contains("btn-captain")) {
    document.querySelectorAll(".btn-captain.active")
      .forEach(b => b.classList.remove("active"));
    t.classList.add("active");
  }

  if (t.classList.contains("btn-vice")) {
    document.querySelectorAll(".btn-vice.active")
      .forEach(b => b.classList.remove("active"));
    t.classList.add("active");
  }
});

// =========================
// ADD / REMOVE
// =========================
document.addEventListener("click", e => {
  const t = e.target;

  if (t.classList.contains("btn-add")) {
    const card = t.closest(".player-card");
    card.classList.add("selected");
    t.remove();

    const actions = document.createElement("div");
    actions.className = "player-actions";
    actions.innerHTML = `
      <button class="btn-captain">C</button>
      <button class="btn-vice">VC</button>
      <button class="btn-remove">−</button>
    `;

    card.appendChild(actions);
    myXI.appendChild(card);
    updateSummary();
  }

  if (t.classList.contains("btn-remove")) {
    const card = t.closest(".player-card");

    card.classList.remove("selected");
    card.querySelector(".player-actions")?.remove();

    const addBtn = document.createElement("button");
    addBtn.className = "btn-add";
    addBtn.textContent = "+";
    card.appendChild(addBtn);

    pool.appendChild(card);
    updateSummary();
  }
});

// =========================
// LOAD LAST LOCKED SNAPSHOT
// =========================
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

// =========================
// SUMMARY
// =========================
function updateSummary() {
  const players = myXI.querySelectorAll(".player-card");
  const summary = document.querySelector(".team-summary");
  const saveBar = document.querySelector(".save-bar");

  let credits = 0;
  let roles = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };

  players.forEach(p => {
    credits += Number(p.dataset.credit);
    roles[p.dataset.role]++;
  });

  const hasC = document.querySelector(".btn-captain.active");
  const hasVC = document.querySelector(".btn-vice.active");

  // =========================
  // SUB CALCULATION
  // =========================
  let subsUsed = 0;
  let remainingSubs = 80 - lastTotalSubsUsed;

  if (!isFirstLock) {
    const currentPlayers = [...players].map(p => p.dataset.id);
    subsUsed = currentPlayers.filter(
      p => !lastLockedPlayers.includes(p)
    ).length;
  }

  let subsHTML = "";

  if (isFirstLock) {
    subsHTML = `
      <div style="margin-top:8px;">
        <strong>Subs:</strong> Unlimited (before first match lock)
      </div>
    `;
  } else {
    subsHTML = `
      <div style="margin-top:8px;">
        <strong>Subs Used:</strong> ${subsUsed}
        &nbsp; | &nbsp;
        <strong>Remaining:</strong> ${remainingSubs}
      </div>
    `;
  }

  summary.innerHTML = `
    <div style="display:flex; justify-content:space-between;">
      <span>Credits</span>
      <strong>${credits.toFixed(1)} / 100</strong>
    </div>
    <div style="display:flex; justify-content:space-between; margin-top:6px;">
      <span>WK ${roles.WK}</span>
      <span>BAT ${roles.BAT}</span>
      <span>AR ${roles.AR}</span>
      <span>BOWL ${roles.BOWL}</span>
    </div>
    ${subsHTML}
  `;

  let canSave = players.length === 11 && credits <= 100 && hasC && hasVC;

  if (!isFirstLock) {
    if (subsUsed > remainingSubs) {
      canSave = false;
    }
  }

  if (canSave) {
    saveBar.classList.add("enabled");
    saveBar.classList.remove("disabled");
    saveBtn.textContent = "Save team";
  } else {
    saveBar.classList.add("disabled");
    saveBar.classList.remove("enabled");
    saveBtn.textContent = "Fix your XI to save";
  }
}

// =========================
// LOAD PLAYERS
// =========================
async function loadPlayers() {
  const { data, error } = await supabase
    .from("players")
    .select("id, name, role, credit")
    .eq("is_active", true)
    .order("credit", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  pool.innerHTML = "";

  data.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card";
    card.dataset.id = player.id;
    card.dataset.role = player.role;
    card.dataset.credit = player.credit;

    card.innerHTML = `
      <div class="player-info">
        <strong>${player.name}</strong>
        <span>${player.role} · ${player.credit} cr</span>
      </div>
      <button class="btn-add">+</button>
    `;

    pool.appendChild(card);
  });
}

// =========================
// LOAD SAVED TEAM
// =========================
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

  document.querySelectorAll(".change-mode .player-card")
    .forEach(card => {
      if (savedIds.includes(card.dataset.id)) {
        card.classList.add("selected");
        card.querySelector(".btn-add")?.remove();

        const actions = document.createElement("div");
        actions.className = "player-actions";
        actions.innerHTML = `
          <button class="btn-captain">C</button>
          <button class="btn-vice">VC</button>
          <button class="btn-remove">−</button>
        `;

        card.appendChild(actions);
        myXI.appendChild(card);
      }
    });

  myXI.querySelectorAll(".player-card").forEach(card => {
    if (card.dataset.id === String(team.captain_id)) {
      card.querySelector(".btn-captain")?.classList.add("active");
    }
    if (card.dataset.id === String(team.vice_captain_id)) {
      card.querySelector(".btn-vice")?.classList.add("active");
    }
  });

  updateSummary();
}

// =========================
// SAVE
// =========================
async function saveSeasonTeam() {
  const user = await getCurrentUser();
  if (!user) return;

  const players = myXI.querySelectorAll(".player-card");

  const playerIds = [];
  let totalCredits = 0;
  let captainId = null;
  let viceCaptainId = null;

  players.forEach(card => {
    playerIds.push(card.dataset.id);
    totalCredits += Number(card.dataset.credit);

    if (card.querySelector(".btn-captain.active")) captainId = card.dataset.id;
    if (card.querySelector(".btn-vice.active")) viceCaptainId = card.dataset.id;
  });

  if (!isFirstLock) {
    const currentPlayers = [...players].map(p => p.dataset.id);
    const subsUsed = currentPlayers.filter(
      p => !lastLockedPlayers.includes(p)
    ).length;

    const remainingSubs = 80 - lastTotalSubsUsed;

    if (subsUsed > remainingSubs) {
      alert(`You only have ${remainingSubs} substitutions remaining.`);
      return;
    }
  }

  const { data: existing } = await supabase
    .from("user_fantasy_teams")
    .select("id")
    .eq("user_id", user.id)
    .eq("tournament_id", TOURNAMENT_ID)
    .maybeSingle();

  let teamId;

  if (existing) {
    await supabase
      .from("user_fantasy_teams")
      .update({
        captain_id: captainId,
        vice_captain_id: viceCaptainId,
        total_credits: totalCredits,
      })
      .eq("id", existing.id);

    await supabase
      .from("user_fantasy_team_players")
      .delete()
      .eq("user_fantasy_team_id", existing.id);

    teamId = existing.id;
  } else {
    const { data } = await supabase
      .from("user_fantasy_teams")
      .insert({
        user_id: user.id,
        tournament_id: TOURNAMENT_ID,
        captain_id: captainId,
        vice_captain_id: viceCaptainId,
        total_credits: totalCredits,
      })
      .select()
      .single();

    teamId = data.id;
  }

  const rows = playerIds.map(id => ({
    user_fantasy_team_id: teamId,
    player_id: id,
  }));

  await supabase.from("user_fantasy_team_players").insert(rows);

  alert("Team saved successfully.");
}

// =========================
// INIT
// =========================
async function init() {
  const user = await getCurrentUser();
  if (!user) return;

  await loadLastLockedSnapshot(user.id);
  await loadPlayers();
  await loadSavedSeasonTeam();
}

init();

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const saveBar = saveBtn.closest(".save-bar");
    if (!saveBar.classList.contains("enabled")) return;

    saveBtn.disabled = true;
    await saveSeasonTeam();
    saveBtn.disabled = false;
  });
}
