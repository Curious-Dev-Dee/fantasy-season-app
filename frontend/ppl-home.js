import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

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

// Modals
const profileModal         = document.getElementById("profileModal");
const saveProfileBtn       = document.getElementById("saveProfileBtn");
const modalTeamName        = document.getElementById("modalTeamName");
const avatarInput          = document.getElementById("avatarInput");
const modalPreview         = document.getElementById("modalAvatarPreview");
const closeProfileModal    = document.getElementById("closeProfileModal");

// Chat
const chatFab      = document.getElementById("chatFab");
const chatBackdrop = document.getElementById("chatBackdrop");
const chatPanel    = document.getElementById("chatPanel");
const closeChatBtn = document.getElementById("closeChatBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm     = document.getElementById("chatForm");
const chatInput    = document.getElementById("chatInput");

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

    matchChannel = supabase.channel('ppl-match-detector')
        .on('postgres_changes', { event: 'UPDATE', table: 'ppl_matches' }, () => {
            fetchHomeData(userId);
        })
        .subscribe();

    try {
        const [homeResult, lbResult, statsResult, groupsResult, pickedResult] = await Promise.allSettled([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            loadTournamentStats(),
            loadGroupsPreview(),
            loadMostPicked(),
            initChat(userId)
        ]);

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

    if (welcomeText) welcomeText.textContent = profile?.full_name ? `Welcome back, ${profile.full_name.split(" ")[0]}` : "Welcome back";
    if (teamNameElement) teamNameElement.textContent = profile?.team_name || "Set your team name";

    if (profile?.team_photo_url) {
        const { data: imgData } = supabase.storage.from("team-avatars").getPublicUrl(profile.team_photo_url);
        if (avatarElement) avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
    }

    // 2. Fetch User Score/Rank
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
    const overallUserRank = document.getElementById("overallUserRank");
    if (overallUserRank) {
        overallUserRank.textContent = displayRank;
        overallUserRank.classList.toggle("pre-season", !(myStats?.total_points > 0));
    }

    currentUserOverallRank = myStats?.overall_rank || Infinity;
    applyOwnFlair();

    // 3. Fetch Matches & Fantasy Phases
    const [{ data: matches }, { data: phases }] = await Promise.all([
        supabase.from("ppl_matches").select("*, team_a:team_a_id(short_name, photo_name), team_b:team_b_id(short_name, photo_name)").eq("is_super_over", false).order("match_number"),
        supabase.from("ppl_fantasy_days").select("*").order("created_at")
    ]);

// Handle Match Cards (CRICBUZZ STACKED LAYOUT)
    const liveMatch = (matches || []).find(m => ['toss_done', 'in_progress', 'live', 'innings_break'].includes(m.status));
    const nextMatch = (matches || []).find(m => m.status === 'upcoming');
    const bucket = supabase.storage.from("team-logos");

    const liveCard = document.getElementById("liveMatchCard");
    const nextCard = document.getElementById("nextMatchCard");

    // Clear any existing countdown
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    if (liveMatch && liveCard) {
        liveCard.classList.remove("hidden");
        if (nextCard) nextCard.classList.add("hidden"); 

        document.getElementById("liveMatchVenue").textContent = `Match ${liveMatch.match_number} • PPL Ground`;
        document.getElementById("liveTeamAName").textContent = liveMatch.team_a?.short_name || 'TBA';
        document.getElementById("liveTeamBName").textContent = liveMatch.team_b?.short_name || 'TBA';
        
        const logoA = liveMatch.team_a?.photo_name ? bucket.getPublicUrl(liveMatch.team_a.photo_name).data.publicUrl : "images/default-team.png";
        const logoB = liveMatch.team_b?.photo_name ? bucket.getPublicUrl(liveMatch.team_b.photo_name).data.publicUrl : "images/default-team.png";
        
        document.getElementById("liveTeamALogo").style.backgroundImage = `url('${logoA}')`;
        document.getElementById("liveTeamBLogo").style.backgroundImage = `url('${logoB}')`;
    } 
    else if (nextMatch && nextCard) {
        if (liveCard) liveCard.classList.add("hidden"); 
        nextCard.classList.remove("hidden");

        document.getElementById("nextMatchVenue").textContent = `Match ${nextMatch.match_number} • PPL Ground`;
        document.getElementById("nextTeamAName").textContent = nextMatch.team_a?.short_name || 'TBA';
        document.getElementById("nextTeamBName").textContent = nextMatch.team_b?.short_name || 'TBA';

        const logoA = nextMatch.team_a?.photo_name ? bucket.getPublicUrl(nextMatch.team_a.photo_name).data.publicUrl : "images/default-team.png";
        const logoB = nextMatch.team_b?.photo_name ? bucket.getPublicUrl(nextMatch.team_b.photo_name).data.publicUrl : "images/default-team.png";
        
        document.getElementById("nextTeamALogo").style.backgroundImage = `url('${logoA}')`;
        document.getElementById("nextTeamBLogo").style.backgroundImage = `url('${logoB}')`;
        
        startCountdown(nextMatch.actual_start_time || nextMatch.scheduled_time);
    } else {
        if (liveCard) liveCard.classList.add("hidden");
        if (nextCard) nextCard.classList.add("hidden");
    }

    // Handle Fantasy Action Logic (Edit Team Enable/Disable)
    const activePhase = (phases || []).find(p => !p.is_locked);
    const editBtn = document.getElementById("homeEditTeamBtn");

    if (editBtn) {
        if (activePhase) {
            editBtn.disabled = false;
            editBtn.innerHTML = `<i class="fas fa-pencil-alt" style="margin-right: 6px;"></i> Edit Team`;
            editBtn.style.opacity = "1";
            editBtn.style.pointerEvents = "auto";
        } else {
            editBtn.disabled = true;
            editBtn.innerHTML = `<i class="fas fa-lock" style="margin-right: 6px;"></i> Locked`;
            editBtn.style.opacity = "0.5";
            editBtn.style.pointerEvents = "none";
        }
    }
}

/* ══════════════════════════════════════════════════════
   TOURNAMENT STATS & GROUPS
══════════════════════════════════════════════════════ */
async function loadTournamentStats() {
    const grid = document.getElementById("topPerformersGrid");
    if (!grid) return;

    const { data } = await supabase
        .from('v_ppl_player_overall_stats')
        .select('*')
        .order('fantasy_points', { ascending: false });

    if (!data || data.length === 0) {
        grid.innerHTML = '<p class="loading-inline" style="grid-column: span 2;">Stats appear after matches</p>';
        return;
    }

    const mvp = data[0];
    const topBatter = [...data].sort((a, b) => b.runs - a.runs)[0];
    const topBowler = [...data].sort((a, b) => b.wickets - a.wickets)[0];
    const topFielder = [...data].sort((a, b) => b.fielding - a.fielding)[0];

    const cardsToRender = [
        { label: "Man of Series", icon: "⭐", p: mvp, isMvp: true },
        { label: "Top Batter", icon: "🏏", p: topBatter },
        { label: "Top Bowler", icon: "🎳", p: topBowler },
        { label: "Top Fielder", icon: "🧤", p: topFielder }
    ];

    grid.innerHTML = cardsToRender.map(item => `
        <div class="stat-mini-card ${item.isMvp ? 'mvp' : ''}">
            <div class="sm-icon">${item.icon}</div>
            <div class="sm-role">${item.label}</div>
            <div class="sm-name">${item.p.name.split(" ").pop()}</div>
            <div class="sm-val">${item.p.fantasy_points} <span style="font-size: 10px; font-weight: normal; color: var(--text-faint);">PTS</span></div>
            <div style="font-size: 9px; color: var(--text-faint); margin-top: 4px; font-weight: 600;">
                ${item.p.runs}R | ${item.p.wickets}W | ${item.p.fielding}F
            </div>
        </div>
    `).join('');
}

async function loadGroupsPreview() {
    const grid = document.getElementById("groupsPreviewGrid");
    if (!grid) return;

    const { data } = await supabase.from('ppl_points_table')
        .select('*, team:team_id(short_name, group_name)')
        .order('points', { ascending: false })
        .order('nrr', { ascending: false });

    if (!data || data.length === 0) {
        grid.innerHTML = '<p class="loading-inline" style="grid-column: span 2;">Standings appear after matches</p>';
        return;
    }

    const grpA = data.filter(r => r.team?.group_name === 'A' || r.group_name === 'A').slice(0, 2);
    const grpB = data.filter(r => r.team?.group_name === 'B' || r.group_name === 'B').slice(0, 2);

    const renderCol = (title, rows) => {
        return `
        <div class="grp-col">
            <div class="grp-title">${title}</div>
            ${rows.map((r, i) => `
                <div class="grp-row rank-${i+1}">
                    <span>${i+1}. ${r.team?.short_name || 'TBA'}</span>
                    <span>${r.points}</span>
                </div>
            `).join('')}
        </div>`;
    };

    grid.innerHTML = renderCol("Group A", grpA) + renderCol("Group B", grpB);
}

/* ══════════════════════════════════════════════════════
   MOST PICKED TRENDS
══════════════════════════════════════════════════════ */
async function loadMostPicked() {
    const wrapper = document.getElementById("mostPickedWrapper");
    if (!wrapper) return;

    const [{ data: picks }, { data: players }] = await Promise.all([
        supabase.from('ppl_user_team_players').select('player_id, is_captain, is_vice_captain'),
        supabase.from('ppl_players').select('id, name, photo_url')
    ]);

    if (!picks || picks.length === 0) {
        wrapper.innerHTML = '<p class="loading-inline">Not enough data yet.</p>';
        return;
    }

    const counts = { total: {}, cap: {}, vc: {} };
    picks.forEach(p => {
        counts.total[p.player_id] = (counts.total[p.player_id] || 0) + 1;
        if (p.is_captain) counts.cap[p.player_id] = (counts.cap[p.player_id] || 0) + 1;
        if (p.is_vice_captain) counts.vc[p.player_id] = (counts.vc[p.player_id] || 0) + 1;
    });

    const getTop3 = (mapObj) => Object.entries(mapObj)
        .sort((a,b) => b[1] - a[1]).slice(0, 3)
        .map(([id, count]) => {
            const p = players?.find(pl => pl.id === id);
            return { p, count };
        }).filter(item => item.p);

    const topPicks = getTop3(counts.total);
    const topCap   = getTop3(counts.cap);
    const topVC    = getTop3(counts.vc);

    const bucket = supabase.storage.from("player-photos");
    const renderBlock = (title, icon, dataList, suffix) => {
        if (!dataList.length) return '';
        return `
        <div class="mp-category">
            <div class="mp-title">${icon} ${title}</div>
            ${dataList.map(item => {
                const photoUrl = item.p.photo_url ? bucket.getPublicUrl(item.p.photo_url).data.publicUrl : "images/default-avatar.png";
                return `
                <div class="mp-row">
                    <div class="mp-player">
                        <div class="mp-avatar" style="background-image:url('${photoUrl}')"></div>
                        <span>${item.p.name.split(" ").pop()}</span>
                    </div>
                    <div class="mp-stat">${item.count} <span style="font-size:9px;color:var(--text-faint)">${suffix}</span></div>
                </div>`;
            }).join('')}
        </div>`;
    };

    wrapper.innerHTML = 
        renderBlock("Most Selected", "👥", topPicks, "teams") +
        renderBlock("Top Captains", "👑", topCap, "teams") +
        renderBlock("Top Vice-Captains", "🎯", topVC, "teams");
}

/* ══════════════════════════════════════════════════════
   GLOBAL LEADERBOARD PREVIEW
══════════════════════════════════════════════════════ */
async function loadLeaderboardPreview() {
    const container = document.getElementById("leaderboardContainer");
    const countEl = document.getElementById("overallMemberCount");
    
    const [{ data: lb, error }, { count: userCount }] = await Promise.all([
        supabase.from("ppl_overall_leaderboard")
            .select("team_name, full_name, total_points, overall_rank, user_id")
            .order("overall_rank", { ascending: true })
            .limit(3),
        supabase.from("user_profiles")
            .select("*", { count: "exact", head: true })
            .eq("profile_completed", true),
    ]);

    if (countEl && userCount != null) countEl.textContent = `${userCount.toLocaleString()} managers`;
    if (!container) return;

    if (error || !lb) {
        container.innerHTML = `<p class="empty-state-text">Could not load rankings.</p>`;
        return;
    }

    if (lb.length > 0) {
        container.innerHTML = "";
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
            container.appendChild(rowDiv);
            top3UserIds.set(row.user_id, row.overall_rank);
        });
    } else {
        container.innerHTML = `<p class="empty-state-text">Rankings appear after Match 1!</p>`;
    }
}

