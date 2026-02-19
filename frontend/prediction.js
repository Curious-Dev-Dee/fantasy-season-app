import { supabase } from "./supabase.js";

// Elements
const chatDrawer = document.getElementById("chatDrawer");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const newMsgBadge = document.getElementById("newMsgBadge");

let currentUserId = null;

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return window.location.href = "login.html";
    currentUserId = session.user.id;

    await loadChatHistory();
    subscribeToChat(); // This enables Real-time
    setupDrawer();
    // ... load other match/prediction data ...
}

function setupDrawer() {
    document.getElementById("chatToggleBtn").onclick = () => {
        chatDrawer.classList.remove("drawer-hidden");
        newMsgBadge.classList.add("hidden");
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    document.getElementById("closeChatBtn").onclick = () => chatDrawer.classList.add("drawer-hidden");
}

/* REAL-TIME CHAT LOGIC */
async function loadChatHistory() {
    const { data } = await supabase.from("game_chat")
        .select("*, user_profiles(team_name)")
        .order("created_at", { ascending: false }).limit(25);
    
    if (data) {
        chatMessages.innerHTML = "";
        data.reverse().forEach(msg => renderMessage(msg));
    }
}

function renderMessage(msg) {
    const isMine = msg.user_id === currentUserId;
    const div = document.createElement("div");
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="msg-user">${msg.user_profiles?.team_name || 'Expert'}</span>${msg.message}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Show red dot if drawer is closed
    if (chatDrawer.classList.contains("drawer-hidden") && !isMine) {
        newMsgBadge.classList.remove("hidden");
    }
}

sendChatBtn.onclick = async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    
    // Just insert to DB, Realtime listener will handle rendering it for you!
    await supabase.from("game_chat").insert({ user_id: currentUserId, message: text });
};

function subscribeToChat() {
    supabase
        .channel('public:game_chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, async (payload) => {
            // Fetch team name for the new message
            const { data } = await supabase.from("user_profiles")
                .select("team_name").eq("user_id", payload.new.user_id).single();
            
            const msgWithUser = { ...payload.new, user_profiles: data };
            renderMessage(msgWithUser);
        })
        .subscribe();
}