import { supabase } from "./supabase.js";

let currentUserId, currentTournamentId, currentMatchId;
let userLeagueId = null;

// The standard photo fallback
const DEFAULT_AVATAR = "https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png";

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    currentUserId = session.user.id;

    // 1. Get Tournament & League Info
    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    const { data: member } = await supabase.from("league_members").select("league_id").eq("user_id", currentUserId).maybeSingle();
    userLeagueId = member?.league_id;

    // 2. Load the UI (No more chat or feed functions here!)
    await Promise.all([
        loadPodiums(),
        loadPredictionCard(),
        loadPostMatchSummary()
    ]);
}
/* ==========================================
   SECTION 1: THE PODIUMS
========================================== */
/* ==========================================
   SECTION 1: THE PODIUMS
========================================== */
async function loadPodiums() {
    try {
        const { data: lastMatch } = await supabase.from("matches")
            .select("id, match_number, winner_id")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false }).limit(1).maybeSingle();

        if (!lastMatch) return;

        // 1. TOP PLAYERS
        const { data: players } = await supabase.from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id)
            .order("fantasy_points", { ascending: false }).limit(3);
        renderPodium(players, "playerPodium", "player");

        // 2. TOP USERS
        const { data: users } = await supabase.from("user_match_points")
            .select("total_points, user_id, user_profiles(team_name, team_photo_url)")
            .eq("match_id", lastMatch.id)
            .order("total_points", { ascending: false }).limit(3);
        
        for (let user of users || []) {
            const { data: lm } = await supabase.from("league_members").select("leagues(name)").eq("user_id", user.user_id).maybeSingle();
            user.league_name = lm?.leagues?.name || "Global Only";
        }
        renderPodium(users, "userPodium", "user");

        // (The Top Prediction Gurus Podium has been completely removed from here)

    } catch (err) { console.error("Podium Error:", err); }
}

function renderPodium(data, containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!data || data.length < 1) {
        container.innerHTML = `<p style="color:#475569; font-size:12px; text-align:center; width:100%;">Awaiting Results...</p>`;
        return;
    }

    // Olympic Order: 2nd, 1st, 3rd
    const order = [data[1], data[0], data[2]].filter(Boolean);
    container.replaceChildren();

    order.forEach((item) => {
        const rank = item === data[0] ? 1 : (item === data[1] ? 2 : 3);
        
        let name = "Unknown";
        let subText = "";
        let pts = 0;
        let photoPath = null;

        if (type === "player") {
            name = item.players?.name?.split(" ").pop();
            pts = `${item.fantasy_points} pts`;
            photoPath = item.players?.photo_url ? supabase.storage.from("player-photos").getPublicUrl(item.players.photo_url).data.publicUrl : DEFAULT_AVATAR;
        } else if (type === "user") {
            name = item.user_profiles?.team_name;
            subText = `<div class="podium-league">${item.league_name || 'Global'}</div>`;
            pts = `${item.total_points} pts`;
            photoPath = item.user_profiles?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl : DEFAULT_AVATAR;
        }

        container.innerHTML += `
            <div class="podium-item rank-${rank}">
                <div class="podium-name">${name}</div>
                ${subText}
                <div class="podium-avatar-wrapper">
                    <img src="${photoPath}" class="podium-img" alt="${name}">
                    <div class="rank-badge">${rank}</div>
                </div>
                <div class="podium-pts">${pts}</div>
            </div>
        `;
    });
}
/* ==========================================
   SECTION 2: PREDICTION ENGINE & STARS
========================================== */
async function loadPredictionCard() {
    // 1. Fetch User's current stars
    const { data: userPoints } = await supabase.from("user_tournament_points")
        .select("prediction_stars").eq("user_id", currentUserId).eq("tournament_id", currentTournamentId).maybeSingle();
    const currentStars = userPoints?.prediction_stars || 0;
    
    // Update UI Header
    const starEl = document.getElementById("userStarCount");
    if(starEl) starEl.innerText = `${currentStars} ⭐`;

    // 2. FIXED: Query matches and real_teams directly so we get the Team IDs!
    const { data: match } = await supabase.from("matches")
        .select("id, team_a:real_teams!team_a_id(id, short_code, photo_name), team_b:real_teams!team_b_id(id, short_code, photo_name)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1).maybeSingle();
    
    if (!match) {
        document.getElementById("predictionArea").innerHTML = "<h3>No upcoming matches to predict.</h3>";
        return;
    }
    
    currentMatchId = match.id;

    // 3. Check if they already predicted
    const { data: existing } = await supabase.from("user_predictions")
        .select("predicted_winner_id").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();

    renderPredictionUI(match, existing?.predicted_winner_id);
}

function renderPredictionUI(match, predictedWinnerId) {
    const container = document.getElementById("predictionArea");
    if(!container) return;

    // Grab logos directly from the joined real_teams table
    const logoA = match.team_a.photo_name ? supabase.storage.from('team-logos').getPublicUrl(match.team_a.photo_name).data.publicUrl : DEFAULT_AVATAR;
    const logoB = match.team_b.photo_name ? supabase.storage.from('team-logos').getPublicUrl(match.team_b.photo_name).data.publicUrl : DEFAULT_AVATAR;

    const isLocked = !!predictedWinnerId;

    container.innerHTML = `
        <div class="prediction-header">
            <h3>Who will win?</h3>
            <p class="prediction-hook">Answer correctly. Get 1 Sub per 10 correct! 🎁</p>
            <button onclick="showGuruLeaderboard()" class="icon-btn">🏆 Top 5 Gurus</button>
        </div>
        
        <div class="team-vs-container">
            <div class="team-card ${predictedWinnerId === match.team_a.id ? 'selected' : ''}" onclick="${isLocked ? '' : `savePrediction('${match.team_a.id}')`}">
                <img src="${logoA}" alt="${match.team_a.short_code}">
                <span>${match.team_a.short_code}</span>
            </div>
            <div class="vs-badge">VS</div>
            <div class="team-card ${predictedWinnerId === match.team_b.id ? 'selected' : ''}" onclick="${isLocked ? '' : `savePrediction('${match.team_b.id}')`}">
                <img src="${logoB}" alt="${match.team_b.short_code}">
                <span>${match.team_b.short_code}</span>
            </div>
        </div>
        ${isLocked ? `<div class="locked-msg">Prediction Locked! 🔒</div>` : ''}
    `;
}

// Ensure your savePrediction looks like this so it catches any future errors:
window.savePrediction = async (teamId) => {
    if(!confirm("Lock in this prediction? You cannot change it later.")) return;
    
    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId,
        match_id: currentMatchId,
        predicted_winner_id: teamId
    });
    
    if (error) {
        console.error("Database save failed:", error);
        alert("Failed to save prediction.");
        return;
    }
    
    loadPredictionCard(); 
};

