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
const leaderboardLink = document.getElementById("leaderboardLink");
const tournamentNameElement = document.getElementById("tournamentName");

const editButton = document.getElementById("editXiBtn");
const viewXiBtn = document.getElementById("viewXiBtn");

let countdownInterval;

/* =========================
   INIT
========================= */
async function initHome() {
  // Listen for auth state to handle new signups who land here immediately
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      const userId = session.user.id;
      await loadProfile(userId);
      await loadDashboard(userId);
    } else {
      window.location.href = "login.html";
    }
  });

  // Initial check
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadProfile(session.user.id);
    await loadDashboard(session.user.id);
  }
}

/* =========================
   PROFILE (FIXED FOR POPUP)
========================= */
async function loadProfile(userId) {
  console.log("Checking profile for:", userId);

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Profile fetch error:", error);
    return;
  }

  // If NO profile exists (!) or profile_completed is explicitly false
  if (!profile || profile.profile_completed === false) {
    console.log("Profile incomplete. Showing modal.");
    modal.classList.remove("hidden");
    modal.style.display = "flex"; // Double-check visibility
  } else {
    console.log("Profile complete. Rendering UI.");
    modal.classList.add("hidden");
    modal.style.display = "none";
    renderProfile(profile);
  }
}

function renderProfile(profile) {
  const firstName = profile.full_name?.trim().split(" ")[0] || "Expert";
  welcomeText.textContent = `Welcome back, Expert ${firstName}`;
  teamNameElement.textContent = profile.team_name || "—";
}

// SAVE ACTION
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
   DASHBOARD & COUNTDOWN (Rest unchanged)
========================= */
async function loadDashboard(userId) {
  const { data: activeTournament } = await supabase.from("active_tournament").select("*").maybeSingle();
  if (!activeTournament) return;
  
  tournamentNameElement.textContent = activeTournament.name;

  // Additional dashboard logic here...
}

// Helper functions for buttons and countdown
function enableEditButton() { editButton.style.opacity = "1"; editButton.style.pointerEvents = "auto"; }
function disableEditButton() { editButton.style.opacity = "0.5"; editButton.style.pointerEvents = "none"; }

initHome();