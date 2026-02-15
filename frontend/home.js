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

// Modal Elements
const profileModal = document.getElementById("profileModal");
const modalFullName = document.getElementById("modalFullName");
const modalTeamName = document.getElementById("modalTeamName");
const saveProfileBtn = document.getElementById("saveProfileBtn");

let countdownInterval;
let currentUserId = null;

/* =========================
   INIT
========================= */
async function initHome() {
  await new Promise(resolve => setTimeout(resolve, 500));
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession) {
        currentUserId = newSession.user.id;
        startDashboard(currentUserId);
        authListener.subscription.unsubscribe();
      } else if (event === 'SIGNED_OUT') {
        window.location.href = "login.html";
      }
    });
    
    const finalCheck = await supabase.auth.getSession();
    if (!finalCheck.data.session) {
        window.location.href = "login.html";
        return;
    }
  } else {
    currentUserId = session.user.id;
    startDashboard(currentUserId);
  }
}

async function startDashboard(userId) {
  document.querySelector('.app-container').style.visibility = 'visible';
  const loader = document.getElementById('loadingOverlay');
  if (loader) loader.style.display = 'none';

  await loadProfile(userId);
  await loadDashboard(userId);
  await loadLeaderboardPreview();

  setInterval(() => {
    loadDashboard(userId);
    loadLeaderboardPreview();
  }, 30000); 
}

/* =========================
   PROFILE & MODAL LOGIC
========================= */

avatarElement.addEventListener("click", () => {
  profileModal.classList.remove("hidden");
});

profileModal.addEventListener("click", (e) => {
  if (e.target === profileModal) {
    profileModal.classList.add("hidden");
  }
});

async function loadProfile(userId) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile) {
    renderProfile(profile);
    modalFullName.value = profile.full_name || "";
    modalTeamName.value = profile.team_name || "";
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

saveProfileBtn.addEventListener("click", async () => {
  const name = modalFullName.value.trim();
  const tName = modalTeamName.value.trim();

  if (!name || !tName) {
    alert("Please fill in both fields!");
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving...";

  const { error } = await supabase
    .from("user_profiles")
    .update({ 
      full_name: name, 
      team_name: tName,
      profile_completed: true 
    })
    .eq("user_id", currentUserId);

  if (error) {
    console.error("Save error:", error);
    alert("Error saving profile. Try again.");
  } else {
    welcomeText.textContent = `Welcome back, ${name.split(" ")[0]}`;
    teamNameElement.textContent = tName;
    profileModal.classList.add("hidden");
  }

  saveProfileBtn.disabled = false;
  saveProfileBtn.textContent = "Save & Start";
});

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
  subsElement.textContent = summary?.subs_remaining ?? 80;

  const { data: rankData } = await supabase
    .from("leaderboard_view")
    .select("rank")
    .eq("user_id", userId)
    .maybeSingle();

  rankElement.textContent = rankData?.rank ? `#${rankData.rank}` : "—";

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

    // 🔒 --- NEW LOCKING UI LOGIC START ---
    // If match is locked, disable editing
    const isLocked = upcomingMatch.lock_processed === true;

    if (isLocked) {
        editButton.disabled = true;
        editButton.textContent = "Locked 🔒";
        editButton.style.background = "#1f2937"; 
        editButton.style.color = "#4b5563";      
    } else {
        editButton.disabled = false;
        editButton.textContent = "Edit XI";
        editButton.style.background = "#9AE000"; 
        editButton.style.color = "#0c1117";
    }
    // 🔒 --- NEW LOCKING UI LOGIC END ---

    startCountdown(upcomingMatch.start_time);
  } else {
    matchTeamsElement.textContent = "No upcoming match";
    editButton.disabled = true; 
  }
}

async function loadLeaderboardPreview() {
  const { data: leaderboard } = await supabase
    .from("leaderboard_view")
    .select("team_name, total_points, rank")
    .order("rank", { ascending: true })
    .limit(3);

  if (leaderboard && leaderboard.length > 0) {
    leaderboardContainer.innerHTML = leaderboard.map(row => `
      <div class="leader-row">
        <span>#${row.rank} ${row.team_name || 'Anonymous'}</span>
        <span>${row.total_points} pts</span>
      </div>
    `).join("");
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