/* ==========================================
   SECTION 3: AUTO POST-MATCH SUMMARY
========================================== */
async function loadPostMatchSummary() {
    const { data: lastMatch } = await supabase.from("matches").select("id, winner_id, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)").eq("points_processed", true).order("actual_start_time", { ascending: false }).limit(1).maybeSingle();
    
    if(!lastMatch || !lastMatch.winner_id) return;

    // Calculate prediction accuracy
    const { count: totalPredictors } = await supabase.from("user_predictions").select("*", { count: 'exact', head: true }).eq("match_id", lastMatch.id);
    const { count: correctPredictors } = await supabase.from("user_predictions").select("*", { count: 'exact', head: true }).eq("match_id", lastMatch.id).eq("predicted_winner_id", lastMatch.winner_id);
    
    let percent = totalPredictors > 0 ? Math.round((correctPredictors / totalPredictors) * 100) : 0;
    const winnerName = lastMatch.winner_id === lastMatch.team_a.id ? lastMatch.team_a.short_code : lastMatch.team_b.short_code;

    const summaryEl = document.getElementById("postMatchSummary");
    if(summaryEl) {
        summaryEl.innerHTML = `
            <div class="summary-card">
                <h4>📰 Match Report</h4>
                <p><strong>${winnerName} won!</strong> ${percent}% of users predicted this correctly. Did you get your star?</p>
            </div>
        `;
    }
}

