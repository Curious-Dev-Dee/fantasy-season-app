import { supabase } from "./supabase.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

/* =========================
   ELEMENTS & STATE
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

const profileModal = document.getElementById("profileModal");
const modalFullName = document.getElementById("modalFullName");
const modalTeamName = document.getElementById("modalTeamName");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const avatarInput = document.getElementById("avatarInput");
const modalPreview = document.getElementById("modalAvatarPreview");

let countdownInterval;
let currentUserId = null;
let existingProfile = null; 

/* =========================
   INIT
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    currentUserId = user.id;
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
    document.body.classList.remove('loading-state');
    await Promise.all([fetchHomeData(userId), loadLeaderboardPreview()]);
    setInterval(() => { fetchHomeData(userId); loadLeaderboardPreview(); }, 30000); 
}

/* =========================
   CORE LOGIC
========================= */
async function fetchHomeData(userId) {
    const { data, error } = await supabase.from('home_dashboard_view').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return;
    existingProfile = data;

    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    welcomeText.textContent = `Welcome back, ${data.full_name?.split(" ")[0] || "Expert"}`;
    teamNameElement.textContent = data.team_name || "Set your team name";
    
    modalFullName.value = data.full_name || "";
    modalTeamName.value = data.team_name || "";
    if (data.team_name) {
        modalTeamName.disabled = true;
        modalTeamName.style.opacity = "0.6";
    }

    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(data.team_photo_url);
        avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
        modalPreview.style.backgroundImage = `url(${imgData.publicUrl})`;
    }

    scoreElement.textContent = data.total_points || 0;
    rankElement.textContent = data.rank > 0 ? `#${data.rank}` : "—";
    subsElement.textContent = data.subs_remaining ?? 80;

    const match = data.upcoming_match;
    if (match) {
        matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
        
        if (match.status === 'abandoned') {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #ef4444; font-weight: 800;">Match Abandoned 🚫</span>`;
            editButton.disabled = false;
            return;
        }

        if (match.is_locked || match.status === 'locked') {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #94a3b8;"><i class="fas fa-lock"></i> Match Started</span>`;
            editButton.disabled = true;
        } else {
            startCountdown(match.actual_start_time);
            editButton.disabled = false;
        }
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
            matchTimeElement.textContent = "Match Started";
            matchTimeElement.className = "match-time neon-green";
            return;
        }

        // Color Logic
        const minutes = distance / (1000 * 60);
        if (minutes <= 10) {
            matchTimeElement.className = "match-time neon-red";
        } else if (minutes <= 30) {
            matchTimeElement.className = "match-time neon-orange";
        } else {
            matchTimeElement.className = "match-time neon-green";
        }

        const h = Math.floor(distance / 3600000);
        const m = Math.floor((distance % 3600000) / 60000);
        const s = Math.floor((distance % 60000) / 1000);
        matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${h}h ${m}m ${s}s`;
    }
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
}

// ... Profile Save & Navigation Listeners same as before ...
// (Omitted for brevity, but keep your existing saveProfileBtn and nav logic)

/* =========================
   UI NAVIGATION & MODAL
========================= */
avatarElement.addEventListener("click", () => profileModal.classList.remove("hidden"));
profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) profileModal.classList.add("hidden");
});

// Navigation links (Updated to match your filenames)
editButton.addEventListener("click", () => window.location.href = "prediction.html");
viewXiBtn.addEventListener("click", () => window.location.href = "view-team.html");
viewFullLeaderboardBtn.addEventListener("click", () => window.location.href = "leaderboard.html");