import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { getEffectiveRank, applyRankFlair } from "./animations.js";

let currentUserId          = null;
let existingProfile        = null;
let countdownInterval      = null;
let currentUserOverallRank = Infinity;

// Realtime Channels
let matchChannel = null;
let navChannel   = null;

// Chat Variables
let chatSubscription = null;
let chatIsEmpty      = true;
let unreadCount      = 0;
const senderNameCache = new Map(); 
const top3UserIds    = new Map();

/* ── DOM ELEMENTS ── */
const avatarElement        = document.getElementById("teamAvatar");
const welcomeText          = document.getElementById("welcomeText");
const teamNameElement      = document.getElementById("userTeamName");
const scoreElement         = document.getElementById("userScore");
const rankElement          = document.getElementById("userRank");
const activePhaseLbl       = document.getElementById("activePhaseLbl");

const matchTeamsElement    = document.getElementById("matchTeams");
const matchTimeElement     = document.getElementById("matchTime");
const matchVenueElement    = document.getElementById("matchVenue");
const matchBadgeStatus     = document.getElementById("matchBadgeStatus");
const teamALogo            = document.getElementById("teamALogo");
const teamBLogo            = document.getElementById("teamBLogo");

const leaderboardContainer = document.getElementById("leaderboardContainer");
const overallMemberCount   = document.getElementById("overallMemberCount");
const overallUserRank      = document.getElementById("overallUserRank");

// Profile Modal Elements
const profileModal         = document.getElementById("profileModal");
const saveProfileBtn       = document.getElementById("saveProfileBtn");
const modalTeamName        = document.getElementById("modalTeamName");
const avatarInput          = document.getElementById("avatarInput");
const modalPreview         = document.getElementById("modalAvatarPreview");
const closeProfileModal    = document.getElementById("closeProfileModal");

// Nav Elements
const navMatchesBtn = document.getElementById("navMatchesBtn");
const navMatchLabel = document.getElementById("navMatchLabel");
const navLiveDot    = document.getElementById("navLiveDot");

