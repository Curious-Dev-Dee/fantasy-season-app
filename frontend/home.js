import { supabase } from "./supabase.js";
import { initNotificationHub } from "./notifications.js";

// REMOVED: Hardcoded TOURNAMENT_ID. We will fetch this dynamically.
let activeTournamentId = null;

/* ELEMENTS */
const tournamentTitle = document.getElementById("tournamentName");
const avatarElement = document.getElementById("teamAvatar");
const welcomeText = document.getElementById("welcomeText");
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

/* =========================
   PAGE LOAD TRANSITION
========================= */

// Define the reveal function globally so it's easy to use


/* =========================
   PAGE LOAD TRANSITION
========================= */

// Declare it once at the top
function revealApp() {
    if (document.body.classList.contains('loaded')) return; // Prevent double trigger
    
    document.body.classList.remove('loading-state');
    document.body.classList.add('loaded');
    
    // Physically hide the overlay after the CSS fade finishes
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }, 600); 
}

// SAFETY: Force reveal after 6 seconds
setTimeout(() => {
    if (document.body.classList.contains('loading-state')) {
        console.warn("Safety trigger: Revealing app content...");
        revealApp();
    }
}, 6000);


window.addEventListener('auth-verified', (e) => {
    if (currentUserId) return; 
    currentUserId = e.detail.user.id;
    startDashboard(currentUserId);
});

/* =========================
   DASHBOARD INITIALIZATION
========================= */

async function startDashboard(userId) {
    initNotificationHub(userId);
    setupHomeLeagueListeners(userId); 

    try {
        const { data: activeT } = await supabase.from('active_tournament').select('*').maybeSingle();
        if (activeT) {
            activeTournamentId = activeT.id;
            if (tournamentTitle) tournamentTitle.textContent = activeT.name;
        }

        await Promise.allSettled([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            fetchPrivateLeagueData(userId)
        ]);
    } catch (err) {
        console.error("Dashboard data load error:", err);
    } finally {
        // Just call the function here! 
        revealApp(); 
    }
}

/* =========================
   CORE LOGIC
========================= */
async function fetchHomeData(userId) {
    // 1. Profile Logic
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (profile) {
        existingProfile = profile;
        if (!profile.profile_completed) {
            if (profileModal) {
                profileModal.classList.remove("hidden");
                const closeBtn = document.getElementById("closeProfileModal");
                if (closeBtn) closeBtn.style.display = "none"; 
                profileModal.setAttribute('data-forced', 'true');
            }
        }

        const firstName = profile.full_name ? profile.full_name.split(" ")[0] : "Expert";
        welcomeText.textContent = `Welcome back, ${firstName}!`;
        teamNameElement.textContent = profile.team_name || "Set your team name";
        
        if (profile.team_photo_url) {
            const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url);
            avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
        }
    }

    // 2. IPL Dashboard Stats
    // We query the view, but we must ensure it targets our active tournament
    const { data: dash } = await supabase
        .from('home_dashboard_view')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    
 /* =========================
       IPL 2026 DASHBOARD RENDER
    ========================= */
    if (dash) {
        // 1. Update Scores and Ranks
        scoreElement.textContent = dash.total_points || 0;
        rankElement.textContent = (dash.user_rank && dash.user_rank > 0) ? `#${dash.user_rank}` : "--";

        // 2. Substitution Logic (Handling the 999 "Magic Number")
        const match = dash.upcoming_match;
        
        if (dash.subs_remaining === 999 || (match && (match.match_number === 1 || match.match_number === 71))) {
            subsElement.textContent = "UNLIMITED";
            subsElement.style.color = "#9AE000"; // Make it glow green
        } else {
            subsElement.textContent = dash.subs_remaining ?? 150;
            subsElement.style.color = ""; // Reset to default CSS color
        }

// 3. Next Match Card Logic
if (dash && dash.upcoming_match) {
    const match = dash.upcoming_match;
    
    // Update Team Names
    matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;

    // Get Storage Bucket Instance
    const bucket = supabase.storage.from("team-logos");

    // Build Public URLs for logos
    const logoAUrl = match.team_a_logo 
        ? bucket.getPublicUrl(match.team_a_logo).data.publicUrl 
        : 'images/default-team.png'; // Fallback icon

    const logoBUrl = match.team_b_logo 
        ? bucket.getPublicUrl(match.team_b_logo).data.publicUrl 
        : 'images/default-team.png';

    const teamALogo = document.getElementById("teamALogo");
    const teamBLogo = document.getElementById("teamBLogo");

    if (teamALogo && teamBLogo) {
        teamALogo.style.backgroundImage = `url('${logoAUrl}')`;
        teamBLogo.style.backgroundImage = `url('${logoBUrl}')`;
        
        // Show them (overriding the display:none from CSS if still there)
        teamALogo.style.display = "block";
        teamBLogo.style.display = "block";
    }

    // Start the Countdown Timer
    startCountdown(match.actual_start_time);
} else {
    matchTeamsElement.textContent = "No Upcoming Matches";
    if (matchTimeElement) matchTimeElement.textContent = "Check back soon!";
}

// 4. Booster Status
if (boosterStatusEl) {
    boosterStatusEl.textContent = dash.s8_booster_used ? "0" : "1";
}
    }}
