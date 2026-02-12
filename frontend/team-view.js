import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */

const teamContainer = document.getElementById("teamContainer");
const teamStatus = document.getElementById("teamStatus");
const teamTitle = document.getElementById("teamTitle");

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

  const userId = session.user.id;

  // Get active tournament
  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .single();

  if (!activeTournament) {
    teamStatus.textContent = "No active tournament.";
    return;
  }

  const tournamentId = activeTournament.id;

  // Get user's edited team
  const { data: userTeam } = await supabase
    .from("user_fantasy_teams")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .single();

  if (!userTeam) {
    teamStatus.textContent = "No team created yet.";
    return;
  }

  teamTitle.textContent = userTeam.team_name || "My XI";

  // Get player IDs
  const { data: teamPlayers } = await supabase
    .from("user_fantasy_team_players")
    .select("player_id")
    .eq("user_fantasy_team_id", userTeam.id);

  if (!teamPlayers?.length) {
    teamStatus.textContent = "No players selected.";
    return;
  }

  const playerIds = teamPlayers.map(p => p.player_id);

  // Get player details
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .in("id", playerIds);

  if (!players?.length) {
    teamStatus.textContent = "Players not found.";
    return;
  }

  renderTeam(players, userTeam.captain_id, userTeam.vice_captain_id);
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
        <div class="player-meta">${player.short_code || ""}</div>
      `;

      row.appendChild(circle);
    });

    roleSection.appendChild(row);
    teamContainer.appendChild(roleSection);
  });
}
