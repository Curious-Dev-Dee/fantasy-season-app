import { supabase } from "./supabase.js";

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
        // Because you have max 100 users, this query is perfectly safe and fast!
        supabase.from("user_profiles").select("user_id, team_photo_url")
    ]);

    const leaderboard = leaderboardRes.data || [];
    const profiles = profilesRes.data || [];
    const normalizedData = leaderboard.map((row) => ({
        ...row,
        rank: leagueId ? row.rank_in_league : row.rank
    }));

    const avatarMap = new Map(profiles.map((profile) => [profile.user_id, profile.team_photo_url]));
    renderLeaderboard(normalizedData, userId, avatarMap);
    setTimeout(() => {
    if (Math.random() < 0.5) {
        loadMonetagAd();
    }
}, 2000);
}



function renderLeaderboard(leaderboard, userId, avatarMap) {
    if (!podiumContainer || !leaderboardContainer || !leaderboardSummary) return;

    // THE FIX: Handle Day 1 elegantly
    if (leaderboard.length === 0) {
        podiumContainer.innerHTML = '<p style="color:var(--text-dim);; margin: auto; padding: 20px;">No rankings available yet.</p>';
        leaderboardContainer.innerHTML = '';
        leaderboardSummary.textContent = "Rankings will appear after Match 1.";
        return;
    }

    const top3 = leaderboard.slice(0, 3);
    // ... [rest of the function continues normally]

    const remaining = leaderboard.slice(3);

    const p2 = top3[1] || { team_name: "TBA", total_points: 0, rank: 2, user_id: null };
    const p1 = top3[0] || { team_name: "TBA", total_points: 0, rank: 1, user_id: null };
    const p3 = top3[2] || { team_name: "TBA", total_points: 0, rank: 3, user_id: null };

podiumContainer.replaceChildren();
    
    // THE FIX: explicitly map the visual position (pos) separate from the database rank!
    const podiumPositions = [
        { pos: 2, user: p2 },
        { pos: 1, user: p1 },
        { pos: 3, user: p3 }
    ];

    // Create the Podium
    podiumPositions.forEach(({ pos, user }) => {
        const card = document.createElement("div");
        // Use 'pos' so the CSS layout NEVER breaks, even during a tie!
        card.className = `podium-card rank-${pos}`; 
        card.onclick = () => window.scoutUser(user.user_id, user.team_name || "Anonymous");

        const rankBadge = document.createElement("div");
        rankBadge.className = "rank-badge";
        // Print the actual database rank (or default to pos if TBA)
        rankBadge.textContent = String(user.rank || pos);

        const avatar = document.createElement("div");
        avatar.className = "podium-avatar";
        
        // Add default avatar background just in case
        avatar.style.backgroundImage = `url('https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png')`;

        if (user.user_id) {
            const photoPath = avatarMap.get(user.user_id);
            if (photoPath) {
                const { data } = supabase.storage.from("team-avatars").getPublicUrl(photoPath);
                // THE FIX: Removed the Date.now() cache-buster!
                avatar.style.backgroundImage = `url('${data.publicUrl}')`;
            }
        }

        const name = document.createElement("div");
        name.className = "podium-name";
        name.textContent = user.team_name || "Anonymous";

        const points = document.createElement("div");
        points.className = "podium-pts";
        points.textContent = `${user.total_points} pts`;

        card.append(rankBadge, avatar, name, points);
        podiumContainer.appendChild(card);
    });

    // Update Summary
    const currentUserRow = leaderboard.find((row) => row.user_id === userId);
    leaderboardSummary.textContent = currentUserRow
        ? `Your Rank: #${currentUserRow.rank} | Score: ${currentUserRow.total_points}`
        : "You are not ranked yet.";

    // Render Remaining List (Ranks 4 to 100)
    leaderboardContainer.replaceChildren();
    remaining.forEach((row) => {
        const rowEl = document.createElement("div");
        
        // Determine the border color class based on rank
        let borderClass = "";
        if (row.rank >= 4 && row.rank <= 5) borderClass = "border-orange";
        else if (row.rank >= 6 && row.rank <= 10) borderClass = "border-yellow";
        else if (row.rank > 10) borderClass = "border-red";

        rowEl.className = `leader-row ${row.user_id === userId ? "you" : ""} ${borderClass}`.trim();
        rowEl.onclick = () => window.scoutUser(row.user_id, row.team_name || "Anonymous");

        const rank = document.createElement("div");
        rank.className = "l-rank";
        rank.textContent = `#${row.rank}`;

        const team = document.createElement("div");
        team.className = "l-team";
        team.textContent = row.team_name || "Anonymous";

        const points = document.createElement("div");
        points.className = "l-pts";
        points.textContent = `${row.total_points} pts`;

        const arrow = document.createElement("div");
        arrow.className = "l-arrow";
        const icon = document.createElement("i");
        icon.className = "fas fa-chevron-right";
        arrow.appendChild(icon);

        rowEl.append(rank, team, points, arrow);
        leaderboardContainer.appendChild(rowEl);
    });
}

