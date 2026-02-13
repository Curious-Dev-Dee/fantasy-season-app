import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */
const avatarElement = document.getElementById("teamAvatar");
const welcomeText = document.getElementById("welcomeText");
const teamNameElement = document.getElementById("userTeamName");
const scoreElement = document.getElementById("userScore");
const rankElement = document.getElementById("userRank");
const subsElement = document.getElementById("subsRemaining");
const matchTeamsElement = document.getElementById("matchTeams");
const matchTimeElement = document.getElementById("matchTime");
const leaderboardContainer = document.getElementById("leaderboardContainer");
const tournamentNameElement = document.getElementById("tournamentName");
const editButton = document.getElementById("editXiBtn");
const viewXiBtn = document.getElementById("viewXiBtn");

let countdownInterval;

/* =========================
   INIT
========================= */
async function initHome() {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const userId = session.user.id;

  // Reveal dashboard and hide any loaders immediately
  document.querySelector('.app-container').style.visibility = 'visible';
  const loader = document.getElementById('loadingOverlay');
  if (loader) loader.style.display = 'none';

  await loadProfile(userId);
  await loadDashboard(userId);
}

/* =========================
   PROFILE (NON-BLOCKING)
========================= */
async function loadProfile(userId) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // If no profile, we just use defaults
  if (profile) {
    renderProfile(profile);
  } else {
    welcomeText.textContent = "Welcome back, Expert";
    teamNameElement.textContent = "Set your team name";
  }
}

function renderProfile(profile) {
  const firstName = profile.full_name?.trim().split(" ")[0] || "Expert";
  welcomeText.textContent = `Welcome back, ${firstName}`;
  teamNameElement.textContent = profile.team_name || "Set your team name";

  if (profile.team_photo_url) {
    const { data } = supabase.storage
      .from("team-avatars")
      .getPublicUrl(profile.team_photo_url);
    avatarElement.style.backgroundImage = `url(${data.publicUrl})`;
    avatarElement.style.backgroundSize = "cover";
    avatarElement.style.backgroundPosition = "center";
  }
}

/* =========================
   DASHBOARD LOGIC
========================= */
async function loadDashboard(userId) {
  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .maybeSingle();

  if (!activeTournament) return;
  tournamentNameElement.textContent = activeTournament.name;

  const { data: summary } = await supabase
    .from("dashboard_summary")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", activeTournament.id)
    .maybeSingle();

  scoreElement.textContent = summary?.total_points ?? 0;

  const { data: upcomingMatch } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", activeTournament.id)
    .gt("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (upcomingMatch) {
    const { data: teams } = await supabase
      .from("real_teams")
      .select("id, short_code")
      .in("id", [upcomingMatch.team_a_id, upcomingMatch.team_b_id]);

    if (teams?.length === 2) {
      const teamA = teams.find(t => t.id === upcomingMatch.team_a_id);
      const teamB = teams.find(t => t.id === upcomingMatch.team_b_id);
      matchTeamsElement.textContent = `${teamA?.short_code || ""} vs ${teamB?.short_code || ""}`;
    }
    startCountdown(upcomingMatch.start_time);
  } else {
    matchTeamsElement.textContent = "No upcoming match";
  }
}

function startCountdown(startTime) {
  clearInterval(countdownInterval);
  const matchTime = new Date(startTime).getTime();
  function updateCountdown() {
    const now = new Date().getTime();
    const distance = matchTime - now;
    if (distance <= 0) {
      clearInterval(countdownInterval);
      matchTimeElement.textContent = "Match Starting"; return;
    }
    const hours = Math.floor(distance / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    matchTimeElement.textContent = `Starts in ${hours}h ${minutes}m ${seconds}s`;
  }
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

// Event Listeners
editButton.addEventListener("click", () => window.location.href = "team-builder.html");
viewXiBtn.addEventListener("click", () => window.location.href = "team-view.html");

initHome();