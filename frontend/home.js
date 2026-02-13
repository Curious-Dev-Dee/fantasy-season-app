import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */
const modal = document.getElementById("profileModal");
const saveBtn = document.getElementById("saveProfileBtn");
const fullNameInput = document.getElementById("fullNameInput");
const teamNameInput = document.getElementById("teamNameInput");

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
   INIT (THE LOOP FIX)
========================= */
async function initHome() {
  // 1. First, check if there is an active session
  const { data: { session }, error } = await supabase.auth.getSession();

  if (session) {
    // Session exists, proceed to load data
    await setupUser(session.user.id);
  } else {
    // 2. If no session, wait for a few seconds for auth to "settle"
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        await setupUser(user.id);
    } else {
        // 3. Only redirect if absolutely no user is found after checks
        window.location.href = "login.html";
    }
  }
}

async function setupUser(userId) {
    // Show the dashboard container once user is verified
    document.querySelector('.app-container').style.visibility = 'visible';
    await loadProfile(userId);
    await loadDashboard(userId);
}

/* =========================
   PROFILE & POPUP LOGIC
========================= */
async function loadProfile(userId) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // If new user (no record) or record is marked incomplete
  if (!profile || profile.profile_completed === false) {
    modal.classList.remove("hidden");
    modal.style.display = "flex";
  } else {
    renderProfile(profile);
  }
}

function renderProfile(profile) {
  const firstName = profile.full_name?.trim().split(" ")[0] || "Expert";
  welcomeText.textContent = `Welcome back, Expert ${firstName}`;
  teamNameElement.textContent = profile.team_name || "—";
}

/* =========================
   SAVE ACTION
========================= */
saveBtn.addEventListener("click", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const fullName = fullNameInput.value.trim();
  const teamName = teamNameInput.value.trim();

  if (!fullName || !teamName) {
    alert("Please enter both Name and Team Name.");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const { error } = await supabase
    .from("user_profiles")
    .upsert({
      user_id: session.user.id,
      full_name: fullName,
      team_name: teamName,
      profile_completed: true,
      is_active: true
    });

  if (error) {
    alert("Save Error: " + error.message);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & Continue";
  } else {
    location.reload();
  }
});

/* =========================
   DASHBOARD LOGIC (Same as before)
========================= */
async function loadDashboard(userId) {
    // ... existing loadDashboard code ...
}

// ... rest of helper functions ...

initHome();