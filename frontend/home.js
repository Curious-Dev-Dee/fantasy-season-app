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
const viewFullLeaderboardBtn = document.getElementById("viewFullLeaderboard");

// Modal Elements
const profileModal = document.getElementById("profileModal");
const modalFullName = document.getElementById("modalFullName");
const modalTeamName = document.getElementById("modalTeamName");
const saveProfileBtn = document.getElementById("saveProfileBtn");

let countdownInterval;
let currentUserId = null;
let currentTournamentId = null; // Stored for saving profile later

/* =========================
   INIT (Auth Guard Protected)
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    currentUserId = user.id;
    console.log("Home.js: Auth confirmed for", user.email);
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
  document.querySelector('.app-container').style.visibility = 'visible';
  const loader = document.getElementById('loadingOverlay');
  if (loader) loader.style.display = 'none';

  // SENIOR DEV CHANGE: Parallel Execution
  // We fetch User Data (View) and Top 3 Leaderboard at the same time.
  await Promise.all([
      fetchHomeData(userId),
      loadLeaderboardPreview()
  ]);

  // Refresh every 30s
  setInterval(() => {
    fetchHomeData(userId);
    loadLeaderboardPreview();
  }, 30000); 
}

/* =========================
   DATA FETCHING (Optimized)
========================= */
async function fetchHomeData(userId) {
    // ONE DB CALL to get Profile, Rank, Subs, Tournament, and Next Match
    const { data, error } = await supabase
        .from('home_dashboard_view')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !data) {
        console.error("Dashboard fetch error:", error);
        return;
    }

    currentTournamentId = data.tournament_id;

    // 1. Render Header & Tournament
    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    
    // 2. Render Profile
    const firstName = data.full_name?.trim().split(" ")[0] || "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}`;
    teamNameElement.textContent = data.team_name || "Set your team name";
    
    // Populate Modal Inputs
    if (modalFullName.value === "") modalFullName.value = data.full_name || "";
    if (modalTeamName.value === "") modalTeamName.value = data.team_name || "";

    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage
            .from("team-avatars")
            .getPublicUrl(data.team_photo_url);
        avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
        avatarElement.style.backgroundSize = "cover";
    }

    // 3. Render Stats
    scoreElement.textContent = data.total_points;
    rankElement.textContent = data.rank > 0 ? `#${data.rank}` : "—";
    subsElement.textContent = data.subs_remaining;

    // 4. Render Upcoming Match (Parsed from JSON)
    const match = data.upcoming_match;
    if (match) {
        matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
        
        // Handle Lock State
        if (match.is_locked) {
            editButton.disabled = true;
            editButton.textContent = "Locked 🔒";
            editButton.style.background = "#1f2937"; 
            editButton.style.color = "#4b5563";      
        } else {
            editButton.disabled = false;
            editButton.textContent = "Change";
            editButton.style.background = "#9AE000"; 
            editButton.style.color = "#0c1117";
        }

        startCountdown(match.start_time);
    } else {
        matchTeamsElement.textContent = "No upcoming match";
        matchTimeElement.textContent = "Check Fixtures";
        editButton.disabled = true;
    }
}

async function loadLeaderboardPreview() {
  // We still keep this separate because the View is User-Specific,
  // but we need the Global Top 3 here.
  const { data: leaderboard } = await supabase
    .from("leaderboard_view")
    .select("team_name, total_points, rank")
    .order("rank", { ascending: true })
    .limit(3);

  if (leaderboard && leaderboard.length > 0) {
    leaderboardContainer.innerHTML = ""; 
    leaderboard.forEach(row => {
      const div = document.createElement("div");
      div.className = "leader-row";
      div.innerHTML = `<span>#${row.rank} <span class="team-name-text"></span></span>
                       <span>${row.total_points} pts</span>`;
      div.querySelector(".team-name-text").textContent = row.team_name || 'Anonymous';
      leaderboardContainer.appendChild(div);
    });
  }
}

/* =========================
   UTILITIES
========================= */
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

/* =========================
   MODAL & NAVIGATION
========================= */
avatarElement.addEventListener("click", () => profileModal.classList.remove("hidden"));
profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) profileModal.classList.add("hidden");
});

// NOTE: We still write to the TABLE 'user_profiles', not the view.
saveProfileBtn.addEventListener("click", async () => {
  const name = modalFullName.value.trim();
  const tName = modalTeamName.value.trim();

  if (!name || !tName) { alert("Please fill in both fields!"); return; }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving...";

  const { error } = await supabase
    .from("user_profiles")
    .upsert({ 
      user_id: currentUserId, 
      full_name: name, 
      team_name: tName,
      profile_completed: true 
    }, { onConflict: 'user_id' });
    
  if (error) {
    console.error("Save error:", error);
    alert("Error saving profile. Try again.");
  } else {
    // Refresh the view data immediately to show changes
    fetchHomeData(currentUserId);
    profileModal.classList.add("hidden");
  }

  saveProfileBtn.disabled = false;
  saveProfileBtn.textContent = "Save & Start";
});

// Navigation (Clean URLs)
editButton.addEventListener("click", () => window.location.href = "/team-builder");
viewXiBtn.addEventListener("click", () => window.location.href = "/team-view");
viewFullLeaderboardBtn.addEventListener("click", () => window.location.href = "/leaderboard");