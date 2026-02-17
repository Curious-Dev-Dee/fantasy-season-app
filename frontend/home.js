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
   INIT (Auth Guard Protected)
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    currentUserId = user.id;
    console.log("Home.js: Starting dashboard for", user.email);
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
    // Reveal app and hide global loader
    document.body.classList.remove('loading-state');
    
    // Parallel Execution: Fetch your data and Top 3 simultaneously
    await Promise.all([
        fetchHomeData(userId),
        loadLeaderboardPreview()
    ]);

    // Refresh data every 30s to catch live score updates
    setInterval(() => {
        fetchHomeData(userId);
        loadLeaderboardPreview();
    }, 30000); 
}

/* =========================
   CORE DASHBOARD LOGIC
========================= */
async function fetchHomeData(userId) {
    const { data, error } = await supabase
        .from('home_dashboard_view')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !data) {
        console.error("Dashboard fetch error:", error);
        return;
    }

    existingProfile = data;

    // 1. Header & Profile
    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    const firstName = data.full_name?.trim().split(" ")[0] || "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}`;
    teamNameElement.textContent = data.team_name || "Set your team name";
    
    // Modal Syncing
    modalFullName.value = data.full_name || "";
    modalTeamName.value = data.team_name || "";
    if (data.team_name) {
        modalTeamName.disabled = true;
        modalTeamName.style.opacity = "0.6";
    }

    // Avatar
    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage
            .from("team-avatars")
            .getPublicUrl(data.team_photo_url);
        
        const avatarUrl = `${imgData.publicUrl}?t=${new Date().getTime()}`;
        avatarElement.style.backgroundImage = `url(${avatarUrl})`;
        modalPreview.style.backgroundImage = `url(${avatarUrl})`;
    }

    // 2. Main Stats
    scoreElement.textContent = data.total_points || 0;
    rankElement.textContent = data.rank > 0 ? `#${data.rank}` : "—";
    subsElement.textContent = data.subs_remaining ?? 80;

    // 3. Match Logic (Delayed, Locked, Abandoned)
    const match = data.upcoming_match;

    if (match) {
        matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
        
        // ABANDONED STATUS
        if (match.status === 'abandoned') {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #ef4444; font-weight: 800;"><i class="fas fa-ban"></i> Match Abandoned</span>`;
            matchTimeElement.className = "match-time";
            editButton.disabled = false;
            editButton.textContent = "Adjust XI";
            return;
        }

        // LOCKED STATUS check
        if (match.is_locked || match.status === 'locked') {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #94a3b8;"><i class="fas fa-lock"></i> Match Started</span>`;
            matchTimeElement.className = "match-time";
            editButton.disabled = true;
            editButton.textContent = "Locked";
            editButton.style.background = "#1e293b";
        } else {
            // Check for Rain Delay warning
            const originalTime = new Date(match.original_start_time);
            const actualTime = new Date(match.actual_start_time);
            
            if (actualTime > originalTime) {
                console.log("Rain delay detected");
                // The countdown function handles the color/timer
            }
            
            startCountdown(match.actual_start_time);
            editButton.disabled = false;
            editButton.textContent = "Change";
            editButton.style.background = "#9AE000";
        }
    } else {
        matchTeamsElement.textContent = "No upcoming match";
        editButton.disabled = true;
    }
}

/* =========================
   DYNAMIC NEON COUNTDOWN
========================= */
function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();
    
    function updateCountdown() {
        const now = new Date().getTime();
        const distance = matchTime - now;

        if (distance <= 0) {
            clearInterval(countdownInterval);
            matchTimeElement.textContent = "Match Live"; 
            matchTimeElement.className = "match-time neon-green";
            return;
        }

        // THRESHOLD LOGIC
        const minsRemaining = distance / (1000 * 60);
        
        if (minsRemaining <= 10) {
            matchTimeElement.className = "match-time neon-red";
        } else if (minsRemaining <= 30) {
            matchTimeElement.className = "match-time neon-orange";
        } else {
            matchTimeElement.className = "match-time neon-green";
        }

        const h = Math.floor(distance / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${h}h ${m}m ${s}s`;
    }
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
}

/* =========================
   LEADERBOARD PREVIEW (FIXED)
========================= */
async function loadLeaderboardPreview() {
    const { data: leaderboard } = await supabase
        .from("leaderboard_view")
        .select("team_name, total_points, rank")
        .order("rank", { ascending: true })
        .limit(3);

    if (leaderboard) {
        leaderboardContainer.innerHTML = ""; 
        leaderboard.forEach(row => {
            const div = document.createElement("div");
            div.className = "leader-row";
            div.innerHTML = `
                <span>#${row.rank} <strong class="team-name-text"></strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            `;
            div.querySelector(".team-name-text").textContent = row.team_name || 'Anonymous';
            leaderboardContainer.appendChild(div);
        });
    }
}

/* =========================
   PROFILE SAVE LOGIC
========================= */
saveProfileBtn.addEventListener("click", async () => {
    const newName = modalFullName.value.trim();
    const newTeam = modalTeamName.value.trim();
    const file = avatarInput.files[0];

    if (!newName || !newTeam) return alert("All fields required.");
    saveProfileBtn.disabled = true;

    try {
        let photoPath = existingProfile?.team_photo_url;
        if (file) {
            const fileName = `${currentUserId}/${Date.now()}.png`;
            await supabase.storage.from('team-avatars').upload(fileName, file, { upsert: true });
            photoPath = fileName;
        }

        const profileData = { user_id: currentUserId, profile_completed: true };
        if (newName !== existingProfile?.full_name) profileData.full_name = newName;
        if (photoPath !== existingProfile?.team_photo_url) profileData.team_photo_url = photoPath;
        if (!existingProfile?.team_name) profileData.team_name = newTeam;

        const { error } = await supabase.from("user_profiles").upsert(profileData, { onConflict: 'user_id' });
        if (error) throw error;

        await fetchHomeData(currentUserId);
        profileModal.classList.add("hidden");
    } catch (err) {
        alert("Update failed: " + err.message);
    } finally {
        saveProfileBtn.disabled = false;
    }
});

/* =========================
   UI NAVIGATION
========================= */
avatarInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            modalPreview.style.backgroundImage = `url(${ev.target.result})`;
            modalPreview.style.backgroundSize = "cover";
        };
        reader.readAsDataURL(file);
    }
});

/* =========================
   CORRECTED UI NAVIGATION
========================= */
avatarElement.addEventListener("click", () => profileModal.classList.remove("hidden"));

profileModal.addEventListener("click", (e) => { 
    if (e.target === profileModal) profileModal.classList.add("hidden"); 
});

// "Change" Button (Edit XI) -> Goes to your team editor
editButton.addEventListener("click", () => window.location.href = "team-builder.html");

// "View Team" Button -> Goes to your team viewer
viewXiBtn.addEventListener("click", () => window.location.href = "team-view.html");

// "Full Leaderboard" -> Goes to the rankings page
viewFullLeaderboardBtn.addEventListener("click", () => window.location.href = "leaderboard.html");