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

const boosterStatusEl = document.getElementById("boosterStatus");
const boosterIconEl = document.getElementById("boosterIcon");

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
   ONESIGNAL & PUSH LOGIC
========================= */
async function initOneSignal(userId) {
    if (!window.OneSignalDeferred) {
        console.warn("OneSignal: SDK blocked by client (AdBlock/Privacy). Push disabled.");
        return; 
    }

    try {
        window.OneSignalDeferred.push(async function(OneSignal) {
            // 1. Initialize SDK
            await OneSignal.init({
                appId: "76bfec04-40bc-4a15-957b-f0c1c6e401d4",
                notifyButton: { enable: false }
            });

            // 2. Link Expert Identity
            await OneSignal.login(userId);

            // 3. CAPTURE & SAVE ID: This is what powers your personalized Hinglish alerts
            const onesignalId = OneSignal.User.PushSubscription.id;
            
            if (onesignalId) {
                const { error } = await supabase
                    .from('user_profiles')
                    .update({ onesignal_id: onesignalId })
                    .eq('user_id', userId);
                
                if (error) console.error("OneSignal ID Sync Error:", error);
                else console.log("OneSignal ID synced to Database for Expert:", userId);
            }
        });
    } catch (err) {
        console.error("OneSignal: Handshake failed", err);
    }
}

