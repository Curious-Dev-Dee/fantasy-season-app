import { supabase } from "./supabase.js";
import { initNotificationHub } from "./notifications.js";

const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";

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
const editButton = document.getElementById("editXiBtn");
const boosterStatusEl = document.getElementById("boosterStatus");
const profileModal = document.getElementById("profileModal");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const modalFullName = document.getElementById("modalFullName");
const modalTeamName = document.getElementById("modalTeamName");
const avatarInput = document.getElementById("avatarInput");
const modalPreview = document.getElementById("modalAvatarPreview");
const viewXiBtn = document.getElementById("viewXiBtn");
const viewFullLeaderboardBtn = document.getElementById("viewFullLeaderboard");

let countdownInterval;
let currentUserId = null;
let existingProfile = null; 

/* =========================
   INIT & DASHBOARD START
========================= */

// SAFETY: Remove black screen after 6 seconds even if Supabase fails
setTimeout(() => {
    if (document.body.classList.contains('loading-state')) {
        console.warn("Forcing screen reveal due to connection delay...");
        document.body.classList.remove('loading-state');
        document.body.classList.add('loaded');
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }
}, 6000);

async function initializeHome() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            currentUserId = session.user.id;
            startDashboard(currentUserId);
        }
    } catch (err) { console.error("Auth check failed:", err); }
}

initializeHome();

window.addEventListener('auth-verified', (e) => {
    if (currentUserId) return; // Prevent double-start
    currentUserId = e.detail.user.id;
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
    initNotificationHub(userId);
    setupHomeLeagueListeners(userId); 

    try {
        // We load what we can. If one fails, the others still try.
        await Promise.allSettled([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            fetchPrivateLeagueData(userId)
        ]);
    } catch (err) {
        console.error("Dashboard data load error:", err);
    } finally {
        // REMOVE BLACK SCREEN
        document.body.classList.remove('loading-state');
        document.body.classList.add('loaded');
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }
}

/* =========================
   CORE LOGIC (Updated for Vanity)
========================= */
async function fetchHomeData(userId) {
    // 1. Fetch Profile with NEW Vanity Columns
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, team_name, team_photo_url, prediction_coins, equipped_frame, equipped_flex')
        .eq('user_id', userId)
        .maybeSingle();

    if (profile) {
        existingProfile = profile;
        const firstName = profile.full_name ? profile.full_name.split(" ")[0] : "Expert";
        welcomeText.textContent = `Welcome back, ${firstName}!`;
        
        // Apply Name Flex
        teamNameElement.textContent = profile.team_name || "Set your team name";
        if (profile.equipped_flex && profile.equipped_flex !== 'none') {
            teamNameElement.className = `team-subtitle ${profile.equipped_flex}`;
        }

        // Apply Avatar and Frame
        if (profile.team_photo_url) {
            const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url);
            avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
            if (profile.equipped_frame && profile.equipped_frame !== 'none') {
                avatarElement.className = `team-avatar ${profile.equipped_frame}`;
            }
        }
        
        // Update Coin Pill if you added it to HTML
        const coinPill = document.getElementById("userCoins");
        if (coinPill) coinPill.textContent = profile.prediction_coins || 0;
    }

    // 2. Fetch Stats from View
    const { data: dash } = await supabase.from('home_dashboard_view').select('*').eq('user_id', userId).maybeSingle();
    
    if (dash) {
        scoreElement.textContent = dash.total_points || 0;
        rankElement.textContent = dash.user_rank > 0 ? `#${dash.user_rank}` : "--";
        subsElement.textContent = dash.subs_remaining ?? 0;
        if (boosterStatusEl) boosterStatusEl.textContent = dash.s8_booster_used ? "0" : "1";

        const match = dash.upcoming_match;
        if (match) {
            matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
            startCountdown(match.actual_start_time);
        }
    }
}

