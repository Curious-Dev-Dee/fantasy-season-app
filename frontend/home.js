import { supabase } from "./supabase.js";
import { initNotificationHub } from "./notifications.js"; // Root import for Vercel

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
   ONESIGNAL & PUSH
========================= */
async function initOneSignal(userId) {
    if (!window.OneSignalDeferred) return;
    window.OneSignalDeferred.push(async function(OneSignal) {
        await OneSignal.init({ appId: "76bfec04-40bc-4a15-957b-f0c1c6e401d4", notifyButton: { enable: false } });
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
    // 1. Initialize Alerts & League Listeners
    initNotificationHub(userId);
    setupHomeLeagueListeners(userId); 

    // 2. Fetch Initial Data once
    try {
        await Promise.all([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            fetchPrivateLeagueData(userId)
        ]);
    } catch (err) {
        console.error("Dashboard load error:", err);
    } finally {
        // 3. Reveal the App
        document.body.classList.remove('loading-state');
        document.body.classList.add('loaded');
    }

    // 4. Background Refresh logic every 30s
    setInterval(async () => {
        await Promise.all([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            fetchPrivateLeagueData(userId)
        ]);
    }, 30000); 
}
/* =========================
   CORE LOGIC
========================= */
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

        // --- RESTORED LOGO UPDATER (The fix for missing flags) ---
        const updateTeamLogo = (path, elementId) => {
            const el = document.getElementById(elementId);
            if (!el) return;
            if (path) {
                const { data: logoData } = supabase.storage.from('team-logos').getPublicUrl(path);
                el.style.backgroundImage = `url(${logoData.publicUrl})`;
                el.style.display = "block"; // This turns them ON
            } else {
                el.style.display = "none";
            }
        };

        updateTeamLogo(match.team_a_logo, "teamALogo");
        updateTeamLogo(match.team_b_logo, "teamBLogo");

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

async function loadLeaderboardPreview() {
    const { data: lb } = await supabase.from("leaderboard_view").select("team_name, total_points, rank, user_id").order("rank", { ascending: true }).limit(3);
    
    if (lb) {
        leaderboardContainer.innerHTML = ''; // Clear existing
        lb.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'leader-row';
            rowDiv.onclick = () => window.location.href = `team-view.html?uid=${row.user_id}`;
            
            // This is the secure part:
            // We use textContent for the team_name so HTML tags aren't rendered.
            rowDiv.innerHTML = `
                <span>#${row.rank} <strong class="team-name-text"></strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            `;
            rowDiv.querySelector('.team-name-text').textContent = row.team_name || 'Expert';
            
            leaderboardContainer.appendChild(rowDiv);
        });
        document.getElementById("overallUserRank").textContent = rankElement.textContent;
    }
}

async function fetchPrivateLeagueData(userId) {
    const card = document.getElementById('privateLeagueCard');
    const leagueNameEl = document.getElementById('privateLeagueName');
    const inviteCodeEl = document.getElementById('privateInviteCode');
    const contentEl = document.getElementById('privateLeagueContent');
    const emptyStateEl = document.getElementById('noLeagueState');
    const containerEl = document.getElementById('privateLeaderboardContainer');

    if (!card) return; // Exit if the card isn't on this page

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

    // Success State
    card.classList.remove('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    
    if (leagueNameEl) leagueNameEl.textContent = m.leagues.name;
    if (inviteCodeEl) inviteCodeEl.textContent = m.leagues.invite_code;

    const { data: lb } = await supabase
        .from('private_league_leaderboard')
        .select('team_name, total_points, rank_in_league, user_id')
        .eq('league_id', m.league_id)
        .order('total_points', { ascending: false })
        .limit(3);

    if (lb && containerEl) {
        containerEl.innerHTML = lb.map(row => `
            <div class="leader-row" onclick="window.location.href='team-view.html?uid=${row.user_id}'">
                <span>#${row.rank_in_league} <strong>${row.team_name || 'Expert'}</strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            </div>`).join('');
            
        // Update user's specific rank in the header if it exists
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
   UI EVENTS
========================= */
avatarElement.onclick = () => profileModal.classList.remove("hidden");
editButton.onclick = () => window.location.href = "team-builder.html";
viewXiBtn.onclick = () => window.location.href = "team-view.html";
viewFullLeaderboardBtn.onclick = () => window.location.href = "leaderboard.html"
// ADD THIS LINE BELOW
const viewPrivateLbtn = document.getElementById("viewPrivateLeaderboard");
if (viewPrivateLbtn) {
    viewPrivateLbtn.onclick = () => window.location.href = "leaderboard.html?type=private";
}