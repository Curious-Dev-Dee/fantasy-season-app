import { supabase } from "./supabase.js";

/* ELEMENTS */
const winnerToggle = document.getElementById("winnerToggle");
const mvpSelect = document.getElementById("mvpSelect");
const userPredictSelect = document.getElementById("userPredictSelect");
const submitBtn = document.getElementById("submitPredictionBtn");
const userPredictionScore = document.getElementById("userPredictionScore");
const loginStreakSpan = document.getElementById("loginStreak");
const mainFlipCard = document.getElementById("mainFlipCard");
const backCardTitle = document.getElementById("backCardTitle");
const backCardContent = document.getElementById("backCardContent");

/* STATE */
let currentUserId = null, currentMatchId = null, currentTournamentId = null, selectedWinnerId = null;

/* INIT */
init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    currentUserId = session.user.id;

    await handleDailyStreak(currentUserId);

    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    await Promise.all([
        fetchPodiumData(),
        fetchNextMatch(),
        fetchExpertsList(),
        fetchUserPredictionPoints()
    ]);
    checkExistingPrediction();
}

/* STREAK & COIN SYSTEM */
async function handleDailyStreak(userId) {
    try {
        const today = new Date().toISOString().split("T")[0];
        const { data: profile } = await supabase.from("user_profiles").select("*").eq("user_id", userId).single();

        let streak = profile.streak_count || 0;
        let coins = profile.prediction_coins || 0;

        if (profile.last_login !== today) {
            const lastDate = new Date(profile.last_login);
            const diff = Math.ceil(Math.abs(new Date(today) - lastDate) / (1000 * 60 * 60 * 24));
            streak = (diff === 1) ? streak + 1 : 1;
            coins += streak; // Reward based on streak length

            await supabase.from("user_profiles").update({
                streak_count: streak, last_login: today, prediction_coins: coins
            }).eq("user_id", userId);
        }
        loginStreakSpan.textContent = streak;
        userPredictionScore.textContent = coins;
    } catch (err) { console.error("Streak Error:", err); }
}

/* 1. UPDATED: Fetch Podium Data with Vanity Columns */
async function fetchPodiumData() {
    try {
        const { data: lastMatch } = await supabase.from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("points_processed", true).order("actual_start_time", { ascending: false }).limit(1).maybeSingle();

        if (!lastMatch) return;

        document.getElementById("podiumSection").classList.remove("hidden");
        const matchTitle = `MATCH ${lastMatch.match_number}: ${lastMatch.team_a.short_code} VS ${lastMatch.team_b.short_code}`;
        const headers = document.querySelectorAll(".podium-card .card-header-fun");
        if(headers[0]) headers[0].textContent = "TOP PLAYERS - " + matchTitle;
        if(headers[1]) headers[1].textContent = "TOP TEAMS - " + matchTitle;

        const { data: players } = await supabase.from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id).order("fantasy_points", { ascending: false }).limit(3);
        renderPodium(players, "playerPodium", true);

        // Fetching vanity columns (equipped_frame, equipped_flex)
        const { data: teams } = await supabase.from("user_match_points")
            .select("total_points, user_profiles(team_name, team_photo_url, equipped_frame, equipped_flex)")
            .eq("match_id", lastMatch.id).order("total_points", { ascending: false }).limit(3);
        renderPodium(teams, "teamPodium", false);
    } catch (err) { console.error("Podium Error:", err); }
}

/* 2. UPDATED: Podium Renderer with Animation Classes */
function renderPodium(data, containerId, isPlayer) {
    const container = document.getElementById(containerId);
    if (!data || data.length < 1) { container.innerHTML = `<p class="sub-label">Awaiting results...</p>`; return; }

    const podiumOrder = [];
    if (data[1]) podiumOrder.push({ ...data[1], rank: 2 });
    if (data[0]) podiumOrder.push({ ...data[0], rank: 1 });
    if (data[2]) podiumOrder.push({ ...data[2], rank: 3 });

    container.innerHTML = podiumOrder.map(item => {
        const name = isPlayer ? item.players.name.split(' ').pop() : item.user_profiles.team_name;
        const pts = isPlayer ? (item.fantasy_points || 0) : (item.total_points || 0);
        
        // Apply Vanity Classes
        const frameClass = (!isPlayer && item.user_profiles?.equipped_frame) ? item.user_profiles.equipped_frame : '';
        const flexClass = (!isPlayer && item.user_profiles?.equipped_flex) ? item.user_profiles.equipped_flex : '';

        let photoUrl = 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png';
        if (isPlayer && item.players?.photo_url) {
            photoUrl = supabase.storage.from('player-photos').getPublicUrl(item.players.photo_url).data.publicUrl;
        } else if (!isPlayer && item.user_profiles?.team_photo_url) {
            photoUrl = supabase.storage.from('team-avatars').getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl;
        }

        return `
            <div class="podium-item rank-${item.rank}">
                <div class="podium-name ${flexClass}">${name}</div>
                <div class="podium-avatar-wrapper ${frameClass}">
                    <img src="${photoUrl}" class="podium-img" onerror="this.src='https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png'">
                    <div class="rank-badge">${item.rank}</div>
                </div>
                <div class="podium-pts">${pts}</div>
            </div>`;
    }).join('');
}

