import { supabase } from "./supabase.js";

// Your fixed Config
const TOURNAMENT_ID = "11111111-1111-1111-1111-111111111111";

let state = { 
    allPlayers: [], 
    selectedPlayers: [], 
    lockedPlayerIds: [], // Used to track who was already in the team (for sub calculation)
    baseSubsRemaining: 150, 
    matches: [],
    captainId: null, 
    viceCaptainId: null,
    filters: { search: "", role: "ALL", teams: [], credits: [], matches: [] },
    saving: false 
};

// 1. APP INITIALIZATION
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    init(user);
});

async function init(user) {
    try {
        // Fetch All Data in Parallel
        const [players, dash, currentTeam, upcomingMatches] = await Promise.all([
            supabase.from("player_pool_view").select("*").eq("is_active", true),
            supabase.from("home_dashboard_view").select("subs_remaining").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_fantasy_teams").select("*, user_fantasy_team_players(player_id)").eq("user_id", user.id).maybeSingle(),
            supabase.from("matches").select("*, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)").eq("status", "upcoming").limit(1)
        ]);

        state.allPlayers = players.data || [];
        state.baseSubsRemaining = dash.data?.subs_remaining ?? 150;
        
        if (upcomingMatches.data?.length > 0) {
            updateHeaderMatch(upcomingMatches.data[0]);
        }

        if (currentTeam.data) {
            state.captainId = currentTeam.data.captain_id;
            state.viceCaptainId = currentTeam.data.vice_captain_id;
            const savedIds = currentTeam.data.user_fantasy_team_players.map(row => row.player_id);
            state.selectedPlayers = state.allPlayers.filter(p => savedIds.includes(p.id));
            state.lockedPlayerIds = [...savedIds]; // Mark currently saved players as "Locked"
        }

        render();
        setupListeners();
        document.body.classList.add('loaded'); // Reveal the app
    } catch (err) {
        console.error("Init Error:", err);
    }
}

// 2. CORE RENDER LOGIC
function render() {
    // Sub Calculation: Any selected player who WAS NOT in the locked list counts as a sub
    const subsUsed = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
    const currentSubsLeft = state.baseSubsRemaining - subsUsed;

    // Update Progress Bar & Labels
    document.getElementById("playerCountLabel").innerText = state.selectedPlayers.length;
    document.getElementById("progressFill").style.width = `${(state.selectedPlayers.length / 11) * 100}%`;
    document.getElementById("subsRemainingLabel").innerText = currentSubsLeft;

    // Render Lists
    renderList("playerPoolList", state.allPlayers.filter(p => {
        return p.name.toLowerCase().includes(state.filters.search.toLowerCase()) &&
               (state.filters.role === "ALL" || p.role === state.filters.role);
    }));

    // Update Save Button Text & State
    const saveBtn = document.getElementById("saveTeamBtn");
    const isValid = state.selectedPlayers.length === 11 && state.captainId && state.viceCaptainId && currentSubsLeft >= 0;
    saveBtn.disabled = !isValid;
}

// 3. SUCCESS MODAL LOGIC
function showSuccessModal(matchName, subsUsed, subsRemaining) {
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "success-modal-overlay";
    
    modalOverlay.innerHTML = `
        <div class="success-modal">
            <h2>Team Saved!</h2>
            <p>Successfully updated for <strong>${matchName}</strong>.</p>
            <p>Subs Used: <strong>${subsUsed}</strong><br>Remaining: <strong>${subsRemaining}</strong></p>
            <div class="modal-btn-group">
                <button class="m-btn home" onclick="window.location.href='home.html'">GO TO HOME</button>
                <button class="m-btn edit" id="closeModal">CHANGE AGAIN</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);
    document.getElementById("closeModal").onclick = () => modalOverlay.remove();
}

// 4. SAVE ACTION
async function handleSave() {
    state.saving = true; render();
    const { data: { user } } = await supabase.auth.getUser();
    
    // Save to Supabase (Simplified logic)
    const { data: team } = await supabase.from("user_fantasy_teams").upsert({
        user_id: user.id, tournament_id: TOURNAMENT_ID,
        captain_id: state.captainId, vice_captain_id: state.viceCaptainId
    }).select().single();

    if (team) {
        // Trigger Popup
        const matchName = document.getElementById("upcomingMatchName").innerText;
        const subsUsed = state.selectedPlayers.filter(p => !state.lockedPlayerIds.includes(p.id)).length;
        const subsLeft = state.baseSubsRemaining - subsUsed;

        showSuccessModal(matchName, subsUsed, subsLeft);
    }
    state.saving = false; render();
}

// 5. LISTENERS
function setupListeners() {
    // Role Switching with Slider
    document.querySelectorAll(".role-tab").forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active"); // Moves neon bar via CSS
            state.filters.role = tab.dataset.role;
            render();
        };
    });

    // View Switching
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".view-mode").forEach(v => v.classList.remove("active"));
            document.getElementById(`${btn.dataset.mode}-view`).classList.add("active");
        };
    });

    document.getElementById("saveTeamBtn").onclick = handleSave;
}