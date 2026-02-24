import { supabase } from "./supabase.js";

/* ELEMENTS */
const winnerToggle = document.getElementById("winnerToggle");
const mvpSelect = document.getElementById("mvpSelect");
const userPredictSelect = document.getElementById("userPredictSelect");
const submitBtn = document.getElementById("submitPredictionBtn");
const chatDrawer = document.getElementById("chatDrawer");
const chatMessages = document.getElementById("chatMessages");
const chatToggleBtn = document.getElementById("chatToggleBtn");
const closeChatBtn = document.getElementById("closeChatBtn");
const newMsgBadge = document.getElementById("newMsgBadge");
const globalChatTab = document.getElementById("globalChatTab");
const privateChatTab = document.getElementById("privateChatTab");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const noLeagueView = document.getElementById("noLeagueView");
const activeLeagueView = document.getElementById("activeLeagueView");
const displayLeagueName = document.getElementById("displayLeagueName");
const displayInviteCode = document.getElementById("displayInviteCode");
const leagueRankVal = document.getElementById("leagueRankVal");
const createLeagueBtn = document.getElementById("createLeagueBtn");
const joinLeagueBtn = document.getElementById("joinLeagueBtn");
const userPredictionScore = document.getElementById("userPredictionScore");
const loginStreakSpan = document.getElementById("loginStreak");

/* STATE */
let currentUserId = null;
let currentMatchId = null;
let currentTournamentId = null;
let selectedWinnerId = null;
let activeLeagueId = null;
let chatMode = "global";
let chatSubscription = null;

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

  // Load everything in parallel
  await Promise.all([
    fetchPodiumData(), // Top 3 Heroes
    fetchNextMatch(),
    fetchExpertsList(),
    checkUserLeagueStatus(),
    fetchUserPredictionPoints(),
    fetchMiniLeaderboard()
  ]);

  await loadChatHistory();
  setupDrawerListeners();
  setupLeagueUIListeners();
  setupChatSend();
  subscribeToChat();
  checkExistingPrediction();
}

/* STREAK LOGIC */
async function handleDailyStreak(userId) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: profile } = await supabase.from("user_profiles").select("last_login, streak_count").eq("user_id", userId).maybeSingle();

    let newStreak = profile?.streak_count || 1;
    const lastLogin = profile?.last_login;

    if (lastLogin && lastLogin !== today) {
      const diff = Math.ceil(Math.abs(new Date(today) - new Date(lastLogin)) / (1000 * 60 * 60 * 24));
      newStreak = (diff === 1) ? newStreak + 1 : 1;
    }

    await supabase.from("user_profiles").upsert({ user_id: userId, last_login: today, streak_count: newStreak }, { onConflict: 'user_id' });
    loginStreakSpan.textContent = newStreak;
  } catch (err) { loginStreakSpan.textContent = "1"; }
}

async function fetchPodiumData() {
    try {
        // 1. Get the last match that was actually processed
        const { data: lastMatch } = await supabase
            .from("matches")
            .select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastMatch) return;

        document.getElementById("podiumSection").classList.remove("hidden");
        const matchTitle = `MATCH ${lastMatch.match_number}: ${lastMatch.team_a.short_code} VS ${lastMatch.team_b.short_code}`;
        
        const headers = document.querySelectorAll(".podium-card .card-header-fun");
        if(headers[0]) headers[0].textContent = "TOP PLAYERS - " + matchTitle;
        if(headers[1]) headers[1].textContent = "TOP USER TEAMS - " + matchTitle;

        // 2. Fetch Top 3 Players
        const { data: players } = await supabase
            .from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id)
            .order("fantasy_points", { ascending: false })
            .limit(3);

        renderPodium(players, "playerPodium", true);

        // 3. Fetch Top 3 Teams from user_match_points
        const { data: teams, error: teamError } = await supabase
            .from("user_match_points")
// FIXED: Added team_photo_url to the joined select
.select("total_points, user_profiles(team_name, team_photo_url)")
            .eq("match_id", lastMatch.id) // Ensure it matches the same match
            .order("total_points", { ascending: false })
            .limit(3);

        if (teamError) {
            console.error("Team Podium Error:", teamError.message);
        } else {
            renderPodium(teams, "teamPodium", false);
        }

    } catch (err) {
        console.error("Podium Load Error:", err);
    }
}

