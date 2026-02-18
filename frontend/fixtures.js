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

  // Toggle Dropdowns
  statusBtn.onclick = (e) => { e.stopPropagation(); statusPanel.classList.toggle("hidden"); teamPanel.classList.add("hidden"); };
  teamBtn.onclick = (e) => { e.stopPropagation(); teamPanel.classList.toggle("hidden"); statusPanel.classList.add("hidden"); };
  document.onclick = () => { statusPanel.classList.add("hidden"); teamPanel.classList.add("hidden"); };

  await loadData();
  renderStatusFilters();
  renderTeamFilters();
  renderMatches();
}

async function loadData() {
  const { data: activeTournament } = await supabase.from("active_tournament").select("*").single();
  if (!activeTournament) return;

  const [mRes, tRes] = await Promise.all([
    supabase.from("matches").select("*").eq("tournament_id", activeTournament.id).order("actual_start_time", { ascending: true }),
    supabase.from("real_teams").select("*").eq("tournament_id", activeTournament.id)
  ]);

  allMatches = mRes.data || [];
  allTeams = tRes.data || [];
}

function renderStatusFilters() {
  const statuses = ["all", "upcoming", "locked", "completed", "abandoned"];
  statusFiltersContainer.innerHTML = statuses.map(s => `
    <div class="filter-chip ${selectedStatuses.has(s) ? 'active' : ''}" data-status="${s}">
      ${s === 'all' ? 'All Status' : s.toUpperCase()}
    </div>
  `).join('');

  statusFiltersContainer.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = () => {
      const s = chip.dataset.status;
      if (s === "all") selectedStatuses = new Set(["all"]);
      else {
        selectedStatuses.delete("all");
        selectedStatuses.has(s) ? selectedStatuses.delete(s) : selectedStatuses.add(s);
        if (selectedStatuses.size === 0) selectedStatuses.add("all");
      }
      renderStatusFilters();
      renderMatches();
    };
  });
}

function renderTeamFilters() {
  teamFiltersContainer.innerHTML = allTeams.map(t => `
    <div class="filter-chip ${selectedTeams.has(t.id) ? 'active' : ''}" data-id="${t.id}">
      ${t.short_code}
    </div>
  `).join('');

  teamFiltersContainer.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = () => {
      const id = chip.dataset.id;
      selectedTeams.has(id) ? selectedTeams.delete(id) : selectedTeams.add(id);
      renderTeamFilters();
      renderMatches();
    };
  });
}

function renderMatches() {
  matchesContainer.innerHTML = "";
  
  const filtered = allMatches.filter(m => {
    const sMatch = selectedStatuses.has("all") || selectedStatuses.has(m.status);
    const tMatch = selectedTeams.size === 0 || selectedTeams.has(m.team_a_id) || selectedTeams.has(m.team_b_id);
    return sMatch && tMatch;
  });

  matchCountSummaryText.innerText = `Showing ${filtered.length} matches`;

  if (!filtered.length) {
    matchesContainer.innerHTML = `<div class="loading-state"><p>No matches found.</p></div>`;
    return;
  }

  const lastLocked = allMatches
    .filter(m => m.status === 'locked')
    .sort((a, b) => new Date(b.actual_start_time) - new Date(a.actual_start_time))[0];

  const sorted = [...filtered].sort((a, b) => {
    if (lastLocked && a.id === lastLocked.id) return -1;
    if (lastLocked && b.id === lastLocked.id) return 1;
    if (a.status === 'upcoming' && b.status !== 'upcoming') return -1;
    if (b.status === 'upcoming' && a.status !== 'upcoming') return 1;
    if (a.status === 'upcoming' && b.status === 'upcoming') {
        return new Date(a.actual_start_time) - new Date(b.actual_start_time);
    }
    return new Date(b.actual_start_time) - new Date(a.actual_start_time);
  });

  sorted.forEach(match => {
    const tA = allTeams.find(t => t.id === match.team_a_id);
    const tB = allTeams.find(t => t.id === match.team_b_id);
    
    // --- DYNAMIC LOGO LOGIC ---
    const getLogoStyle = (team) => {
      if (team && team.photo_name) {
        const { data } = supabase.storage.from('team-logos').getPublicUrl(team.photo_name);
        return `style="background-image: url('${data.publicUrl}'); background-size: contain; background-repeat: no-repeat; background-position: center;"`;
      }
      return '';
    };

    const logoA = getLogoStyle(tA);
    const logoB = getLogoStyle(tB);

    const date = new Date(match.actual_start_time).toLocaleString('en-IN', { 
        day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' 
    });

    const card = document.createElement("div");
    card.className = `match-card status-${match.status}`;
    
    const isLatestHighlight = lastLocked && match.id === lastLocked.id;
    const highlightLabel = isLatestHighlight ? `<span style="font-size: 10px; color: #f59e0b; margin-left: 10px;">• RECENTLY LOCKED</span>` : '';

    card.innerHTML = `
      <div class="card-header">
        <span>${date} ${highlightLabel}</span>
        <i class="fas fa-info-circle"></i>
      </div>
      <div class="team-display">
        <div class="team-slot">
            <div class="team-logo" ${logoA}>${!logoA ? (tA?.short_code || '?') : ''}</div>
            <b>${tA?.short_code || 'TBA'}</b>
        </div>
        <div class="vs-badge">VS</div>
        <div class="team-slot">
            <div class="team-logo" ${logoB}>${!logoB ? (tB?.short_code || '?') : ''}</div>
            <b>${tB?.short_code || 'TBA'}</b>
        </div>
      </div>
      <div class="status-tag tag-${match.status}">${match.status.toUpperCase()}</div>
    `;
    matchesContainer.appendChild(card);
  });
}