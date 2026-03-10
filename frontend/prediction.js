import { supabase } from "./supabase.js";

/* STATE */
let currentUserId, currentMatchId, currentTournamentId;
let currentStep = 1;
let userChoices = { winner: null, mvp: null, expert: null };
let activeChatType = 'global';
let userLeagueId = null;

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    currentUserId = session.user.id;

    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    // Fetch User League for Private Chat
    const { data: member } = await supabase.from('league_members').select('league_id').eq('user_id', currentUserId).maybeSingle();
    userLeagueId = member?.league_id;
    if (!userLeagueId) document.getElementById('btnLeague').disabled = true;

    await Promise.all([
        loadPodiums(),
        fetchNextMatch(),
        fetchExpertsList(),
        loadFeed(),
        fetchUserPredictionPoints()
    ]);

    setupChatRealtime();
    setupWizard();
    checkExistingPrediction();
}

/* --- THE DOUBLE PODIUM LOGIC --- */
async function loadPodiums() {
    try {
        const { data: lastMatch } = await supabase.from("matches")
            .select("id, match_number")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false }).limit(1).maybeSingle();

        if (!lastMatch) return;

        // 1. Players Podium
        const { data: players } = await supabase.from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id).order("fantasy_points", { ascending: false }).limit(3);
        renderPodium(players, "playerPodium", true);

        // 2. Users Podium
        const { data: users } = await supabase.from("user_match_points")
            .select("total_points, user_profiles(team_name, team_photo_url, equipped_flex)")
            .eq("match_id", lastMatch.id).order("total_points", { ascending: false }).limit(3);
        renderPodium(users, "userPodium", false);
    } catch (err) { console.error("Podium Load Error:", err); }
}

function renderPodium(data, containerId, isPlayer) {
    const container = document.getElementById(containerId);
    if (!data || data.length < 1) { container.innerHTML = `<p style="font-size:10px; color:#475569;">Awaiting Results...</p>`; return; }

    const order = [data[1], data[0], data[2]].filter(Boolean);
    container.innerHTML = order.map((item, idx) => {
        const rank = item === data[0] ? 1 : (item === data[1] ? 2 : 3);
        const name = isPlayer ? item.players.name.split(' ').pop() : item.user_profiles.team_name;
        const pts = isPlayer ? item.fantasy_points : item.total_points;
        const flex = !isPlayer ? item.user_profiles.equipped_flex : '';
        
        let url = 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png';
        const path = isPlayer ? item.players.photo_url : item.user_profiles.team_photo_url;
        if (path) url = supabase.storage.from(isPlayer ? 'player-photos' : 'team-avatars').getPublicUrl(path).data.publicUrl;

        return `
            <div class="podium-item rank-${rank}">
                <div class="podium-name ${flex}">${name}</div>
                <div class="podium-avatar-wrapper">
                    <img src="${url}" class="podium-img">
                    <div class="rank-badge">${rank}</div>
                </div>
                <div class="podium-pts">${pts}</div>
            </div>`;
    }).join('');
}

/* --- THE QUIZ WIZARD --- */
function setupWizard() {
    const nextBtn = document.getElementById("nextBtn");
    nextBtn.onclick = () => {
        if (currentStep === 1 && !userChoices.winner) return alert("Pick a Winner!");
        if (currentStep === 2 && !document.getElementById("mvpSelect").value) return alert("Pick an MVP!");
        if (currentStep === 3 && !document.getElementById("userPredictSelect").value) return alert("Pick an Expert!");

        if (currentStep < 3) { currentStep++; renderStep(); } 
        else { finalizeQuiz(); }
    };
    document.getElementById("skipBtn").onclick = () => { if (currentStep < 3) { currentStep++; renderStep(); } else { finalizeQuiz(); }};
}

function renderStep() {
    document.querySelectorAll(".quiz-step").forEach(s => s.classList.add("hidden"));
    document.getElementById(`quizStep${currentStep}`).classList.remove("hidden");
    const titles = ["Step 1: Match Winner", "Step 2: Top Player", "Step 3: Top Expert"];
    document.getElementById("stepTitle").innerText = titles[currentStep - 1];
    if (currentStep === 3) document.getElementById("nextBtn").innerText = "FINISH";
}

async function finalizeQuiz() {
    userChoices.mvp = document.getElementById("mvpSelect").value;
    userChoices.expert = document.getElementById("userPredictSelect").value;

    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId, match_id: currentMatchId,
        predicted_winner_id: userChoices.winner, predicted_mvp_id: userChoices.mvp, predicted_top_user_id: userChoices.expert
    });

    if (!error) {
        document.getElementById("quizActions").classList.add("hidden");
        document.querySelectorAll(".quiz-step").forEach(s => s.classList.add("hidden"));
        document.getElementById("quizStepDone").classList.remove("hidden");
        document.getElementById("stepTitle").innerText = "Locked 🔒";
    }
}

