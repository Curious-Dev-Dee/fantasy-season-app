import { supabase } from "./supabase.js";
import { applyRankFlair } from "./animations.js";

const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary = document.getElementById("leaderboardSummary");
const podiumContainer = document.getElementById("podiumContainer");

function loadMonetagAd() {
    const lastShown = localStorage.getItem("ad_last_shown");
    const now = Date.now();
    if (lastShown && now - lastShown < 120000) return;
    localStorage.setItem("ad_last_shown", now);
    const script = document.createElement("script");
    script.dataset.zone = "10742556";
    script.src = "https://gizokraijaw.net/vignette.min.js";
    script.async = true;
    document.body.appendChild(script);
}

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    const userId = session.user.id;

    const urlParams = new URLSearchParams(window.location.search);
    const leagueId = urlParams.get("league_id");

    const { data: activeTournament } = await supabase.from("active_tournament").select("*").single();
    if (!activeTournament) return;

    let query;
    if (leagueId) {
        query = supabase.from("private_league_leaderboard").select("*").eq("league_id", leagueId);
        document.querySelector("h1").textContent = "League Standings";
    } else {
        query = supabase.from("leaderboard_view").select("*").eq("tournament_id", activeTournament.id);
    }

    const [leaderboardRes, profilesRes] = await Promise.all([
        query.order("total_points", { ascending: false }),
        supabase.from("user_profiles").select("user_id, team_photo_url")
    ]);

    const leaderboard = leaderboardRes.data || [];
    const profiles = profilesRes.data || [];
    const normalizedData = leaderboard.map((row) => ({
        ...row,
        rank: leagueId ? row.rank_in_league : row.rank
    }));

    const avatarMap = new Map(profiles.map((p) => [p.user_id, p.team_photo_url]));
    renderLeaderboard(normalizedData, userId, avatarMap);

    setTimeout(() => {
        if (Math.random() < 0.5) loadMonetagAd();
    }, 2000);
}

function renderLeaderboard(leaderboard, userId, avatarMap) {
    if (!podiumContainer || !leaderboardContainer || !leaderboardSummary) return;

    if (leaderboard.length === 0) {
        podiumContainer.innerHTML = '<p style="color:var(--text-dim); margin:auto; padding:20px;">No rankings available yet.</p>';
        leaderboardContainer.innerHTML = '';
        leaderboardSummary.textContent = "Rankings will appear after Match 1.";
        return;
    }

    const top3     = leaderboard.slice(0, 3);
    const remaining = leaderboard.slice(3);

    const p1 = top3[0] || { team_name: "TBA", total_points: 0, rank: 1, user_id: null };
    const p2 = top3[1] || { team_name: "TBA", total_points: 0, rank: 2, user_id: null };
    const p3 = top3[2] || { team_name: "TBA", total_points: 0, rank: 3, user_id: null };

    podiumContainer.replaceChildren();

    // Visual layout order: 2nd left, 1st centre, 3rd right
    const podiumPositions = [
        { pos: 2, user: p2 },
        { pos: 1, user: p1 },
        { pos: 3, user: p3 }
    ];

    podiumPositions.forEach(({ pos, user }) => {
        const card = document.createElement("div");
        card.className = `podium-card rank-${pos}`;
        card.onclick = () => window.scoutUser(user.user_id, user.team_name || "Anonymous");

        const rankBadge = document.createElement("div");
        rankBadge.className = "rank-badge";
        rankBadge.textContent = String(user.rank || pos);

        const avatar = document.createElement("div");
        avatar.className = "podium-avatar";
        avatar.style.backgroundImage = `url('https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png')`;

        if (user.user_id) {
            const photoPath = avatarMap.get(user.user_id);
            if (photoPath) {
                const { data } = supabase.storage.from("team-avatars").getPublicUrl(photoPath);
                avatar.style.backgroundImage = `url('${data.publicUrl}')`;
            }
        }

        const name = document.createElement("div");
        name.className = "podium-name";
        name.textContent = user.team_name || "Anonymous";

        const points = document.createElement("div");
        points.className = "podium-pts";
        points.textContent = `${user.total_points} pts`;

        // ── FLAIR: Gold/silver/bronze on podium avatar + name ──
        // pos is always 1, 2, or 3 here so flair always applies
        applyRankFlair(avatar, name, pos);

        card.append(rankBadge, avatar, name, points);
        podiumContainer.appendChild(card);
    });

    // User summary bar
    const currentUserRow = leaderboard.find((row) => row.user_id === userId);
    leaderboardSummary.textContent = currentUserRow
        ? `Your Rank: #${currentUserRow.rank} | Score: ${currentUserRow.total_points}`
        : "You are not ranked yet.";

    // Ranks 4+ list
    leaderboardContainer.replaceChildren();
    remaining.forEach((row) => {
        let borderClass = "";
        if (row.rank >= 4  && row.rank <= 5)  borderClass = "border-orange";
        else if (row.rank >= 6  && row.rank <= 10) borderClass = "border-yellow";
        else if (row.rank > 10)                    borderClass = "border-red";

        const rowEl = document.createElement("div");
        rowEl.className = `leader-row ${row.user_id === userId ? "you" : ""} ${borderClass}`.trim();
        rowEl.onclick = () => window.scoutUser(row.user_id, row.team_name || "Anonymous");

        const rank = document.createElement("div");
        rank.className = "l-rank";
        rank.textContent = `#${row.rank}`;

        const team = document.createElement("div");
        team.className = "l-team";
        team.textContent = row.team_name || "Anonymous";

        const pts = document.createElement("div");
        pts.className = "l-pts";
        pts.textContent = `${row.total_points} pts`;

        const arrow = document.createElement("div");
        arrow.className = "l-arrow";
        arrow.innerHTML = `<i class="fas fa-chevron-right"></i>`;

        rowEl.append(rank, team, pts, arrow);
        leaderboardContainer.appendChild(rowEl);
    });
}

