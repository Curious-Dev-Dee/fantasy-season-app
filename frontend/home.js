import { supabase } from "./supabase.js";
import { initNotificationHub } from "./notifications.js";
import { getEffectiveRank, applyRankFlair } from "./animations.js";

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

if (viewFullLeaderboardBtn) {
    viewFullLeaderboardBtn.onclick = (e) => {
        e.preventDefault();
        const adLink = document.createElement('a');
        adLink.href = 'leaderboard.html';
        adLink.style.display = 'none';
        document.body.appendChild(adLink);
        adLink.click();
        adLink.remove();
    };
}

let countdownInterval;
let currentUserId = null;
let existingProfile = null;

// ─── Store the user's own effective rank globally so
//     loadLeaderboardPreview and fetchPrivateLeagueData
//     can read it when building mini leaderboard rows ───
let currentUserOverallRank = Infinity;
let currentUserPrivateRank = Infinity;

function loadInPageAd(containerId, zoneId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (container.hasChildNodes()) return;
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.minHeight = "80px";
    container.appendChild(wrapper);
    const script = document.createElement("script");
    script.src = "https://nap5k.com/tag.min.js";
    script.async = true;
    script.dataset.zone = zoneId;
    wrapper.appendChild(script);
}

function loadMonetagAd() {
    const lastShown = localStorage.getItem("ad_last_shown");
    const now = Date.now();
    if (lastShown && now - lastShown < 120000) return;
    localStorage.setItem("ad_last_shown", now);
    const existing = document.getElementById("monetag-vignette");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "monetag-vignette";
    script.src = "https://gizokraijaw.net/vignette.min.js";
    script.dataset.zone = "10742556";
    script.async = true;
    document.body.appendChild(script);
}

function shouldShowHomeAd() {
    if (profileModal && profileModal.hasAttribute('data-forced')) return false;
    if (!existingProfile?.profile_completed) return false;
    return true;
}

/* =========================
   APPLICATION BOOTSTRAP
========================= */
async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
        currentUserId = session.user.id;
        startDashboard(currentUserId);
    } else {
        window.addEventListener('auth-verified', (e) => {
            if (currentUserId) return;
            currentUserId = e.detail.user.id;
            startDashboard(currentUserId);
        }, { once: true });
    }
}

initApp();

/* =========================
   PAGE LOAD TRANSITION
========================= */
function revealApp(hasError = false) {
    if (document.body.classList.contains('loaded') && !hasError) return;
    if (hasError) {
        const loadingText = document.querySelector(".loading-text");
        if (loadingText) {
            loadingText.style.color = "var(--red)";
            loadingText.innerHTML = `FIELD UNAVAILABLE <br>
                <button onclick="location.reload()" style="background:#9AE000; color:#000; border:none; padding:8px 15px; border-radius:8px; margin-top:10px; font-weight:800; cursor:pointer;">RETRY</button>`;
        }
        return;
    }
    document.body.classList.remove('loading-state');
    document.body.classList.add('loaded');
    if (existingProfile?.profile_completed) {
        loadMonetagAd();
    }
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
        revealApp();
    } catch (err) {
        console.error("Dashboard data load error:", err);
        revealApp(true);
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

    existingProfile = profile;

    if (!profile || !profile.profile_completed) {
        if (profileModal) {
            profileModal.classList.remove("hidden");
            const closeBtn = document.getElementById("closeProfileModal");
            if (closeBtn) closeBtn.style.display = "none";
            profileModal.setAttribute('data-forced', 'true');
        }
    }

    const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : "Expert";
    welcomeText.textContent = `Welcome back, ${firstName}!`;
    teamNameElement.textContent = profile?.team_name || "Set your team name";

    if (profile?.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url);
        avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
    }

    // 2. IPL Dashboard Stats
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

    if (dash) {
        scoreElement.textContent = dash.total_points || 0;

        const displayRank = (dash.user_rank && dash.user_rank > 0) ? `#${dash.user_rank}` : "--";
        if (rankElement) rankElement.textContent = displayRank;

        const overallRankHeader = document.getElementById("overallUserRank");
        if (overallRankHeader) overallRankHeader.textContent = displayRank;

        // ── FLAIR STEP 1: Save this user's overall rank globally ──
        // loadLeaderboardPreview runs in parallel so we store it here
        // and apply flair after both ranks are known (see bottom of
        // fetchPrivateLeagueData where we call applyOwnFlair)
        currentUserOverallRank = dash.user_rank || Infinity;

        if (dash.subs_remaining === 999) {
            subsElement.textContent = "UNLIMITED";
            subsElement.style.color = "#9AE000";
        } else {
            subsElement.textContent = dash.subs_remaining ?? 150;
            subsElement.style.color = "";
        }

        if (dash && dash.upcoming_match) {
            const match = dash.upcoming_match;
            matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
            const venueElement = document.getElementById("matchVenue");
            if (venueElement) venueElement.innerHTML = `🏟️ ${match.venue || 'Venue TBA'}`;

            const bucket = supabase.storage.from("team-logos");
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
            startCountdown(match.actual_start_time);
        } else {
            matchTeamsElement.textContent = "No Upcoming Matches";
            const venueElement = document.getElementById("matchVenue");
            if (venueElement) venueElement.innerHTML = "";
            if (matchTimeElement) matchTimeElement.textContent = "Check back soon!";
        }

        if (boosterStatusEl) {
            boosterStatusEl.textContent = String(Math.max(0, 7 - ((boosterData?.used_boosters || []).length)));
        }
    }
}