function renderPodium(data, containerId, isPlayer) {
    const container = document.getElementById(containerId);
    if (!data || data.length < 1) {
        container.innerHTML = `<p class="sub-label">Awaiting results...</p>`;
        return;
    }

    const podiumOrder = [];
    if (data[1]) podiumOrder.push({ ...data[1], rank: 2 });
    if (data[0]) podiumOrder.push({ ...data[0], rank: 1 });
    if (data[2]) podiumOrder.push({ ...data[2], rank: 3 });

    container.innerHTML = podiumOrder.map(item => {
        const name = isPlayer ? item.players.name.split(' ').pop() : item.user_profiles.team_name;
        const pts = isPlayer ? (item.fantasy_points || 0) : (item.total_points || 0);
        
        let photoUrl = 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png';
        
        if (isPlayer && item.players.photo_url) {
            // FIXED: Standard bucket name for player photos is usually 'player-photos'
            photoUrl = supabase.storage.from('player-photos').getPublicUrl(item.players.photo_url).data.publicUrl;
        } else if (!isPlayer && item.user_profiles.team_photo_url) {
            // FIXED: Standard bucket for user teams is usually 'team-photos'
            photoUrl = supabase.storage.from('team-photos').getPublicUrl(item.user_profiles.team_photo_url).data.publicUrl;
        }

        return `
            <div class="podium-item rank-${item.rank}">
                <div class="podium-name">${name}</div>
                <div class="podium-avatar-wrapper">
                    <img src="${photoUrl}" class="podium-img" onerror="this.src='https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png'">
                    <div class="rank-badge">${item.rank}</div>
                </div>
                <div class="podium-pts">${pts}</div>
            </div>
        `;
    }).join('');
}

/* MATCH & RESULT LOGIC */
async function fetchNextMatch() {
  const { data: upcoming } = await supabase.from("matches").select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
    .eq("tournament_id", currentTournamentId).eq("status", "upcoming").order("actual_start_time", { ascending: true }).limit(1).maybeSingle();

  const { data: lastFinished } = await supabase.from("matches").select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
    .eq("tournament_id", currentTournamentId).eq("points_processed", true).order("actual_start_time", { ascending: false }).limit(1).maybeSingle();

  if (upcoming) { currentMatchId = upcoming.id; renderSelectionView(upcoming); }
  if (lastFinished) { document.getElementById("recentResultContainer").classList.remove("hidden"); renderResultView(lastFinished); }
}

async function renderResultView(match) {
    const container = document.getElementById("resultView");
    let winnerName = "TBA", motmName = "TBA";

    // Safe fetches to prevent id=eq.null errors
    if (match.winner_id) {
        const { data: wt } = await supabase.from("real_teams").select("short_code").eq("id", match.winner_id).maybeSingle();
        if (wt) winnerName = wt.short_code;
    }
    if (match.man_of_the_match_id) {
        const { data: mp } = await supabase.from("players").select("name").eq("id", match.man_of_the_match_id).maybeSingle();
        if (mp) motmName = mp.name;
    }

    const { data: rank1User } = await supabase.from("prediction_leaderboard").select("team_name").order("total_points", { ascending: false }).limit(1).maybeSingle();
    const { data: stats } = await supabase.from("prediction_stats_view").select("*").eq("match_id", match.id).maybeSingle();

    container.innerHTML = `
      <div class="result-header" style="text-align:center; margin-bottom:15px;">
        <span class="final-badge">LATEST RESULT</span>
        <h3 class="theme-neon-text">${match.team_a.short_code} vs ${match.team_b.short_code}</h3>
      </div>
      ${renderResultItem("Winner", winnerName, stats?.winner_pct)}
      ${renderResultItem("Man of the Match", motmName, stats?.mvp_pct)}
      ${renderResultItem("Current #1 Expert", rank1User?.team_name || "TBA", stats?.top_user_pct)}
    `;
}

