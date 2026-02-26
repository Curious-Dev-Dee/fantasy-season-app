// home.js
import { pb } from "./pb.js";
// Note: You'll need to update notifications.js to use PocketBase later
// import { initNotificationHub } from "./notifications.js"; 

/* ELEMENTS */
const avatarElement = document.getElementById("teamAvatar");
const welcomeText   = document.getElementById("welcomeText");
const teamNameElement = document.getElementById("userTeamName");
const scoreElement = document.getElementById("userScore");
const rankElement = document.getElementById("userRank");
const subsElement = document.getElementById("subsRemaining");
const matchTeamsElement = document.getElementById("matchTeams");
const matchTimeElement = document.getElementById("matchTime");
const leaderboardContainer = document.getElementById("leaderboardContainer");
const profileModal = document.getElementById("profileModal");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const modalFullName = document.getElementById("modalFullName");
const modalTeamName = document.getElementById("modalTeamName");
const avatarInput = document.getElementById("avatarInput");

let countdownInterval;
let currentUserId = null;

/* =========================
    INIT & DASHBOARD START
========================= */

async function initializeHome() {
    if (!pb.authStore.isValid) {
        window.location.replace("/login");
        return;
    }

    currentUserId = pb.authStore.model.id;
    startDashboard(currentUserId);
}

initializeHome();

async function startDashboard(userId) {
    try {
        // Load all data from your laptop
        await Promise.allSettled([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            fetchPrivateLeagueData(userId)
        ]);
    } catch (err) {
        console.error("Dashboard error:", err);
    } finally {
        document.body.classList.remove('loading-state');
        document.body.classList.add('loaded');
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }
}

/* =========================
    CORE LOGIC
========================= */

async function fetchHomeData(userId) {
    // 1. Fetch User Data from 'users' collection
    const user = await pb.collection('users').getOne(userId);
    
    if (user) {
        const firstName = user.name ? user.name.split(" ")[0] : "Expert";
        welcomeText.textContent = `Welcome back, ${firstName}!`;
        teamNameElement.textContent = user.team_name || "Set your team name";

        // Handle Avatar (PocketBase file handling)
        if (user.avatar) {
            const url = pb.files.getUrl(user, user.avatar);
            avatarElement.style.backgroundImage = `url(${url})`;
        }
        
        // Update Stats
        scoreElement.textContent = user.total_points || 0;
        rankElement.textContent = user.rank > 0 ? `#${user.rank}` : "--";
        subsElement.textContent = user.subs_remaining ?? 0;
    }

    // 2. Fetch Upcoming Match
    try {
        const now = new Date().toISOString();
        const match = await pb.collection('matches').getFirstListItem(`date_time > "${now}"`, {
            sort: 'date_time',
        });

        if (match) {
            matchTeamsElement.textContent = `${match.team_a} vs ${match.team_b}`;
            startCountdown(match.date_time);
        }
    } catch (e) {
        matchTeamsElement.textContent = "No Upcoming Matches";
    }
}

async function loadLeaderboardPreview() {
    // Fetch top 3 from users collection
    const topUsers = await pb.collection('users').getList(1, 3, {
        sort: '-total_points',
    });

    leaderboardContainer.innerHTML = '';
    topUsers.items.forEach((row, idx) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'leader-row';
        rowDiv.innerHTML = `
            <span>#${idx + 1} <strong>${row.team_name || 'Expert'}</strong></span>
            <span class="pts-pill">${row.total_points} pts</span>
        `;
        leaderboardContainer.appendChild(rowDiv);
    });
}

function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();
    const update = () => {
        const dist = matchTime - Date.now();
        if (dist <= 0) { 
            clearInterval(countdownInterval); 
            matchTimeElement.textContent = "Match Live"; 
            return; 
        }
        const h = Math.floor(dist / 3600000), 
              m = Math.floor((dist % 3600000) / 60000), 
              s = Math.floor((dist % 60000) / 1000);
        matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${h}h ${m}m ${s}s`;
    };
    update(); 
    countdownInterval = setInterval(update, 1000);
}

/* =========================
    PROFILE SAVE LOGIC
========================= */
if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        const fullName = modalFullName.value.trim();
        const teamName = modalTeamName.value.trim();
        const file = avatarInput.files[0];

        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = "SAVING...";

        try {
            const formData = new FormData();
            formData.append('name', fullName);
            formData.append('team_name', teamName);
            if (file) formData.append('avatar', file);

            await pb.collection('users').update(currentUserId, formData);

            alert("Profile updated!");
            window.location.reload();
        } catch (err) {
            alert("Error saving profile: " + err.message);
        } finally {
            saveProfileBtn.disabled = false;
        }
    };
}

// Modal Toggle
if (avatarElement) {
    avatarElement.onclick = () => profileModal.classList.remove("hidden");
}