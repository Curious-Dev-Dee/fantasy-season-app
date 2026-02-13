import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */

const modal = document.getElementById("profileModal");
const saveBtn = document.getElementById("saveProfileBtn");

const fullNameInput = document.getElementById("fullNameInput");
const teamNameInput = document.getElementById("teamNameInput");
const teamPhotoInput = document.getElementById("teamPhotoInput");

const avatarElement = document.getElementById("teamAvatar");
const welcomeText = document.getElementById("welcomeText");
const teamNameElement = document.getElementById("userTeamName");

const scoreElement = document.getElementById("userScore");
const rankElement = document.getElementById("userRank");
const subsElement = document.getElementById("subsRemaining");

const matchTeamsElement = document.getElementById("matchTeams");
const matchTimeElement = document.getElementById("matchTime");

const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardLink = document.getElementById("leaderboardLink");

const tournamentNameElement = document.getElementById("tournamentName");

const editButton = document.getElementById("editXiBtn");
const viewXiBtn = document.getElementById("viewXiBtn");

let countdownInterval;

/* =========================
   INIT
========================= */

async function initHome() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const userId = session.user.id;

  await loadProfile(userId);
  await loadDashboard(userId);
}

/* =========================
   PROFILE
========================= */

async function loadProfile(userId) {

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return;

  if (!profile.profile_completed) {
    modal.classList.remove("hidden");
  } else {
    renderProfile(profile);
  }
}

function renderProfile(profile) {

  const firstName = profile.full_name?.trim().split(" ")[0] || "Expert";
  welcomeText.textContent = `Welcome back, Expert ${firstName}`;
  teamNameElement.textContent = profile.team_name || "—";

  if (profile.team_photo_url) {
    const { data } = supabase.storage
      .from("team-avatars")
      .getPublicUrl(profile.team_photo_url);

    avatarElement.style.backgroundImage = `url(${data.publicUrl})`;
    avatarElement.style.backgroundSize = "cover";
    avatarElement.style.backgroundPosition = "center";
  } else {
    avatarElement.style.backgroundImage = "none";
  }
}

/* =========================
   DASHBOARD
========================= */

async function loadDashboard(userId) {

  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .maybeSingle();

  if (!activeTournament) return;

  const tournamentId = activeTournament.id;
  tournamentNameElement.textContent = activeTournament.name;

  /* SUMMARY */

  const { data: summary } = await supabase
    .from("dashboard_summary")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  scoreElement.textContent = summary?.total_points ?? 0;

  /* =========================
     SUB + EDIT LOCK LOGIC
  ========================== */

  const { data: lastSnapshot } = await supabase
    .from("user_match_teams")
    .select("total_subs_used")
    .eq("user_id", userId)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSnapshot) {
    subsElement.textContent = "Unlimited";
    enableEditButton();
  } else {
    const remaining = 80 - lastSnapshot.total_subs_used;
    subsElement.textContent = remaining;

    if (remaining <= 0) {
      disableEditButton();
    } else {
      enableEditButton();
    }
  }

  /* UPCOMING MATCH */

  const { data: upcomingMatch } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
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

      matchTeamsElement.textContent =
        `${teamA?.short_code || ""} vs ${teamB?.short_code || ""}`;
    }

    startCountdown(upcomingMatch.start_time);

  } else {
    matchTeamsElement.textContent = "No upcoming match";
    matchTimeElement.textContent = "";
  }

  /* LEADERBOARD */

  const { data: leaderboard } = await supabase
    .from("leaderboard_view")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("rank", { ascending: true });

  leaderboardContainer.innerHTML = "";
  rankElement.textContent = "—";

  if (leaderboard?.length) {

    leaderboard.forEach(row => {
      if (row.user_id === userId) {
        rankElement.textContent = `#${row.rank}`;
      }
    });

    leaderboard.slice(0, 5).forEach(row => {
      const div = document.createElement("div");
      div.classList.add("leader-row");

      if (row.user_id === userId) {
        div.classList.add("you");
      }

      div.innerHTML = `
        <span>${row.rank}</span>
        <span>${row.team_name}</span>
        <span>${row.total_points}</span>
      `;

      leaderboardContainer.appendChild(div);
    });
  }
}

/* =========================
   EDIT BUTTON CONTROL
========================= */

function disableEditButton() {
  editButton.textContent = "XI Locked";
  editButton.style.pointerEvents = "none";
  editButton.style.opacity = "0.6";
}

function enableEditButton() {
  editButton.textContent = "Edit XI";
  editButton.style.pointerEvents = "auto";
  editButton.style.opacity = "1";
}

/* =========================
   COUNTDOWN
========================= */

function startCountdown(startTime) {

  clearInterval(countdownInterval);

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

    matchTimeElement.textContent =
      `Starts in ${hours}h ${minutes}m ${seconds}s`;
  }

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

/* =========================
   NAVIGATION
========================= */

if (leaderboardLink) {
  leaderboardLink.addEventListener("click", () => {
    window.location.href = "leaderboard.html";
  });
}

editButton.addEventListener("click", () => {
  if (editButton.style.pointerEvents === "none") return;
  window.location.href = "team-builder.html";
});

viewXiBtn.addEventListener("click", () => {
  window.location.href = "team-view.html";
});

initHome();
