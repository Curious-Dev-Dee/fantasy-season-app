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
const avatarInput = document.getElementById("avatarInput");
const modalPreview = document.getElementById("modalAvatarPreview");

let countdownInterval;
let currentUserId = null;
let currentTournamentId = null;

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

    // Parallel Execution
    await Promise.all([
        fetchHomeData(userId),
        loadLeaderboardPreview()
    ]);

    setInterval(() => {
        fetchHomeData(userId);
        loadLeaderboardPreview();
    }, 30000); 
}

/* =========================
   DATA FETCHING
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

    currentTournamentId = data.tournament_id;

    // 1. Render Header
    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    
    // 2. Render Profile
    const firstName = data.full_name?.trim().split(" ")[0] || "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}`;
    teamNameElement.textContent = data.team_name || "Set your team name";
    
    // Sync Modal Inputs (Only if they are empty)
    if (modalFullName.value === "") modalFullName.value = data.full_name || "";
    if (modalTeamName.value === "") modalTeamName.value = data.team_name || "";

    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage
            .from("team-avatars")
            .getPublicUrl(data.team_photo_url);
        
        const avatarUrl = `${imgData.publicUrl}?t=${new Date().getTime()}`; // Cache busting
        avatarElement.style.backgroundImage = `url(${avatarUrl})`;
        modalPreview.style.backgroundImage = `url(${avatarUrl})`;
    }

    // 3. Stats
    scoreElement.textContent = data.total_points;
    rankElement.textContent = data.rank > 0 ? `#${data.rank}` : "—";
    subsElement.textContent = data.subs_remaining;

    // 4. Upcoming Match
    const match = data.upcoming_match;
    if (match) {
        matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
        
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
        editButton.disabled = true;
    }
}

/* =========================
   IMAGE PREVIEW LOGIC
========================= */
avatarInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            modalPreview.style.backgroundImage = `url(${e.target.result})`;
            modalPreview.style.backgroundSize = "cover";
            modalPreview.style.backgroundPosition = "center";
        };
        reader.readAsDataURL(file);
    }
});

/* =========================
   SAVE PROFILE (Upload + Upsert)
========================= */
saveProfileBtn.addEventListener("click", async () => {
    const name = modalFullName.value.trim();
    const tName = modalTeamName.value.trim();
    const file = avatarInput.files[0];

    if (!name || !tName) {
        alert("Please enter both your name and team name!");
        return;
    }

    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Uploading...";

    let photoPath = null;

    try {
        // 1. Upload Image to Storage if file selected
        if (file) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${currentUserId}-${Math.floor(Date.now() / 1000)}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage
                .from('team-avatars')
                .upload(fileName, file, { upsert: true });

            if (uploadError) throw uploadError;
            photoPath = fileName;
        }

        // 2. Prepare Data for Database
        const profileData = { 
            user_id: currentUserId, 
            full_name: name, 
            team_name: tName,
            profile_completed: true 
        };

        if (photoPath) profileData.team_photo_url = photoPath;

        // 3. Upsert to user_profiles table
        const { error: dbError } = await supabase
            .from("user_profiles")
            .upsert(profileData, { onConflict: 'user_id' });

        if (dbError) throw dbError;

        // 4. Success: UI Cleanup
        await fetchHomeData(currentUserId);
        profileModal.classList.add("hidden");
        avatarInput.value = ""; // Clear file selection

    } catch (err) {
        console.error("Save Error:", err);
        alert("Something went wrong while saving your profile.");
    } finally {
        saveProfileBtn.disabled = false;
        saveProfileBtn.textContent = "Save & Start";
    }
});

/* =========================
   LEADERBOARD & UTILS
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
            div.innerHTML = `<span>#${row.rank} <span class="team-name-text"></span></span>
                             <span>${row.total_points} pts</span>`;
            div.querySelector(".team-name-text").textContent = row.team_name || 'Anonymous';
            leaderboardContainer.appendChild(div);
        });
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
        const h = Math.floor(distance / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        matchTimeElement.textContent = `Starts in ${h}h ${m}m ${s}s`;
    }
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
}

/* =========================
   NAVIGATION
========================= */
avatarElement.addEventListener("click", () => profileModal.classList.remove("hidden"));
profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) profileModal.classList.add("hidden");
});

editButton.addEventListener("click", () => window.location.href = "/team-builder");
viewXiBtn.addEventListener("click", () => window.location.href = "/team-view");
viewFullLeaderboardBtn.addEventListener("click", () => window.location.href = "/leaderboard");