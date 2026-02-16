import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */

const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary = document.getElementById("leaderboardSummary");

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

  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .single();

  if (!activeTournament) {
    leaderboardSummary.textContent = "No active tournament.";
    return;
  }

  const tournamentId = activeTournament.id;

  const { data: leaderboard } = await supabase
    .from("leaderboard_view")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("rank", { ascending: true });

  if (!leaderboard || leaderboard.length === 0) {
    leaderboardSummary.textContent = "No rankings available yet.";
    return;
  }

  renderLeaderboard(leaderboard, userId);
}

/* =========================
   RENDER
========================= */

function renderLeaderboard(leaderboard, userId) {

  leaderboardContainer.innerHTML = "";

  const totalUsers = leaderboard.length;

  const currentUserRow = leaderboard.find(row => row.user_id === userId);

  if (currentUserRow) {
    leaderboardSummary.innerHTML = `
      You are ranked <strong>#${currentUserRow.rank}</strong> 
      with <strong>${currentUserRow.total_points}</strong> points 
      out of ${totalUsers} participants.
    `;
  } else {
    leaderboardSummary.innerHTML = `
      ${totalUsers} participants in this tournament.
    `;
  }

  leaderboard.forEach(row => {

    const div = document.createElement("div");
    div.classList.add("leader-row");

    if (row.user_id === userId) {
      div.classList.add("you");
    }

    // NEW: Add Click Logic to Scout other teams
    div.onclick = () => {
      // Passes User ID and Team Name to the Team View page
      window.location.href = `team-view.html?uid=${row.user_id}&name=${encodeURIComponent(row.team_name)}`;
    };

    div.innerHTML = `
  <div class="leader-rank">#${row.rank}</div>
  <div class="leader-team">${row.team_name}</div>
  <div class="leader-points-group">
    <span class="leader-points">${row.total_points}</span>
    <span class="leader-arrow">›</span>
  </div>
`;

    leaderboardContainer.appendChild(div);
  });
}