function renderResultItem(label, val, pct) {
  return `
    <div class="result-item">
      <div class="result-row"><label>${label}</label><span class="winner-val">${val}</span></div>
      <div class="pct-bar-bg"><div class="pct-bar-fill" style="width:${pct || 0}%"></div></div>
      <div class="pct-label">${pct || 0}% Correct</div>
    </div>`;
}

// ... (Rest of your Selection, League, and Chat logic remains the same)

/* UI & BUTTONS */
function lockUIForLiveMatch() {
  submitBtn.disabled = true;
  submitBtn.textContent = "MATCH IN PROGRESS ⏳";
  submitBtn.style.background = "#334155";
  submitBtn.style.opacity = "0.7";
}

function disableAllInputs() {
  submitBtn.disabled = true;
  mvpSelect.disabled = true;
  userPredictSelect.disabled = true;
  winnerToggle.querySelectorAll(".team-option").forEach((btn) => {
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.7";
  });
}

async function renderSelectionView(match) {
  document.getElementById("predictionSubtext").textContent = `Next: ${match.team_a.short_code} vs ${match.team_b.short_code}`;
  winnerToggle.innerHTML = `
    <button class="team-option" data-id="${match.team_a.id}">${match.team_a.short_code}</button>
    <button class="team-option" data-id="${match.team_b.id}">${match.team_b.short_code}</button>`;

  const { data: players } = await supabase.from("players").select("*").in("real_team_id", [match.team_a.id, match.team_b.id]).order("name", { ascending: true });
  mvpSelect.innerHTML = `<option value="">Select a Player...</option>` + (players || []).map(p => `<option value="${p.id}">${p.name} (${p.role || ""})</option>`).join("");

  winnerToggle.querySelectorAll(".team-option").forEach((btn) => {
    btn.onclick = () => {
      if (match.status === "locked") return;
      winnerToggle.querySelectorAll(".team-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedWinnerId = btn.dataset.id;
    };
  });
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
      predicted_top_user_id: topUserId,
    }, { onConflict: "user_id, match_id" });

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
    mvpSelect.value = data.predicted_mvp_id;
    userPredictSelect.value = data.predicted_top_user_id;
    const btn = winnerToggle.querySelector(`[data-id="${data.predicted_winner_id}"]`);
    if (btn) btn.classList.add("selected");
    selectedWinnerId = data.predicted_winner_id;
    submitBtn.textContent = "LOCKED ✅";
    disableAllInputs();
  }
}

/* LEAGUE LOGIC */
async function checkUserLeagueStatus() {
  const { data } = await supabase.from("league_members").select("league_id, leagues(name, invite_code)").eq("user_id", currentUserId).maybeSingle();
  if (data) {
    activeLeagueId = data.league_id;
    noLeagueView.classList.add("hidden");
    activeLeagueView.classList.remove("hidden");
    displayLeagueName.textContent = data.leagues.name;
    displayInviteCode.textContent = data.leagues.invite_code;
    privateChatTab.disabled = false;
    const { data: rankData } = await supabase.from("private_league_leaderboard").select("rank_in_league").eq("user_id", currentUserId).eq("league_id", activeLeagueId).maybeSingle();
    if (rankData) leagueRankVal.textContent = `#${rankData.rank_in_league}`;
  }
}

function setupLeagueUIListeners() {
  createLeagueBtn.onclick = async () => {
    const name = prompt("Enter a cool name for your League:");
    if (!name) return;
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: league, error } = await supabase.from("leagues").insert([{ name, invite_code: inviteCode, owner_id: currentUserId }]).select().single();
    if (error) return alert("Error creating league.");
    await supabase.from("league_members").insert([{ league_id: league.id, user_id: currentUserId }]);
    window.location.reload();
  };

  joinLeagueBtn.onclick = async () => {
    const code = prompt("Enter Invite Code:");
    if (!code) return;
    const { data: league } = await supabase.from("leagues").select("id").eq("invite_code", code.toUpperCase()).maybeSingle();
    if (!league) return alert("Invalid Code!");
    const { error } = await supabase.from("league_members").insert([{ league_id: league.id, user_id: currentUserId }]);
    if (error) return alert("You're already in this league or it failed.");
    window.location.reload();
  };
}

