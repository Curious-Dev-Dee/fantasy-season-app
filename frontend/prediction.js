import { supabase } from "./supabase.js";

/* --- STATE --- */
let currentUserId, currentMatchId, currentTournamentId, activeLeagueId = null;
let chatMode = 'global', chatSubscription = null, selectedWinnerId = null;

const chatDrawer = document.getElementById("chatDrawer");
const chatMessages = document.getElementById("chatMessages");
const newMsgBadge = document.getElementById("newMsgBadge");
const chatToggleBtn = document.getElementById("chatToggleBtn");

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = "login.html";
    currentUserId = session.user.id;

    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    await Promise.all([
        fetchNextMatch(), fetchExpertsList(), checkUserLeagueStatus(), 
        fetchUserPredictionPoints(), fetchMiniLeaderboard()
    ]);

    await loadChatHistory();
    setupDrawerListeners();
    setupLeagueUIListeners();
    subscribeToChat();
    checkExistingPrediction();
}

async function renderResultView(match) {
    const container = document.getElementById("resultView");
    const { data: statsArray } = await supabase.from("prediction_stats_view").select("*").eq("match_id", match.id);
    const stats = statsArray?.[0];

    const fetchPromises = [
        match.winner_id ? supabase.from("real_teams").select("short_code").eq("id", match.winner_id).single() : Promise.resolve({ data: { short_code: 'TBA' } }),
        match.man_of_the_match_id ? supabase.from("players").select("name").eq("id", match.man_of_the_match_id).single() : Promise.resolve({ data: { name: 'TBA' } }),
        stats?.predicted_top_user_id ? supabase.from("user_profiles").select("team_name").eq("user_id", stats.predicted_top_user_id).single() : Promise.resolve({ data: { team_name: 'TBA' } })
    ];

    const [wRes, mRes, eRes] = await Promise.all(fetchPromises);

    container.innerHTML = `
        <div class="result-header" style="text-align:center; margin-bottom:15px;">
            <span class="final-badge">LATEST RESULT</span>
            <h3 class="theme-neon-text">${match.team_a.short_code} vs ${match.team_b.short_code}</h3>
        </div>
        ${renderResultItem("Winner", wRes.data.short_code, stats?.winner_pct, stats?.winner_votes)}
        ${renderResultItem("Man of the Match", mRes.data.name, stats?.mvp_pct, stats?.mvp_votes)}
    `;
}

function renderResultItem(label, val, pct, votes) {
    return `
        <div class="result-item">
            <div class="result-row"><label>${label}:</label> <span class="winner-val">${val}</span></div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${pct || 0}%"></div></div>
            <div class="pct-label">${pct || 0}% correct (${votes || 0} votes)</div>
        </div>
    `;
}

function setupDrawerListeners() {
    chatToggleBtn.onclick = (e) => {
        e.stopPropagation();
        chatDrawer.classList.remove("drawer-hidden");
        newMsgBadge.classList.add("hidden");
    };
    document.getElementById("closeChatBtn").onclick = () => chatDrawer.classList.add("drawer-hidden");
}

function renderMessage(msg) {
    const isMine = msg.user_id === currentUserId;
    const div = document.createElement("div");
    div.className = `chat-bubble ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="msg-user">${msg.user_profiles?.team_name || 'Expert'}</span><div class="msg-content">${msg.message}</div>`;
    chatMessages.appendChild(div);
    setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 50);
}

// ... existing helper logic ...

async function handleDailyStreak(userId) {
    const today = new Date().toISOString().split('T')[0];
    const { data: profile } = await supabase.from('user_profiles').select('last_login, streak_count').eq('user_id', userId).single();
    if (profile.last_login !== today) {
        let newStreak = (profile.streak_count || 0) + 1;
        await supabase.from('user_profiles').update({ streak_count: newStreak, last_login: today }).eq('user_id', userId);
        document.getElementById('loginStreak').textContent = newStreak;
    } else {
        document.getElementById('loginStreak').textContent = profile.streak_count;
    }
}

// Subscriptions and Event Listeners (Existing logic remains)

function subscribeToChat() {
    if (chatSubscription) supabase.removeChannel(chatSubscription);
    const filter = chatMode === 'private' ? `league_id=eq.${activeLeagueId}` : `league_id=is.null`;
    chatSubscription = supabase.channel(`live-chat-${chatMode}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat', filter: filter }, 
        async (payload) => {
            const { data } = await supabase.from("user_profiles").select("team_name").eq("user_id", payload.new.user_id).single();
            renderMessage({ ...payload.new, user_profiles: data });
        }).subscribe();
}

// Emoji logic remains the same
const emojiBar = document.getElementById("emojiBar");
emojiBar.querySelectorAll("span").forEach(btn => {
    btn.onclick = () => { chatInput.value += btn.textContent; chatInput.focus(); };
});

/* =========================
   SUPPORTING FETCHES (+1/-1 Logic)
========================= */

async function fetchMiniLeaderboard() {
    const { data } = await supabase.from("prediction_leaderboard").select("team_name, total_points").limit(3);
    const tbody = document.getElementById("miniLeaderboardBody");
    if (!tbody || !data) return;
    tbody.innerHTML = data.map(row => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding:10px 0; color:#fff; font-weight:600;">${row.team_name}</td>
            <td style="text-align:right; color:#9AE000; font-weight:800;">${row.total_points}</td>
        </tr>
    `).join('');
}

async function fetchUserPredictionPoints() {
    const { data } = await supabase.from("user_predictions").select("points_earned").eq("user_id", currentUserId);
    const total = data?.reduce((acc, curr) => acc + (curr.points_earned || 0), 0) || 0;
    userPredictionScore.textContent = total;
}

async function fetchExpertsList() {
    const { data } = await supabase.from("user_profiles").select("user_id, team_name").limit(50);
    userPredictSelect.innerHTML = `<option value="">Select an Expert...</option>` + 
        data?.map(e => `<option value="${e.user_id}">${e.user_id === currentUserId ? e.team_name + ' (Me)' : e.team_name}</option>`).join('');
}

submitBtn.onclick = async () => {
    const mvpId = mvpSelect.value;
    const topUserId = userPredictSelect.value;
    if (!selectedWinnerId || !mvpId || !topUserId) return alert("Complete your guesses!");
    submitBtn.disabled = true;
    submitBtn.textContent = "LOCKING...";
    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId, match_id: currentMatchId,
        predicted_winner_id: selectedWinnerId, predicted_mvp_id: mvpId, predicted_top_user_id: topUserId
    }, { onConflict: 'user_id, match_id' });

    if (!error) { submitBtn.textContent = "LOCKED ✅"; disableAllInputs(); }
    else { alert("Action failed."); submitBtn.disabled = false; submitBtn.textContent = "LOCK PREDICTIONS"; }
};

async function checkExistingPrediction() {
    if (!currentMatchId) return;
    const { data } = await supabase.from("user_predictions").select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();
    if (data) {
        mvpSelect.value = data.predicted_mvp_id;
        userPredictSelect.value = data.predicted_top_user_id;
        const btn = winnerToggle.querySelector(`[data-id="${data.predicted_winner_id}"]`);
        if (btn) btn.classList.add("selected");
        selectedWinnerId = data.predicted_winner_id;
        submitBtn.textContent = "LOCKED ✅";
        disableAllInputs();
    }
}