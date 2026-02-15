import { supabase } from "./supabase.js";

const searchInput = document.getElementById("playerSearch");
const teamFilter = document.getElementById("teamFilter");
const statsContainer = document.getElementById("statsContainer");
const loader = document.getElementById("loadingOverlay");

async function initStats() {
    // 1. Load Team Filter Options
    const { data: teams } = await supabase.from('real_teams').select('short_code');
    if (teams) {
        teamFilter.innerHTML += teams.map(t => `<option value="${t.short_code}">${t.short_code}</option>`).join('');
    }

    // 2. Initial Load
    await loadPlayerStats();
}

async function loadPlayerStats() {
    loader.style.display = "block";
    const searchTerm = searchInput.value.toLowerCase();
    const team = teamFilter.value;

    // We pull from the VIEW we created in SQL
    let query = supabase
        .from('player_performance_audit')
        .select('*')
        .order('match_number', { ascending: false });

    if (team) query = query.eq('team_code', team);
    
    const { data: stats, error } = await query;

    if (error) {
        console.error("Error fetching stats:", error);
        return;
    }

    // Filter by name in JS for instant responsiveness
    const filtered = stats.filter(s => s.player_name.toLowerCase().includes(searchTerm));

    renderStats(filtered);
    loader.style.display = "none";
}

function renderStats(data) {
    if (data.length === 0) {
        statsContainer.innerHTML = `<div class="no-results">No players found matching your criteria.</div>`;
        return;
    }

    // Grouping match data by player_id
    const grouped = data.reduce((acc, curr) => {
        if (!acc[curr.player_id]) {
            acc[curr.player_id] = {
                name: curr.player_name,
                team: curr.team_code,
                matches: []
            };
        }
        acc[curr.player_id].matches.push(curr);
        return acc;
    }, {});

    statsContainer.innerHTML = Object.values(grouped).map(player => {
        const totalPoints = player.matches.reduce((sum, m) => sum + m.match_total_points, 0);
        
        return `
        <div class="player-card">
            <div class="player-header" onclick="this.parentElement.classList.toggle('active')">
                <div class="player-info">
                    <span class="team-tag">${player.team}</span>
                    <span class="player-name">${player.name}</span>
                </div>
                <div class="player-total">
                    <strong>${totalPoints} pts</strong>
                    <span class="expand-icon">▼</span>
                </div>
            </div>
            <div class="match-history">
                ${player.matches.map(m => `
                    <div class="history-row">
                        <div class="match-meta">
                            <strong>Match ${m.match_number}</strong>
                            <span class="match-pts">+${m.match_total_points} pts</span>
                        </div>
                        <div class="breakdown">
                            ${m.runs > 0 ? `<span>Runs: <strong>${m.runs}</strong>(${m.balls})</span>` : ''}
                            ${m.wickets > 0 ? `<span>Wkts: <strong>${m.wickets}</strong></span>` : ''}
                            ${m.catches > 0 ? `<span>Catches: <strong>${m.catches}</strong></span>` : ''}
                            ${m.stumpings > 0 ? `<span>Stumpings: <strong>${m.stumpings}</strong></span>` : ''}
                            ${m.maidens > 0 ? `<span>Maiden: <strong>${m.maidens}</strong></span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        `;
    }).join('');
}

// Event Listeners for Live Search
searchInput.addEventListener("input", loadPlayerStats);
teamFilter.addEventListener("change", loadPlayerStats);

initStats();