/* =========================
   SCOUT USER
========================= */
window.scoutUser = (uid, name) => {
    if (!uid || uid === "undefined" || uid === "null") return;
    let scoutCount = parseInt(localStorage.getItem('scout_trigger_count') || '0');
    scoutCount++;
    localStorage.setItem('scout_trigger_count', scoutCount);
    if (scoutCount % 3 === 0) {
        console.log("Scout threshold reached. Ad will trigger on page load.");
    }
    window.location.href = `team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;
};

/* =========================
   LIVE CHAT MODULE
========================= */
let chatSubscription = null;
let chatUserId = null;
let currentLeagueId = null;

// ── Store top 3 user IDs so renderMessage can apply flair to sender names ──
const top3UserIds = new Map(); // Map<user_id, rank (1|2|3)>

const chatFab       = document.getElementById("chatFab");
const chatBackdrop  = document.getElementById("chatBackdrop");
const chatPanel     = document.getElementById("chatPanel");
const closeChatBtn  = document.getElementById("closeChatBtn");
const chatMessages  = document.getElementById("chatMessages");
const chatForm      = document.getElementById("chatForm");
const chatInput     = document.getElementById("chatInput");
const chatTitle     = document.getElementById("chatTitle");
const unreadBadge   = document.getElementById("unreadBadge");

async function initChat() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    chatUserId = session.user.id;

    const urlParams = new URLSearchParams(window.location.search);
    currentLeagueId = urlParams.get("league_id");
    chatTitle.textContent = currentLeagueId ? "League Banter" : "Global Banter";

    // ── Fetch top 3 so we know whose names to flair in chat ──
    let rankQuery;
    if (currentLeagueId) {
        rankQuery = supabase
            .from("private_league_leaderboard")
            .select("user_id, rank_in_league")
            .eq("league_id", currentLeagueId)
            .lte("rank_in_league", 3);
    } else {
        const { data: activeT } = await supabase.from("active_tournament").select("id").single();
        rankQuery = supabase
            .from("leaderboard_view")
            .select("user_id, rank")
            .eq("tournament_id", activeT?.id)
            .lte("rank", 3);
    }
    const { data: topRows } = await rankQuery;
    if (topRows) {
        topRows.forEach(row => {
            const rank = currentLeagueId ? row.rank_in_league : row.rank;
            top3UserIds.set(row.user_id, rank);
        });
    }

    chatFab.onclick = () => {
        chatPanel.classList.add("show");
        chatBackdrop.classList.remove("hidden");
        unreadBadge.classList.add("hidden");
        setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
    };

    const closeChat = () => {
        chatPanel.classList.remove("show");
        chatBackdrop.classList.add("hidden");
    };
    closeChatBtn.onclick = closeChat;
    chatBackdrop.onclick = closeChat;

    chatForm.onsubmit = async (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (!msg) return;
        chatInput.value = "";
        renderMessage({ user_id: chatUserId, message: msg, user_profiles: { team_name: "You" } }, true);
        await supabase.from("game_chat").insert([{
            user_id: chatUserId,
            message: msg,
            league_id: currentLeagueId
        }]);
    };

    loadChatHistory();
    subscribeToChat();
}

async function loadChatHistory() {
    let query = supabase
        .from("game_chat")
        .select("user_id, message, created_at, user_profiles(team_name)")
        .order("created_at", { ascending: false })
        .limit(50);

    if (currentLeagueId) {
        query = query.eq("league_id", currentLeagueId);
    } else {
        query = query.is("league_id", null);
    }

    const { data } = await query;
    chatMessages.innerHTML = "";

    if (data && data.length > 0) {
        data.reverse().forEach(msg => renderMessage(msg, false));
    } else {
        chatMessages.innerHTML = '<p style="color:var(--text-faint); text-align:center; font-size:12px; margin-top:20px;">Be the first to talk trash!</p>';
    }
}

function renderMessage(msgData, isOptimistic = false) {
    const isMe = msgData.user_id === chatUserId;
    const senderName = isMe ? "You" : (msgData.user_profiles?.team_name || "Expert");

    if (chatMessages.innerHTML.includes("Be the first")) {
        chatMessages.innerHTML = "";
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${isMe ? "me" : "them"}`;

    // ── FLAIR: Apply rank color to sender name for top 3 users ──
    // We only flair other people's names, never "You"
    if (!isMe) {
        const senderNameEl = document.createElement("div");
        senderNameEl.className = "msg-sender";
        senderNameEl.textContent = senderName;

        const senderRank = top3UserIds.get(msgData.user_id);
        if (senderRank) {
            // Pass null for avatar — chat bubbles have no avatar element
            applyRankFlair(null, senderNameEl, senderRank);
        }

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        bubble.textContent = msgData.message;

        msgDiv.append(senderNameEl, bubble);
    } else {
        // Own messages: no sender name shown, just bubble
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        bubble.textContent = msgData.message;
        msgDiv.appendChild(bubble);
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function subscribeToChat() {
    chatSubscription = supabase
        .channel('public:game_chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, async (payload) => {
            const newMsg = payload.new;
            const isMatch = currentLeagueId
                ? (newMsg.league_id === currentLeagueId)
                : (newMsg.league_id === null);
            if (!isMatch || newMsg.user_id === chatUserId) return;

            const { data: profile } = await supabase
                .from('user_profiles')
                .select('team_name')
                .eq('user_id', newMsg.user_id)
                .single();
            newMsg.user_profiles = profile;

            renderMessage(newMsg, false);

            if (!chatPanel.classList.contains("show")) {
                unreadBadge.classList.remove("hidden");
            }
        })
        .subscribe();
}

document.addEventListener("DOMContentLoaded", initChat);

let adShownOnScroll = false;
window.addEventListener("scroll", () => {
    if (adShownOnScroll) return;
    const scrollY = window.scrollY;
    const triggerPoint = document.body.scrollHeight * 0.6;
    if (scrollY > triggerPoint && !chatPanel.classList.contains("show")) {
        adShownOnScroll = true;
        loadMonetagAd();
    }
});