/* ══════════════════════════════════════════════════════
   DYNAMIC NAV & TIMER
══════════════════════════════════════════════════════ */
async function initLiveNav() {
    const navLiveDot = document.getElementById("navLiveDot");
    const navMatchLabel = document.getElementById("navMatchLabel");
    if (!navLiveDot) return;

    const updateNavUI = async () => {
        const { data: match } = await supabase.from("ppl_matches").select("id").eq("status", "in_progress").limit(1).maybeSingle();
        if (match) {
            navMatchLabel.textContent = "LIVE";
            navLiveDot.classList.remove("hidden");
        } else {
            navMatchLabel.textContent = "Scores";
            navLiveDot.classList.add("hidden");
        }
    };
    updateNavUI();
    navChannel = supabase.channel('ppl-nav-updates').on('postgres_changes', { event: 'UPDATE', table: 'ppl_matches' }, updateNavUI).subscribe();
}

function startCountdown(startTime) {
    if (!startTime) {
        document.getElementById("nextMatchTime").innerHTML = `<i class="far fa-clock"></i> Time TBD`;
        return;
    }
    
    if (countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();
    const timeEl = document.getElementById("nextMatchTime");

    const update = () => {
        const dist = matchTime - Date.now();
        if (dist <= 0) {
            clearInterval(countdownInterval);
            if (timeEl) timeEl.innerHTML = `<i class="far fa-clock"></i> Match Started`;
            return;
        }

        const days    = Math.floor(dist / 86400000);
        const hours   = Math.floor((dist % 86400000) / 3600000);
        const minutes = Math.floor((dist % 3600000)  / 60000);
        const seconds = Math.floor((dist % 60000)    / 1000);

        if (timeEl) {
            timeEl.innerHTML = days > 0
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

/* ══════════════════════════════════════════════════════
   PROFILE MODAL & CHAT (GLOBAL BANTER)
══════════════════════════════════════════════════════ */
if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        const teamName = modalTeamName.value.trim();
        const file     = avatarInput?.files[0];
        const isFirstTime = !existingProfile || !existingProfile.profile_completed;

        if (isFirstTime && (!teamName)) { alert("Please enter your team name."); return; }

        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = "SAVING...";

        try {
            let photoPath = existingProfile?.team_photo_url;
            if (file) {
                const fileExt  = file.name.split(".").pop();
                const fileName = `${currentUserId}/avatar.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from("team-avatars").upload(fileName, file, { cacheControl: "3600", upsert: true });
                if (uploadError) throw uploadError;
                photoPath = `${fileName}?t=${Date.now()}`;
            }

            const updatePayload = { team_photo_url: photoPath };
            if (isFirstTime || teamName) updatePayload.team_name = teamName;
            if (isFirstTime) updatePayload.profile_completed = true;

            const { error: updateError } = await supabase.from("user_profiles").upsert({ user_id: currentUserId, ...updatePayload }, { onConflict: "user_id" });
            if (updateError) throw updateError;

            profileModal.classList.add("hidden");
            window.location.reload();
        } catch (err) {
            alert("Failed to save: " + err.message);
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
        else window.location.href = "profile.html"; 
    };
}

// Global Chat
async function initChat(userId) {
    if (!chatFab) return;

    chatFab.onclick = () => {
        chatPanel.classList.add("show");
        chatBackdrop.classList.remove("hidden");
        unreadCount = 0; 
        const unreadBadge = document.getElementById("unreadBadge");
        if (unreadBadge) { unreadBadge.textContent = ""; unreadBadge.classList.add("hidden"); unreadBadge.style.display = "none"; }
        setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 100);
    };

    const closeChat = () => { chatPanel.classList.remove("show"); chatBackdrop.classList.add("hidden"); };
    if (closeChatBtn) closeChatBtn.onclick = closeChat;
    if (chatBackdrop) chatBackdrop.onclick = closeChat;

    if (chatForm) {
        chatForm.onsubmit = async e => {
            e.preventDefault();
            const msg = chatInput?.value.trim();
            if (!msg) return;
            chatInput.value = "";
            renderMessage({ user_id: userId, message: msg, _senderName: "You" }, userId);
            await supabase.from("game_chat").insert([{ user_id: userId, message: msg, league_id: null, context: "ppl" }]);
        };
    }

    const { data } = await supabase.from("game_chat").select("user_id, message, created_at, user_profiles(team_name)").is("league_id", null).order("created_at", { ascending: false }).limit(50);
    chatMessages.replaceChildren();

    if (!data?.length) {
        chatIsEmpty = true;
        chatMessages.innerHTML = '<p class="chat-placeholder">Be the first to talk trash in PPL!</p>';
    } else {
        chatIsEmpty = false;
        data.forEach(msg => {
            if (msg.user_profiles?.team_name && !senderNameCache.has(msg.user_id)) senderNameCache.set(msg.user_id, msg.user_profiles.team_name);
        });
        data.reverse().forEach(msg => renderMessage(msg, userId));
    }

    chatSubscription = supabase.channel("public:game_chat_ppl")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat", filter: "league_id=is.null" }, async payload => {
            const newMsg = payload.new;
            if (newMsg.user_id === userId) return;
            if (!senderNameCache.has(newMsg.user_id)) {
                const { data: p } = await supabase.from("user_profiles").select("team_name").eq("user_id", newMsg.user_id).maybeSingle();
                if (p?.team_name) senderNameCache.set(newMsg.user_id, p.team_name);
            }
            newMsg._senderName = senderNameCache.get(newMsg.user_id) || "Manager";
            renderMessage(newMsg, userId);
            if (!chatPanel?.classList.contains("show")) {
                unreadCount++;
                const b = document.getElementById("unreadBadge");
                if (b) { b.textContent = unreadCount; b.classList.remove("hidden"); b.style.display = "flex"; }
            }
        }).subscribe();
}

function renderMessage(msgData, currentUserId) {
    if (!chatMessages) return;
    if (chatIsEmpty) { chatMessages.replaceChildren(); chatIsEmpty = false; }

    const isMe = msgData.user_id === currentUserId;
    const senderName = isMe ? "You" : msgData._senderName || senderNameCache.get(msgData.user_id) || "Manager";
    
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

window.addEventListener("pagehide", () => {
    if (countdownInterval) clearInterval(countdownInterval);
    if (chatSubscription) supabase.removeChannel(chatSubscription);
    if (navChannel) supabase.removeChannel(navChannel);
    if (matchChannel) supabase.removeChannel(matchChannel);
});