/* --- CHAT SYSTEM --- */
function setupChatRealtime() {
    const drawer = document.getElementById("chatDrawer");
    document.getElementById("chatToggleBtn").onclick = () => { drawer.classList.toggle("drawer-hidden"); loadMessages(); };
    document.getElementById("closeChat").onclick = () => drawer.classList.add("drawer-hidden");
    document.getElementById("sendChatBtn").onclick = sendMessage;
    
    document.getElementById("btnGlobal").onclick = () => { activeChatType = 'global'; switchTab('btnGlobal'); loadMessages(); };
    document.getElementById("btnLeague").onclick = () => { activeChatType = 'league'; switchTab('btnLeague'); loadMessages(); };

    supabase.channel('game_chat').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, payload => {
        if (payload.new.league_id === (activeChatType === 'global' ? null : userLeagueId)) {
            loadMessages();
        }
    }).subscribe();
}

async function sendMessage() {
    const input = document.getElementById("chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    await supabase.from('game_chat').insert({
        user_id: currentUserId, message: msg, league_id: activeChatType === 'global' ? null : userLeagueId
    });
}

async function loadMessages() {
    const { data } = await supabase.from('game_chat')
        .select('*, user_profiles(team_name)').eq('league_id', activeChatType === 'global' ? null : userLeagueId)
        .order('created_at', { ascending: false }).limit(20);
    const area = document.getElementById("chatMessages");
    area.innerHTML = data.reverse().map(m => `<div><b>${m.user_profiles?.team_name || 'Expert'}:</b> ${m.message}</div>`).join('');
    area.scrollTop = area.scrollHeight;
}

function switchTab(id) {
    document.getElementById("btnGlobal").classList.remove("active");
    document.getElementById("btnLeague").classList.remove("active");
    document.getElementById(id).classList.add("active");
}

/* --- SOCIAL FEED --- */
async function loadFeed() {
    const { data } = await supabase.from('social_feed').select('*, user_profiles(team_name)')
        .order('created_at', { ascending: false }).limit(15);
    document.getElementById("feedContainer").innerHTML = data.map(p => `
        <div class="post-card">
            <span class="post-user">${p.user_profiles.team_name}</span>
            <p class="post-content">${p.content}</p>
        </div>`).join('');
}

document.getElementById("postFab").onclick = async () => {
    const txt = prompt("Sledge the community:");
    if (!txt) return;
    await supabase.from('social_feed').insert({ user_id: currentUserId, content: txt });
    loadFeed();
};

/* HELPER FETCHERS */
async function fetchNextMatch() {
    const { data: m } = await supabase.from("matches").select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId).eq("status", "upcoming").order("actual_start_time", { ascending: true }).limit(1).maybeSingle();
    if (m) {
        currentMatchId = m.id;
        document.getElementById("winnerToggle").innerHTML = `
            <button class="team-option" onclick="pickWinner('${m.team_a.id}', this)">${m.team_a.short_code}</button>
            <button class="team-option" onclick="pickWinner('${m.team_b.id}', this)">${m.team_b.short_code}</button>`;
        const { data: players } = await supabase.from("players").select("id, name").in("real_team_id", [m.team_a.id, m.team_b.id]);
        document.getElementById("mvpSelect").innerHTML = `<option value="">Select MVP</option>` + players.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
}

window.pickWinner = (id, btn) => {
    document.querySelectorAll(".team-option").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    userChoices.winner = id;
};

async function fetchExpertsList() {
    const { data } = await supabase.from("user_profiles").select("user_id, team_name").limit(30);
    document.getElementById("userPredictSelect").innerHTML = `<option value="">Select Expert</option>` + data.map(e => `<option value="${e.user_id}">${e.team_name}</option>`).join('');
}

async function fetchUserPredictionPoints() {
    const { data } = await supabase.from("user_predictions").select("points_earned").eq("user_id", currentUserId);
    document.getElementById("userPredictionScore").textContent = data?.reduce((a, c) => a + (c.points_earned || 0), 0) || 0;
}

async function checkExistingPrediction() {
    const { data } = await supabase.from("user_predictions").select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();
    if (data) {
        document.getElementById("quizActions").classList.add("hidden");
        document.querySelectorAll(".quiz-step").forEach(s => s.classList.add("hidden"));
        document.getElementById("quizStepDone").classList.remove("hidden");
        document.getElementById("stepTitle").innerText = "Locked 🔒";
    }
}

window.flipTo = (side) => document.getElementById("mainFlipCard").classList.toggle("flipped", side !== 'front');