window.scoutUser = (uid, name) => {
    if (!uid || uid === "undefined" || uid === "null") return;

    // Retrieve or initialize the counter from local storage
    let scoutCount = parseInt(localStorage.getItem('scout_trigger_count') || '0');
    scoutCount++;
    localStorage.setItem('scout_trigger_count', scoutCount);

    const targetUrl = `team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;

    // If it's the 3rd, 6th, etc. click, we send them to the team-view.html 
    // where the script in the <head> will handle the full-screen ad.
    if (scoutCount % 3 === 0) {
        console.log("Scout threshold reached. Ad will trigger on page load.");
    }

    window.location.href = targetUrl;
};

/* =========================
   LIVE CHAT MODULE
========================= */
let chatSubscription = null;
let chatUserId = null;
let currentLeagueId = null;

// Get DOM Elements
const chatFab = document.getElementById("chatFab");
const chatBackdrop = document.getElementById("chatBackdrop");
const chatPanel = document.getElementById("chatPanel");
const closeChatBtn = document.getElementById("closeChatBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatTitle = document.getElementById("chatTitle");
const unreadBadge = document.getElementById("unreadBadge");

// 1. Initialize Chat
async function initChat() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    chatUserId = session.user.id;

    // Grab the league ID from the URL (null if Global)
    const urlParams = new URLSearchParams(window.location.search);
    currentLeagueId = urlParams.get("league_id");

    // Update Title
    chatTitle.textContent = currentLeagueId ? "League Banter" : "Global Banter";

    // UI Listeners
    chatFab.onclick = () => {
        chatPanel.classList.add("show");
        chatBackdrop.classList.remove("hidden");
        unreadBadge.classList.add("hidden"); // Clear badge
        setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
    };

    const closeChat = () => {
        chatPanel.classList.remove("show");
        chatBackdrop.classList.add("hidden");
    };
    closeChatBtn.onclick = closeChat;
    chatBackdrop.onclick = closeChat;

    // Send Message Logic
    chatForm.onsubmit = async (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (!msg) return;

        chatInput.value = ""; // Clear input immediately for UX
        
        // Optimistic UI: Draw it locally right away
        renderMessage({ user_id: chatUserId, message: msg, user_profiles: { team_name: "You" } }, true);

        // Send to Database
        await supabase.from("game_chat").insert([{
            user_id: chatUserId,
            message: msg,
            league_id: currentLeagueId // Perfectly maps to your schema!
        }]);
    };

    loadChatHistory();
    subscribeToChat();
}

// 2. Load History
async function loadChatHistory() {
    let query = supabase
        .from("game_chat")
        .select("user_id, message, created_at, user_profiles(team_name)")
        .order("created_at", { ascending: false })
        .limit(50);

    // Route query to correct room using your schema
    if (currentLeagueId) {
        query = query.eq("league_id", currentLeagueId);
    } else {
        query = query.is("league_id", null);
    }

    const { data } = await query;
    chatMessages.innerHTML = ""; // Clear spinner
    
    if (data && data.length > 0) {
        // Reverse so newest is at the bottom
        data.reverse().forEach(msg => renderMessage(msg, false));
    } else {
        chatMessages.innerHTML = '<p style="color:var(--text-faint);; text-align:center; font-size:12px; margin-top:20px;">Be the first to talk trash!</p>';
    }
}

// 3. Render Message
function renderMessage(msgData, isOptimistic = false) {
    const isMe = msgData.user_id === chatUserId;
    const senderName = isMe ? "You" : (msgData.user_profiles?.team_name || "Expert");

    // Remove the empty state text if it exists
    if (chatMessages.innerHTML.includes("Be the first")) {
        chatMessages.innerHTML = "";
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${isMe ? "me" : "them"}`;
    
    // Only show sender name if it's someone else
    const nameHtml = !isMe ? `<div class="msg-sender">${senderName}</div>` : '';
    
    msgDiv.innerHTML = `
        ${nameHtml}
        <div class="msg-bubble">${msgData.message}</div>
    `;

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll to bottom
}

// 4. Real-time Subscription
function subscribeToChat() {
    chatSubscription = supabase
        .channel('public:game_chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, async (payload) => {
            const newMsg = payload.new;
            
            // Client-side room filter
            const isMatch = currentLeagueId ? (newMsg.league_id === currentLeagueId) : (newMsg.league_id === null);
            
            // Don't render if it's not for this room, or if I just sent it (Optimistic UI already drew it)
            if (!isMatch || newMsg.user_id === chatUserId) return;

            // Fetch the sender's name
            const { data: profile } = await supabase.from('user_profiles').select('team_name').eq('user_id', newMsg.user_id).single();
            newMsg.user_profiles = profile;

            renderMessage(newMsg, false);

            // If panel is closed, show the red unread dot!
            if (!chatPanel.classList.contains("show")) {
                unreadBadge.classList.remove("hidden");
            }
        })
        .subscribe();
}

// Start the engine
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