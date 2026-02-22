import { supabase } from "./supabase.js";
import { initNotificationHub } from "./notifications.js";

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
    if (!window.OneSignalDeferred) return;
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
   INIT (Auth Guard Protected)
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    currentUserId = user.id;
    await initOneSignal(currentUserId);
    startDashboard(currentUserId);
});

async function startDashboard(userId) {
    document.body.classList.remove('loading-state');
    
    // 1. Initialize the separate Notification logic
    initNotificationHub(userId);

    // 2. Initial Data Fetch
    await Promise.all([
        fetchHomeData(userId),
        loadLeaderboardPreview(),
        fetchPrivateLeagueData(userId)
    ]);

    // 3. Background refresh every 30s
    setInterval(() => {
        fetchHomeData(userId);
        loadLeaderboardPreview();
        fetchPrivateLeagueData(userId);
    }, 30000); 
}

/* =========================
   DASHBOARD DATA FETCHING
========================= */
async function fetchPrivateLeagueData(userId) {
    const { data: membership } = await supabase.from('league_members').select('league_id, leagues(name, invite_code)').eq('user_id', userId).maybeSingle();
    const card = document.getElementById('privateLeagueCard');
    const container = document.getElementById('privateLeaderboardContainer');

    if (!membership) { card?.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    document.getElementById('privateLeagueName').textContent = membership.leagues.name;
    document.getElementById('privateInviteCode').textContent = membership.leagues.invite_code;

    const { data: members } = await supabase.from('private_league_leaderboard').select('team_name, total_points, rank_in_league, user_id').eq('league_id', membership.league_id).order('total_points', { ascending: false }).limit(3);
    if (members) {
        container.innerHTML = members.map(row => `
            <div class="leader-row" onclick="window.location.href='team-view.html?uid=${row.user_id}'">
                <span>#${row.rank_in_league} <strong>${row.team_name || 'Expert'}</strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            </div>`).join('');
        const me = members.find(m => m.user_id === userId);
        if (me) document.getElementById('privateLeagueRank').textContent = `#${me.rank_in_league}`;
    }
}

async function fetchHomeData(userId) {
    const { data, error } = await supabase.from('home_dashboard_view').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return;

    existingProfile = data;
    tournamentNameElement.textContent = data.tournament_name || "Tournament";
    welcomeText.textContent = `Welcome back, ${data.full_name?.split(" ")[0] || "Expert"}`;
    teamNameElement.textContent = data.team_name || "Set your team name";

    if (data.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(data.team_photo_url);
        avatarElement.style.backgroundImage = `url(${imgData.publicUrl}?t=${Date.now()})`;
    }

    scoreElement.textContent = data.total_points || 0;
    rankElement.textContent = data.user_rank > 0 ? `#${data.user_rank}` : "—";
    subsElement.textContent = data.subs_remaining;

    if (boosterStatusEl) {
        boosterStatusEl.textContent = data.s8_booster_used ? "0" : "1";
        boosterStatusEl.style.color = data.s8_booster_used ? "#64748b" : "#9AE000";
    }

    const match = data.upcoming_match;
    if (match) {
        const isDelayed = new Date(match.actual_start_time) > new Date(match.original_start_time);
        matchTeamsElement.innerHTML = `${match.team_a_code} vs ${match.team_b_code}${isDelayed ? ' <span class="delay-badge">Delayed</span>' : ''}`;

        const startTime = new Date(match.actual_start_time).getTime();
        if (match.status === 'locked' || startTime <= Date.now()) {
            if (countdownInterval) clearInterval(countdownInterval);
            matchTimeElement.innerHTML = `<span style="color: #94a3b8;"><i class="fas fa-lock"></i> Match Started</span>`;
            editButton.disabled = true; editButton.style.background = "#1e293b";
        } else {
            startCountdown(match.actual_start_time);
            editButton.disabled = false; editButton.style.background = "#9AE000";
        }
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

async function loadLeaderboardPreview() {
    const { data: leaderboard } = await supabase.from("leaderboard_view").select("team_name, total_points, rank, user_id").order("rank", { ascending: true }).limit(3);
    if (leaderboard) {
        leaderboardContainer.innerHTML = leaderboard.map(row => `
            <div class="leader-row" onclick="window.location.href='team-view.html?uid=${row.user_id}'">
                <span>#${row.rank} <strong>${row.team_name || 'Expert'}</strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            </div>`).join('');
    }
}

/* =========================
   UI NAVIGATION & MODALS
========================= */
saveProfileBtn.onclick = async () => {
    const newName = modalFullName.value.trim(), newTeam = modalTeamName.value.trim();
    if (!newName || !newTeam) return alert("Fields required.");
    saveProfileBtn.disabled = true;
    try {
        await supabase.from("user_profiles").upsert({ user_id: currentUserId, profile_completed: true, full_name: newName, team_name: existingProfile?.team_name || newTeam }, { onConflict: 'user_id' });
        await fetchHomeData(currentUserId);
        profileModal.classList.add("hidden");
    } catch (err) { alert(err.message); } finally { saveProfileBtn.disabled = false; }
};

avatarElement.onclick = () => profileModal.classList.remove("hidden");
editButton.onclick = () => window.location.href = "team-builder.html";
viewXiBtn.onclick = () => window.location.href = "team-view.html";
viewFullLeaderboardBtn.onclick = () => window.location.href = "leaderboard.html";