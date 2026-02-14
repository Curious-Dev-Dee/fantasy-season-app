import { supabase } from "./supabase.js";

/* ================= CONFIGURATION ================= */
const TOURNAMENT_ID = "e0416509-f082-4c11-8277-ec351bdc046d";
const RULES = {
    MAX_PLAYERS: 11,
    MAX_CREDITS: 100,
    MAX_FROM_TEAM: 10 // Adjust based on league rules
};

/* ================= APP STATE ================= */
let allPlayers = [];
let selectedPlayers = [];
let captainId = null;
let viceCaptainId = null;
let filters = { search: "", role: "ALL" };

/* ================= DOM ELEMENTS ================= */
const myXIList = document.getElementById("myXIList");
const playerPoolList = document.getElementById("playerPool");
const mainSaveBtn = document.getElementById("mainSaveBtn");
const playerCountText = document.getElementById("playerCount");
const creditCountText = document.getElementById("creditCount");
const progressFill = document.getElementById("progressFill");
const searchInput = document.getElementById("playerSearch");

/* ================= INITIALIZATION ================= */
async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await fetchAllPlayers();
    await fetchSavedTeam(user.id);
    renderAll();
}

async function fetchAllPlayers() {
    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("is_active", true);
    
    if (error) console.error("Error fetching players:", error);
    allPlayers = data || [];
}

async function fetchSavedTeam(userId) {
    const { data: team } = await supabase
        .from("user_fantasy_teams")
        .select("*, user_fantasy_team_players(player_id)")
        .eq("user_id", userId)
        .eq("tournament_id", TOURNAMENT_ID)
        .maybeSingle();

    if (team) {
        captainId = team.captain_id;
        viceCaptainId = team.vice_captain_id;
        // Map player IDs to full player objects from allPlayers
        selectedPlayers = (team.user_fantasy_team_players || [])
            .map(item => allPlayers.find(p => p.id === item.player_id))
            .filter(Boolean);
    }
}

/* ================= RENDER LOGIC ================= */
function renderAll() {
    renderMyXI();
    renderPool();
    updateSummary();
}

function updateSummary() {
    const currentCount = selectedPlayers.length;
    const currentCredits = selectedPlayers.reduce((sum, p) => sum + Number(p.credit), 0);

    playerCountText.textContent = currentCount;
    creditCountText.textContent = currentCredits;
    progressFill.style.width = `${(currentCount / RULES.MAX_PLAYERS) * 100}%`;

    // Enable Save Button only if team is valid
    const isTeamComplete = currentCount === RULES.MAX_PLAYERS;
    const hasCaptaincy = captainId !== null && viceCaptainId !== null;
    mainSaveBtn.disabled = !(isTeamComplete && hasCaptaincy);
}

function renderMyXI() {
    myXIList.innerHTML = "";
    if (selectedPlayers.length === 0) {
        myXIList.innerHTML = `<div style="text-align:center; padding:50px; color:#64748b;">No players selected.</div>`;
        return;
    }

    selectedPlayers.forEach(player => {
        const initials = player.name.split(" ").map(n => n[0]).join("").toUpperCase();
        const card = document.createElement("div");
        card.className = "player-card selected";
        card.innerHTML = `
            <div class="avatar">${initials}</div>
            <div class="info">
                <h4>${player.name}</h4>
                <div class="cv-group">
                    <button class="cv-btn ${captainId === player.id ? 'active' : ''}" data-id="${player.id}" data-role="C">C</button>
                    <button class="cv-btn ${viceCaptainId === player.id ? 'active' : ''}" data-id="${player.id}" data-role="VC">VC</button>
                </div>
            </div>
            <button class="circle-btn remove">−</</button>
        `;

        card.querySelector('[data-role="C"]').onclick = () => setCaptaincy(player.id, 'C');
        card.querySelector('[data-role="VC"]').onclick = () => setCaptaincy(player.id, 'VC');
        card.querySelector('.remove').onclick = () => removePlayer(player.id);
        
        myXIList.appendChild(card);
    });
}