/* =========================
   APPLY OWN FLAIR
   Called after both overall rank (fetchHomeData)
   and private rank (fetchPrivateLeagueData) are known
========================= */
function applyOwnFlair() {
    const effectiveRank = getEffectiveRank(currentUserOverallRank, currentUserPrivateRank);
    applyRankFlair(avatarElement, teamNameElement, effectiveRank);
}

/* =========================
   LEADERBOARD PREVIEW
========================= */
async function loadLeaderboardPreview() {
    const { data: lb } = await supabase
        .from("leaderboard_view")
        .select("team_name, total_points, rank, user_id")
        .order("rank", { ascending: true })
        .limit(3);

    if (lb && lb.length > 0) {
        leaderboardContainer.innerHTML = '';
        lb.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'leader-row';
            rowDiv.onclick = () => {
                const scoutName = encodeURIComponent(row.team_name || 'Expert');
                window.location.href = `team-view.html?uid=${row.user_id}&name=${scoutName}`;
            };
            rowDiv.innerHTML = `
                <span>#${row.rank} <strong class="team-name-text"></strong></span>
                <span class="pts-pill">${row.total_points} pts</span>
            `;

            const nameEl = rowDiv.querySelector('.team-name-text');
            nameEl.textContent = row.team_name || 'Expert';

            // ── FLAIR STEP 2: Apply gold/silver/bronze to top 3
            //    overall leaderboard names in the home mini-list ──
            // No avatar in this list so we pass null for avatarEl
            if (row.rank <= 3) {
                applyRankFlair(null, nameEl, row.rank);
            }

            leaderboardContainer.appendChild(rowDiv);
        });
    } else {
        leaderboardContainer.innerHTML = '<p style="color: var(--text-dim); font-size: 13px; text-align: center; padding: 10px 0; margin: 0;">Rankings will appear after Match 1!</p>';
    }
}

/* =========================
   PRIVATE LEAGUE DATA
========================= */
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

        // No private league — apply flair with just overall rank
        currentUserPrivateRank = Infinity;
        applyOwnFlair();
        return;
    }

    card.classList.remove('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    if (leagueNameEl) leagueNameEl.textContent = m.leagues.name;

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
        viewBtn.onclick = (e) => {
            e.preventDefault();
            const adLink = document.createElement('a');
            adLink.href = `leaderboard.html?league_id=${m.league_id}`;
            adLink.style.display = 'none';
            document.body.appendChild(adLink);
            adLink.click();
            adLink.remove();
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

            const nameEl = rowDiv.querySelector('.team-name-text');
            nameEl.textContent = row.team_name || 'Expert';

            // ── FLAIR STEP 3: Apply gold/silver/bronze to top 3
            //    private league names in the home mini-list ──
            if (row.rank_in_league <= 3) {
                applyRankFlair(null, nameEl, row.rank_in_league);
            }

            containerEl.appendChild(rowDiv);
        });

        // ── FLAIR STEP 4: Save this user's private rank then
        //    apply flair to their own avatar + name at the top ──
        const userRow = lb.find(r => r.user_id === userId);
        const rankSpan = document.getElementById('privateLeagueRank');
        if (rankSpan && userRow) rankSpan.textContent = `#${userRow.rank_in_league}`;

        currentUserPrivateRank = userRow?.rank_in_league ?? Infinity;
    } else {
        currentUserPrivateRank = Infinity;
    }

    // Now both ranks are known — apply flair to user's own card
    applyOwnFlair();
}

