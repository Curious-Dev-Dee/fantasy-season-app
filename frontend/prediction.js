import { supabase } from "./supabase.js";

let currentUserId, currentMatchId, currentTournamentId;
let currentStep = 1;
let userChoices = { winner: null, mvp: null, expert: null };
let activeChatType = "global";
let userLeagueId = null;

function createOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
}

function safeFlexClass(flex) {
    return /^[a-z0-9_-]+$/i.test(flex || "") ? flex : "";
}

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    currentUserId = session.user.id;

    const { data: activeTourney } = await supabase.from("active_tournament").select("*").maybeSingle();
    if (!activeTourney) return;
    currentTournamentId = activeTourney.id;

    const { data: member } = await supabase.from("league_members").select("league_id").eq("user_id", currentUserId).maybeSingle();
    userLeagueId = member?.league_id;
    if (!userLeagueId) document.getElementById("btnLeague").disabled = true;

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

async function loadPodiums() {
    try {
        const { data: lastMatch } = await supabase.from("matches")
            .select("id, match_number")
            .eq("points_processed", true)
            .order("actual_start_time", { ascending: false }).limit(1).maybeSingle();

        if (!lastMatch) return;

        const { data: players } = await supabase.from("player_match_stats")
            .select("fantasy_points, players(name, photo_url)")
            .eq("match_id", lastMatch.id).order("fantasy_points", { ascending: false }).limit(3);
        renderPodium(players, "playerPodium", true);

        const { data: users } = await supabase.from("user_match_points")
            .select("total_points, user_profiles(team_name, team_photo_url, equipped_flex)")
            .eq("match_id", lastMatch.id).order("total_points", { ascending: false }).limit(3);
        renderPodium(users, "userPodium", false);
    } catch (err) {
        console.error("Podium Load Error:", err);
    }
}

function renderPodium(data, containerId, isPlayer) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data || data.length < 1) {
        const empty = document.createElement("p");
        empty.style.fontSize = "10px";
        empty.style.color = "#475569";
        empty.textContent = "Awaiting Results...";
        container.replaceChildren(empty);
        return;
    }

    const order = [data[1], data[0], data[2]].filter(Boolean);
    container.replaceChildren();

    order.forEach((item) => {
        const rank = item === data[0] ? 1 : (item === data[1] ? 2 : 3);
        const name = isPlayer
            ? item.players?.name?.split(" ").pop() || "Player"
            : item.user_profiles?.team_name || "Expert";
        const pts = isPlayer ? item.fantasy_points : item.total_points;
        const flex = !isPlayer ? safeFlexClass(item.user_profiles?.equipped_flex) : "";

        let url = "https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png";
        const path = isPlayer ? item.players?.photo_url : item.user_profiles?.team_photo_url;
        if (path) {
            url = supabase.storage.from(isPlayer ? "player-photos" : "team-avatars").getPublicUrl(path).data.publicUrl;
        }

        const itemEl = document.createElement("div");
        itemEl.className = `podium-item rank-${rank}`;

        const nameEl = document.createElement("div");
        nameEl.className = "podium-name";
        if (flex) nameEl.classList.add(flex);
        nameEl.textContent = name;

        const avatarWrapper = document.createElement("div");
        avatarWrapper.className = "podium-avatar-wrapper";

        const image = document.createElement("img");
        image.src = url;
        image.className = "podium-img";
        image.alt = name;

        const badge = document.createElement("div");
        badge.className = "rank-badge";
        badge.textContent = String(rank);

        avatarWrapper.append(image, badge);

        const pointsEl = document.createElement("div");
        pointsEl.className = "podium-pts";
        pointsEl.textContent = String(pts);

        itemEl.append(nameEl, avatarWrapper, pointsEl);
        container.appendChild(itemEl);
    });
}

function setupWizard() {
    const nextBtn = document.getElementById("nextBtn");
    nextBtn.onclick = () => {
        if (currentStep === 1 && !userChoices.winner) return alert("Pick a Winner!");
        if (currentStep === 2 && !document.getElementById("mvpSelect").value) return alert("Pick an MVP!");
        if (currentStep === 3 && !document.getElementById("userPredictSelect").value) return alert("Pick an Expert!");

        if (currentStep < 3) { currentStep++; renderStep(); }
        else { finalizeQuiz(); }
    };
    document.getElementById("skipBtn").onclick = () => { if (currentStep < 3) { currentStep++; renderStep(); } else { finalizeQuiz(); } };
}

function renderStep() {
    document.querySelectorAll(".quiz-step").forEach((step) => step.classList.add("hidden"));
    document.getElementById(`quizStep${currentStep}`).classList.remove("hidden");
    const titles = ["Step 1: Match Winner", "Step 2: Top Player", "Step 3: Top Expert"];
    document.getElementById("stepTitle").innerText = titles[currentStep - 1];
    if (currentStep === 3) document.getElementById("nextBtn").innerText = "FINISH";
}

async function finalizeQuiz() {
    userChoices.mvp = document.getElementById("mvpSelect").value;
    userChoices.expert = document.getElementById("userPredictSelect").value;

    const { error } = await supabase.from("user_predictions").upsert({
        user_id: currentUserId,
        match_id: currentMatchId,
        predicted_winner_id: userChoices.winner,
        predicted_mvp_id: userChoices.mvp,
        predicted_top_user_id: userChoices.expert
    });

    if (!error) {
        document.getElementById("quizActions").classList.add("hidden");
        document.querySelectorAll(".quiz-step").forEach((step) => step.classList.add("hidden"));
        document.getElementById("quizStepDone").classList.remove("hidden");
        document.getElementById("stepTitle").innerText = "Locked";
    }
}