function renderPool() {
    playerPoolList.innerHTML = "";
    const filtered = allPlayers.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(filters.search.toLowerCase());
        const matchesRole = filters.role === "ALL" || p.role === filters.role;
        return matchesSearch && matchesRole;
    });

    filtered.forEach(player => {
        const isSelected = selectedPlayers.some(p => p.id === player.id);
        const initials = player.name.split(" ").map(n => n[0]).join("").toUpperCase();
        
        const card = document.createElement("div");
        card.className = `player-card ${isSelected ? 'selected' : ''}`;
        card.innerHTML = `
            <div class="avatar">${initials}</div>
            <div class="info">
                <h4>${player.name}</h4>
                <p>${player.role} • ${player.credit} cr</p>
            </div>
            <button class="circle-btn ${isSelected ? 'remove' : 'add'}" 
                ${!isSelected && selectedPlayers.length >= RULES.MAX_PLAYERS ? 'disabled' : ''}>
                ${isSelected ? '−' : '+'}
            </button>
        `;

        card.querySelector('button').onclick = () => isSelected ? removePlayer(player.id) : addPlayer(player);
        playerPoolList.appendChild(card);
    });
}

/* ================= ACTIONS ================= */
function addPlayer(player) {
    const totalCredits = selectedPlayers.reduce((sum, p) => sum + Number(p.credit), 0);
    if (totalCredits + Number(player.credit) > RULES.MAX_CREDITS) {
        alert("Insufficient Credits!");
        return;
    }
    selectedPlayers.push(player);
    renderAll();
}

function removePlayer(playerId) {
    selectedPlayers = selectedPlayers.filter(p => p.id !== playerId);
    if (captainId === playerId) captainId = null;
    if (viceCaptainId === playerId) viceCaptainId = null;
    renderAll();
}

function setCaptaincy(playerId, type) {
    if (type === 'C') {
        if (viceCaptainId === playerId) viceCaptainId = null;
        captainId = playerId;
    } else {
        if (captainId === playerId) captainId = null;
        viceCaptainId = playerId;
    }
    renderAll();
}

/* ================= EVENTS ================= */
searchInput.addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderPool();
});

document.querySelectorAll(".role-filter-btn").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll(".role-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        filters.role = btn.dataset.role;
        renderPool();
    };
});

mainSaveBtn.onclick = async () => {
    mainSaveBtn.textContent = "SAVING...";
    mainSaveBtn.disabled = true;

    const { data: { user } } = await supabase.auth.getUser();
    const totalCreditsUsed = selectedPlayers.reduce((sum, p) => sum + Number(p.credit), 0);

    try {
        // 1. Upsert Team Record
        const { data: team, error: teamError } = await supabase
            .from("user_fantasy_teams")
            .upsert({
                user_id: user.id,
                tournament_id: TOURNAMENT_ID,
                captain_id: captainId,
                vice_captain_id: viceCaptainId,
                total_credits: totalCreditsUsed
            })
            .select()
            .single();

        if (teamError) throw teamError;

        // 2. Clear previous players for this team
        await supabase
            .from("user_fantasy_team_players")
            .delete()
            .eq("user_fantasy_team_id", team.id);

        // 3. Insert new selection
        const playerEntries = selectedPlayers.map(p => ({
            user_fantasy_team_id: team.id,
            player_id: p.id
        }));

        const { error: playersError } = await supabase
            .from("user_fantasy_team_players")
            .insert(playerEntries);

        if (playersError) throw playersError;

        mainSaveBtn.textContent = "SAVED ✓";
        setTimeout(() => {
            mainSaveBtn.textContent = "SAVE TEAM";
            mainSaveBtn.disabled = false;
        }, 2000);

    } catch (err) {
        console.error(err);
        alert("Failed to save team. Please try again.");
        mainSaveBtn.textContent = "SAVE TEAM";
        mainSaveBtn.disabled = false;
    }
};

// Start App
init();