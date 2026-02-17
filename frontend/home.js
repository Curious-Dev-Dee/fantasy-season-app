import { supabase } from "./supabase.js";

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

// Modal Elements
const profileModal = document.getElementById("profileModal");
const modalFullName = document.getElementById("modalFullName");
const modalTeamName = document.getElementById("modalTeamName");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const avatarInput = document.getElementById("avatarInput");
const modalPreview = document.getElementById("modalAvatarPreview");

let countdownInterval;
let currentUserId = null;
let existingProfile = null; // Stores original data to prevent unauthorized overwrites

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

    // Parallel Execution: Fetch your data and Top 3 simultaneously
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
   DATA FETCHING (Using View)
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

    // Save existing data for defensive comparison
    existingProfile = data;

    // 1. Render Header
    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    
    // 2. Render Profile
    const firstName = data.full_name?.trim().split(" ")[0] || "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}`;
    teamNameElement.textContent = data.team_name || "Set your team name";
    
    // Sync Modal Inputs
    modalFullName.value = data.full_name || "";
    modalTeamName.value = data.team_name || "";

    // TEAM NAME LOCK: If a team name exists, disable the input
    if (data.team_name) {
        modalTeamName.disabled = true;
        modalTeamName.style.opacity = "0.6";
        modalTeamName.style.cursor = "not-allowed";
    }

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
   SAVE PROFILE (Defensive Save)
========================= */
/* =========================
   SAVE PROFILE (Defensive)
========================= */
saveProfileBtn.addEventListener("click", async () => {
    const newName = modalFullName.value.trim();
    const newTeam = modalTeamName.value.trim();
    const file = avatarInput.files[0];

    if (!newName || !newTeam) return alert("Please fill all fields.");

    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Saving...";

    try {
        let photoPath = existingProfile?.team_photo_url;

        // 1. Handle Upload (Folder: userId/timestamp.png)
        if (file) {
            const fileName = `${currentUserId}/${Date.now()}.${file.name.split('.').pop()}`;
            const { error: upErr } = await supabase.storage
                .from('team-avatars')
                .upload(fileName, file, { upsert: true });
            
            if (upErr) throw upErr;
            photoPath = fileName;
        }

        // 2. Build Defensive Payload
        const profileData = { 
            user_id: currentUserId, 
            profile_completed: true 
        };

        // Only send full_name if it changed
        if (newName !== existingProfile?.full_name) {
            profileData.full_name = newName;
        }

        // Only update photo if a new one was uploaded
        if (photoPath !== existingProfile?.team_photo_url) {
            profileData.team_photo_url = photoPath;
        }
        
        // ONLY send team_name if it was previously empty
        // This stops the error for users like Satyaranjan who already have 'AvengersCTC'
        if (!existingProfile?.team_name) {
            profileData.team_name = newTeam;
        }

        // 3. Perform the Database Upsert
        const { error: dbErr } = await supabase
            .from("user_profiles")
            .upsert(profileData, { onConflict: 'user_id' });

        if (dbErr) throw dbErr;

        // Success Cleanup
        await fetchHomeData(currentUserId);
        profileModal.classList.add("hidden");

    } catch (err) {
        console.error("Save Error:", err.message);
        alert(err.message || "Update failed. Check your connection.");
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
   UI NAVIGATION & MODAL
========================= */
avatarElement.addEventListener("click", () => profileModal.classList.remove("hidden"));
profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) profileModal.classList.add("hidden");
});

// Clean URLs
editButton.addEventListener("click", () => window.location.href = "/team-builder");
viewXiBtn.addEventListener("click", () => window.location.href = "/team-view");
viewFullLeaderboardBtn.addEventListener("click", () => window.location.href = "/leaderboard");