/* CHAT LOGIC */
function setupDrawerListeners() {
  chatToggleBtn.onclick = (e) => {
    e.stopPropagation();
    chatDrawer.classList.remove("drawer-hidden");
    newMsgBadge.classList.add("hidden");
    // 50ms delay ensures DOM is ready
    setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
  };
  closeChatBtn.onclick = () => chatDrawer.classList.add("drawer-hidden");
  globalChatTab.onclick = () => switchChatMode("global");
  privateChatTab.onclick = () => switchChatMode("private");
}

async function switchChatMode(mode) {
  if (mode === "private" && !activeLeagueId) return;
  chatMode = mode;
  globalChatTab.classList.toggle("active", mode === "global");
  privateChatTab.classList.toggle("active", mode === "private");
  await loadChatHistory();
  subscribeToChat();
}

async function loadChatHistory() {
  let query = supabase.from("game_chat").select("*, user_profiles(team_name)").order("created_at", { ascending: false }).limit(25);
  if (chatMode === "private") query = query.eq("league_id", activeLeagueId);
  else query = query.is("league_id", null);

  const { data: messages } = await query;
  if (!messages) return;
  chatMessages.innerHTML = "";
  messages.slice().reverse().forEach((msg) => renderMessage(msg));
}

function renderMessage(msg) {
  const isMine = msg.user_id === currentUserId;
  const div = document.createElement("div");
  div.className = `chat-bubble ${isMine ? "mine" : "other"}`;
  div.innerHTML = `<span class="msg-user">${msg.user_profiles?.team_name || "Expert"}</span><div class="msg-content">${msg.message}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatDrawer.classList.contains("drawer-hidden") && !isMine) newMsgBadge.classList.remove("hidden");
}

function setupChatSend() {
  sendChatBtn.onclick = sendChat;
  chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  const emojiBar = document.getElementById("emojiBar");
  emojiBar.querySelectorAll("span").forEach((btn) => {
    btn.onclick = () => { chatInput.value += btn.textContent; chatInput.focus(); };
  });
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  const payload = { user_id: currentUserId, message: text, league_id: chatMode === "private" ? activeLeagueId : null };
  await supabase.from("game_chat").insert(payload);
}

function subscribeToChat() {
  if (chatSubscription) supabase.removeChannel(chatSubscription);
  const filter = chatMode === "private" ? `league_id=eq.${activeLeagueId}` : `league_id=is.null`;
  chatSubscription = supabase.channel(`chat:${chatMode}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat", filter }, async (payload) => {
    const { data: userData } = await supabase.from("user_profiles").select("team_name").eq("user_id", payload.new.user_id).maybeSingle();
    renderMessage({ ...payload.new, user_profiles: userData });
  }).subscribe();
}

/* DATA FETCHERS */
async function fetchMiniLeaderboard() {
  const { data } = await supabase
    .from("prediction_leaderboard")
    .select("team_name, total_points")
    .order("total_points", { ascending: false }) // FIX: Highest points first
    .limit(3);

  const tbody = document.getElementById("miniLeaderboardBody");
  if (!tbody || !data) return;

  tbody.innerHTML = data.map((row, index) => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
        <td style="padding:10px 0; color:#fff; font-weight:600;">
          <span style="color: var(--neon-cyan); margin-right: 8px;">#${index + 1}</span>${row.team_name}
        </td>
        <td style="text-align:right; color:var(--neon-green); font-weight:800;">${row.total_points}</td>
      </tr>`).join("");
}

async function fetchUserPredictionPoints() {
  const { data, error } = await supabase
    .from("user_predictions")
    .select("points_earned")
    .eq("user_id", currentUserId);

  // Sum up all points (+1s and -1s)
  const total = data?.reduce((acc, curr) => acc + (curr.points_earned || 0), 0) || 0;
  
  // Update the UI score pill
  userPredictionScore.textContent = total;
}

async function fetchExpertsList() {
  const { data } = await supabase.from("user_profiles").select("user_id, team_name").limit(50);
  userPredictSelect.innerHTML = `<option value="">Select an Expert...</option>` + (data || []).map((e) => {
    const label = e.user_id === currentUserId ? `${e.team_name} (Me)` : e.team_name;
    return `<option value="${e.user_id}">${label}</option>`;
  }).join("");
}