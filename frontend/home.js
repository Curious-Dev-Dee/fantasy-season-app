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
   APPLICATION BOOTSTRAP
========================= */
async function initApp() {
    // 1. Instant Check: Is the user already logged in? (e.g. on refresh)
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
        currentUserId = session.user.id;
        startDashboard(currentUserId);
    } else {
        // 2. Event Check: If no session yet, wait for the guard to verify them
        window.addEventListener('auth-verified', (e) => {
            if (currentUserId) return; 
            currentUserId = e.detail.user.id;
            startDashboard(currentUserId);
        }, { once: true });
    }
}

// Start the engine
initApp();

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

function revealApp(hasError = false) {
    if (document.body.classList.contains('loaded') && !hasError) return; 
    
    if (hasError) {
        // Change the loading text to show an error and a retry button
        const loadingText = document.querySelector(".loading-text");
        if (loadingText) {
            loadingText.style.color = "#ef4444"; // Red for error
            loadingText.innerHTML = `FIELD UNAVAILABLE <br> 
                <button onclick="location.reload()" style="background:#9AE000; color:#000; border:none; padding:8px 15px; border-radius:8px; margin-top:10px; font-weight:800; cursor:pointer;">RETRY</button>`;
        }
        return;
    }

    document.body.classList.remove('loading-state');
    document.body.classList.add('loaded');
    
    setTimeout(() => {
        const overlay = document.getElementById("loadingOverlay");
        if (overlay) overlay.style.display = 'none';
    }, 600); 
}



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
        revealApp(); // Success!
    } catch (err) {
        console.error("Dashboard data load error:", err);
        revealApp(true); // Error!
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

    existingProfile = profile; // Save to global state whether it exists or not

    // THE FIX: If profile is null OR not completed, force the modal open!
    if (!profile || !profile.profile_completed) {
        if (profileModal) {
            profileModal.classList.remove("hidden");
            const closeBtn = document.getElementById("closeProfileModal");
            if (closeBtn) closeBtn.style.display = "none"; 
            profileModal.setAttribute('data-forced', 'true');
        }
    }

    // Safely update UI
    const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}!`;
    teamNameElement.textContent = profile?.team_name || "Set your team name";
    
    if (profile?.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url);
        avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
    }
    
    // ... [keep the rest of your IPL Dashboard Stats logic exactly the same] ...
    // 2. IPL Dashboard Stats
    // We query the view, but we must ensure it targets our active tournament
    const [{ data: dash }, { data: boosterData }] = await Promise.all([
        supabase
            .from('home_dashboard_view')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
        activeTournamentId
            ? supabase
                .from('user_tournament_points')
                .select('used_boosters')
                .eq('user_id', userId)
                .eq('tournament_id', activeTournamentId)
                .maybeSingle()
            : Promise.resolve({ data: null })
    ]);
    
 /* =========================
       IPL 2026 DASHBOARD RENDER
    ========================= */
    /* =========================
       IPL 2026 DASHBOARD RENDER
    ========================= */
    if (dash) {
        // 1. Update Scores and Ranks
        scoreElement.textContent = dash.total_points || 0;
        
        // Format the rank properly
        const displayRank = (dash.user_rank && dash.user_rank > 0) ? `#${dash.user_rank}` : "--";
        
        // Update BOTH rank elements directly from the database data!
        if (rankElement) rankElement.textContent = displayRank;
        
        const overallRankHeader = document.getElementById("overallUserRank");
        if (overallRankHeader) overallRankHeader.textContent = displayRank;

        // ... [The rest of your subs and match logic stays exactly the same]
        // 2. Substitution Logic (Handling the 999 "Magic Number")
        const match = dash.upcoming_match;
        
        if (dash.subs_remaining === 999) {
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

    // --- POPULATE THE VENUE ---
    // --- POPULATE THE VENUE ---
    const venueElement = document.getElementById("matchVenue");
    if (venueElement) {
        venueElement.innerHTML = `🏟️ ${match.venue || 'Venue TBA'}`;
    }
    // Get Storage Bucket Instance
    const bucket = supabase.storage.from("team-logos");

    // Build Public URLs for logos
    const logoAUrl = match.team_a_logo 
        ? bucket.getPublicUrl(match.team_a_logo).data.publicUrl 
        : 'images/default-team.png';

    const logoBUrl = match.team_b_logo 
        ? bucket.getPublicUrl(match.team_b_logo).data.publicUrl 
        : 'images/default-team.png';

    const teamALogo = document.getElementById("teamALogo");
    const teamBLogo = document.getElementById("teamBLogo");

    if (teamALogo && teamBLogo) {
        teamALogo.style.backgroundImage = `url('${logoAUrl}')`;
        teamBLogo.style.backgroundImage = `url('${logoBUrl}')`;
        teamALogo.style.display = "block";
        teamBLogo.style.display = "block";
    }

    // Start the Smart Countdown Timer
    startCountdown(match.actual_start_time);
} else {
    matchTeamsElement.textContent = "No Upcoming Matches";
    const venueElement = document.getElementById("matchVenue");
    if (venueElement) venueElement.innerHTML = ""; // Hide venue if no match
    if (matchTimeElement) matchTimeElement.textContent = "Check back soon!";
}
// 4. Booster Status
if (boosterStatusEl) {
    boosterStatusEl.textContent = String(Math.max(0, 7 - ((boosterData?.used_boosters || []).length)));
}
    }}