/* 3. UPDATED: Flip Logic with Vanity Names */
window.flipTo = async (view) => {
    if (view === 'front') { mainFlipCard.classList.remove("flipped"); return; }
    mainFlipCard.classList.add("flipped");
    backCardContent.innerHTML = `<div class="spinner-small" style="margin: 50px auto;"></div>`;

    if (view === 'results') {
        backCardTitle.innerText = "LATEST RESULTS";
        const { data: lastMatch } = await supabase.from("matches").select("*, team_a:real_teams(short_code), team_b:real_teams(short_code)")
            .eq("points_processed", true).order("actual_start_time", { ascending: false }).limit(1).single();

        const [topP, topU] = await Promise.all([
            supabase.from("player_match_stats").select("players(name), fantasy_points").eq("match_id", lastMatch.id).order("fantasy_points", {desc:true}).limit(1).single(),
            supabase.from("user_match_points").select("user_profiles(team_name), total_points").eq("match_id", lastMatch.id).order("total_points", {desc:true}).limit(1).single()
        ]);

        backCardContent.innerHTML = `
            <div class="result-item"><label>Winner:</label> <span>Official Result</span></div>
            <div class="result-item"><label>Top Player:</label> <span>${topP.data?.players.name} (${topP.data?.fantasy_points})</span></div>
            <div class="result-item"><label>Top Team:</label> <span>${topU.data?.user_profiles.team_name} (${topU.data?.total_points})</span></div>`;
    } else if (view === 'leaderboard') {
        backCardTitle.innerText = "TOP 3 EXPERTS";
        // Selecting vanity columns for the flip leaderboard
        const { data: leaders } = await supabase.from("prediction_leaderboard").select("team_name, total_points, equipped_flex").limit(3);
        
        backCardContent.innerHTML = `
            <table class="mini-table">
                ${leaders.map((u, i) => `
                <tr>
                    <td>#${i+1} <span class="${u.equipped_flex || ''}">${u.team_name}</span></td>
                    <td style="text-align:right; color:var(--neon-green); font-weight:800;">${u.total_points}</td>
                </tr>`).join('')}
            </table>`;
    }
};

/* PREDICTION LOGIC */
async function fetchNextMatch() {
  const { data: upcoming } = await supabase.from("matches").select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
    .eq("tournament_id", currentTournamentId).eq("status", "upcoming").order("actual_start_time", { ascending: true }).limit(1).maybeSingle();

  if (upcoming) { currentMatchId = upcoming.id; renderSelectionView(upcoming); }
}

async function renderSelectionView(match) {
  document.getElementById("predictionSubtext").textContent = `Next Match: ${match.team_a.short_code} vs ${match.team_b.short_code}`;
  winnerToggle.innerHTML = `
    <button class="team-option" data-id="${match.team_a.id}">${match.team_a.short_code}</button>
    <button class="team-option" data-id="${match.team_b.id}">${match.team_b.short_code}</button>`;

  const { data: players } = await supabase.from("players").select("*").in("real_team_id", [match.team_a.id, match.team_b.id]).order("name", { ascending: true });
  mvpSelect.innerHTML = `<option value="">Select Player...</option>` + (players || []).map(p => `<option value="${p.id}">${p.name}</option>`).join("");

  winnerToggle.querySelectorAll(".team-option").forEach((btn) => {
    btn.onclick = () => {
      winnerToggle.querySelectorAll(".team-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedWinnerId = btn.dataset.id;
    };
  });
}

submitBtn.onclick = async () => {
    const mvpId = mvpSelect.value;
    const topUserId = userPredictSelect.value;
    if (!selectedWinnerId || !mvpId || !topUserId) return alert("Complete all 3 predictions!");

    submitBtn.disabled = true;
    submitBtn.textContent = "LOCKING...";
    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId, match_id: currentMatchId,
        predicted_winner_id: selectedWinnerId, predicted_mvp_id: mvpId, predicted_top_user_id: topUserId
    }, { onConflict: "user_id, match_id" });

    if (!error) { submitBtn.textContent = "LOCKED ✅"; disableInputs(); }
};

function disableInputs() {
    submitBtn.disabled = true; mvpSelect.disabled = true; userPredictSelect.disabled = true;
    winnerToggle.querySelectorAll(".team-option").forEach(b => b.style.pointerEvents = "none");
}

async function checkExistingPrediction() {
    if (!currentMatchId) return;
    const { data } = await supabase.from("user_predictions").select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();
    if (data) {
        mvpSelect.value = data.predicted_mvp_id; userPredictSelect.value = data.predicted_top_user_id;
        const btn = winnerToggle.querySelector(`[data-id="${data.predicted_winner_id}"]`);
        if (btn) btn.classList.add("selected");
        selectedWinnerId = data.predicted_winner_id;
        submitBtn.textContent = "LOCKED ✅"; disableInputs();
    }
}

async function fetchExpertsList() {
    const { data } = await supabase.from("user_profiles").select("user_id, team_name").limit(50);
    userPredictSelect.innerHTML = `<option value="">Select Expert...</option>` + (data || []).map(e => `<option value="${e.user_id}">${e.team_name}</option>`).join("");
}

async function fetchUserPredictionPoints() {
    const { data } = await supabase.from("user_predictions").select("points_earned").eq("user_id", currentUserId);
    userPredictionScore.textContent = data?.reduce((acc, curr) => acc + (curr.points_earned || 0), 0) || 0;
}