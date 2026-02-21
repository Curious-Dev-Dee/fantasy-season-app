import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS & STATE
========================= */
const winnerToggle = document.getElementById("winnerToggle");
const mvpSelect = document.getElementById("mvpSelect");
const userPredictSelect = document.getElementById("userPredictSelect");
const submitBtn = document.getElementById("submitPredictionBtn");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");

const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatDrawer = document.getElementById("chatDrawer");
const closeChatBtn = document.getElementById("closeChatBtn");
const newMsgBadge = document.getElementById("newMsgBadge");
const userPredictionScore = document.getElementById("userPredictionScore");

// --- PRIVATE LEAGUE ELEMENTS ---
const noLeagueView = document.getElementById("noLeagueView");
const activeLeagueView = document.getElementById("activeLeagueView");
const displayLeagueName = document.getElementById("displayLeagueName");
const displayInviteCode = document.getElementById("displayInviteCode");
const leagueRankVal = document.getElementById("leagueRankVal");
const createLeagueBtn = document.getElementById("createLeagueBtn");
const joinLeagueBtn = document.getElementById("joinLeagueBtn");

// --- CHAT TABS ---
const globalChatTab = document.getElementById("globalChatTab");
const privateChatTab = document.getElementById("privateChatTab");

let currentUserId = null;
let currentMatchId = null;
let selectedWinnerId = null;
let currentTournamentId = null;

// --- LEAGUE & CHAT STATE ---
let activeLeagueId = null; 
let chatMode = 'global'; // 'global' or 'private'
let chatSubscription = null;

/* =========================
   INIT LOGIC
========================= */
init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = "login.html";
    currentUserId = session.user.id;

    // Get Active Tournament
    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    // 🚀 Speed: Parallel Data Loading
    await Promise.all([
        fetchNextMatch(),
        fetchExpertsList(),
        checkUserLeagueStatus(), 
        fetchUserPredictionPoints(),
        fetchMiniLeaderboard()
    ]);

    await loadChatHistory();
    setupDrawerListeners();
    setupLeagueUIListeners();
    subscribeToChat();
    checkExistingPrediction();
}

/* =========================
   CORE PREDICTION LOGIC
========================= */

function disableAllInputs() {
    submitBtn.disabled = true;
    mvpSelect.disabled = true;
    userPredictSelect.disabled = true;
    winnerToggle.querySelectorAll(".team-option").forEach(btn => {
        btn.style.pointerEvents = "none";
        btn.style.opacity = "0.7";
    });
}

async function fetchNextMatch() {
    // 1. Prediction Target
    const { data: upcomingMatch } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1).maybeSingle();

    // 2. Engagement Target (Previous Match Result)
    const { data: lastFinishedMatch } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId)
        .eq("points_processed", true)
        .order("actual_start_time", { ascending: false })
        .limit(1).maybeSingle();

    if (upcomingMatch) {
        currentMatchId = upcomingMatch.id;
        renderSelectionView(upcomingMatch);
    } else {
        // Fallback for Locked Matches
        const { data: liveMatch } = await supabase.from("matches")
            .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
            .eq("tournament_id", currentTournamentId)
            .eq("status", "locked")
            .order("actual_start_time", { ascending: true })
            .limit(1).maybeSingle();

        if (liveMatch) {
            currentMatchId = liveMatch.id;
            renderSelectionView(liveMatch);
            lockUIForLiveMatch();
        } else {
            document.getElementById("selectionView").innerHTML = `<p class="sub-label" style="text-align:center;">No new matches to predict.</p>`;
        }
    }

    if (lastFinishedMatch) {
        document.getElementById("recentResultContainer").classList.remove("hidden");
        renderResultView(lastFinishedMatch);
    }
}

function lockUIForLiveMatch() {
    submitBtn.disabled = true;
    submitBtn.textContent = "MATCH IN PROGRESS ⏳";
    submitBtn.style.background = "#334155";
}

