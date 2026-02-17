import { supabase } from "./supabase.js";

const matchesContainer = document.getElementById("matchesContainer");
const statusFiltersContainer = document.getElementById("statusFilters");
const teamFiltersContainer = document.getElementById("teamFilters");
const matchCountSummaryText = document.getElementById("matchCountSummaryText");

const statusBtn = document.getElementById("statusBtn");
const teamBtn = document.getElementById("teamBtn");
const statusPanel = document.getElementById("statusPanel");
const teamPanel = document.getElementById("teamPanel");

let allMatches = [];
let allTeams = [];
let selectedStatuses = new Set(["all"]);
let selectedTeams = new Set();

init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }

  await loadData();
  renderStatusFilters();
  renderTeamFilters();
  renderMatches();
}

async function loadData() {
  const { data: activeTournament } = await supabase.from("active_tournament").select("*").single();
  if (!activeTournament) { matchesContainer.textContent = "No active tournament."; return; }

  const tournamentId = activeTournament.id;

  const [mRes, tRes] = await Promise.all([
    supabase.from("matches").select("*").eq("tournament_id", tournamentId).order("actual_start_time", { ascending: true }),
    supabase.from("real_teams").select("*").eq("tournament_id", tournamentId)
  ]);

  allMatches = mRes.data || [];
  allTeams = tRes.data || [];
}

// ... Dropdown behavior remains same ...

function renderStatusFilters() {
  const statuses = ["all", "upcoming", "locked", "completed", "abandoned"];
  statusFiltersContainer.innerHTML = "";
  statuses.forEach(status => {
    const chip = document.createElement("div");
    chip.className = `filter-chip ${selectedStatuses.has(status) ? 'active' : ''}`;
    chip.textContent = status === "all" ? "All Status" : status.charAt(0).toUpperCase() + status.slice(1);
    chip.onclick = () => {
      if (status === "all") { selectedStatuses = new Set(["all"]); } 
      else {
        selectedStatuses.delete("all");
        selectedStatuses.has(status) ? selectedStatuses.delete(status) : selectedStatuses.add(status);
        if (selectedStatuses.size === 0) selectedStatuses.add("all");
      }
      renderStatusFilters();
      renderMatches();
    };
    statusFiltersContainer.appendChild(chip);
  });
}

function renderTeamFilters() {
  teamFiltersContainer.innerHTML = "";
  allTeams.forEach(team => {
    const chip = document.createElement("div");
    chip.className = `filter-chip ${selectedTeams.has(team.id) ? 'active' : ''}`;
    chip.textContent = team.short_code;
    chip.onclick = () => {
      selectedTeams.has(team.id) ? selectedTeams.delete(team.id) : selectedTeams.add(team.id);
      renderTeamFilters();
      renderMatches();
    };
    teamFiltersContainer.appendChild(chip);
  });
}

function renderMatches() {
  matchesContainer.innerHTML = "";
  let filtered = allMatches.filter(m => {
    const statusMatch = selectedStatuses.has("all") || selectedStatuses.has(m.status);
    const teamMatch = selectedTeams.size === 0 || selectedTeams.has(m.team_a_id) || selectedTeams.has(m.team_b_id);
    return statusMatch && teamMatch;
  });

  matchCountSummaryText.innerText = `Showing ${filtered.length} matches`;

  if (filtered.length === 0) {
    matchesContainer.innerHTML = `<div class="loading-state"><p>No matches found for these filters.</p></div>`;
    return;
  }

  filtered.forEach(match => {
    const tA = allTeams.find(t => t.id === match.team_a_id);
    const tB = allTeams.find(t => t.id === match.team_b_id);
    const date = new Date(match.actual_start_time).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

    const card = document.createElement("div");
    card.className = `match-card status-${match.status}`;
    card.innerHTML = `
      <div class="card-header">
        <span class="match-date">${date}</span>
        <i class="fas fa-info-circle" style="color: #475569"></i>
      </div>
      <div class="team-display">
        <div class="team-slot">
            <div class="team-logo-circle">${tA?.short_code || '?'}</div>
            <span style="font-size: 13px; font-weight: 600;">${tA?.short_code || 'TBA'}</span>
        </div>
        <div class="vs-badge">VS</div>
        <div class="team-slot">
            <div class="team-logo-circle">${tB?.short_code || '?'}</div>
            <span style="font-size: 13px; font-weight: 600;">${tB?.short_code || 'TBA'}</span>
        </div>
      </div>
      <div class="match-footer">
        <div class="status-tag tag-${match.status}">${match.status.toUpperCase()}</div>
      </div>
    `;
    matchesContainer.appendChild(card);
  });
}