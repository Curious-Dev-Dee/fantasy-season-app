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
async function loadPodiums() {
    try {
        // Get the last completed match
        const { data: lastMatch } = await supabase.from("matches")
            .select("id, match_number, winner_id")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false }).limit(1).maybeSingle();

        if (!lastMatch) return;

        // 1. TOP PLAYERS PODIUM
        const { data: players } = await supabase.from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id)
            .order("fantasy_points", { ascending: false }).limit(3);
        renderPodium(players, "playerPodium", "player");

        // 2. TOP USERS PODIUM (With Private League Names)
        const { data: users } = await supabase.from("user_match_points")
            .select("total_points, user_id, user_profiles(team_name, team_photo_url)")
            .eq("match_id", lastMatch.id)
            .order("total_points", { ascending: false }).limit(3);
        
        // Quick fetch to get their league names
        for (let user of users || []) {
            const { data: lm } = await supabase.from("league_members").select("leagues(name)").eq("user_id", user.user_id).maybeSingle();
            user.league_name = lm?.leagues?.name || "Global Only";
        }
        renderPodium(users, "userPodium", "user");

        // 3. TOP PREDICTION GURUS PODIUM (Based on Stars)
        const { data: gurus } = await supabase.from("user_tournament_points")
            .select("prediction_stars, user_id, user_profiles(team_name, team_photo_url)")
            .eq("tournament_id", currentTournamentId)
            .order("prediction_stars", { ascending: false })
            .order("updated_at", { ascending: true }) // Tie-breaker!
            .limit(3);
        renderPodium(gurus, "guruPodium", "guru");

    } catch (err) { console.error("Podium Error:", err); }
}

function renderPodium(data, containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!data || data.length < 1) {
        container.innerHTML = `<p style="color:#475569; font-size:12px;">Awaiting Results...</p>`;
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
            subText = `<div class="podium-league">${item.league_name}</div>`;
            pts = `${item.total_points} pts`;
            photoPath = item.user_profiles?.team_photo_url ? supabase.storage.from("team-avatars").getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl : DEFAULT_AVATAR;
        } else if (type === "guru") {
            name = item.user_profiles?.team_name;
            pts = `${item.prediction_stars || 0} ⭐`;
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

/* Modal for Top 5 Gurus */
window.showGuruLeaderboard = async () => {
    const { data: top5 } = await supabase.from("user_tournament_points").select("prediction_stars, user_profiles(team_name)").eq("tournament_id", currentTournamentId).order("prediction_stars", { ascending: false }).order("updated_at", { ascending: true }).limit(5);
    
    let listHtml = top5.map((g, i) => `${i+1}. ${g.user_profiles.team_name} - ${g.prediction_stars} ⭐`).join("\n");
    alert(`🏆 TOP 5 PREDICTION GURUS:\n\n${listHtml}\n\n(Ties broken by who predicted first!)`);
};

/* ==========================================
   SECTION 4: THE SOCIAL FEED & REACTIONS
========================================== */




/* ==========================================
   SECTION 5: PODIUM COMMENTS
========================================== */

// Attach this to a button below each podium in your HTML
window.openPodiumComments = async (podiumType) => {
    // podiumType should be 'players', 'users', or 'gurus'
    if (!currentMatchId && podiumType !== 'gurus') return alert("No recent match to comment on!");

    const { data: comments } = await supabase
        .from("podium_comments")
        .select("comment, created_at, user_profiles(team_name)")
        .eq("podium_type", podiumType)
        // Only filter by match if it's the player/user podiums. Guru podium is tournament-wide!
        .eq(podiumType !== 'gurus' ? "match_id" : "user_id", podiumType !== 'gurus' ? currentMatchId : currentUserId) 
        .order("created_at", { ascending: true });

    let commentText = comments.map(c => `[${c.user_profiles.team_name}]: ${c.comment}`).join("\n");
    if(comments.length === 0) commentText = "No comments yet. Be the first!";

    // Simple alert/prompt for now, but you should connect this to a nice HTML drawer!
    const newComment = prompt(`--- ${podiumType.toUpperCase()} COMMENTS ---\n\n${commentText}\n\nAdd your reply:`);
    
    if (newComment && newComment.trim() !== "") {
        await supabase.from("podium_comments").insert({
            match_id: currentMatchId, // Might be null for gurus if you want season-long guru comments
            podium_type: podiumType,
            user_id: currentUserId,
            comment: newComment
        });
        alert("Comment posted!");
    }
};

