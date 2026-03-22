import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

/* ─── DOM REFS ───────────────────────────────────────────────────────────── */
const matchesContainer      = document.getElementById("matchesContainer");
const matchCountSummaryText = document.getElementById("matchCountSummaryText");
const statusFiltersEl       = document.getElementById("statusFilters");
const teamFiltersEl         = document.getElementById("teamFilters");

/* ─── STATE ──────────────────────────────────────────────────────────────── */
let allMatches       = [];
let allTeams         = [];
let selectedStatuses = new Set(["all"]);
let selectedTeams    = new Set();

/* ─── INIT ───────────────────────────────────────────────────────────────── */
async function init() {
    // BUG FIX: authReady replaces direct getSession() call
    try { await authReady; } catch (_) { return; }
    await loadData();
    renderStatusFilters();
    renderTeamFilters();
    renderMatches();
}

init();

/* ─── DATA ───────────────────────────────────────────────────────────────── */
async function loadData() {
    // BUG FIX: .maybeSingle() — won't throw if no active tournament
    const { data: activeTournament } = await supabase
        .from("active_tournament").select("*").maybeSingle();

    if (!activeTournament) {
        matchesContainer.innerHTML = "";
        matchesContainer.appendChild(buildEmptyNode("No active tournament."));
        return;
    }

    const [mRes, tRes] = await Promise.all([
        supabase.from("matches")
            .select("*")
            .eq("tournament_id", activeTournament.id)
            .order("actual_start_time", { ascending: true }),
        supabase.from("real_teams")
            .select("*")
            .eq("tournament_id", activeTournament.id)
            .order("short_code", { ascending: true }),
    ]);

    allMatches = mRes.data || [];
    allTeams   = tRes.data || [];
}

/* ─── FILTERS ────────────────────────────────────────────────────────────── */
function renderStatusFilters() {
    statusFiltersEl.replaceChildren();
    const statuses = ["all", "upcoming", "locked", "abandoned"];
    const labels   = { all: "All", upcoming: "Upcoming", locked: "Locked", abandoned: "Abandoned" };

    statuses.forEach(s => {
        const chip       = document.createElement("button");
        chip.className   = `pill-filter ${selectedStatuses.has(s) ? "active" : ""}`;
        chip.textContent = labels[s];
        chip.onclick = () => {
            if (s === "all") {
                selectedStatuses = new Set(["all"]);
            } else {
                selectedStatuses.delete("all");
                selectedStatuses.has(s) ? selectedStatuses.delete(s) : selectedStatuses.add(s);
                if (selectedStatuses.size === 0) selectedStatuses.add("all");
            }
            renderStatusFilters();
            renderMatches();
        };
        statusFiltersEl.appendChild(chip);
    });
}

function renderTeamFilters() {
    teamFiltersEl.replaceChildren();
    allTeams.forEach(t => {
        const chip       = document.createElement("button");
        chip.className   = `pill-filter ${selectedTeams.has(t.id) ? "active" : ""}`;
        chip.textContent = t.short_code;   // safe: short_code is a code string
        chip.onclick = () => {
            selectedTeams.has(t.id) ? selectedTeams.delete(t.id) : selectedTeams.add(t.id);
            renderTeamFilters();
            renderMatches();
        };
        teamFiltersEl.appendChild(chip);
    });
}

/* ─── RENDER MATCHES ─────────────────────────────────────────────────────── */
function renderMatches() {
    matchesContainer.replaceChildren();

    const filtered = allMatches.filter(m => {
        const sMatch = selectedStatuses.has("all") || selectedStatuses.has(m.status);
        const tMatch = selectedTeams.size === 0
            || selectedTeams.has(m.team_a_id)
            || selectedTeams.has(m.team_b_id);
        return sMatch && tMatch;
    });

    if (matchCountSummaryText) {
        matchCountSummaryText.textContent =
            `${filtered.length} match${filtered.length !== 1 ? "es" : ""}`;
    }

    if (!filtered.length) {
        matchesContainer.appendChild(buildEmptyNode("No matches match this filter."));
        return;
    }

    // Three groups:
    // 1. LIVE — locked but points not yet processed
    // 2. Upcoming — soonest first
    // 3. Results — locked + points processed, or abandoned
    const live     = sorted.filter(m => m.status === "locked" && !m.points_processed);
    const upcoming = sorted.filter(m => m.status === "upcoming");
    const results  = sorted.filter(m =>
        (m.status === "locked" && m.points_processed) || m.status === "abandoned"
    );

    // Sort upcoming soonest first, results most recent first
    upcoming.sort((a, b) => new Date(a.actual_start_time) - new Date(b.actual_start_time));
    results.sort((a, b) => new Date(b.actual_start_time) - new Date(a.actual_start_time));

    if (live.length) {
        matchesContainer.appendChild(buildGroupHeader("🔴 Live"));
        live.forEach(m => matchesContainer.appendChild(buildMatchCard(m)));
    }
    if (upcoming.length) {
        matchesContainer.appendChild(buildGroupHeader("Upcoming"));
        upcoming.forEach(m => matchesContainer.appendChild(buildMatchCard(m)));
    }
    if (results.length) {
        matchesContainer.appendChild(buildGroupHeader("Results"));
        results.forEach(m => matchesContainer.appendChild(buildMatchCard(m)));
    }
}

