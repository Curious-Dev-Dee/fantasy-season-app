import { supabase } from "./supabase.js";
import { applyRankFlair } from "./animations.js";

let currentUserId, currentTournamentId, currentMatchId;
let userLeagueId = null;

const DEFAULT_AVATAR = "https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png";

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    currentUserId = session.user.id;

    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    const { data: member } = await supabase.from("league_members").select("league_id").eq("user_id", currentUserId).maybeSingle();
    userLeagueId = member?.league_id;

    await Promise.all([
        loadPodiums(),
        loadPredictionCard(),
        loadPostMatchSummary()
    ]);
}

/* ==========================================
   SECTION 1: PODIUMS
========================================== */
async function loadPodiums() {
    try {
        const { data: lastMatch } = await supabase
            .from("matches")
            .select("id, match_number, winner_id")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastMatch) return;

        // TOP PLAYERS (cricket players — no rank flair)
        const { data: players } = await supabase
            .from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id)
            .order("fantasy_points", { ascending: false })
            .limit(3);
        renderPodium(players, "playerPodium", "player");

        // TOP USERS (fantasy users — rank flair applies)
        const { data: users } = await supabase
            .from("user_match_points")
            .select("total_points, user_id, user_profiles(team_name, team_photo_url)")
            .eq("match_id", lastMatch.id)
            .order("total_points", { ascending: false })
            .limit(3);

        for (let user of users || []) {
            const { data: lm } = await supabase
                .from("league_members")
                .select("leagues(name)")
                .eq("user_id", user.user_id)
                .maybeSingle();
            user.league_name = lm?.leagues?.name || "Global Only";
        }

        renderPodium(users, "userPodium", "user");

    } catch (err) { console.error("Podium Error:", err); }
}

function renderPodium(data, containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data || data.length < 1) {
        container.innerHTML = `<p style="color:#475569; font-size:12px; text-align:center; width:100%;">Awaiting Results...</p>`;
        return;
    }

    // Olympic order: 2nd left, 1st centre, 3rd right
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
            photoPath = item.players?.photo_url
                ? supabase.storage.from("player-photos").getPublicUrl(item.players.photo_url).data.publicUrl
                : DEFAULT_AVATAR;
        } else if (type === "user") {
            name = item.user_profiles?.team_name || "Unknown";
            subText = item.league_name || "Global";
            pts = `${item.total_points} pts`;
            photoPath = item.user_profiles?.team_photo_url
                ? supabase.storage.from("team-avatars").getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl
                : DEFAULT_AVATAR;
        }

        // Build the podium item using createElement (safe, no XSS)
        const itemEl = document.createElement("div");
        itemEl.className = `podium-item rank-${rank}`;

        const nameEl = document.createElement("div");
        nameEl.className = "podium-name";
        nameEl.textContent = name;

        const avatarWrapper = document.createElement("div");
        avatarWrapper.className = "podium-avatar-wrapper";

        const img = document.createElement("img");
        img.src = photoPath;
        img.className = "podium-img";
        img.alt = name;

        const badge = document.createElement("div");
        badge.className = "rank-badge";
        badge.textContent = String(rank);

        avatarWrapper.append(img, badge);

        const ptsEl = document.createElement("div");
        ptsEl.className = "podium-pts";
        ptsEl.textContent = pts;

        if (type === "user") {
            const leagueEl = document.createElement("div");
            leagueEl.className = "podium-league";
            leagueEl.textContent = subText;

            // ── FLAIR: Gold/silver/bronze on Match Expert podium ──
            // rank is always 1, 2, or 3 here — pass img as avatar, nameEl as name
            applyRankFlair(img, nameEl, rank);

            itemEl.append(nameEl, leagueEl, avatarWrapper, ptsEl);
        } else {
            // Player podium — no rank flair (these are cricket players, not users)
            itemEl.append(nameEl, avatarWrapper, ptsEl);
        }

        container.appendChild(itemEl);
    });
}

/* ==========================================
   SECTION 2: PREDICTION ENGINE
========================================== */
async function loadPredictionCard() {
    const { data: userPoints } = await supabase
        .from("user_tournament_points")
        .select("prediction_stars")
        .eq("user_id", currentUserId)
        .eq("tournament_id", currentTournamentId)
        .maybeSingle();

    const currentStars = userPoints?.prediction_stars || 0;
    const starEl = document.getElementById("userStarCount");
    if (starEl) starEl.innerText = `${currentStars} ⭐`;

    const { data: match } = await supabase
        .from("matches")
        .select("id, team_a:real_teams!team_a_id(id, short_code, photo_name), team_b:real_teams!team_b_id(id, short_code, photo_name)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (!match) {
        document.getElementById("predictionArea").innerHTML = "<h3>No upcoming matches to predict.</h3>";
        return;
    }

    currentMatchId = match.id;

    const { data: existing } = await supabase
        .from("user_predictions")
        .select("predicted_winner_id")
        .eq("user_id", currentUserId)
        .eq("match_id", currentMatchId)
        .maybeSingle();

    renderPredictionUI(match, existing?.predicted_winner_id);
}