function showNeonNotificationPrompt() {
    const promptContainer = document.getElementById("notificationPrompt");
    if (!promptContainer) return;

    promptContainer.classList.remove("hidden");
    promptContainer.style.cssText = `
        position: fixed; bottom: 90px; left: 16px; right: 16px;
        background: #1e293b; border: 1px solid #9AE000;
        padding: 16px; border-radius: 16px; z-index: 1000;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        display: flex; flex-direction: column; gap: 12px;
        animation: fadeIn 0.5s ease-out;
    `;

    promptContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-bell" style="color: #9AE000;"></i>
            <span style="font-weight: 700; font-size: 14px;">Enable Match Alerts?</span>
        </div>
        <p style="margin:0; font-size: 12px; color: #94a3b8;">Get a nudge 15 mins before match lock.</p>
        <div style="display: flex; gap: 8px;">
            <button id="btnAllowPush" style="flex:1; background:#9AE000; color:#000; border:none; padding:8px; border-radius:8px; font-weight:700;">ALLOW</button>
            <button id="btnDismissPush" style="flex:1; background:#334155; color:#fff; border:none; padding:8px; border-radius:8px; font-weight:700;">LATER</button>
        </div>
    `;

    document.getElementById("btnAllowPush").onclick = () => {
        window.OneSignal.showNativePrompt();
        promptContainer.remove();
    };
    document.getElementById("btnDismissPush").onclick = () => promptContainer.remove();
}

/* =========================
   INIT (Auth Guard Protected)
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    currentUserId = user.id;
    
    // Setup Push & Identity
    await initOneSignal(currentUserId);
    
    console.log("Home.js: Starting dashboard for", user.email);
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
    document.body.classList.remove('loading-state');
    
    await Promise.all([
        fetchHomeData(userId),
        loadLeaderboardPreview(),
        fetchPrivateLeagueData(userId) // NEW: Fetch Private League Standings
    ]);
    
    // ... rest of your interval code

    document.body.classList.remove('loading-state');
    
    await Promise.all([
        fetchHomeData(userId),
        loadLeaderboardPreview()
    ]);

    // Background refresh every 30s
    setInterval(() => {
        fetchHomeData(userId);
        loadLeaderboardPreview();
    }, 30000); 
}

/* =========================
   CORE DASHBOARD LOGIC
========================= */

async function fetchPrivateLeagueData(userId) {
    // 1. Check for league membership
    const { data: membership } = await supabase
        .from('league_members')
        .select('league_id, leagues(name, invite_code)')
        .eq('user_id', userId)
        .maybeSingle();

    const card = document.getElementById('privateLeagueCard');
    const container = document.getElementById('privateLeaderboardContainer');

    if (!membership) {
        card.classList.add('hidden'); // Hide if not in a league
        return;
    }

    card.classList.remove('hidden');
    document.getElementById('privateLeagueName').textContent = membership.leagues.name;
    document.getElementById('privateInviteCode').textContent = membership.leagues.invite_code;

    // 2. Fetch Top 3 members of this specific league
    const { data: members } = await supabase
        .from('private_league_leaderboard')
        .select('team_name, total_points, rank_in_league, user_id')
        .eq('league_id', membership.league_id)
        .order('total_points', { ascending: false })
        .limit(3);

    if (members) {
        container.innerHTML = members.map(row => `
            <div class="leader-row" onclick="window.location.href='team-view.html?uid=${row.user_id}'">
                <span>#${row.rank_in_league} <strong>${row.team_name || 'Expert'}</strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            </div>
        `).join('');

        // Find and set current user's rank in this league
        const me = members.find(m => m.user_id === userId);
        if (me) document.getElementById('privateLeagueRank').textContent = `#${me.rank_in_league}`;
    }

    // 3. Handle "View All" Navigation
    document.getElementById('viewPrivateLeaderboard').onclick = () => {
        window.location.href = `leaderboard.html?league_id=${membership.league_id}`;
    };

    // 4. Click to Copy Invite Code
    document.getElementById('privateInviteCode').onclick = () => {
        navigator.clipboard.writeText(membership.leagues.invite_code);
        alert("Invite Code Copied! Share it with your friends.");
    };
}

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

    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    const firstName = data.full_name?.trim().split(" ")[0] || "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}`;
    teamNameElement.textContent = data.team_name || "Set your team name";

    modalFullName.value = data.full_name || "";
    modalTeamName.value = data.team_name || "";
    
    if (data.team_name) {
        modalTeamName.disabled = true;
        modalTeamName.style.opacity = "0.6";
    }

    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage
            .from("team-avatars")
            .getPublicUrl(data.team_photo_url);
        
        const avatarUrl = `${imgData.publicUrl}?t=${new Date().getTime()}`;
        avatarElement.style.backgroundImage = `url(${avatarUrl})`;
        modalPreview.style.backgroundImage = `url(${avatarUrl})`;
    }

    scoreElement.textContent = data.total_points || 0;
    rankElement.textContent = data.user_rank > 0 ? `#${data.user_rank}` : "—";
    subsElement.textContent = data.subs_remaining;

    if (boosterStatusEl && boosterIconEl) {
        if (data.s8_booster_used) {
            boosterStatusEl.textContent = "0";
            boosterStatusEl.style.color = "#64748b"; 
            boosterIconEl.style.color = "#64748b";
        } else {
            boosterStatusEl.textContent = "1";
            boosterStatusEl.style.color = "#9AE000";
            boosterIconEl.style.color = "#9AE000";
        }
    }

    const match = data.upcoming_match;

    if (match) {
        const isDelayed = new Date(match.actual_start_time) > new Date(match.original_start_time);
        const delayBadge = isDelayed ? ' <span class="delay-badge">Delayed</span>' : '';
        
        matchTeamsElement.innerHTML = `${match.team_a_code} vs ${match.team_b_code}${delayBadge}`;

        const updateTeamLogo = (path, elementId) => {
            const el = document.getElementById(elementId);
            if (!el) return;
            if (path) {
                const { data: logoData } = supabase.storage.from('team-logos').getPublicUrl(path);
                el.style.backgroundImage = `url(${logoData.publicUrl})`;
                el.style.display = "block";
            } else {
                el.style.display = "none";
            }
        };

        updateTeamLogo(match.team_a_logo, "teamALogo");
        updateTeamLogo(match.team_b_logo, "teamBLogo");
        
        const startTime = new Date(match.actual_start_time).getTime();
        const now = new Date().getTime();

        if (match.is_locked === true || match.status === 'locked' || startTime <= now) {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #94a3b8;"><i class="fas fa-lock"></i> Match Started</span>`;
            editButton.disabled = true;
            editButton.textContent = "Locked";
            editButton.style.background = "#1e293b";
        } else {
            if (!isNaN(startTime)) {
                startCountdown(match.actual_start_time);
            }
            editButton.disabled = false;
            editButton.textContent = "Change";
            editButton.style.background = "#9AE000";
        }
    } else {
        matchTeamsElement.textContent = "No upcoming match";
        editButton.disabled = true;
        document.getElementById("teamALogo").style.display = "none";
        document.getElementById("teamBLogo").style.display = "none";
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
   LEADERBOARD PREVIEW
========================= */
async function loadLeaderboardPreview() {
    // 1. Fetch Top 3 Experts
    const { data: leaderboard } = await supabase
        .from("leaderboard_view")
        .select("team_name, total_points, rank, user_id")
        .order("rank", { ascending: true })
        .limit(3);

    if (leaderboard) {
        const container = document.getElementById("leaderboardContainer");
        container.innerHTML = ""; 
        
        leaderboard.forEach(row => {
            const div = document.createElement("div");
            div.className = "leader-row";
            // Use the standard scoutUser navigation you have on the Full Leaderboard page
            div.onclick = () => window.location.href = `team-view.html?uid=${row.user_id}&name=${encodeURIComponent(row.team_name)}`;
            
            div.innerHTML = `
                <span>#${row.rank} <strong>${row.team_name || 'Anonymous'}</strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            `;
            container.appendChild(div);
        });

        // 2. Update the "YOUR RANK" indicator at the top of this card
        // We get this from the 'userRank' element that is already being set in fetchHomeData
        const currentRank = document.getElementById("userRank").textContent;
        document.getElementById("overallUserRank").textContent = currentRank;
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
   UI NAVIGATION & EVENTS
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

avatarElement.addEventListener("click", () => profileModal.classList.remove("hidden"));

profileModal.addEventListener("click", (e) => { 
    if (e.target === profileModal) profileModal.classList.add("hidden"); 
});

editButton.addEventListener("click", () => window.location.href = "team-builder.html");
viewXiBtn.addEventListener("click", () => window.location.href = "team-view.html");
viewFullLeaderboardBtn.addEventListener("click", () => window.location.href = "leaderboard.html");