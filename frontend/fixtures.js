import { supabase } from "./supabase.js";

/* =========================
   ELEMENTS
========================= */
const matchesContainer = document.getElementById("matchesContainer");
const statusFiltersContainer = document.getElementById("statusFilters");
const teamFiltersContainer = document.getElementById("teamFilters");

const statusBtn = document.getElementById("statusBtn");
const teamBtn = document.getElementById("teamBtn");
const statusPanel = document.getElementById("statusPanel");
const teamPanel = document.getElementById("teamPanel");

let allMatches = [];
let allTeams = [];

let selectedStatuses = new Set(["all"]);
let selectedTeams = new Set();

/* =========================
   INIT
========================= */
init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  await loadData();
  renderStatusFilters();
  renderTeamFilters();
  renderMatches();
}

/* =========================
   LOAD DATA
========================= */
async function loadData() {
  const { data: activeTournament } = await supabase
    .from("active_tournament")
    .select("*")
    .single();

  if (!activeTournament) {
    matchesContainer.textContent = "No active tournament.";
    return;
  }

  const tournamentId = activeTournament.id;

  // FIX: Using actual_start_time instead of start_time
  const { data: matches } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("actual_start_time", { ascending: true });

  const { data: teams } = await supabase
    .from("real_teams")
    .select("*")
    .eq("tournament_id", tournamentId);

  allMatches = matches || [];
  allTeams = teams || [];
}

/* =========================
   DROPDOWN BEHAVIOR
========================= */
statusBtn.addEventListener("click", () => {
  statusPanel.classList.toggle("hidden");
  teamPanel.classList.add("hidden");
});

teamBtn.addEventListener("click", () => {
  teamPanel.classList.toggle("hidden");
  statusPanel.classList.add("hidden");
});

document.addEventListener("click", (e) => {
  const isStatusClick = statusBtn.contains(e.target) || statusPanel.contains(e.target);
  const isTeamClick = teamBtn.contains(e.target) || teamPanel.contains(e.target);

  if (!isStatusClick) statusPanel.classList.add("hidden");
  if (!isTeamClick) teamPanel.classList.add("hidden");
});

/* =========================
   STATUS FILTERS
========================= */
function renderStatusFilters() {
  const statuses = ["all", "upcoming", "locked", "completed", "abandoned"];
  statusFiltersContainer.innerHTML = "";

  statuses.forEach(status => {
    const chip = document.createElement("div");
    chip.classList.add("filter-chip");
    if (selectedStatuses.has(status)) chip.classList.add("active");

    chip.textContent = status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1);

    chip.addEventListener("click", () => {
      if (status === "all") {
        selectedStatuses = new Set(["all"]);
      } else {
        selectedStatuses.delete("all");
        if (selectedStatuses.has(status)) selectedStatuses.delete(status);
        else selectedStatuses.add(status);
        if (selectedStatuses.size === 0) selectedStatuses.add("all");
      }
      renderStatusFilters();
      renderMatches();
    });
    statusFiltersContainer.appendChild(chip);
  });
}

/* =========================
   TEAM FILTERS
========================= */
function renderTeamFilters() {
  teamFiltersContainer.innerHTML = "";
  allTeams.forEach(team => {
    const chip = document.createElement("div");
    chip.classList.add("filter-chip");
    if (selectedTeams.has(team.id)) chip.classList.add("active");

    chip.textContent = team.short_code;

    chip.addEventListener("click", () => {
      if (selectedTeams.has(team.id)) selectedTeams.delete(team.id);
      else selectedTeams.add(team.id);
      renderTeamFilters();
      renderMatches();
    });
    teamFiltersContainer.appendChild(chip);
  });
}

/* =========================
   MATCH RENDER
========================= */
function renderMatches() {
  matchesContainer.innerHTML = "";
  let filtered = [...allMatches];

  if (!selectedStatuses.has("all")) {
    filtered = filtered.filter(match => selectedStatuses.has(match.status));
  }

  if (selectedTeams.size > 0) {
    filtered = filtered.filter(match => selectedTeams.has(match.team_a_id) || selectedTeams.has(match.team_b_id));
  }

  if (filtered.length === 0) {
    matchesContainer.textContent = "No matches found.";
    return;
  }

  filtered.forEach(match => {
    const teamA = allTeams.find(t => t.id === match.team_a_id);
    const teamB = allTeams.find(t => t.id === match.team_b_id);

    const card = document.createElement("div");
    card.classList.add("match-card");

    // FIX: Using actual_start_time instead of start_time
    const readableDate = new Date(match.actual_start_time)
      .toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });

    card.innerHTML = `
      <div class="match-teams">
        ${teamA?.short_code || "?"} vs ${teamB?.short_code || "?"}
      </div>
      <div class="match-time">${readableDate}</div>
      <div class="match-status status-${match.status}">
        ${match.status.charAt(0).toUpperCase() + match.status.slice(1)}
      </div>
    `;
    matchesContainer.appendChild(card);
  });
}