function renderPredictionUI(match, predictedWinnerId) {
    const container = document.getElementById("predictionArea");
    if (!container) return;

    const logoA = match.team_a.photo_name
        ? supabase.storage.from('team-logos').getPublicUrl(match.team_a.photo_name).data.publicUrl
        : DEFAULT_AVATAR;
    const logoB = match.team_b.photo_name
        ? supabase.storage.from('team-logos').getPublicUrl(match.team_b.photo_name).data.publicUrl
        : DEFAULT_AVATAR;

    const isLocked = !!predictedWinnerId;

    container.innerHTML = `
        <div class="prediction-header">
            <h3>Who will win?</h3>
            <p class="prediction-hook">Answer correctly. Get 1 Sub per 10 correct! 🎁</p>
            <button onclick="showGuruLeaderboard()" class="icon-btn">🏆 Top Prediction Masters</button>
        </div>
        <div class="team-vs-container">
            <div class="team-card ${predictedWinnerId === match.team_a.id ? 'selected' : ''}"
                 onclick="${isLocked ? '' : `savePrediction('${match.team_a.id}')`}">
                <img src="${logoA}" alt="${match.team_a.short_code}">
                <span>${match.team_a.short_code}</span>
            </div>
            <div class="vs-badge">VS</div>
            <div class="team-card ${predictedWinnerId === match.team_b.id ? 'selected' : ''}"
                 onclick="${isLocked ? '' : `savePrediction('${match.team_b.id}')`}">
                <img src="${logoB}" alt="${match.team_b.short_code}">
                <span>${match.team_b.short_code}</span>
            </div>
        </div>
        ${isLocked ? `<div class="locked-msg">Prediction Locked! 🔒</div>` : ''}
    `;
}

window.savePrediction = async (teamId) => {
    if (!confirm("Lock in this prediction? You cannot change it later.")) return;

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
   SECTION 3: POST-MATCH SUMMARY
========================================== */
async function loadPostMatchSummary() {
    const { data: lastMatch } = await supabase
        .from("matches")
        .select("id, winner_id, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
        .eq("points_processed", true)
        .order("actual_start_time", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lastMatch || !lastMatch.winner_id) return;

    const { count: totalPredictors } = await supabase
        .from("user_predictions")
        .select("*", { count: 'exact', head: true })
        .eq("match_id", lastMatch.id);

    const { count: correctPredictors } = await supabase
        .from("user_predictions")
        .select("*", { count: 'exact', head: true })
        .eq("match_id", lastMatch.id)
        .eq("predicted_winner_id", lastMatch.winner_id);

    const percent = totalPredictors > 0 ? Math.round((correctPredictors / totalPredictors) * 100) : 0;
    const winnerName = lastMatch.winner_id === lastMatch.team_a.id
        ? lastMatch.team_a.short_code
        : lastMatch.team_b.short_code;

    const summaryEl = document.getElementById("postMatchSummary");
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="summary-card">
                <h4>📰 Match Report</h4>
                <p><strong>${winnerName} won!</strong> ${percent}% of users predicted this correctly. Did you get your star?</p>
            </div>
        `;
    }
}

/* ==========================================
   SECTION 4: GURU LEADERBOARD MODAL
========================================== */
window.showGuruLeaderboard = async () => {
    const { data: top100 } = await supabase
        .from("user_tournament_points")
        .select("prediction_stars, user_profiles(team_name, team_photo_url)")
        .eq("tournament_id", currentTournamentId)
        .order("prediction_stars", { ascending: false })
        .order("updated_at", { ascending: true })
        .limit(100);

    if (!document.getElementById("guruModal")) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="guruModal" class="custom-modal-overlay hidden">
                <div class="custom-modal">
                    <div class="modal-header">
                        <h3>🏆 Top Prediction Masters</h3>
                        <button onclick="document.getElementById('guruModal').classList.add('hidden')" class="close-btn">×</button>
                    </div>
                    <div id="guruList" class="guru-list"></div>
                </div>
            </div>
        `);
    }

    const guruList = document.getElementById("guruList");
    guruList.replaceChildren();

    (top100 || []).forEach((g, i) => {
        const rank = i + 1;

        const avatar = g.user_profiles?.team_photo_url
            ? supabase.storage.from("team-avatars").getPublicUrl(g.user_profiles.team_photo_url).data.publicUrl
            : DEFAULT_AVATAR;

        // Build row safely with createElement (no innerHTML = no XSS)
        const row = document.createElement("div");
        row.className = "guru-row";

        const rankEl = document.createElement("div");
        rankEl.className = "guru-rank";
        rankEl.textContent = `#${rank}`;

        const avatarEl = document.createElement("img");
        avatarEl.src = avatar;
        avatarEl.className = "guru-avatar";

        const nameEl = document.createElement("div");
        nameEl.className = "guru-name";
        nameEl.textContent = g.user_profiles?.team_name || "Expert";

        const starsEl = document.createElement("div");
        starsEl.className = "guru-stars";
        starsEl.textContent = `${g.prediction_stars} ⭐`;

        // ── FLAIR: Gold/silver/bronze on top 3 Guru names ──
        // Guru list is sorted by prediction_stars so rank 1/2/3 are index 0/1/2
        if (rank <= 3) {
            applyRankFlair(avatarEl, nameEl, rank);
        }

        row.append(rankEl, avatarEl, nameEl, starsEl);
        guruList.appendChild(row);
    });

    document.getElementById("guruModal").classList.remove("hidden");
};