// ... Keep your existing loadLeaderboardPreview, fetchPrivateLeagueData, startCountdown, etc. ...

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
        
        if (dist <= 0) { 
            clearInterval(countdownInterval); 
            matchTimeElement.textContent = "Match Live"; 
            
            // SENIOR UI LOCK: Stop user interaction immediately
            if (editButton) {
                editButton.disabled = true;
                editButton.style.opacity = "0.5";
                editButton.style.pointerEvents = "none"; // Hard lock against clicks
                editButton.textContent = "LOCKED";
            }

            // SENIOR SYNC: Wait 5s for the Edge Function to finish 'Locking' the match
            // so the next 'Upcoming' match is ready when we reload.
            setTimeout(() => {
                window.location.reload(); 
            }, 5000); 
            return; 
        }
        
        const h = Math.floor(dist / 3600000);
        const m = Math.floor((dist % 3600000) / 60000);
        const s = Math.floor((dist % 60000) / 1000);
        
        matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${h}h ${m}m ${s}s`;
        
        // Visual Warning: Turn the timer red if less than 15 minutes remain
        if (dist < 900000) {
            matchTimeElement.classList.remove('neon-green');
            matchTimeElement.classList.add('neon-red');
        }
    };
    
    update(); 
    countdownInterval = setInterval(update, 1000);
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

        // 1. Initial validation for first-time setup
        const isFirstTime = !existingProfile || !existingProfile.profile_completed;
        if (isFirstTime && (!fullName || !teamName)) {
            return alert("Please enter both your name and team name to proceed!");
        }

        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = "SAVING...";

        try {
            let photoPath = existingProfile?.team_photo_url;

           // Inside your saveProfileBtn.onclick try block:
if (file) {
    const fileExt = file.name.split('.').pop();
    // We use the UserID as the folder to make RLS easier to manage
    const fileName = `${currentUserId}/${Date.now()}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
        .from('team-avatars')
        .upload(fileName, file, { 
            cacheControl: '3600',
            upsert: true // This requires the UPDATE policy we added in Step 1
        });

    if (uploadError) {
        console.error("Upload Error Details:", uploadError);
        throw new Error("Storage Upload Failed: " + uploadError.message);
    }
    photoPath = fileName;
}
            // 3. Construct Smart Payload 
            // We only include name/team if it's the first time to avoid trigger conflicts
            let updatePayload = { team_photo_url: photoPath };

            if (isFirstTime) {
                updatePayload.full_name = fullName;
                updatePayload.team_name = teamName;
                updatePayload.profile_completed = true;
            }

            // 4. Update User Profile in Database
            const { error: updateError } = await supabase
                .from('user_profiles')
                .update(updatePayload)
                .eq('user_id', currentUserId);

            if (updateError) throw updateError;

            // 5. Success! Refresh and Close
            alert("Profile updated successfully!");
            profileModal.classList.add("hidden");
            window.location.reload(); 

        } catch (err) {
            console.error("Save error:", err.message);
            alert("Failed to save profile: " + err.message);
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = isFirstTime ? "Save & Start" : "Update Photo";
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
                modalPreview.style.backgroundSize = "cover";
                modalPreview.style.backgroundPosition = "center";
            };
            reader.readAsDataURL(file);
        }
    };
}