/* ─── MATCH CARD ─────────────────────────────────────────────────────────── */
function buildMatchCard(match) {
    const tA     = allTeams.find(t => t.id === match.team_a_id);
    const tB     = allTeams.find(t => t.id === match.team_b_id);
    const logoA  = getLogoUrl(tA);
    const logoB  = getLogoUrl(tB);

    const dateStr = new Date(match.actual_start_time).toLocaleString("en-IN", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });

    // Card
    const card     = document.createElement("article");
    card.className = `match-card status-${match.status}`;
    card.style.cursor = "pointer";
card.onclick = () => window.open("https://crex.com/live-matches", "_blank");

    // Top accent bar — avoids border-left + border-radius conflict
    const bar      = document.createElement("div");
    bar.className  = "match-accent-bar";
    card.appendChild(bar);

    // Inner padding wrapper
    const inner    = document.createElement("div");
    inner.className = "match-inner";

    // ── Meta row ──
    const meta     = document.createElement("div");
    meta.className = "match-meta";

    const num      = document.createElement("span");
    num.className  = "match-num";
    num.textContent = `Match#${match.match_number}`;

    const dateEl   = document.createElement("span");
    dateEl.className = "match-date";
    dateEl.textContent = dateStr;

    meta.append(num, dateEl);

    // ── Teams row ──
    const teamsRow = document.createElement("div");
    teamsRow.className = "match-teams";

    teamsRow.appendChild(buildTeamSlot(tA, logoA));

    const vs       = document.createElement("div");
    vs.className   = "match-vs";
    vs.textContent = "VS";
    teamsRow.appendChild(vs);

    teamsRow.appendChild(buildTeamSlot(tB, logoB));

    // ── Venue ──
    const venue    = document.createElement("div");
    venue.className = "match-venue";

    const icon     = document.createElement("i");
    icon.className = "fas fa-map-marker-alt";

    const venueText = document.createElement("span");
    // BUG FIX: textContent (not innerHTML) — venue is user-entered DB data
    venueText.textContent = match.venue ? escapeHtml(match.venue) : "Venue TBA";

    venue.append(icon, venueText);

    // ── Status chip ──
    const chip     = document.createElement("span");
    const isLive   = match.status === "locked" && !match.points_processed;
    chip.className = `status-chip ${isLive ? "chip-live" : `chip-${match.status}`}`;
    chip.textContent = isLive ? "LIVE" : match.status.toUpperCase();
    if (isLive) {
        chip.innerHTML = `<span class="live-dot"></span> LIVE`;
    }
    inner.append(meta, teamsRow, venue, chip);
    card.appendChild(inner);
    return card;
}

function buildTeamSlot(team, logoUrl) {
    const slot     = document.createElement("div");
    slot.className = "team-slot";

    const logo     = document.createElement("div");
    logo.className = "team-logo-circle";

    if (logoUrl) {
        logo.style.backgroundImage = `url('${logoUrl}')`;
    } else {
        logo.textContent = team?.short_code?.slice(0, 3) || "?";
    }

    const name     = document.createElement("span");
    name.className = "team-name";
    name.textContent = team?.short_code || "TBA";   // safe: integer/code from DB

    slot.append(logo, name);
    return slot;
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function getLogoUrl(team) {
    return team?.photo_name
        ? supabase.storage.from("team-logos").getPublicUrl(team.photo_name).data.publicUrl
        : null;
}

function buildGroupHeader(text) {
    const el       = document.createElement("h2");
    el.className   = "group-header";
    el.textContent = text;
    return el;
}

function buildEmptyNode(text) {
    const wrap     = document.createElement("div");
    wrap.className = "empty-state";

    const icon     = document.createElement("i");
    icon.className = "fas fa-calendar-times";

    const p        = document.createElement("p");
    p.textContent  = text;

    wrap.append(icon, p);
    return wrap;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&",  "&amp;")
        .replaceAll("<",  "&lt;")
        .replaceAll(">",  "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'",  "&#39;");
}