import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */

const teamContainer = document.getElementById("teamContainer");
const teamStatus = document.getElementById("teamStatus");
const teamTitle = document.getElementById("teamTitle");

const tabs = document.querySelectorAll(".xi-tab");

let userId;
let tournamentId;

/* =========================
   INIT
========================= */

init();

async function init() {

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  userId = session.user.id;

  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .maybeSingle();

  if (!activeTournament) {
    teamStatus.textContent = "No active tournament.";
    return;
  }

  tournamentId = activeTournament.id;

  setupTabs();
  loadCurrentXI();
}

/* =========================
   TAB SWITCHING
========================= */

function setupTabs() {
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const mode = tab.dataset.tab;

      if (mode === "current") {
        loadCurrentXI();
      } else {
        loadLastLockedXI();
      }
    });
  });
}

/* =========================
   CURRENT XI
========================= */

async function loadCurrentXI() {

  teamContainer.innerHTML = "";
  teamStatus.textContent = "Loading...";

  const { data: userTeam } = await supabase
    .from("user_fantasy_teams")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (!userTeam) {
    teamStatus.textContent = "No team created yet.";
    return;
  }

  teamTitle.textContent = userTeam.team_name || "My XI";

  const { data: teamPlayers } = await supabase
    .from("user_fantasy_team_players")
    .select("player_id")
    .eq("user_fantasy_team_id", userTeam.id);

  if (!teamPlayers?.length) {
    teamStatus.textContent = "No players selected.";
    return;
  }

  const playerIds = teamPlayers.map(p => p.player_id);

  const { data: players } = await supabase
    .from("players")
    .select("*")
    .in("id", playerIds);

  renderTeam(players, userTeam.captain_id, userTeam.vice_captain_id);

  teamStatus.textContent = "Editable XI (current team)";
}

/* =========================
   LAST LOCKED XI
========================= */

async function loadLastLockedXI() {

  teamContainer.innerHTML = "";
  teamStatus.textContent = "Loading...";

  const { data: snapshot } = await supabase
    .from("user_match_teams")
    .select("*")
    .eq("user_id", userId)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot) {
    teamStatus.textContent = "No locked XI yet. First match not started.";
    return;
  }

  const { data: match } = await supabase
    .from("matches")
    .select("match_number")
    .eq("id", snapshot.match_id)
    .maybeSingle();

  teamTitle.textContent = `Match ${match?.match_number || ""} Locked XI`;

  const { data: teamPlayers } = await supabase
    .from("user_match_team_players")
    .select("player_id")
    .eq("user_match_team_id", snapshot.id);

  if (!teamPlayers?.length) {
    teamStatus.textContent = "No players found in snapshot.";
    return;
  }

  const playerIds = teamPlayers.map(p => p.player_id);

  const { data: players } = await supabase
    .from("players")
    .select("*")
    .in("id", playerIds);

  renderTeam(players, snapshot.captain_id, snapshot.vice_captain_id);

  teamStatus.textContent =
    `Subs Used: ${snapshot.subs_used_for_match} | Total Subs Used: ${snapshot.total_subs_used}`;
}

/* =========================
   RENDER TEAM
========================= */

function renderTeam(players, captainId, viceCaptainId) {

  teamContainer.innerHTML = "";
  teamStatus.textContent = "";

  const roleOrder = ["WK", "BAT", "AR", "BOWL"];

  roleOrder.forEach(role => {

    const rolePlayers = players.filter(p => p.role === role);
    if (!rolePlayers.length) return;

    const roleSection = document.createElement("div");
    roleSection.classList.add("role-section");

    const roleTitle = document.createElement("div");
    roleTitle.classList.add("role-title");
    roleTitle.textContent = role;
    roleSection.appendChild(roleTitle);

    const row = document.createElement("div");
    row.classList.add("player-row");

    rolePlayers.forEach(player => {

      const circle = document.createElement("div");
      circle.classList.add("player-circle");

      if (player.id === captainId) {
        circle.classList.add("captain");
      }

      if (player.id === viceCaptainId) {
        circle.classList.add("vice-captain");
      }

      let badgeHTML = "";

      if (player.id === captainId) {
        badgeHTML = `<div class="badge captain-badge">C</div>`;
      } else if (player.id === viceCaptainId) {
        badgeHTML = `<div class="badge vice-badge">VC</div>`;
      }

      circle.innerHTML = `
        ${badgeHTML}
        <div class="avatar"></div>
        <div class="player-name">${player.name}</div>
      `;

      row.appendChild(circle);
    });

    roleSection.appendChild(row);
    teamContainer.appendChild(roleSection);
  });
}