const closeBtn = document.getElementById("closeProfileModal");
if (closeBtn) {
    closeBtn.onclick = () => {
        // Only allow closing if the profile isn't being forced
        if (!profileModal.hasAttribute('data-forced')) {
            profileModal.classList.add("hidden");
        } else {
            alert("Please complete your profile to continue!");
        }
    };
}
/* =========================
    REFINED UI EVENTS
========================= */
/* =========================
    REFINED UI EVENTS
========================= */

// 1. Profile Modal Control (Avatar Click)
if (avatarElement) {
    avatarElement.onclick = () => {
        if (!profileModal || !modalFullName || !modalTeamName) return;
        
        // Check if this is an existing user who already completed their profile
        const isEditing = existingProfile && existingProfile.profile_completed;

        if (existingProfile) {
            modalFullName.value = existingProfile.full_name || "";
            modalTeamName.value = existingProfile.team_name || "";
            
            if (isEditing) {
                // LOCK FIELDS: Make them read-only and look disabled
                modalFullName.readOnly = true;
                modalTeamName.readOnly = true;
                modalFullName.style.background = "rgba(255, 255, 255, 0.05)";
                modalTeamName.style.background = "rgba(255, 255, 255, 0.05)";
                modalFullName.style.color = "#94a3b8";
                modalTeamName.style.color = "#94a3b8";
                modalTeamName.style.cursor = "not-allowed";
                
                // UI FEEDBACK: Change button text and add the locked note
                saveProfileBtn.textContent = "UPDATE PHOTO";
                
                let note = document.getElementById("profileLockNote");
                if (!note) {
                    note = document.createElement("p");
                    note.id = "profileLockNote";
                    note.style.cssText = "font-size:11px; color:#ef4444; margin-top:12px; text-align:center; font-weight:600;";
                    saveProfileBtn.parentNode.insertBefore(note, saveProfileBtn.nextSibling);
                }
                note.innerText = "⚠️ Your name & Team name locked for the season.";
            } else {
                // First time setup state
                saveProfileBtn.textContent = "SAVE & START";
            }
        }
        profileModal.classList.remove("hidden");
    };
}

// Close Button Logic
if (closeBtn) {
    closeBtn.onclick = () => {
        // Prevent closing if the user is forced to complete profile (first login)
        if (profileModal.hasAttribute('data-forced')) {
            alert("Please complete your profile details to continue.");
            return;
        }
        profileModal.classList.add("hidden");
    };
}

// 2. Navigation Actions
if (editButton) {
    editButton.onclick = () => {
        // Prevent editing team if profile isn't finished
        if (!existingProfile?.profile_completed) {
            alert("Please complete your profile first!");
            profileModal?.classList.remove("hidden");
            return;
        }
        window.location.href = "team-builder.html";
    };
}

if (viewXiBtn) {
    viewXiBtn.onclick = () => {
        if (!existingProfile?.team_name || existingProfile.team_name === "Set your team name") {
            alert("Please set your team name in your profile first!");
            profileModal?.classList.remove("hidden");
        } else {
            // Encode name to handle special characters in the URL
            const teamName = encodeURIComponent(existingProfile.team_name);
            window.location.href = `team-view.html?uid=${currentUserId}&name=${teamName}`;
        }
    };
}

if (viewFullLeaderboardBtn) {
    viewFullLeaderboardBtn.onclick = () => {
        window.location.href = "leaderboard.html";
    };
}

window.addEventListener('click', (event) => {
    // Only close if it's NOT a forced profile setup
    if (profileModal && event.target === profileModal && !profileModal.hasAttribute('data-forced')) {
        profileModal.classList.add("hidden");
    }
});