// ... (KEEP your loadLeaderboardPreview, fetchPrivateLeagueData, and other functions exactly as they were)
async function loadLeaderboardPreview() {
    // 1. Fetch top 3 users from the overall leaderboard view
    const { data: lb } = await supabase
        .from("leaderboard_view")
        .select("team_name, total_points, rank, user_id")
        .order("rank", { ascending: true })
        .limit(3);
    
    if (lb) {
        leaderboardContainer.innerHTML = ''; // Clear "Updating..." text
        
        lb.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'leader-row';
            
            // Navigate to scouting view with both ID and Name
            rowDiv.onclick = () => {
                const scoutName = encodeURIComponent(row.team_name || 'Expert');
                window.location.href = `team-view.html?uid=${row.user_id}&name=${scoutName}`;
            };
            
            // Security: Use an empty <strong> then fill it with textContent to prevent XSS
            rowDiv.innerHTML = `
                <span>#${row.rank} <strong class="team-name-text"></strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            `;
            
            // Fill the team name securely
            rowDiv.querySelector('.team-name-text').textContent = row.team_name || 'Expert';
            
            leaderboardContainer.appendChild(rowDiv);
        });

        // 2. Update the "YOUR RANK" badge in the section header
        const rankHeader = document.getElementById("overallUserRank");
        if (rankHeader) {
            rankHeader.textContent = rankElement.textContent;
        }
    }
}

async function fetchPrivateLeagueData(userId) {
    const card = document.getElementById('privateLeagueCard');
    const leagueNameEl = document.getElementById('privateLeagueName');
    const inviteCodeEl = document.getElementById('privateInviteCode');
    const contentEl = document.getElementById('privateLeagueContent');
    const emptyStateEl = document.getElementById('noLeagueState');
    const containerEl = document.getElementById('privateLeaderboardContainer');
    const viewBtn = document.getElementById("viewPrivateLeaderboard");

    if (!card) return; 

    const { data: m, error } = await supabase
        .from('league_members')
        .select('league_id, leagues(name, invite_code)')
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !m) {
        card.classList.remove('hidden');
        if (contentEl) contentEl.classList.add('hidden');
        if (emptyStateEl) emptyStateEl.classList.remove('hidden');
        if (leagueNameEl) leagueNameEl.textContent = "Private League";
        return;
    }

    card.classList.remove('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    
    if (leagueNameEl) leagueNameEl.textContent = m.leagues.name;
    
    // --- COPY TO CLIPBOARD LOGIC ---
    if (inviteCodeEl) {
        inviteCodeEl.textContent = m.leagues.invite_code;
        inviteCodeEl.style.cursor = "pointer";
        inviteCodeEl.title = "Click to copy";
        
        inviteCodeEl.onclick = () => {
            navigator.clipboard.writeText(m.leagues.invite_code);
            const originalText = inviteCodeEl.textContent;
            inviteCodeEl.textContent = "COPIED!";
            inviteCodeEl.style.color = "#9AE000";
            
            setTimeout(() => {
                inviteCodeEl.textContent = originalText;
                inviteCodeEl.style.color = "#fff";
            }, 2000);
        };
    }

    if (viewBtn) {
        viewBtn.onclick = () => {
            window.location.href = `leaderboard.html?league_id=${m.league_id}`;
        };
    }

    const { data: lb } = await supabase
        .from('private_league_leaderboard')
        .select('team_name, total_points, rank_in_league, user_id')
        .eq('league_id', m.league_id)
        .order('total_points', { ascending: false })
        .limit(3);

    if (lb && containerEl) {
        containerEl.innerHTML = '';
        lb.forEach((row) => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'leader-row';
            rowDiv.onclick = () => {
                const scoutName = encodeURIComponent(row.team_name || 'Expert');
                window.location.href = `team-view.html?uid=${row.user_id}&name=${scoutName}`;
            };

            rowDiv.innerHTML = `
                <span>#${row.rank_in_league} <strong class="team-name-text"></strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            `;
            rowDiv.querySelector('.team-name-text').textContent = row.team_name || 'Expert';
            containerEl.appendChild(rowDiv);
        });

        const userRow = lb.find(r => r.user_id === userId);
        const rankSpan = document.getElementById('privateLeagueRank');
        if (rankSpan && userRow) rankSpan.textContent = `#${userRow.rank_in_league}`;
    }
}

