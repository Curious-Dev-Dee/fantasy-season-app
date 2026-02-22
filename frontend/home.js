import { supabase } from "./supabase.js";
import { initNotificationHub } from "./js/notifications.js"; // IMPORT THE HUB

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
        console.warn("OneSignal: SDK blocked by client. Push disabled.");
        return; 
    }
    window.OneSignalDeferred.push(async function(OneSignal) {
        await OneSignal.init({
            appId: "76bfec04-40bc-4a15-957b-f0c1c6e401d4",
            notifyButton: { enable: false }
        });
        await OneSignal.login(userId);
        const onesignalId = OneSignal.User.PushSubscription.id;
        if (onesignalId) {
            await supabase.from('user_profiles').update({ onesignal_id: onesignalId }).eq('user_id', userId);
        }
    });
}

/* =========================
   INIT & DASHBOARD START
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    currentUserId = user.id;
    await initOneSignal(currentUserId);
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
    document.body.classList.remove('loading-state');
    
    // 1. START THE NOTIFICATION HUB IMMEDIATELY
    initNotificationHub(userId);

    // 2. FETCH DASHBOARD DATA (Cleaned up duplicate calls)
    await Promise.all([
        fetchHomeData(userId),
        loadLeaderboardPreview(),
        fetchPrivateLeagueData(userId)
    ]);

    // 3. BACKGROUND REFRESH (Every 60s is safer for DB than 30s)
    setInterval(() => {
        fetchHomeData(userId);
        loadLeaderboardPreview();
        fetchPrivateLeagueData(userId);
    }, 60000); 
}

/* =========================
   CORE DASHBOARD LOGIC
========================= */
async function fetchPrivateLeagueData(userId) {
    const { data: membership } = await supabase
        .from('league_members')
        .select('league_id, leagues(name, invite_code)')
        .eq('user_id', userId)
        .maybeSingle();

    const card = document.getElementById('privateLeagueCard');
    const container = document.getElementById('privateLeaderboardContainer');

    if (!membership) {
        card?.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');
    document.getElementById('privateLeagueName').textContent = membership.leagues.name;
    document.getElementById('privateInviteCode').textContent = membership.leagues.invite_code;

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
        const me = members.find(m => m.user_id === userId);
        if (me) document.getElementById('privateLeagueRank').textContent = `#${me.rank_in_league}`;
    }

    document.getElementById('viewPrivateLeaderboard').onclick = () => {
        window.location.href = `leaderboard.html?league_id=${membership.league_id}`;
    };

    document.getElementById('privateInviteCode').onclick = () => {
        navigator.clipboard.writeText(membership.leagues.invite_code);
        alert("Invite Code Copied!");
    };
}

async function fetchHomeData(userId) {
    const { data, error } = await supabase
        .from('home_dashboard_view')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error || !data) return;

    existingProfile = data;
    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    const firstName = data.full_name?.trim().split(" ")[0] || "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}`;
    teamNameElement.textContent = data.team_name || "Set your team name";

    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(data.team_photo_url);
        const avatarUrl = `${imgData.publicUrl}?t=${new Date().getTime()}`;
        avatarElement.style.backgroundImage = `url(${avatarUrl})`;
        modalPreview.style.backgroundImage = `url(${avatarUrl})`;
    }

    scoreElement.textContent = data.total_points || 0;
    rankElement.textContent = data.user_rank > 0 ? `#${data.user_rank}` : "—";
    subsElement.textContent = data.subs_remaining;

    if (boosterStatusEl) {
        boosterStatusEl.textContent = data.s8_booster_used ? "0" : "1";
        boosterStatusEl.style.color = data.s8_booster_used ? "#64748b" : "#9AE000";
        boosterIconEl.style.color = data.s8_booster_used ? "#64748b" : "#9AE000";
    }

    const match = data.upcoming_match;
    if (match) {
        const isDelayed = new Date(match.actual_start_time) > new Date(match.original_start_time);
        matchTeamsElement.innerHTML = `${match.team_a_code} vs ${match.team_b_code}${isDelayed ? ' <span class="delay-badge">Delayed</span>' : ''}`;

        const updateLogo = (path, id) => {
            const el = document.getElementById(id);
            if (!path || !el) return el ? el.style.display = "none" : null;
            const { data: d } = supabase.storage.from('team-logos').getPublicUrl(path);
            el.style.backgroundImage = `url(${d.publicUrl})`;
            el.style.display = "block";
        };

        updateLogo(match.team_a_logo, "teamALogo");
        updateLogo(match.team_b_logo, "teamBLogo");
        
        const startTime = new Date(match.actual_start_time).getTime();
        const now = new Date().getTime();

        if (match.status === 'locked' || startTime <= now) {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #94a3b8;"><i class="fas fa-lock"></i> Match Started</span>`;
            editButton.disabled = true;
            editButton.textContent = "Locked";
            editButton.style.background = "#1e293b";
        } else {
            startCountdown(match.actual_start_time);
            editButton.disabled = false;
            editButton.textContent = "Change";
            editButton.style.background = "#9AE000";
        }
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
        matchTimeElement.className = minsRemaining <= 10 ? "match-time neon-red" : (minsRemaining <= 30 ? "match-time neon-orange" : "match-time neon-green");

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
    const { data: leaderboard } = await supabase.from("leaderboard_view").select("team_name, total_points, rank, user_id").order("rank", { ascending: true }).limit(3);
    if (leaderboard) {
        const container = document.getElementById("leaderboardContainer");
        container.innerHTML = leaderboard.map(row => `
            <div class="leader-row" onclick="window.location.href='team-view.html?uid=${row.user_id}&name=${encodeURIComponent(row.team_name)}'">
                <span>#${row.rank} <strong>${row.team_name || 'Expert'}</strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            </div>
        `).join('');
        const currentRank = document.getElementById("userRank").textContent;
        document.getElementById("overallUserRank").textContent = currentRank;
    }
}

/* =========================
   UI NAVIGATION & EVENTS
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
        const profileData = { user_id: currentUserId, profile_completed: true, full_name: newName, team_photo_url: photoPath };
        if (!existingProfile?.team_name) profileData.team_name = newTeam;
        await supabase.from("user_profiles").upsert(profileData, { onConflict: 'user_id' });
        await fetchHomeData(currentUserId);
        profileModal.classList.add("hidden");
    } catch (err) { alert("Update failed: " + err.message); }
    finally { saveProfileBtn.disabled = false; }
});

avatarInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => { modalPreview.style.backgroundImage = `url(${ev.target.result})`; };
        reader.readAsDataURL(file);
    }
});

avatarElement.onclick = () => profileModal.classList.remove("hidden");
profileModal.onclick = (e) => { if (e.target === profileModal) profileModal.classList.add("hidden"); };
editButton.onclick = () => window.location.href = "team-builder.html";
viewXiBtn.onclick = () => window.location.href = "team-view.html";
viewFullLeaderboardBtn.onclick = () => window.location.href = "leaderboard.html";