function setupChatRealtime() {
    const drawer = document.getElementById("chatDrawer");
    document.getElementById("chatToggleBtn").onclick = () => { drawer.classList.toggle("drawer-hidden"); loadMessages(); };
    document.getElementById("closeChat").onclick = () => drawer.classList.add("drawer-hidden");
    document.getElementById("sendChatBtn").onclick = sendMessage;

    document.getElementById("btnGlobal").onclick = () => { activeChatType = "global"; switchTab("btnGlobal"); loadMessages(); };
    document.getElementById("btnLeague").onclick = () => { activeChatType = "league"; switchTab("btnLeague"); loadMessages(); };

    supabase.channel("game_chat").on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat" }, (payload) => {
        if (payload.new.league_id === (activeChatType === "global" ? null : userLeagueId)) {
            loadMessages();
        }
    }).subscribe();
}

async function sendMessage() {
    const input = document.getElementById("chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    await supabase.from("game_chat").insert({
        user_id: currentUserId,
        message: msg,
        league_id: activeChatType === "global" ? null : userLeagueId
    });
}

async function loadMessages() {
    let query = supabase.from("game_chat")
        .select("*, user_profiles(team_name)")
        .order("created_at", { ascending: false })
        .limit(20);

    query = activeChatType === "global"
        ? query.is("league_id", null)
        : query.eq("league_id", userLeagueId);

    const { data } = await query;
    const area = document.getElementById("chatMessages");
    if (!area) return;

    area.replaceChildren();
    (data || []).reverse().forEach((message) => {
        const row = document.createElement("div");
        const name = document.createElement("b");
        name.textContent = `${message.user_profiles?.team_name || "Expert"}: `;
        row.append(name, document.createTextNode(message.message || ""));
        area.appendChild(row);
    });
    area.scrollTop = area.scrollHeight;
}

function switchTab(id) {
    document.getElementById("btnGlobal").classList.remove("active");
    document.getElementById("btnLeague").classList.remove("active");
    document.getElementById(id).classList.add("active");
}

async function loadFeed() {
    const { data } = await supabase.from("social_feed").select("*, user_profiles(team_name)")
        .order("created_at", { ascending: false }).limit(15);
    const container = document.getElementById("feedContainer");
    if (!container) return;

    container.replaceChildren();
    (data || []).forEach((post) => {
        const card = document.createElement("div");
        card.className = "post-card";

        const user = document.createElement("span");
        user.className = "post-user";
        user.textContent = post.user_profiles?.team_name || "Expert";

        const content = document.createElement("p");
        content.className = "post-content";
        content.textContent = post.content || "";

        card.append(user, content);
        container.appendChild(card);
    });
}

document.getElementById("postFab").onclick = async () => {
    const txt = prompt("Sledge the community:");
    if (!txt) return;
    await supabase.from("social_feed").insert({ user_id: currentUserId, content: txt });
    loadFeed();
};

async function fetchNextMatch() {
    const { data: match } = await supabase.from("matches").select("*, team_a:real_teams!team_a_id(*), team_b:real_teams!team_b_id(*)")
        .eq("tournament_id", currentTournamentId).eq("status", "upcoming").order("actual_start_time", { ascending: true }).limit(1).maybeSingle();
    if (match) {
        currentMatchId = match.id;
        document.getElementById("winnerToggle").innerHTML = `
            <button class="team-option" onclick="pickWinner('${match.team_a.id}', this)">${match.team_a.short_code}</button>
            <button class="team-option" onclick="pickWinner('${match.team_b.id}', this)">${match.team_b.short_code}</button>`;

        const { data: players } = await supabase.from("players").select("id, name").in("real_team_id", [match.team_a.id, match.team_b.id]);
        const mvpSelect = document.getElementById("mvpSelect");
        mvpSelect.replaceChildren(createOption("", "Select MVP"));
        (players || []).forEach((player) => {
            mvpSelect.appendChild(createOption(player.id, player.name));
        });
    }
}

window.pickWinner = (id, btn) => {
    document.querySelectorAll(".team-option").forEach((button) => button.classList.remove("selected"));
    btn.classList.add("selected");
    userChoices.winner = id;
};

async function fetchExpertsList() {
    const { data } = await supabase.from("user_profiles").select("user_id, team_name").limit(30);
    const select = document.getElementById("userPredictSelect");
    if (!select) return;

    select.replaceChildren(createOption("", "Select Expert"));
    (data || []).forEach((expert) => {
        select.appendChild(createOption(expert.user_id, expert.team_name || "Expert"));
    });
}

async function fetchUserPredictionPoints() {
    const { data } = await supabase.from("user_predictions").select("points_earned").eq("user_id", currentUserId);
    document.getElementById("userPredictionScore").textContent = data?.reduce((total, row) => total + (row.points_earned || 0), 0) || 0;
}

async function checkExistingPrediction() {
    const { data } = await supabase.from("user_predictions").select("*").eq("user_id", currentUserId).eq("match_id", currentMatchId).maybeSingle();
    if (data) {
        document.getElementById("quizActions").classList.add("hidden");
        document.querySelectorAll(".quiz-step").forEach((step) => step.classList.add("hidden"));
        document.getElementById("quizStepDone").classList.remove("hidden");
        document.getElementById("stepTitle").innerText = "Locked";
    }
}

window.flipTo = (side) => document.getElementById("mainFlipCard").classList.toggle("flipped", side !== "front");
