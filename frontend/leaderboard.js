import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

/* ─── ELEMENTS ───────────────────────────────────────────────────────────── */
const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary   = document.getElementById("leaderboardSummary");
const podiumContainer      = document.getElementById("podiumContainer");

/* ─── AD UTILITY ─────────────────────────────────────────────────────────── */
// BUG FIX #2: localStorage wrapped in try/catch for Safari Private Mode
let adShownOnScroll = false;

function loadMonetagAd() {
    let lastShown = null;
    try { lastShown = localStorage.getItem("ad_last_shown"); } catch (_) {}
    const now = Date.now();
    if (lastShown && now - Number(lastShown) < 120000) return;
    try { localStorage.setItem("ad_last_shown", now); } catch (_) {}

    const script       = document.createElement("script");
    script.dataset.zone = "10742556";
    script.src          = "https://gizokraijaw.net/vignette.min.js";
    script.async        = true;
    document.body.appendChild(script);
}

/* ─── INIT ───────────────────────────────────────────────────────────────── */
// BUG FIX #1: Replaced supabase.auth.getSession() with authReady Promise
async function init() {
    let userId;
    try {
        const user = await authReady;
        userId = user.id;
    } catch (_) {
        // auth-guard.js already redirected to login
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const leagueId  = urlParams.get("league_id");

    // BUG FIX #4: .maybeSingle() instead of .single() — no throw on empty/multiple rows
    const { data: activeTournament } = await supabase
        .from("active_tournament")
        .select("*")
        .maybeSingle();

    if (!activeTournament) {
        if (leaderboardSummary) leaderboardSummary.textContent = "No active tournament.";
        return;
    }

    let query;
if (leagueId) {
    query = supabase
        .from("private_league_leaderboard")
        .select("*")
        .eq("league_id", leagueId);
    const h1 = document.getElementById("lbPageTitle");
    if (h1) h1.textContent = "League Standings";
    // Hide prizes — private league has no season prizes
    const prizesStrip = document.querySelector(".lb-prizes-strip");
    if (prizesStrip) prizesStrip.style.display = "none";

    } else {
        query = supabase
            .from("leaderboard_view")
            .select("*")
            .eq("tournament_id", activeTournament.id);
    }

    const [leaderboardRes, profilesRes] = await Promise.all([
        query.order("total_points", { ascending: false }),
        supabase.from("user_profiles").select("user_id, team_photo_url"),
    ]);

    const leaderboard = leaderboardRes.data || [];
    const profiles    = profilesRes.data   || [];

    const normalized = leaderboard.map(row => ({
        ...row,
        rank: leagueId ? row.rank_in_league : row.rank,
    }));

    const avatarMap = new Map(profiles.map(p => [p.user_id, p.team_photo_url]));
    renderLeaderboard(normalized, userId, avatarMap);

    // BUG FIX #3: Pass userId to initChat so it doesn't re-fetch the session
    initChat(userId, leagueId, activeTournament.id);

    setTimeout(() => {
        if (Math.random() < 0.5) loadMonetagAd();
    }, 2000);
}

init();

function buildRankCircle(rank, pct) {
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (pct / 100) * circumference;
    const colorClass = pct >= 70 ? "neon" : "red";

    const wrapper = document.createElement("div");
    wrapper.className = "rank-circle";

    wrapper.innerHTML = `
        <svg viewBox="0 0 42 42">
            <circle class="rank-circle-bg"
                cx="21" cy="21" r="${radius}"/>
            <circle class="rank-circle-fill ${colorClass}"
                cx="21" cy="21" r="${radius}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}"/>
        </svg>
        <div class="rank-circle-label">#${rank}</div>`;

    return wrapper;
}

/* ─── LEADERBOARD RENDERER ───────────────────────────────────────────────── */
function renderLeaderboard(leaderboard, userId, avatarMap) {
    if (!podiumContainer || !leaderboardContainer || !leaderboardSummary) return;

    if (leaderboard.length === 0) {
        podiumContainer.innerHTML  = "";
        leaderboardContainer.innerHTML = "";
        leaderboardSummary.textContent = "Rankings appear after Match 1.";
        return;
    }

    const top3     = leaderboard.slice(0, 3);
    const rest     = leaderboard.slice(3);

    const rank1Points = top3[0]?.total_points || 1;

    const p1 = top3[0] || { team_name: "TBA", total_points: 0, rank: 1, user_id: null };
    const p2 = top3[1] || { team_name: "TBA", total_points: 0, rank: 2, user_id: null };
    const p3 = top3[2] || { team_name: "TBA", total_points: 0, rank: 3, user_id: null };

    podiumContainer.replaceChildren();

    // Visual order: 2nd left, 1st centre, 3rd right
    [{ pos: 2, user: p2 }, { pos: 1, user: p1 }, { pos: 3, user: p3 }].forEach(({ pos, user }) => {
        const card = document.createElement("div");
        card.className = `podium-card rank-${pos}`;
        card.onclick   = () => scoutUser(user.user_id, user.team_name || "Anonymous");

const pct       = pos === 1 ? 100 : Math.round(((user.total_points || 0) / rank1Points) * 100);
const rankBadge = buildRankCircle(user.rank || pos, pct);
rankBadge.classList.add("podium-rank-circle");

        const avatar = document.createElement("div");
        avatar.className = "podium-avatar";
        avatar.style.backgroundImage = "url('images/default-avatar.png')";

        if (user.user_id) {
            const photoPath = avatarMap.get(user.user_id);
            if (photoPath) {
                const { data } = supabase.storage.from("team-avatars").getPublicUrl(photoPath);
                avatar.style.backgroundImage = `url('${data.publicUrl}')`;
            }
        }

        const name = document.createElement("div");
        name.className   = "podium-name";
        name.textContent = user.team_name || "Anonymous";

const points = document.createElement("div");
points.className   = `podium-pts${user.total_points > 0 ? " has-pts" : ""}`;
points.textContent = `${user.total_points} pts`;

        applyRankFlair(avatar, name, pos);

        card.append(rankBadge, avatar, name, points);
        podiumContainer.appendChild(card);
    });

const me = leaderboard.find(row => row.user_id === userId);
if (me) {
    leaderboardSummary.textContent = `Your Rank: #${me.rank}  ·  ${me.total_points} pts`;
    leaderboardSummary.classList.remove("unranked");
} else {
    leaderboardSummary.textContent = "You are not ranked yet.";
    leaderboardSummary.classList.add("unranked");
}

    // Ranks 4+ list
    leaderboardContainer.replaceChildren();
    rest.forEach(row => {
        // BUG FIX #12: Consistent token-based colours.
        // Ranks 4–5: warm accent border. Ranks 6–10: muted border. 11+: dimmed, no border.
        let extraClass = "";
        if      (row.rank <= 5)  extraClass = "row-top5";
        else if (row.rank <= 10) extraClass = "row-top10";
        else                     extraClass = "row-rest";

        const rowEl = document.createElement("div");
        rowEl.className = `leader-row ${row.user_id === userId ? "you" : ""} ${extraClass}`.trim();
        rowEl.onclick   = () => scoutUser(row.user_id, row.team_name || "Anonymous");

const pct  = Math.round((row.total_points / rank1Points) * 100);
const rank = buildRankCircle(row.rank, pct);

        const team = document.createElement("div");
        team.className   = "l-team";
        team.textContent = row.team_name || "Anonymous";

const pts = document.createElement("div");
pts.className   = `l-pts${row.total_points > 0 ? " has-pts" : ""}`;
pts.textContent = `${row.total_points} pts`;

        const arrow = document.createElement("i");
        arrow.className = "fas fa-chevron-right l-arrow";

        rowEl.append(rank, team, pts, arrow);
        leaderboardContainer.appendChild(rowEl);
    });
}

/* ─── SCOUT USER ─────────────────────────────────────────────────────────── */
// BUG FIX #5: Dead scout counter removed entirely. No more console.log in prod.
function scoutUser(uid, name) {
    if (!uid || uid === "undefined" || uid === "null") return;
    window.location.href = `team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;
}

window.scoutUser = scoutUser;

/* ─── CHAT MODULE ────────────────────────────────────────────────────────── */
// BUG FIX #7: In-memory sender name cache — one profile fetch per user, not per message
const senderNameCache = new Map(); // Map<user_id, team_name>

// BUG FIX #8: Track subscription so we can remove it on pagehide
let chatSubscription = null;

// BUG FIX #6: Replace innerHTML string-matching with a proper flag
let chatIsEmpty = true;

const chatFab      = document.getElementById("chatFab");
const chatBackdrop = document.getElementById("chatBackdrop");
const chatPanel    = document.getElementById("chatPanel");
const closeChatBtn = document.getElementById("closeChatBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm     = document.getElementById("chatForm");
const chatInput    = document.getElementById("chatInput");
const chatTitle    = document.getElementById("chatTitle");
const unreadBadge  = document.getElementById("unreadBadge");

// Top 3 map for flair — keyed by user_id, value is rank 1/2/3
const top3UserIds  = new Map();

// BUG FIX #3: userId and leagueId passed in — no second getSession() call
async function initChat(userId, leagueId, tournamentId) {
    if (!chatFab) return;

    if (chatTitle) chatTitle.textContent = leagueId ? "League Banter" : "Global Banter";

    // Fetch top 3 for flair
    const rankQuery = leagueId
        ? supabase.from("private_league_leaderboard").select("user_id, rank_in_league").eq("league_id", leagueId).lte("rank_in_league", 3)
        : supabase.from("leaderboard_view").select("user_id, rank").eq("tournament_id", tournamentId).lte("rank", 3);

    const { data: topRows } = await rankQuery;
    if (topRows) {
        topRows.forEach(row => {
            top3UserIds.set(row.user_id, leagueId ? row.rank_in_league : row.rank);
        });
    }

    chatFab.onclick = () => {
        chatPanel.classList.add("show");
        chatBackdrop.classList.remove("hidden");
        unreadBadge.classList.add("hidden");
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

            // Optimistic render — use cached or "You"
            renderMessage({
                user_id: userId,
                message: msg,
                _senderName: "You",
            }, userId);

            await supabase.from("game_chat").insert([{
                user_id:   userId,
                message:   msg,
                league_id: leagueId || null,
            }]);
        };
    }

    await loadChatHistory(userId, leagueId);
    subscribeToChat(userId, leagueId);

    // BUG FIX #8: Unsubscribe on page hide
    window.addEventListener("pagehide", () => {
        if (chatSubscription) {
            supabase.removeChannel(chatSubscription);
            chatSubscription = null;
        }
    }, { once: true });
}

async function loadChatHistory(userId, leagueId) {
    if (!chatMessages) return;

    let query = supabase
        .from("game_chat")
        .select("user_id, message, created_at, user_profiles(team_name)")
        .order("created_at", { ascending: false })
        .limit(50);

    query = leagueId ? query.eq("league_id", leagueId) : query.is("league_id", null);

    const { data } = await query;
    chatMessages.replaceChildren();

    if (!data?.length) {
        chatIsEmpty = true;
        const placeholder = document.createElement("p");
        placeholder.className   = "chat-placeholder";
        placeholder.textContent = "Be the first to talk trash!";
        chatMessages.appendChild(placeholder);
        return;
    }

    chatIsEmpty = false;
    // Seed the sender name cache from history — avoids per-message fetches later
    data.forEach(msg => {
        const name = msg.user_profiles?.team_name;
        if (name && !senderNameCache.has(msg.user_id)) {
            senderNameCache.set(msg.user_id, name);
        }
    });

    data.reverse().forEach(msg => renderMessage(msg, userId));
}

function renderMessage(msgData, currentUserId) {
    if (!chatMessages) return;
    const isMe = msgData.user_id === currentUserId;

    // BUG FIX #6: Use flag instead of innerHTML.includes()
    if (chatIsEmpty) {
        chatMessages.replaceChildren();
        chatIsEmpty = false;
    }

    // BUG FIX #7: Use cache, never fetch inline
    const senderName = isMe
        ? "You"
        : msgData._senderName
          || senderNameCache.get(msgData.user_id)
          || msgData.user_profiles?.team_name
          || "Expert";

    // Update cache if we got a name from the message payload
    if (!isMe && senderName !== "Expert" && !senderNameCache.has(msgData.user_id)) {
        senderNameCache.set(msgData.user_id, senderName);
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${isMe ? "me" : "them"}`;

    if (!isMe) {
        const nameEl = document.createElement("div");
        nameEl.className   = "msg-sender";
        nameEl.textContent = senderName;

        const rank = top3UserIds.get(msgData.user_id);
        if (rank) applyRankFlair(null, nameEl, rank);

        const bubble = document.createElement("div");
        bubble.className   = "msg-bubble";
        bubble.textContent = msgData.message;

        msgDiv.append(nameEl, bubble);
    } else {
        const bubble = document.createElement("div");
        bubble.className   = "msg-bubble";
        bubble.textContent = msgData.message;
        msgDiv.appendChild(bubble);
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function subscribeToChat(userId, leagueId) {
    chatSubscription = supabase
        .channel("public:game_chat")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat" }, async payload => {
            const newMsg = payload.new;
            const isMatch = leagueId
                ? newMsg.league_id === leagueId
                : newMsg.league_id === null;
            if (!isMatch || newMsg.user_id === userId) return;

            // BUG FIX #7: Check cache first — only fetch if name unknown
            if (!senderNameCache.has(newMsg.user_id)) {
                const { data: profile } = await supabase
                    .from("user_profiles")
                    .select("team_name")
                    .eq("user_id", newMsg.user_id)
                    .maybeSingle();
                if (profile?.team_name) {
                    senderNameCache.set(newMsg.user_id, profile.team_name);
                }
            }

            newMsg._senderName = senderNameCache.get(newMsg.user_id) || "Expert";
            renderMessage(newMsg, userId);

            if (!chatPanel?.classList.contains("show")) {
                unreadBadge?.classList.remove("hidden");
            }
        })
        .subscribe();
}

/* ─── SCROLL AD TRIGGER ─────────────────────────────────────────────────── */
window.addEventListener("scroll", () => {
    if (adShownOnScroll) return;
    const triggerPoint = document.body.scrollHeight * 0.6;
    if (window.scrollY > triggerPoint && !chatPanel?.classList.contains("show")) {
        adShownOnScroll = true;
        loadMonetagAd();
    }
});