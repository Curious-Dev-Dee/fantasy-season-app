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
const tournamentNameElement = document.getElementById("tournamentName");
const editButton = document.getElementById("editXiBtn");
const viewXiBtn = document.getElementById("viewXiBtn");

let countdownInterval;

/* =========================
   INIT (With New User Fix)
========================= */
async function initHome() {
  // 1. Wait a split second to let the Google login "land"
  await new Promise(resolve => setTimeout(resolve, 500));

  const { data: { session } } = await supabase.auth.getSession();
  
  // 2. If no session, wait for an auth change event (back-up for slow connections)
  if (!session) {
    supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession) {
        startDashboard(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        window.location.href = "login.html";
      }
    });
    
    // Final check: if still nothing, go to login
    const finalCheck = await supabase.auth.getSession();
    if (!finalCheck.data.session) {
        window.location.href = "login.html";
        return;
    }
  } else {
    startDashboard(session.user.id);
  }
}

async function startDashboard(userId) {
  // Reveal dashboard and hide loader
  document.querySelector('.app-container').style.visibility = 'visible';
  const loader = document.getElementById('loadingOverlay');
  if (loader) loader.style.display = 'none';

  await loadProfile(userId);
  await loadDashboard(userId);
}

/* =========================
   PROFILE LOGIC
========================= */
async function loadProfile(userId) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile) {
    renderProfile(profile);
  } else {
    // New User default view
    welcomeText.textContent = "Welcome back, Expert";
    teamNameElement.textContent = "Set your team name in 'More'";
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

  // Pulling live stats from your dashboard_summary table
  const { data: summary } = await supabase
    .from("dashboard_summary")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", activeTournament.id)
    .maybeSingle();

  scoreElement.textContent = summary?.total_points ?? 0;
  // Use 'rank' if available, otherwise keep the default dash
  rankElement.textContent = summary?.rank ? `#${summary.rank}` : "—";
  subsElement.textContent = summary?.subs_remaining ?? 80;

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
    matchTimeElement.textContent = "Stay tuned!";
  }
}

function startCountdown(startTime) {
  if (countdownInterval) clearInterval(countdownInterval);
  const matchTime = new Date(startTime).getTime();
  
  function updateCountdown() {
    const now = new Date().getTime();
    const distance = matchTime - now;
    if (distance <= 0) {
      clearInterval(countdownInterval);
      matchTimeElement.textContent = "Match Starting"; 
      return;
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