/* =========================
   COUNTDOWN
========================= */
function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();

    const update = () => {
        const dist = matchTime - Date.now();
        if (dist <= 0) {
            clearInterval(countdownInterval);
            matchTimeElement.textContent = "Match Live";
            if (editButton) {
                editButton.disabled = true;
                editButton.style.opacity = "0.5";
                editButton.style.pointerEvents = "none";
                editButton.textContent = "LOCKED";
            }
            setTimeout(() => { window.location.reload(); }, 5000);
            return;
        }
        const days = Math.floor(dist / (1000 * 60 * 60 * 24));
        const hours = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((dist % (1000 * 60)) / 1000);
        if (days > 0) {
            matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${days}d ${hours}h ${minutes}m`;
        } else {
            matchTimeElement.innerHTML = `<i class="far fa-clock"></i> Starts in ${hours}h ${minutes}m ${seconds}s`;
        }
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
        const name = await window.showCustomPrompt("Create League", "Enter a cool name...");
        if (!name) return;
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: league, error } = await supabase
            .from("leagues")
            .insert([{ name, invite_code: inviteCode, owner_id: userId }])
            .select()
            .single();
        if (error) return window.showToast("Error creating league: " + error.message, "error");
        await supabase.from("league_members").insert([{ league_id: league.id, user_id: userId }]);
        window.showToast("League Created! Share your code.", "success");
        fetchPrivateLeagueData(userId);
    };

    joinBtn.onclick = async () => {
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
                const fileName = `${currentUserId}/avatar.${fileExt}`;
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('team-avatars')
                    .upload(fileName, file, { cacheControl: '3600', upsert: true });
                if (uploadError) throw new Error("Storage Upload Failed: " + uploadError.message);
                photoPath = `${fileName}?t=${Date.now()}`;
            }
            let updatePayload = { team_photo_url: photoPath };
            if (isFirstTime) {
                updatePayload.full_name = fullName;
                updatePayload.team_name = teamName;
                updatePayload.profile_completed = true;
            }
            const { error: updateError } = await supabase
                .from('user_profiles')
                .upsert(updatePayload)
                .eq('user_id', currentUserId);
            if (updateError) throw updateError;
            alert("Profile updated successfully!");
            profileModal.classList.add("hidden");
            window.location.reload();
        } catch (err) {
            console.error("Save error:", err.message);
            window.showToast("Failed to save: " + err.message, "error");
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = isFirstTime ? "Save & Start" : "Update Photo";
        }
    };
}

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
        if (!profileModal.hasAttribute('data-forced')) {
            profileModal.classList.add("hidden");
        } else {
            alert("Please complete your profile to continue!");
        }
    };
}

/* =========================
   UI EVENTS
========================= */
if (avatarElement) {
    avatarElement.onclick = () => {
        if (!profileModal || !modalFullName || !modalTeamName) return;
        const isEditing = existingProfile && existingProfile.profile_completed;
        if (existingProfile) {
            modalFullName.value = existingProfile.full_name || "";
            modalTeamName.value = existingProfile.team_name || "";
            if (isEditing) {
                modalFullName.readOnly = true;
                modalTeamName.readOnly = true;
                modalFullName.style.background = "rgba(255, 255, 255, 0.05)";
                modalTeamName.style.background = "rgba(255, 255, 255, 0.05)";
                modalFullName.style.color = "var(--text-dim)";
                modalTeamName.style.color = "var(--text-dim)";
                modalTeamName.style.cursor = "not-allowed";
                saveProfileBtn.textContent = "UPDATE PHOTO";
                let note = document.getElementById("profileLockNote");
                if (!note) {
                    note = document.createElement("p");
                    note.id = "profileLockNote";
                    note.style.cssText = "font-size:11px; color:var(--red); margin-top:12px; text-align:center; font-weight:600;";
                    saveProfileBtn.parentNode.insertBefore(note, saveProfileBtn.nextSibling);
                }
                note.innerText = "⚠️ Your name & Team name locked for the season.";
            } else {
                saveProfileBtn.textContent = "SAVE & START";
            }
        }
        profileModal.classList.remove("hidden");
    };
}

if (closeBtn) {
    closeBtn.onclick = () => {
        if (profileModal.hasAttribute('data-forced')) {
            alert("Please complete your profile details to continue.");
            return;
        }
        profileModal.classList.add("hidden");
    };
}

if (editButton) {
    editButton.onclick = () => {
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
            const teamName = encodeURIComponent(existingProfile.team_name);
            window.location.href = `team-view.html?uid=${currentUserId}&name=${teamName}`;
        }
    };
}

window.addEventListener('click', (event) => {
    if (profileModal && event.target === profileModal && !profileModal.hasAttribute('data-forced')) {
        profileModal.classList.add("hidden");
    }
});

/* =========================
   TOAST & PROMPT HELPERS
========================= */
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
    }, 3000);
};

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

window.addEventListener('offline', () => { window.showToast("You are offline. Reconnecting...", "error"); });
window.addEventListener('online',  () => { window.showToast("Back online!", "success"); });