async function renderSelectionView(match) {
    document.getElementById("predictionSubtext").textContent = `Next: ${match.team_a.short_code} vs ${match.team_b.short_code}`;

    winnerToggle.innerHTML = `
        <button class="team-option" data-id="${match.team_a.id}">${match.team_a.short_code}</button>
        <button class="team-option" data-id="${match.team_b.id}">${match.team_b.short_code}</button>
    `;

    const { data: players } = await supabase.from("players")
        .select("*")
        .in("real_team_id", [match.team_a.id, match.team_b.id])
        .order("name", { ascending: true });

    mvpSelect.innerHTML = `<option value="">Select a Player...</option>`;
    players?.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.role})`;
        mvpSelect.appendChild(opt);
    });

    winnerToggle.querySelectorAll(".team-option").forEach(btn => {
        btn.onclick = () => {
            if (match.status === 'locked') return;
            winnerToggle.querySelectorAll(".team-option").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedWinnerId = btn.dataset.id;
        };
    });
}

async function renderResultView(match) {
    const resultContainer = document.getElementById("resultView");
    
    // 🛡️ Error-Proof Fetching
    const { data: statsArray } = await supabase.from("prediction_stats_view").select("*").eq("match_id", match.id);
    const stats = statsArray?.[0];

    const fetchPromises = [];
    fetchPromises.push(match.winner_id ? supabase.from("real_teams").select("short_code").eq("id", match.winner_id).single() : Promise.resolve({ data: { short_code: 'TBA' } }));
    fetchPromises.push(match.man_of_the_match_id ? supabase.from("players").select("name").eq("id", match.man_of_the_match_id).single() : Promise.resolve({ data: { name: 'TBA' } }));
    fetchPromises.push(stats?.predicted_top_user_id ? supabase.from("user_profiles").select("team_name").eq("user_id", stats.predicted_top_user_id).single() : Promise.resolve({ data: { team_name: 'TBA' } }));

    const [winnerRes, motmRes, expertRes] = await Promise.all(fetchPromises);

    resultContainer.innerHTML = `
        <div class="result-header" style="text-align:center; margin-bottom:15px;">
            <h3 class="theme-neon-text">${match.team_a.short_code} vs ${match.team_b.short_code}</h3>
        </div>
        
        <div class="result-item">
            <div class="result-row"><label>Winner</label><span class="winner-val">${winnerRes.data.short_code}</span></div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.winner_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.winner_pct || 0}% correct (${stats?.winner_votes || 0} votes)</div>
        </div>

        <div class="result-item">
            <div class="result-row"><label>Man of the Match</label><span class="winner-val">${motmRes.data.name}</span></div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.mvp_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.mvp_pct || 0}% correct (${stats?.mvp_votes || 0} votes)</div>
        </div>
    `;
}

/* =========================
   PRIVATE LEAGUE LOGIC
========================= */

async function checkUserLeagueStatus() {
    const { data } = await supabase.from('league_members')
        .select('league_id, leagues(name, invite_code)')
        .eq('user_id', currentUserId).maybeSingle();

    if (data) {
        activeLeagueId = data.league_id;
        noLeagueView.classList.add("hidden");
        activeLeagueView.classList.remove("hidden");
        displayLeagueName.textContent = data.leagues.name;
        displayInviteCode.textContent = data.leagues.invite_code;
        privateChatTab.disabled = false;

        const { data: rankData } = await supabase.from('private_league_leaderboard')
            .select('rank_in_league').eq('user_id', currentUserId).eq('league_id', activeLeagueId).maybeSingle();
        
        if (rankData) leagueRankVal.textContent = `#${rankData.rank_in_league}`;
    }
}

function setupLeagueUIListeners() {
    createLeagueBtn.onclick = async () => {
        const name = prompt("Name your League:");
        if (!name) return;
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: league } = await supabase.from('leagues').insert([{ name: name, invite_code: code, owner_id: currentUserId }]).select().single();
        await supabase.from('league_members').insert([{ league_id: league.id, user_id: currentUserId }]);
        window.location.reload();
    };

    joinLeagueBtn.onclick = async () => {
        const code = prompt("Enter Invite Code:");
        if (!code) return;
        const { data: league } = await supabase.from('leagues').select('id').eq('invite_code', code.toUpperCase()).single();
        if (league) {
            await supabase.from('league_members').insert([{ league_id: league.id, user_id: currentUserId }]);
            window.location.reload();
        } else {
            alert("Invalid Code!");
        }
    };
}

/* =========================
   SLEDGE-BOX & CHAT LOGIC
========================= */

function setupDrawerListeners() {
    chatToggleBtn.onclick = () => {
        chatDrawer.classList.remove("drawer-hidden");
        newMsgBadge.classList.add("hidden");
        setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 50);
    };
    closeChatBtn.onclick = () => chatDrawer.classList.add("drawer-hidden");

    globalChatTab.onclick = () => switchChatMode('global');
    privateChatTab.onclick = () => switchChatMode('private');
}

async function switchChatMode(mode) {
    if (mode === 'private' && !activeLeagueId) return;
    chatMode = mode;
    globalChatTab.classList.toggle('active', mode === 'global');
    privateChatTab.classList.toggle('active', mode === 'private');
    chatMessages.innerHTML = `<p class="sub-label" style="text-align:center;">Switching context...</p>`;
    await loadChatHistory();
    subscribeToChat();
}

async function loadChatHistory() {
    let query = supabase.from("game_chat").select("*, user_profiles(team_name)").order("created_at", { ascending: false }).limit(25);
    if (chatMode === 'private') query = query.eq('league_id', activeLeagueId);
    else query = query.is('league_id', null);

    const { data: messages } = await query;
    chatMessages.innerHTML = "";
    messages?.reverse().forEach(msg => renderMessage(msg));
}

function renderMessage(msg) {
    const isMine = msg.user_id === currentUserId;
    const div = document.createElement("div");
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="msg-user">${msg.user_profiles?.team_name || 'Expert'}</span>${msg.message}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (chatDrawer.classList.contains("drawer-hidden") && !isMine) newMsgBadge.classList.remove("hidden");
}

sendChatBtn.onclick = async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    await supabase.from("game_chat").insert({ 
        user_id: currentUserId, 
        message: text, 
        league_id: chatMode === 'private' ? activeLeagueId : null 
    });
};

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