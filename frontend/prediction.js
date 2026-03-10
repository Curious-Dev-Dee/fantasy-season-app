import { supabase } from "./supabase.js";

let currentStep = 1;
let userChoices = { winner: null, mvp: null, expert: null };
let activeChatType = 'global';
let userLeagueId = null;

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    
    // 1. Fetch User League for Private Chat
    const { data: member } = await supabase.from('league_members').select('league_id').eq('user_id', session.user.id).maybeSingle();
    userLeagueId = member?.league_id;
    if (!userLeagueId) document.getElementById('btnLeague').disabled = true;

    // 2. Initial Loads
    loadPodiums();
    loadFeed();
    setupChatRealtime();
    setupWizard();
}

/* --- THE QUIZ WIZARD --- */
function setupWizard() {
    const nextBtn = document.getElementById("nextBtn");
    const skipBtn = document.getElementById("skipBtn");

    nextBtn.onclick = () => {
        if (currentStep === 1 && !userChoices.winner) return alert("Select a winner!");
        if (currentStep === 2 && !document.getElementById("mvpSelect").value) return alert("Select an MVP!");
        if (currentStep === 3 && !document.getElementById("userPredictSelect").value) return alert("Select an Expert!");

        if (currentStep < 3) {
            currentStep++;
            renderStep();
        } else {
            finalizeQuiz();
        }
    };

    skipBtn.onclick = () => {
        if (currentStep < 3) {
            currentStep++;
            renderStep();
        } else {
            finalizeQuiz();
        }
    };
}

function renderStep() {
    document.querySelectorAll(".quiz-step").forEach(s => s.classList.add("hidden"));
    const stepTitle = document.getElementById("stepTitle");

    if (currentStep === 1) {
        stepTitle.innerText = "Step 1: Match Winner";
        document.getElementById("quizStep1").classList.remove("hidden");
    } else if (currentStep === 2) {
        stepTitle.innerText = "Step 2: Top Scorer (MVP)";
        document.getElementById("quizStep2").classList.remove("hidden");
    } else if (currentStep === 3) {
        stepTitle.innerText = "Step 3: Top Fantasy Expert";
        document.getElementById("quizStep3").classList.remove("hidden");
        document.getElementById("nextBtn").innerText = "FINISH";
    }
}

async function finalizeQuiz() {
    // Collect final values
    userChoices.mvp = document.getElementById("mvpSelect").value;
    userChoices.expert = document.getElementById("userPredictSelect").value;

    await supabase.from("user_predictions").upsert({
        user_id: currentUserId,
        match_id: currentMatchId,
        predicted_winner_id: userChoices.winner,
        predicted_mvp_id: userChoices.mvp,
        predicted_top_user_id: userChoices.expert
    });

    document.getElementById("quizActions").classList.add("hidden");
    document.getElementById("quizStep3").classList.add("hidden");
    document.getElementById("quizStepDone").classList.remove("hidden");
    document.getElementById("stepTitle").innerText = "Locked 🔒";
}

/* --- CHAT SYSTEM (REALTIME + 20 LIMIT) --- */
function setupChatRealtime() {
    const chatBtn = document.getElementById("chatToggleBtn");
    const drawer = document.getElementById("chatDrawer");
    
    chatBtn.onclick = () => {
        drawer.classList.toggle("drawer-hidden");
        loadMessages();
    };

    document.getElementById("sendChatBtn").onclick = sendMessage;

    // Realtime Listener
    supabase.channel('game_chat')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_chat' }, payload => {
        appendMessage(payload.new);
    }).subscribe();
}

async function loadMessages() {
    const { data } = await supabase.from('game_chat')
        .select('*, user_profiles(team_name)')
        .eq('league_id', activeChatType === 'global' ? null : userLeagueId)
        .order('created_at', { ascending: false }).limit(20);

    const display = document.getElementById("chatMessages");
    display.innerHTML = data.reverse().map(m => `<div><b>${m.user_profiles.team_name}:</b> ${m.message}</div>`).join('');
    display.scrollTop = display.scrollHeight;
}

/* --- SOCIAL FEED --- */
document.getElementById("postFab").onclick = async () => {
    const txt = prompt("Sledge the community (Text only):");
    if (!txt) return;
    await supabase.from('social_feed').insert({ user_id: currentUserId, content: txt });
    loadFeed();
};

async function loadFeed() {
    const { data } = await supabase.from('social_feed')
        .select('*, user_profiles(team_name)')
        .order('created_at', { ascending: false }).limit(10);

    document.getElementById("feedContainer").innerHTML = data.map(p => `
        <div class="post-card">
            <span class="post-user">${p.user_profiles.team_name}</span>
            <p class="post-content">${p.content}</p>
            <div class="post-actions">
                <span><i class="far fa-thumbs-up"></i> ${p.likes}</span>
                <span><i class="far fa-thumbs-down"></i> ${p.dislikes}</span>
            </div>
        </div>
    `).join('');
}