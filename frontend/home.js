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
    .single();

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

/* SAVE PROFILE */

saveBtn.addEventListener("click", async () => {

  const fullName = fullNameInput.value.trim();
  const teamName = teamNameInput.value.trim();

  if (!fullName || !teamName) {
    alert("Name and Team Name are mandatory.");
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const user = session.user;

  let photoPath = null;

  if (teamPhotoInput.files.length > 0) {
    const file = teamPhotoInput.files[0];
    const fileExt = file.name.split(".").pop();
    const fileName = `${user.id}.${fileExt}`;

    const { error } = await supabase.storage
      .from("team-avatars")
      .upload(fileName, file, { upsert: true });

    if (error) {
      alert("Image upload failed.");
      return;
    }

    photoPath = fileName;
  }

  await supabase
    .from("user_profiles")
    .update({
      full_name: fullName,
      team_name: teamName,
      team_photo_url: photoPath,
      profile_completed: true
    })
    .eq("user_id", user.id);

  modal.classList.add("hidden");
  initHome();
});

/* =========================
   DASHBOARD
========================= */

async function loadDashboard(userId) {

  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .single();

  if (!activeTournament) return;

  const tournamentId = activeTournament.id;
  tournamentNameElement.textContent = activeTournament.name;

  /* SUMMARY */

  const { data: summary } = await supabase
    .from("dashboard_summary")
    .select("*")
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .single();

  scoreElement.textContent = summary?.total_points ?? 0;
  subsElement.textContent = summary?.subs_remaining ?? 80;

  /* UPCOMING MATCH */

  const { data: upcomingMatch } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .gt("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(1)
    .single();

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
  window.location.href = "team-builder.html";
});

viewXiBtn.addEventListener("click", () => {
  window.location.href = "team-view.html";
});

/* =========================
   AVATAR UPDATE
========================= */

avatarElement.addEventListener("click", async () => {

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.onchange = async () => {

    const file = input.files[0];
    if (!file) return;

    const { data: { session } } = await supabase.auth.getSession();
    const user = session.user;

    const fileExt = file.name.split(".").pop();
    const fileName = `${user.id}.${fileExt}`;

    const { error } = await supabase.storage
      .from("team-avatars")
      .upload(fileName, file, { upsert: true });

    if (error) {
      alert("Upload failed.");
      return;
    }

    await supabase
      .from("user_profiles")
      .update({ team_photo_url: fileName })
      .eq("user_id", user.id);

    initHome();
  };

  input.click();
});

initHome();