// ... Keep your existing loadLeaderboardPreview, fetchPrivateLeagueData, startCountdown, etc. ...

// ... (KEEP your loadLeaderboardPreview, fetchPrivateLeagueData, and other functions exactly as they were)
async function loadLeaderboardPreview() {
    const { data: lb } = await supabase
        .from("leaderboard_view")
        .select("team_name, total_points, rank, user_id")
        .order("rank", { ascending: true })
        .limit(3);
    
    if (lb && lb.length > 0) {
        leaderboardContainer.innerHTML = ''; // Clear the "Updating..." text
        
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
    } else {
        // THE FIX: Graceful empty state before Match 1 happens
        leaderboardContainer.innerHTML = '<p style="color: #94a3b8; font-size: 13px; text-align: center; padding: 10px 0; margin: 0;">Rankings will appear after Match 1!</p>';
    }};

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
                editButton.style.pointerEvents = "none";
                editButton.textContent = "LOCKED";
            }

            setTimeout(() => {
                window.location.reload(); 
            }, 5000); 
            return; 
        }
        
        // NEW SMART TIME MATH
        const days = Math.floor(dist / (1000 * 60 * 60 * 24));
        const hours = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((dist % (1000 * 60)) / 1000);
        
        // FORMAT CHECKER
        if (days > 0) {
            // More than 24 hours: Show Days, Hours, Mins
            matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${days}d ${hours}h ${minutes}m`;
        } else {
            // Less than 24 hours: Show Hours, Mins, Secs
            matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${hours}h ${minutes}m ${seconds}s`;
        }
        
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
        // FIXED: Using custom prompt
        const name = await window.showCustomPrompt("Create League", "Enter a cool name...");
        if (!name) return;
        
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const { data: league, error } = await supabase
            .from("leagues")
            .insert([{ name, invite_code: inviteCode, owner_id: userId }])
            .select()
            .single();

        // FIXED: Using Toast for errors
        if (error) return window.showToast("Error creating league: " + error.message, "error");

        await supabase.from("league_members").insert([{ league_id: league.id, user_id: userId }]);
        
        window.showToast("League Created! Share your code.", "success");
        fetchPrivateLeagueData(userId);
    };

    joinBtn.onclick = async () => {
        // FIXED: Using custom prompt
        const code = await window.showCustomPrompt("Join League", "Enter Invite Code...");
        if (!code) return;

        const { data: league } = await supabase
            .from("leagues")
            .select("id")
            .eq("invite_code", code.toUpperCase())
            .maybeSingle();

        if (!league) return window.showToast("Invalid Code! Double check it.", "error");

        const { error } = await supabase
            .from("league_members")
            .insert([{ league_id: league.id, user_id: userId }]);

        if (error) return window.showToast("You're already in this league or it failed.", "error");
        
        window.showToast("Joined League Successfully!", "success");
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

        if (file) {
                const fileExt = file.name.split('.').pop();
                
                // FIXED: Removed Date.now() so it actively overwrites the old image!
                const fileName = `${currentUserId}/avatar.${fileExt}`;

                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('team-avatars')
                    .upload(fileName, file, { 
                        cacheControl: '3600',
                        upsert: true 
                    });

                if (uploadError) {
                    console.error("Upload Error Details:", uploadError);
                    throw new Error("Storage Upload Failed: " + uploadError.message);
                }
                
                // We add a timestamp query parameter to the end of the saved path in the database.
                // This forces the browser to fetch the new image instead of showing the cached old one!
                photoPath = `${fileName}?t=${Date.now()}`;
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
                .upsert(updatePayload)
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

// Replaces alert()
window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000); // Disappears after 3 seconds
};

// Replaces prompt()
window.showCustomPrompt = (title, placeholder) => {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customPromptOverlay');
        const titleEl = document.getElementById('promptTitle');
        const inputEl = document.getElementById('promptInput');
        const btnCancel = document.getElementById('promptCancel');
        const btnConfirm = document.getElementById('promptConfirm');

        if (!overlay) return resolve(null);

        titleEl.textContent = title;
        inputEl.placeholder = placeholder;
        inputEl.value = '';
        overlay.classList.remove('hidden');
        inputEl.focus();

        const cleanup = () => {
            overlay.classList.add('hidden');
            btnCancel.onclick = null;
            btnConfirm.onclick = null;
        };

        btnCancel.onclick = () => { cleanup(); resolve(null); };
        btnConfirm.onclick = () => { cleanup(); resolve(inputEl.value.trim()); };
    });
};
