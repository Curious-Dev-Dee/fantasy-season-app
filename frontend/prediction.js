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

let currentUserId = null;
let currentMatchId = null;
let selectedWinnerId = null;
let currentTournamentId = null;

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

    // Load Data
    await Promise.all([
        fetchNextMatch(),
        fetchExpertsList(),
        loadChatHistory(),
        fetchUserPredictionPoints()
    ]);

    setupDrawerListeners();
    subscribeToChat();
    checkExistingPrediction();
}

/* =========================
   CORE PREDICTION LOGIC
========================= */

/**
 * UPDATED: Priority Fetching
 * 1. Shows 'upcoming' match for voting if available.
 * 2. If 'locked' match exists, shows last processed match results.
 * 3. Falls back to 'locked' match if no processed match exists.
 */
async function fetchNextMatch() {
    // 1. Check for the next match awaiting predictions (voting open)
    const { data: upcomingMatch } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "upcoming")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .maybeSingle();

    // 2. Fetch the most recently completed match with results
    const { data: lastFinishedMatch } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId)
        .eq("points_processed", true)
        .order("actual_start_time", { ascending: false })
        .limit(1)
        .maybeSingle();

    // 3. Handle 'Live' or Locked matches
    const { data: liveMatch } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId)
        .eq("status", "locked")
        .order("actual_start_time", { ascending: true })
        .limit(1)
        .maybeSingle();

    // PRIORITY 1: Show the next match to vote on
    if (upcomingMatch) {
        currentMatchId = upcomingMatch.id;
        renderSelectionView(upcomingMatch);
    } 
    // PRIORITY 2: If no upcoming match, show results of the last finished match
    else if (lastFinishedMatch) {
        currentMatchId = lastFinishedMatch.id;
        renderResultView(lastFinishedMatch);
    } 
    // PRIORITY 3: If a match is live but not yet processed, show its locked state
    else if (liveMatch) {
        currentMatchId = liveMatch.id;
        renderSelectionView(liveMatch);
        lockUIForLiveMatch();
    } 
    // FALLBACK: Empty state
    else {
        document.getElementById("predictorCard").innerHTML = `
            <div style="text-align:center; padding: 40px 20px;">
                <i class="fas fa-calendar-times" style="font-size: 40px; color: var(--text-slate); margin-bottom: 15px;"></i>
                <p style="color: var(--text-slate);">No matches scheduled at the moment.</p>
            </div>`;
    }
}

function lockUIForLiveMatch() {
    submitBtn.disabled = true;
    submitBtn.textContent = "MATCH IN PROGRESS ⏳";
    submitBtn.style.background = "#334155";
    submitBtn.style.opacity = "0.7";
}

async function renderSelectionView(match) {
    document.getElementById("selectionView").classList.remove("hidden");
    document.getElementById("resultView").classList.add("hidden");
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
    document.getElementById("selectionView").classList.add("hidden");
    const resultContainer = document.getElementById("resultView");
    resultContainer.classList.remove("hidden");
    
    document.getElementById("predictionSubtext").textContent = `Match Result: ${match.team_a.short_code} vs ${match.team_b.short_code}`;

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
            <span class="final-badge">MATCH COMPLETED</span>
            <h3 class="theme-neon-text">Official Results</h3>
        </div>
        
        <div class="result-item">
            <div class="result-row">
                <label>Match Winner</label>
                <span class="winner-val">${winnerTeam?.short_code || 'N/A'}</span>
            </div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.winner_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.winner_pct || 0}% correct (${stats?.winner_votes || 0} votes)</div>
        </div>

        <div class="result-item">
            <div class="result-row">
                <label>Man of the Match</label>
                <span class="winner-val">${motmPlayer?.name || 'N/A'}</span>
            </div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.mvp_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.mvp_pct || 0}% correct</div>
        </div>

        <div class="result-item">
            <div class="result-row">
                <label>Top Expert (Rank 1)</label>
                <span class="winner-val">${topExpert?.team_name || 'N/A'}</span>
            </div>
            <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${stats?.top_user_pct || 0}%"></div></div>
            <div class="pct-label">${stats?.top_user_pct || 0}% predicted correctly</div>
        </div>
    `;
}

/* --- SUPPORTING FUNCTIONS (UNCHANGED) --- */
async function fetchExpertsList() {
    const { data: experts } = await supabase.from("user_profiles").select("user_id, team_name").limit(50);
    userPredictSelect.innerHTML = `<option value="">Select an Expert...</option>`;
    experts.forEach(e => {
        if (e.user_id === currentUserId) return;
        const opt = document.createElement("option");
        opt.value = e.user_id;
        opt.textContent = e.team_name || "Expert User";
        userPredictSelect.appendChild(opt);
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

    if (error) {
        alert("Action failed. Check match status.");
        submitBtn.disabled = false;
        submitBtn.textContent = "LOCK PREDICTIONS";
    } else {
        submitBtn.textContent = "LOCKED ✅";
    }
};

async function checkExistingPrediction() {
    if (!currentMatchId) return;
    const { data } = await supabase.from("user_predictions").select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();
    if (data) {
        submitBtn.disabled = true;
        submitBtn.textContent = "LOCKED ✅";
        mvpSelect.value = data.predicted_mvp_id;
        userPredictSelect.value = data.predicted_top_user_id;
        const btn = winnerToggle.querySelector(`[data-id="${data.predicted_winner_id}"]`);
        if (btn) btn.classList.add("selected");
        selectedWinnerId = data.predicted_winner_id;
    }
}

function setupDrawerListeners() {
    chatToggleBtn.onclick = () => {
        chatDrawer.classList.remove("drawer-hidden");
        newMsgBadge.classList.add("hidden");
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    closeChatBtn.onclick = () => chatDrawer.classList.add("drawer-hidden");
}

async function loadChatHistory() {
    const { data: messages } = await supabase.from("game_chat").select("*, user_profiles(team_name)").order("created_at", { ascending: false }).limit(25);
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
    await supabase.from("game_chat").insert({ user_id: currentUserId, message: text });
};

function subscribeToChat() {
    supabase.channel('public:game_chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, async (payload) => {
            const { data: userData } = await supabase.from("user_profiles").select("team_name").eq("user_id", payload.new.user_id).single();
            renderMessage({ ...payload.new, user_profiles: userData });
        }).subscribe();
}