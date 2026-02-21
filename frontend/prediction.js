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

    // Load Parallel Data
    await Promise.all([
        fetchNextMatch(),
        fetchExpertsList(),
        checkUserLeagueStatus(), // Checks if in private group
        fetchUserPredictionPoints(),
        fetchMiniLeaderboard()
    ]);

    // Initial Chat Load depends on league status
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
    const { data: upcomingMatch } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1).maybeSingle();

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
            document.getElementById("selectionView").innerHTML = `
                <div style="text-align:center; padding: 20px;">
                    <p style="color: var(--text-slate); font-size: 13px;">No new matches to predict.</p>
                </div>`;
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
    submitBtn.style.opacity = "0.7";
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
    
    const [statsRes, winnerRes, motmRes] = await Promise.all([
        supabase.from("prediction_stats_view").select("*").eq("match_id", match.id),
        supabase.from("real_teams").select("short_code").eq("id", match.winner_id).single(),
        supabase.from("players").select("name").eq("id", match.man_of_the_match_id).single()
    ]);

    const stats = statsRes.data?.[0];
    const winnerTeam = winnerRes.data;
    const motmPlayer = motmRes.data;

    const { data: topExpert } = await supabase.from("user_profiles")
        .select("team_name")
        .eq("user_id", stats?.predicted_top_user_id)
        .single();

    resultContainer.innerHTML = `
        <div class="result-header">
            <span class="final-badge">LATEST RESULT</span>
            <h3 class="theme-neon-text">${match.team_a.short_code} vs ${match.team_b.short_code}</h3>
        </div>
        
        <div class="result-item">
            <div class="result-row">
                <label>Match Winner</label>
                <span class="winner-val">${winnerTeam?.short_code || 'N/A'}</span>
            </div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.winner_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.winner_pct || 0}% picked correctly (${stats?.winner_votes || 0} votes)</div>
        </div>

        <div class="result-item">
            <div class="result-row">
                <label>Man of the Match</label>
                <span class="winner-val">${motmPlayer?.name || 'N/A'}</span>
            </div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.mvp_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.mvp_pct || 0}% picked correctly (${stats?.mvp_votes || 0} votes)</div>
        </div>

        <div class="result-item">
            <div class="result-row">
                <label>Top Expert (Rank 1)</label>
                <span class="winner-val">${topExpert?.team_name || 'N/A'}</span>
            </div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.top_user_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.top_user_pct || 0}% picked correctly (${stats?.top_user_votes || 0} votes)</div>
        </div>
    `;
}
/* =========================
   PRIVATE LEAGUE LOGIC
========================= */

async function checkUserLeagueStatus() {
    const { data, error } = await supabase
        .from('league_members')
        .select('league_id, leagues(name, invite_code)')
        .eq('user_id', currentUserId)
        .maybeSingle();

    if (data) {
        activeLeagueId = data.league_id;
        noLeagueView.classList.add("hidden");
        activeLeagueView.classList.remove("hidden");
        displayLeagueName.textContent = data.leagues.name;
        displayInviteCode.textContent = data.leagues.invite_code;
        privateChatTab.disabled = false;

        // Fetch rank from the private view
        const { data: rankData } = await supabase
            .from('private_league_leaderboard')
            .select('rank_in_league')
            .eq('user_id', currentUserId)
            .eq('league_id', activeLeagueId)
            .maybeSingle();
        
        if (rankData) leagueRankVal.textContent = `#${rankData.rank_in_league}`;
    }
}

function setupLeagueUIListeners() {
    createLeagueBtn.onclick = async () => {
        const name = prompt("Enter a cool name for your League:");
        if (!name) return;
        
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const { data: league, error } = await supabase.from('leagues').insert([{
            name: name,
            invite_code: inviteCode,
            owner_id: currentUserId
        }]).select().single();

        if (error) return alert("Error creating league.");

        await supabase.from('league_members').insert([{
            league_id: league.id,
            user_id: currentUserId
        }]);

        alert(`League Created! Invite friends with code: ${inviteCode}`);
        window.location.reload();
    };

    joinLeagueBtn.onclick = async () => {
        const code = prompt("Enter Invite Code:");
        if (!code) return;

        const { data: league } = await supabase.from('leagues').select('id').eq('invite_code', code.toUpperCase()).single();
        if (!league) return alert("Invalid Code!");

        const { error } = await supabase.from('league_members').insert([{
            league_id: league.id,
            user_id: currentUserId
        }]);

        if (error) return alert("You're already in this league or it failed.");
        alert("Joined Successfully!");
        window.location.reload();
    };
}