// Chat Elements
const chatFab      = document.getElementById("chatFab");
const chatBackdrop = document.getElementById("chatBackdrop");
const chatPanel    = document.getElementById("chatPanel");
const closeChatBtn = document.getElementById("closeChatBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm     = document.getElementById("chatForm");
const chatInput    = document.getElementById("chatInput");
const unreadBadge  = document.getElementById("unreadBadge");


/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
async function initApp() {
    try {
        const user = await authReady;
        currentUserId = user.id;
        startDashboard(currentUserId);
    } catch (err) {
        console.warn("Auth failed:", err.message);
        revealApp(true);
    }
}

initApp();

function revealApp(hasError = false) {
    if (hasError) {
        const sk = document.getElementById("skeletonScreen");
        if (sk) {
            sk.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px">
                    <div style="font-family:var(--font-display);font-size:14px;font-weight:900;color:var(--red);letter-spacing:2px">FIELD UNAVAILABLE</div>
                    <button onclick="location.reload()" style="background:#9AE000;color:#000;border:none;padding:10px 20px;border-radius:8px;font-weight:900;cursor:pointer;font-size:13px">RETRY</button>
                </div>`;
        }
        return;
    }
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
}

/* ══════════════════════════════════════════════════════
   DASHBOARD BOOTSTRAP
══════════════════════════════════════════════════════ */
async function startDashboard(userId) {
    initLiveNav();

    // Realtime: Match lock/live detector
    matchChannel = supabase.channel('ppl-match-detector')
        .on('postgres_changes', { event: 'UPDATE', table: 'ppl_matches' }, () => {
            fetchHomeData(userId);
        })
        .subscribe();

    try {
        const [homeResult, lbResult] = await Promise.allSettled([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            initChat(userId)
        ]);

        if ([homeResult, lbResult].some(r => r.status === "rejected")) {
            console.warn("Dashboard fetches failed:", homeResult.reason, lbResult.reason);
        }

        revealApp(homeResult.status === "rejected");

    } catch (err) {
        console.error("Dashboard bootstrap error:", err);
        revealApp(true);
    }
}

/* ══════════════════════════════════════════════════════
   CORE DATA FETCH
══════════════════════════════════════════════════════ */
async function fetchHomeData(userId) {
    // 1. Check Profile
    const { data: profile } = await supabase
        .from("user_profiles").select("*").eq("user_id", userId).maybeSingle();

    existingProfile = profile;

    if (!profile || !profile.profile_completed) {
        if (profileModal) {
            profileModal.classList.remove("hidden");
            if (closeProfileModal) closeProfileModal.style.display = "none";
            profileModal.setAttribute("data-forced", "true");
        }
    }

    const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : "Expert";
    if (welcomeText)     welcomeText.textContent     = `Welcome back, ${firstName}`;
    if (teamNameElement) teamNameElement.textContent = profile?.team_name || "Set your team name";

    if (profile?.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url);
        if (avatarElement) avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
    }

    // 2. Fetch Active Phase
    const { data: activeDay } = await supabase.from("ppl_fantasy_days")
        .select("phase").eq("is_locked", false).order("created_at").limit(1).maybeSingle();
    
    if (activePhaseLbl) {
        let phaseTxt = "Groups";
        if (activeDay?.phase === "group_a") phaseTxt = "Group A";
        else if (activeDay?.phase === "group_b") phaseTxt = "Group B";
        else if (activeDay?.phase === "knockout") phaseTxt = "Knockout";
        activePhaseLbl.textContent = phaseTxt;
    }

    // 3. Fetch User Score/Rank
    const { data: myStats } = await supabase
        .from("ppl_overall_leaderboard")
        .select("total_points, overall_rank")
        .eq("user_id", userId)
        .maybeSingle();

    if (scoreElement) scoreElement.textContent = myStats?.total_points ? parseFloat(myStats.total_points).toFixed(1) : "0";
    
    const displayRank = myStats?.total_points > 0 ? `#${myStats.overall_rank}` : "Pre-Season";
    if (rankElement) {
        rankElement.textContent = displayRank;
        rankElement.classList.toggle("pre-season", !(myStats?.total_points > 0));
    }
    if (overallUserRank) {
        overallUserRank.textContent = displayRank;
        overallUserRank.classList.toggle("pre-season", !(myStats?.total_points > 0));
    }

    currentUserOverallRank = myStats?.overall_rank || Infinity;
    applyOwnFlair();

    // 4. Fetch Next/Live Match
    const { data: matches } = await supabase.from("ppl_matches")
        .select("*, team_a:team_a_id(short_name), team_b:team_b_id(short_name)")
        .eq("is_super_over", false)
        .order("match_number");

    const liveMatch = (matches || []).find(m => m.status === 'in_progress');
    const nextMatch = (matches || []).find(m => m.status === 'upcoming');
    const targetMatch = liveMatch || nextMatch || (matches || [])[(matches?.length || 1) - 1];

    if (targetMatch) {
        if (matchTeamsElement) matchTeamsElement.textContent = `${targetMatch.team_a?.short_name || 'TBA'} vs ${targetMatch.team_b?.short_name || 'TBA'}`;
        if (matchVenueElement) matchVenueElement.textContent = `🏟️ PPL Ground · Match ${targetMatch.match_number}`;
        
        if (liveMatch) {
            if (matchBadgeStatus) {
                matchBadgeStatus.textContent = "● LIVE NOW";
                matchBadgeStatus.classList.add("badge-live");
                matchBadgeStatus.classList.remove("badge-upcoming");
            }
            if (matchTimeElement) matchTimeElement.textContent = "Action in progress!";
            if (countdownInterval) clearInterval(countdownInterval);
        } else if (nextMatch) {
            startCountdown(targetMatch.actual_start_time || targetMatch.scheduled_time);
        } else {
            if (matchTimeElement) matchTimeElement.textContent = "Match Completed";
            if (matchBadgeStatus) matchBadgeStatus.textContent = "RESULT";
        }
    }
}

/* ══════════════════════════════════════════════════════
   DYNAMIC NAV LIVE SCORE
══════════════════════════════════════════════════════ */
async function initLiveNav() {
    if (!navMatchesBtn) return;

    const updateNavUI = async () => {
        const { data: match } = await supabase.from("ppl_matches")
            .select("id")
            .eq("status", "in_progress")
            .limit(1).maybeSingle();

        if (match) {
            navMatchesBtn.classList.add("is-live");
            navMatchLabel.textContent = "LIVE";
            navLiveDot.classList.remove("hidden");
        } else {
            navMatchLabel.textContent = "Scores";
            navLiveDot.classList.add("hidden");
            navMatchesBtn.classList.remove("is-live");
        }
    };

    updateNavUI();
    navChannel = supabase.channel('ppl-nav-updates')
        .on('postgres_changes', { event: 'UPDATE', table: 'ppl_matches' }, updateNavUI)
        .subscribe();
}

/* ══════════════════════════════════════════════════════
   GLOBAL LEADERBOARD PREVIEW
══════════════════════════════════════════════════════ */
async function loadLeaderboardPreview() {
    const [{ data: lb, error }, { count: userCount }] = await Promise.all([
        supabase.from("ppl_overall_leaderboard")
            .select("team_name, full_name, total_points, overall_rank, user_id")
            .order("overall_rank", { ascending: true })
            .limit(3),
        supabase.from("user_profiles")
            .select("*", { count: "exact", head: true })
            .eq("profile_completed", true),
    ]);

    if (overallMemberCount && userCount != null) {
        overallMemberCount.textContent = `${userCount.toLocaleString()} managers`;
    }

    if (!leaderboardContainer) return;

    if (error || !lb) {
        leaderboardContainer.innerHTML = `<p class="empty-state-text">Could not load rankings.</p>`;
        return;
    }

    if (lb.length > 0) {
        leaderboardContainer.innerHTML = "";
        lb.forEach(row => {
            const rowDiv = document.createElement("div");
            rowDiv.className = "leader-row";
            
            const rankSpan = document.createElement("span");
            const rankTxt = document.createTextNode(row.total_points > 0 ? `#${row.overall_rank} ` : "");
            const nameStrong = document.createElement("strong");
            nameStrong.className = "team-name-text";
            nameStrong.textContent = row.team_name || row.full_name || "Manager";
            rankSpan.append(rankTxt, nameStrong);

            const ptsPill = document.createElement("span");
            const hasPoints = row.total_points > 0;
            ptsPill.className = `pts-pill${hasPoints ? " has-pts" : ""}`;
            ptsPill.textContent = hasPoints ? `${parseFloat(row.total_points).toFixed(1)} pts` : "Pre-season";

            rowDiv.append(rankSpan, ptsPill);
            leaderboardContainer.appendChild(rowDiv);
            
            // Store top 3 for chat flairs
            top3UserIds.set(row.user_id, row.overall_rank);
        });
    } else {
        leaderboardContainer.innerHTML = `<p class="empty-state-text">Rankings appear after Match 1!</p>`;
    }
}

/* ══════════════════════════════════════════════════════
   PROFILE MODAL (GLOBAL)
══════════════════════════════════════════════════════ */
if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        if (!modalTeamName || !profileModal) return;

        const teamName = modalTeamName.value.trim();
        const file     = avatarInput?.files[0];
        const isFirstTime = !existingProfile || !existingProfile.profile_completed;

        if (isFirstTime && (!teamName)) {
            window.showToast("Please enter your team name to continue.", "error");
            return;
        }

        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = "SAVING...";

        try {
            let photoPath = existingProfile?.team_photo_url;

            if (file) {
                if (file.size > 2 * 1024 * 1024) throw new Error("Photo must be under 2MB.");
                const fileExt  = file.name.split(".").pop();
                const fileName = `${currentUserId}/avatar.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from("team-avatars").upload(fileName, file, { cacheControl: "3600", upsert: true });
                if (uploadError) throw uploadError;
                photoPath = `${fileName}?t=${Date.now()}`;
            }

            const updatePayload = { team_photo_url: photoPath };
            if (isFirstTime) {
                updatePayload.team_name = teamName;
                updatePayload.profile_completed = true;
            } else if (teamName) {
                updatePayload.team_name = teamName;
            }

            const { error: updateError } = await supabase.from("user_profiles")
                .upsert({ user_id: currentUserId, ...updatePayload }, { onConflict: "user_id" });
            
            if (updateError) throw updateError;

            window.showToast("Profile saved!", "success");
            profileModal.classList.add("hidden");
            window.location.reload();

        } catch (err) {
            window.showToast("Failed to save: " + err.message, "error");
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = "Save & Start";
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

if (avatarElement) {
    avatarElement.onclick = () => {
        if (!existingProfile?.profile_completed) profileModal?.classList.remove("hidden");
        else window.location.href = "profile.html"; // Redirect to global profile
    };
}

/* ══════════════════════════════════════════════════════
   GLOBAL BANTER CHAT (PPL CONTEXT)
══════════════════════════════════════════════════════ */
async function initChat(userId) {
    if (!chatFab) return;

    chatFab.onclick = () => {
        chatPanel.classList.add("show");
        chatBackdrop.classList.remove("hidden");
        unreadCount = 0; 
        if (unreadBadge) {
            unreadBadge.textContent = "";
            unreadBadge.classList.add("hidden");
            unreadBadge.style.display = "none";
        }
        setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 100);
    };

    const closeChat = () => {
        chatPanel.classList.remove("show");
        chatBackdrop.classList.add("hidden");
    };
    if (closeChatBtn) closeChatBtn.onclick = closeChat;
    if (chatBackdrop) chatBackdrop.onclick = closeChat;

    if (chatForm) {
        chatForm.onsubmit = async e => {
            e.preventDefault();
            const msg = chatInput?.value.trim();
            if (!msg) return;
            chatInput.value = "";

            renderMessage({ user_id: userId, message: msg, _senderName: "You" }, userId);

            // Using the global game_chat but ensuring it's not tied to a private league
            await supabase.from("game_chat").insert([{
                user_id: userId,
                message: msg,
                league_id: null,
                context: "ppl" // Optional tag if you want to filter IPL vs PPL chatter later
            }]);
        };
    }

    await loadChatHistory(userId);
    subscribeToChat(userId);
}

async function loadChatHistory(userId) {
    if (!chatMessages) return;

    const { data } = await supabase.from("game_chat")
        .select("user_id, message, created_at, user_profiles(team_name)")
        .is("league_id", null)
        .order("created_at", { ascending: false })
        .limit(50);

    chatMessages.replaceChildren();

    if (!data?.length) {
        chatIsEmpty = true;
        const placeholder = document.createElement("p");
        placeholder.className = "chat-placeholder";
        placeholder.textContent = "Be the first to talk trash in PPL!";
        chatMessages.appendChild(placeholder);
        return;
    }

    chatIsEmpty = false;
    data.forEach(msg => {
        const name = msg.user_profiles?.team_name;
        if (name && !senderNameCache.has(msg.user_id)) senderNameCache.set(msg.user_id, name);
    });

    data.reverse().forEach(msg => renderMessage(msg, userId));
}

function renderMessage(msgData, currentUserId) {
    if (!chatMessages) return;
    const isMe = msgData.user_id === currentUserId;

    if (chatIsEmpty) {
        chatMessages.replaceChildren();
        chatIsEmpty = false;
    }

    const senderName = isMe ? "You" : msgData._senderName || senderNameCache.get(msgData.user_id) || msgData.user_profiles?.team_name || "Manager";
    if (!isMe && senderName !== "Manager" && !senderNameCache.has(msgData.user_id)) {
        senderNameCache.set(msgData.user_id, senderName);
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${isMe ? "me" : "them"}`;

    if (!isMe) {
        const nameEl = document.createElement("div");
        nameEl.className = "msg-sender";
        nameEl.textContent = senderName;

        const rank = top3UserIds.get(msgData.user_id);
        if (rank) applyRankFlair(null, nameEl, rank);

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        bubble.textContent = msgData.message;

        msgDiv.append(nameEl, bubble);
    } else {
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        bubble.textContent = msgData.message;
        msgDiv.appendChild(bubble);
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function subscribeToChat(userId) {
    chatSubscription = supabase.channel("public:game_chat_ppl")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat", filter: "league_id=is.null" }, async payload => {
            const newMsg = payload.new;
            if (newMsg.user_id === userId) return;

            if (!senderNameCache.has(newMsg.user_id)) {
                const { data: profile } = await supabase.from("user_profiles").select("team_name").eq("user_id", newMsg.user_id).maybeSingle();
                if (profile?.team_name) senderNameCache.set(newMsg.user_id, profile.team_name);
            }

            newMsg._senderName = senderNameCache.get(newMsg.user_id) || "Manager";
            renderMessage(newMsg, userId);

            if (!chatPanel?.classList.contains("show")) {
                unreadCount++;
                if (unreadBadge) {
                    unreadBadge.textContent = unreadCount;
                    unreadBadge.classList.remove("hidden");
                    unreadBadge.style.display = "flex";
                }
            }
        }).subscribe();
}

/* ══════════════════════════════════════════════════════
   HELPERS & CLEANUP
══════════════════════════════════════════════════════ */
function startCountdown(startTime) {
    if (!startTime || countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();

    const update = () => {
        const dist = matchTime - Date.now();
        if (dist <= 0) {
            clearInterval(countdownInterval);
            if (matchTimeElement) matchTimeElement.textContent = "Match Started";
            return;
        }

        const days    = Math.floor(dist / 86400000);
        const hours   = Math.floor((dist % 86400000) / 3600000);
        const minutes = Math.floor((dist % 3600000)  / 60000);
        const seconds = Math.floor((dist % 60000)    / 1000);

        if (matchTimeElement) {
            matchTimeElement.innerHTML = days > 0
                ? `<i class="far fa-clock"></i> Starts in ${days}d ${hours}h`
                : `<i class="far fa-clock"></i> Starts in ${hours}h ${minutes}m ${seconds}s`;
        }
    };
    update();
    countdownInterval = setInterval(update, 1000);
}

function applyOwnFlair() {
    applyRankFlair(avatarElement, null, currentUserOverallRank);
}

window.showToast = (message, type = "success") => {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("fade-out");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 3000);
};

window.addEventListener("pagehide", () => {
    if (countdownInterval) clearInterval(countdownInterval);
    if (chatSubscription) supabase.removeChannel(chatSubscription);
    if (navChannel) supabase.removeChannel(navChannel);
    if (matchChannel) supabase.removeChannel(matchChannel);
});