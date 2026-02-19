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

let currentUserId = null;
let currentMatchId = null;
let selectedWinnerId = null;
let currentTournamentId = null;

/* =========================
   INIT
========================= */
init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = "login.html";
    currentUserId = session.user.id;

    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    currentTournamentId = activeTourney.id;

    await Promise.all([fetchNextMatch(), fetchExpertsList(), loadChatHistory()]);
    subscribeToChat();
    checkExistingPrediction();
}

/* =========================
   DRAWER UI LOGIC
========================= */
chatToggleBtn.onclick = () => {
    chatDrawer.classList.remove("drawer-hidden");
    newMsgBadge.classList.add("hidden");
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

closeChatBtn.onclick = () => chatDrawer.classList.add("drawer-hidden");

/* =========================
   PREDICTION LOGIC
========================= */
async function fetchNextMatch() {
    const { data: match } = await supabase.from("matches")
        .select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId).gt("actual_start_time", new Date().toISOString())
        .order("actual_start_time", { ascending: true }).limit(1).maybeSingle();

    if (!match) return;
    currentMatchId = match.id;
    document.getElementById("predictionSubtext").textContent = `Next: ${match.team_a.short_code} vs ${match.team_b.short_code}`;

    winnerToggle.innerHTML = `
        <button class="team-btn" data-id="${match.team_a.id}">${match.team_a.short_code}</button>
        <button class="team-btn" data-id="${match.team_b.id}">${match.team_b.short_code}</button>
    `;

    const { data: players } = await supabase.from("players").select("*")
        .in("real_team_id", [match.team_a.id, match.team_b.id]).order("name", { ascending: true });

    players.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.role})`;
        mvpSelect.appendChild(opt);
    });

    winnerToggle.querySelectorAll(".team-btn").forEach(btn => {
        btn.onclick = () => {
            winnerToggle.querySelectorAll(".team-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedWinnerId = btn.dataset.id;
        };
    });
}

async function fetchExpertsList() {
    const { data: experts } = await supabase.from("user_profiles").select("user_id, team_name").limit(50);
    experts.forEach(e => {
        if (e.user_id === currentUserId) return;
        const opt = document.createElement("option");
        opt.value = e.user_id;
        opt.textContent = e.team_name || "Expert User";
        userPredictSelect.appendChild(opt);
    });
}

submitBtn.onclick = async () => {
    const mvpId = mvpSelect.value;
    const topUserId = userPredictSelect.value;
    if (!selectedWinnerId || !mvpId || !topUserId) return alert("All fields required!");

    submitBtn.disabled = true;
    submitBtn.textContent = "LOCKING...";

    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId, match_id: currentMatchId,
        predicted_winner_id: selectedWinnerId, predicted_mvp_id: mvpId, predicted_top_user_id: topUserId
    }, { onConflict: 'user_id, match_id' });

    if (!error) submitBtn.textContent = "LOCKED ✅";
};

async function checkExistingPrediction() {
    if (!currentMatchId) return;
    const { data } = await supabase.from("user_predictions")
        .select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();

    if (data) {
        submitBtn.disabled = true;
        submitBtn.textContent = "LOCKED ✅";
        mvpSelect.value = data.predicted_mvp_id;
        userPredictSelect.value = data.predicted_top_user_id;
        const btn = winnerToggle.querySelector(`[data-id="${data.predicted_winner_id}"]`);
        if (btn) btn.classList.add("selected");
    }
}

/* =========================
   CHAT & REAL-TIME
========================= */
async function loadChatHistory() {
    const { data: messages } = await supabase.from("game_chat")
        .select("*, user_profiles(team_name)").order("created_at", { ascending: false }).limit(20);

    if (messages) {
        chatMessages.innerHTML = "";
        messages.reverse().forEach(msg => appendMessage(msg));
    }
}

function appendMessage(msg) {
    const isMine = msg.user_id === currentUserId;
    const div = document.createElement("div");
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="msg-user">${msg.user_profiles?.team_name || 'Expert'}</span>${msg.message}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (chatDrawer.classList.contains("drawer-hidden")) newMsgBadge.classList.remove("hidden");
}

sendChatBtn.onclick = async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    await supabase.from("game_chat").insert({ user_id: currentUserId, message: text });
};

function subscribeToChat() {
    supabase.channel('public:game_chat').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, async (payload) => {
        const { data: userData } = await supabase.from("user_profiles").select("team_name").eq("user_id", payload.new.user_id).single();
        appendMessage({ ...payload.new, user_profiles: userData });
    }).subscribe();
}