/* =========================
   CHAT & UI LOGIC
========================= */

function setupDrawerListeners() {
    chatToggleBtn.onclick = () => {
        chatDrawer.classList.remove("drawer-hidden");
        newMsgBadge.classList.add("hidden");
        chatMessages.scrollTop = chatMessages.scrollHeight;
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

    await loadChatHistory();
    subscribeToChat(); // Resubscribe with new filter
}

async function loadChatHistory() {
    let query = supabase.from("game_chat")
        .select("*, user_profiles(team_name)")
        .order("created_at", { ascending: false })
        .limit(25);

    if (chatMode === 'private') query = query.eq('league_id', activeLeagueId);
    else query = query.is('league_id', null);

    const { data: messages } = await query;
    if (messages) {
        chatMessages.innerHTML = "";
        messages.reverse().forEach(msg => renderMessage(msg));
    }
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
    
    const payload = { 
        user_id: currentUserId, 
        message: text,
        league_id: chatMode === 'private' ? activeLeagueId : null 
    };
    await supabase.from("game_chat").insert(payload);
};

function subscribeToChat() {
    if (chatSubscription) supabase.removeChannel(chatSubscription);

    const filter = chatMode === 'private' 
        ? `league_id=eq.${activeLeagueId}` 
        : `league_id=is.null`;

    chatSubscription = supabase.channel(`chat:${chatMode}`)
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'game_chat',
            filter: filter 
        }, async (payload) => {
            const { data: userData } = await supabase.from("user_profiles").select("team_name").eq("user_id", payload.new.user_id).single();
            renderMessage({ ...payload.new, user_profiles: userData });
        }).subscribe();
}

// --- EMOJI BAR ---
const emojiBar = document.getElementById("emojiBar");
emojiBar.querySelectorAll("span").forEach(emojiBtn => {
    emojiBtn.onclick = () => {
        chatInput.value += emojiBtn.textContent;
        chatInput.focus();
    };
});

/* =========================
   SUPPORTING FUNCTIONS
========================= */

async function fetchExpertsList() {
    const { data: experts } = await supabase.from("user_profiles").select("user_id, team_name").limit(50);
    userPredictSelect.innerHTML = `<option value="">Select an Expert...</option>`;
    experts?.forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.user_id;
        opt.textContent = (e.user_id === currentUserId) ? `${e.team_name} (Me)` : e.team_name;
        userPredictSelect.appendChild(opt);
    });
}

async function fetchMiniLeaderboard() {
    const { data: topTeams } = await supabase.from("prediction_leaderboard").select("*");
    const tbody = document.getElementById("miniLeaderboardBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    topTeams?.forEach(team => {
        const row = `<tr><td>${team.team_name}</td><td>${team.total_points}</td></tr>`;
        tbody.insertAdjacentHTML('beforeend', row);
    });
}

async function fetchUserPredictionPoints() {
    const { data } = await supabase.from("user_predictions").select("points_earned").eq("user_id", currentUserId);
    const total = data?.reduce((acc, curr) => acc + (curr.points_earned || 0), 0) || 0;
    userPredictionScore.textContent = total;
}

submitBtn.onclick = async () => {
    const mvpId = mvpSelect.value;
    const topUserId = userPredictSelect.value;
    if (!selectedWinnerId || !mvpId || !topUserId) return alert("Please complete your guesses!");

    submitBtn.disabled = true;
    submitBtn.textContent = "LOCKING...";

    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId,
        match_id: currentMatchId,
        predicted_winner_id: selectedWinnerId,
        predicted_mvp_id: mvpId,
        predicted_top_user_id: topUserId
    }, { onConflict: 'user_id, match_id' });

    if (!error) {
        submitBtn.textContent = "LOCKED ✅";
        disableAllInputs();
    } else {
        alert("Action failed.");
        submitBtn.disabled = false;
        submitBtn.textContent = "LOCK PREDICTIONS";
    }
};

async function checkExistingPrediction() {
    if (!currentMatchId) return;
    const { data } = await supabase.from("user_predictions").select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();
    if (data) {
        submitBtn.textContent = "LOCKED ✅";
        mvpSelect.value = data.predicted_mvp_id;
        userPredictSelect.value = data.predicted_top_user_id;
        const btn = winnerToggle.querySelector(`[data-id="${data.predicted_winner_id}"]`);
        if (btn) btn.classList.add("selected");
        selectedWinnerId = data.predicted_winner_id;
        disableAllInputs();
    }
}