function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();
    const update = () => {
        const dist = matchTime - Date.now();
        if (dist <= 0) { clearInterval(countdownInterval); matchTimeElement.textContent = "Match Live"; return; }
        const h = Math.floor(dist / 3600000), m = Math.floor((dist % 3600000) / 60000), s = Math.floor((dist % 60000) / 1000);
        matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${h}h ${m}m ${s}s`;
    };
    update(); countdownInterval = setInterval(update, 1000);
}

/* =========================
   HOME LEAGUE ACTIONS
========================= */
function setupHomeLeagueListeners(userId) {
    const createBtn = document.getElementById("homeCreateLeagueBtn");
    const joinBtn = document.getElementById("homeJoinLeagueBtn");

    if (!createBtn || !joinBtn) return;

    createBtn.onclick = async () => {
        const name = prompt("Enter a cool name for your League:");
        if (!name) return;
        
        // Generate unique code
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const { data: league, error } = await supabase
            .from("leagues")
            .insert([{ name, invite_code: inviteCode, owner_id: userId }])
            .select()
            .single();

        if (error) return alert("Error creating league: " + error.message);

        await supabase.from("league_members").insert([{ league_id: league.id, user_id: userId }]);
        
        // Refresh the dashboard data immediately
        fetchPrivateLeagueData(userId);
    };

    joinBtn.onclick = async () => {
        const code = prompt("Enter Invite Code:");
        if (!code) return;

        const { data: league } = await supabase
            .from("leagues")
            .select("id")
            .eq("invite_code", code.toUpperCase())
            .maybeSingle();

        if (!league) return alert("Invalid Code!");

        const { error } = await supabase
            .from("league_members")
            .insert([{ league_id: league.id, user_id: userId }]);

        if (error) return alert("You're already in this league or it failed.");
        
        // Refresh the dashboard data immediately
        fetchPrivateLeagueData(userId);
    };
}

/* =========================
   PROFILE SAVE LOGIC
========================= */
if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        if (!modalFullName || !modalTeamName || !avatarInput || !profileModal) return;

        const fullName = modalFullName.value.trim();
        const teamName = modalTeamName.value.trim();
        const file = avatarInput.files[0];

        if (!fullName || !teamName) return alert("Please enter both your name and team name!");

        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = "SAVING...";

        try {
            let photoPath = existingProfile?.team_photo_url;

            // 1. Handle Avatar Upload if a new file is selected
            if (file) {
                const fileExt = file.name.split('.').pop();
                const fileName = `${currentUserId}-${Math.random()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                    .from('team-avatars')
                    .upload(fileName, file, { upsert: true });

                if (uploadError) throw uploadError;
                photoPath = fileName;
            }

            // 2. Update User Profile in Database
            const { error: updateError } = await supabase
                .from('user_profiles')
                .update({
                    full_name: fullName,
                    team_name: teamName,
                    team_photo_url: photoPath,
                    profile_completed: true
                })
                .eq('user_id', currentUserId);

            if (updateError) throw updateError;

            // 3. Success! Refresh and Close
            alert("Profile updated successfully!");
            profileModal.classList.add("hidden");
            window.location.reload(); // Reload to reflect changes across the dashboard

        } catch (err) {
            console.error("Save error:", err.message);
            alert("Failed to save profile. Please try again.");
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = "Save & Start";
        }
    };
}

// Handle Image Preview when a user selects a file
if (avatarInput) {
    avatarInput.onchange = () => {
        const file = avatarInput.files[0];
        if (file && modalPreview) {
            const reader = new FileReader();
            reader.onload = (e) => {
                modalPreview.style.backgroundImage = `url(${e.target.result})`;
            };
            reader.readAsDataURL(file);
        }
    };
}

const closeBtn = document.getElementById("closeProfileModal");
if (closeBtn) {
    closeBtn.onclick = () => profileModal?.classList.add("hidden");
}

/* =========================
    REFINED UI EVENTS
========================= */

// 1. Profile Modal Control
if (avatarElement) {
    avatarElement.onclick = () => {
        if (!profileModal || !modalFullName || !modalTeamName) return;
        if (existingProfile) {
            modalFullName.value = existingProfile.full_name || "";
            modalTeamName.value = existingProfile.team_name || "";
        }
        profileModal.classList.remove("hidden");
    };
}

// Close Button
if (closeBtn) {
    closeBtn.onclick = () => profileModal?.classList.add("hidden");
}

// 2. Navigation Actions
if (editButton) {
    editButton.onclick = () => {
        window.location.href = "team-builder.html";
    };
}

if (viewXiBtn) {
    viewXiBtn.onclick = () => {
        if (!existingProfile?.team_name || existingProfile.team_name === "Set your team name") {
            alert("Please set your team name in your profile first!");
            profileModal?.classList.remove("hidden");
        } else {
            window.location.href = `team-view.html?uid=${currentUserId}`;
        }
    };
}

if (viewFullLeaderboardBtn) {
    viewFullLeaderboardBtn.onclick = () => {
        window.location.href = "leaderboard.html";
    };
}

// 3. Global Click Handler (Close modal on outside click)
window.addEventListener('click', (event) => {
    if (profileModal && event.target === profileModal) {
        profileModal.classList.add("hidden");
    }
});