/* ==========================================
   SECTION 3: PREMIUM TOP 5 GURUS MODAL
========================================== */
window.showGuruLeaderboard = async () => {
    const { data: top5 } = await supabase.from("user_tournament_points")
        .select("prediction_stars, user_profiles(team_name, team_photo_url)")
        .eq("tournament_id", currentTournamentId)
        .order("prediction_stars", { ascending: false })
        .order("updated_at", { ascending: true })
        .limit(5);
    
    // Inject modal HTML
    if (!document.getElementById("guruModal")) {
        document.body.insertAdjacentHTML('beforeend', `<div id="guruModal" class="custom-modal-overlay hidden"><div class="custom-modal"><div class="modal-header"><h3>🏆 Top 5 Gurus</h3><button onclick="document.getElementById('guruModal').classList.add('hidden')" class="close-btn">×</button></div><div id="guruList" class="guru-list"></div></div></div>`);
    }

    const listHtml = top5.map((g, i) => {
        const avatar = g.user_profiles?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(g.user_profiles.team_photo_url).data.publicUrl : DEFAULT_AVATAR;
        return `
            <div class="guru-row">
                <div class="guru-rank">#${i + 1}</div>
                <img src="${avatar}" class="guru-avatar">
                <div class="guru-name">${g.user_profiles.team_name}</div>
                <div class="guru-stars">${g.prediction_stars} ⭐</div>
            </div>
        `;
    }).join('');

    document.getElementById("guruList").innerHTML = listHtml;
    document.getElementById("guruModal").classList.remove("hidden");
};
/* ==========================================
   SECTION 4: THE SOCIAL FEED & REACTIONS
========================================== */




/* ==========================================
   SECTION 5: ENGAGING CHAT INTERFACE
========================================== */
window.openPodiumComments = async (podiumType) => {
    if (!currentMatchId && podiumType !== 'gurus') return alert("No recent match to comment on!");

    // Inject Chat UI if it doesn't exist
    if (!document.getElementById("chatDrawer")) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="chatDrawer" class="chat-drawer-overlay hidden">
                <div class="chat-drawer">
                    <div class="chat-header">
                        <h3 id="chatTitle">Comments</h3>
                        <button onclick="document.getElementById('chatDrawer').classList.add('hidden')" class="close-btn">×</button>
                    </div>
                    <div id="chatMessages" class="chat-messages"></div>
                    <div class="chat-input-area">
                        <input type="text" id="chatInput" placeholder="Talk trash here..." onkeypress="if(event.key === 'Enter') postComment()">
                        <button onclick="postComment()" class="send-btn">➤</button>
                    </div>
                </div>
            </div>
        `);
    }

    document.getElementById("chatTitle").innerText = `${podiumType.toUpperCase()} BANTER`;
    document.getElementById("chatDrawer").classList.remove("hidden");
    document.getElementById("chatMessages").innerHTML = `<div class="loading-chat">Loading...</div>`;
    window.currentChatContext = podiumType;

    await loadComments(podiumType);
};

window.loadComments = async (podiumType) => {
    const { data: comments } = await supabase
        .from("podium_comments")
        .select("comment, created_at, user_id, user_profiles(team_name, team_photo_url)")
        .eq("podium_type", podiumType)
        .eq(podiumType !== 'gurus' ? "match_id" : "user_id", podiumType !== 'gurus' ? currentMatchId : currentUserId) 
        .order("created_at", { ascending: true });

    const chatBox = document.getElementById("chatMessages");
    if (!comments || comments.length === 0) {
        chatBox.innerHTML = `<div class="empty-chat">No comments yet. Start the banter!</div>`;
        return;
    }

    chatBox.innerHTML = comments.map(c => {
        const isMe = c.user_id === currentUserId;
        const avatar = c.user_profiles?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(c.user_profiles.team_photo_url).data.publicUrl : DEFAULT_AVATAR;
        return `
            <div class="chat-wrapper ${isMe ? 'mine' : 'theirs'}">
                ${!isMe ? `<img src="${avatar}" class="chat-avatar">` : ''}
                <div class="chat-bubble">
                    ${!isMe ? `<div class="chat-name">${c.user_profiles?.team_name}</div>` : ''}
                    <div class="chat-text">${c.comment}</div>
                </div>
            </div>
        `;
    }).join('');
    chatBox.scrollTop = chatBox.scrollHeight; // Scroll to bottom
};

window.postComment = async () => {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;

    input.value = ""; // Clear immediately for snappy feel
    const podiumType = window.currentChatContext;

    // Optimistic UI update (shows comment instantly before saving to DB)
    const chatBox = document.getElementById("chatMessages");
    const emptyMsg = chatBox.querySelector('.empty-chat');
    if (emptyMsg) emptyMsg.remove();

    chatBox.insertAdjacentHTML('beforeend', `
        <div class="chat-wrapper mine">
            <div class="chat-bubble"><div class="chat-text">${text}</div></div>
        </div>
    `);
    chatBox.scrollTop = chatBox.scrollHeight;

    await supabase.from("podium_comments").insert({
        match_id: currentMatchId,
        podium_type: podiumType,
        user_id: currentUserId,
        comment: text
    });
};
