import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { initNotificationHub } from "./notifications.js";
import { getEffectiveRank, applyRankFlair } from "./animations.js";

let activeTournamentId      = null;
let currentUserId           = null;
let existingProfile         = null;
let countdownInterval       = null;
let currentUserOverallRank  = Infinity;
let currentUserPrivateRank  = Infinity;
let pointsChannel           = null;
let matchChannel            = null;
let notifChannel            = null;
let navChannel    = null;   // ← add this

const senderNameCache = new Map(); 
let chatSubscription = null;
let chatIsEmpty = true;
const top3UserIds = new Map();

// Chat DOM Elements
const chatFab      = document.getElementById("chatFab");
const chatBackdrop = document.getElementById("chatBackdrop");
const chatPanel    = document.getElementById("chatPanel");
const closeChatBtn = document.getElementById("closeChatBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm     = document.getElementById("chatForm");
const chatInput    = document.getElementById("chatInput");
const chatTitle    = document.getElementById("chatTitle");
const unreadBadge  = document.getElementById("unreadBadge");


/* ── ELEMENTS ── */
const tournamentTitle        = document.getElementById("tournamentName");
const avatarElement          = document.getElementById("teamAvatar");
const welcomeText            = document.getElementById("welcomeText");
const teamNameElement        = document.getElementById("userTeamName");
const scoreElement           = document.getElementById("userScore");
const rankElement            = document.getElementById("userRank");
const subsElement            = document.getElementById("subsRemaining");
const matchTeamsElement      = document.getElementById("matchTeams");
const matchTimeElement       = document.getElementById("matchTime");
const leaderboardContainer   = document.getElementById("leaderboardContainer");
const editButton             = document.getElementById("editXiBtn");
const boosterStatusEl        = document.getElementById("boosterStatus");
const profileModal           = document.getElementById("profileModal");
const saveProfileBtn         = document.getElementById("saveProfileBtn");
const modalTeamName          = document.getElementById("modalTeamName");
const avatarInput            = document.getElementById("avatarInput");
const modalPreview           = document.getElementById("modalAvatarPreview");
const viewXiBtn              = document.getElementById("viewXiBtn");
// Dynamic Nav Elements
const navMatchesBtn = document.getElementById("navMatchesBtn");
const navMatchLabel = document.getElementById("navMatchLabel");
const navLiveDot    = document.getElementById("navLiveDot");
const navLiveScore  = document.getElementById("navLiveScore");

function switchLeagueTab(tab) {
    const panePrivate  = document.getElementById("panePrivate");
    const paneOverall  = document.getElementById("paneOverall");
    const tabMyLeague  = document.getElementById("tabMyLeague");
    const tabOverall   = document.getElementById("tabOverall");

    if (tab === "private") {
        panePrivate?.classList.remove("hidden");
        paneOverall?.classList.add("hidden");
        tabMyLeague?.classList.add("active");
        tabOverall?.classList.remove("active");
    } else {
        paneOverall?.classList.remove("hidden");
        panePrivate?.classList.add("hidden");
        tabOverall?.classList.add("active");
        tabMyLeague?.classList.remove("active");
    }
}

// Expose to HTML onclick attributes
window.switchLeagueTab = switchLeagueTab;

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
async function initApp() {
    try {
        const user = await authReady;
        currentUserId = user.id;
        startDashboard(currentUserId);
    } catch (err) {
        console.warn("Auth failed:", err.message);
    }
}

initApp();

/* ══════════════════════════════════════════════════════
   PAGE LOAD TRANSITION
══════════════════════════════════════════════════════ */
function revealApp(hasError = false) {
    if (hasError) {
        const sk = document.getElementById("skeletonScreen");
        if (sk) {
            sk.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px">
                    <div style="font-family:var(--font-display);font-size:14px;font-weight:900;color:var(--red);letter-spacing:2px">FIELD UNAVAILABLE</div>
                    <button onclick="location.reload()" style="background:#9AE000;color:#000;border:none;padding:10px 20px;border-radius:8px;font-weight:900;cursor:pointer;font-size:13px">RETRY</button>
                </div>`;
        }
        return;
    }
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
}

/* ══════════════════════════════════════════════════════
   DYNAMIC NAV LIVE SCORE LOGIC
══════════════════════════════════════════════════════ */
async function initLiveNav() {
    if (!navMatchesBtn) return;

    const updateNavUI = async () => {
        // Fetch only one match that is active/locked but not finished
        const { data: matches, error } = await supabase
            .from("matches")
            .select(`
                id, 
                team_a:real_teams!matches_team_a_id_fkey(short_code),
                team_b:real_teams!matches_team_b_id_fkey(short_code),
                live_scores(team1_score, team1_wickets, team1_overs, team2_score, team2_wickets, team2_overs)
            `)
            .eq("status", "locked")
            .eq("points_processed", false)
            .limit(1);

        if (error || !matches || matches.length === 0 || !matches[0].live_scores) {
            // NO LIVE MATCH: Reset to default "Matches" view
            navMatchLabel.textContent = "Matches";
            navLiveScore.classList.add("hidden");
            navLiveDot.classList.add("hidden");
            navMatchesBtn.classList.remove("is-live");
            return;
        }

        const m = matches[0];
        const ls = m.live_scores;

        // MATCH IS LIVE: Update UI
        navMatchesBtn.classList.add("is-live");
        navMatchLabel.textContent = "LIVE";
        navLiveDot.classList.remove("hidden");
        navLiveScore.classList.remove("hidden");

        // Logic: Show the team currently batting
        // If Team 2 has overs, they are batting (2nd innings). Otherwise, Team 1.
        if (ls.team2_overs > 0) {
            navLiveScore.textContent = `${m.team_b.short_code} ${ls.team2_score}/${ls.team2_wickets || 0}`;
        } else {
            navLiveScore.textContent = `${m.team_a.short_code} ${ls.team1_score}/${ls.team1_wickets || 0}`;
        }
    };

    // 1. Initial Load
    updateNavUI();

    // 2. Realtime Listener: Refresh Nav whenever live_scores table updates
navChannel = supabase.channel('nav-live-updates')
    .on('postgres_changes', { event: '*', table: 'live_scores' }, () => {
        updateNavUI();
    })
    .subscribe();
}

/* ══════════════════════════════════════════════════════
   DASHBOARD INIT
══════════════════════════════════════════════════════ */
async function startDashboard(userId) {
    initLiveNav();
    try { initNotificationHub(userId); } catch (e) {
        console.warn("Notification hub error:", e);
    }

    // ── REALTIME: My live points update ──
pointsChannel = supabase.channel('my-live-points')
    .on('postgres_changes', {
        event: '*',
        table: 'user_match_points',
        filter: `user_id=eq.${userId}`
    }, () => {
        fetchHomeData(userId);
    })
    .subscribe();

// ── REALTIME: Match lock detector ──
matchChannel = supabase.channel('match-lock-detector')
    .on('postgres_changes', {
        event: 'UPDATE',
        table: 'matches'
    }, (payload) => {
        if (payload.new.status === 'locked') {
            if (editButton) {
                editButton.disabled            = true;
                editButton.style.opacity       = "0.5";
                editButton.style.pointerEvents = "none";
                editButton.textContent         = "LOCKED";
            }
            if (matchTimeElement) matchTimeElement.textContent = "Match Live";
        }
    })
    .subscribe();

// ── REALTIME: Bell notification badge ──
notifChannel = supabase.channel('my-notifications')
    .on('postgres_changes', {
        event: 'INSERT',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
    }, () => {
        try { initNotificationHub(userId); } catch (e) {}
    })
    .subscribe();

    setupHomeLeagueListeners(userId);
    switchLeagueTab("private");

    try {
        const { data: activeT } = await supabase
            .from("active_tournament").select("*").maybeSingle();

        if (activeT) {
            activeTournamentId = activeT.id;
            if (tournamentTitle) tournamentTitle.textContent = activeT.name;
            await initChat(userId, null, activeT.id);
        }

        const [homeResult, lbResult, leagueResult] = await Promise.allSettled([
            fetchHomeData(userId),
            loadLeaderboardPreview(),
            fetchPrivateLeagueData(userId),
        ]);

        if ([homeResult, lbResult, leagueResult].some(r => r.status === "rejected")) {
            console.warn("One or more dashboard fetches failed:",
                homeResult.reason, lbResult.reason, leagueResult.reason);
        }

        revealApp(homeResult.status === "rejected");

    } catch (err) {
        console.error("Dashboard bootstrap error:", err);
        revealApp(true);
    }
}

/* ══════════════════════════════════════════════════════
   FANTASY TIPS TEASER CARD
══════════════════════════════════════════════════════ */
async function loadFantasyTipsCard(upcomingMatch, matchNumber) {
    const card    = document.getElementById("tipsCard");
    const titleEl = document.getElementById("tipsCardTitle");
    const subEl   = document.getElementById("tipsCardSub");
    const ctaBtn  = document.getElementById("tipsCtaBtn");
    if (!card || !upcomingMatch) return;

    const teamA = upcomingMatch.team_a_code;  // "KKR"
    const teamB = upcomingMatch.team_b_code;  // "SRH"

    // Use match number to find the EXACT article — avoids picking up old matches
    const { data: article } = await supabase
        .from("articles")
        .select("slug")
        .eq("published", true)
        .eq("category", "fantasy-preview")
        .ilike("match_label", `%Match ${matchNumber}%`)  // ← "Match 6" or "Match 32"
        .ilike("match_label", `%${teamA}%`)              // ← extra safety: team name check
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    card.classList.remove("hidden");

    if (article) {
titleEl.textContent = `${teamA} vs ${teamB} — Best XI & Captain Picks`;
subEl.textContent   = "Don't lock your team before reading this ⚡";
        card.classList.remove("tips-soon");
        card.classList.add("tips-live");
        if (ctaBtn) {
            ctaBtn.innerHTML           = `Read <i class="fas fa-chevron-right"></i>`;
            ctaBtn.style.pointerEvents = "";
            ctaBtn.onclick = () => {
                window.location.href = `/blog-post?slug=${article.slug}`;
            };
        }
    } else {
        titleEl.textContent = `${teamA} vs ${teamB} Fantasy Tips`;
        subEl.textContent   = "Our experts are analyzing this match — tips coming soon!";
        card.classList.remove("tips-live");
        card.classList.add("tips-soon");
        if (ctaBtn) {
            ctaBtn.innerHTML           = `Coming Soon`;
            ctaBtn.style.pointerEvents = "none";
            ctaBtn.onclick             = null;
        }
    }
}
/* ══════════════════════════════════════════════════════
   CORE DATA FETCH
══════════════════════════════════════════════════════ */
async function fetchHomeData(userId) {
    const { data: profile } = await supabase
        .from("user_profiles").select("*").eq("user_id", userId).maybeSingle();

    existingProfile = profile;

    // Force profile modal if first time — name + team required
    if (!profile || !profile.profile_completed) {
        if (profileModal) {
            profileModal.classList.remove("hidden");
            const closeBtn = document.getElementById("closeProfileModal");
            if (closeBtn) closeBtn.style.display = "none";
            profileModal.setAttribute("data-forced", "true");
        }
    }

    const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : "Expert";
    if (welcomeText)     welcomeText.textContent     = `Welcome back, ${firstName}!`;
    if (teamNameElement) teamNameElement.textContent = profile?.team_name || "Set your team name";

    if (profile?.team_photo_url) {
        const { data: imgData } = supabase.storage
            .from("team-avatars").getPublicUrl(profile.team_photo_url);
        if (avatarElement) avatarElement.style.backgroundImage = `url(${imgData.publicUrl})`;
    }

    const [{ data: dash }, { data: boosterData }] = await Promise.all([
        supabase.from("home_dashboard_view").select("*").eq("user_id", userId).maybeSingle(),
        activeTournamentId
            ? supabase.from("user_tournament_points").select("used_boosters")
                .eq("user_id", userId).eq("tournament_id", activeTournamentId).maybeSingle()
            : Promise.resolve({ data: null }),
    ]);

    if (dash) {
        if (scoreElement) scoreElement.textContent = dash.total_points || 0;

const hasEarnedPoints = (dash.total_points || 0) > 0;
const displayRank = hasEarnedPoints && dash.user_rank > 0 ? `#${dash.user_rank}` : "Pre-Season";
const isPreSeason = !hasEarnedPoints;

if (rankElement) {
    rankElement.textContent = displayRank;
    rankElement.classList.toggle("pre-season", isPreSeason);
}

const overallRankHeader = document.getElementById("overallUserRank");
if (overallRankHeader) {
    overallRankHeader.textContent = displayRank;
    overallRankHeader.classList.toggle("pre-season", isPreSeason);
}

        currentUserOverallRank = dash.user_rank || Infinity;

        if (dash.subs_remaining === 999) {
if (subsElement) { subsElement.textContent = "∞"; subsElement.style.color = "var(--accent)"; }
        } else {
            if (subsElement) { subsElement.textContent = dash.subs_remaining ?? 130; subsElement.style.color = ""; }
        }

        
        // Season progress bar
const progressFill = document.getElementById("seasonProgressFill");
const progressLabel = document.getElementById("seasonProgressLabel");
if (progressFill && dash.current_match_number != null) {
    const total = 74;
    const current = Math.min(dash.current_match_number, total);
    const pct = Math.round((current / total) * 100);
requestAnimationFrame(() => {
    setTimeout(() => { progressFill.style.width = `${pct}%`; }, 100);
});
    if (progressLabel) progressLabel.textContent = `Match ${current} of ${total}`;
}

        if (dash.upcoming_match) {
            const match = dash.upcoming_match;

            if (matchTeamsElement) {
                matchTeamsElement.textContent = `${match.team_a_code} vs ${match.team_b_code}`;
            }


            const venueEl = document.getElementById("matchVenue");
            if (venueEl) {
                venueEl.textContent = "";
                const emojiSpan       = document.createElement("span");
                emojiSpan.textContent = "🏟️ ";
                const venueText       = document.createElement("span");
                venueText.textContent = match.venue || "Venue TBA";
                venueEl.title = match.venue || "Venue TBA";
                venueEl.append(emojiSpan, venueText);
            }

            const bucket   = supabase.storage.from("team-logos");
            const logoAUrl = match.team_a_logo
                ? bucket.getPublicUrl(match.team_a_logo).data.publicUrl
                : "images/default-team.png";
            const logoBUrl = match.team_b_logo
                ? bucket.getPublicUrl(match.team_b_logo).data.publicUrl
                : "images/default-team.png";

            const teamALogo = document.getElementById("teamALogo");
            const teamBLogo = document.getElementById("teamBLogo");
            if (teamALogo) {
                teamALogo.style.backgroundImage = `url('${logoAUrl}')`;
                teamALogo.style.display         = "block";
            }
            if (teamBLogo) {
                teamBLogo.style.backgroundImage = `url('${logoBUrl}')`;
                teamBLogo.style.display         = "block";
            }

            startCountdown(match.actual_start_time);
    loadFantasyTipsCard(match, dash.current_match_number);  // ← pass match number too


        } else {
            if (matchTeamsElement) matchTeamsElement.textContent = "No Upcoming Matches";
            const venueEl = document.getElementById("matchVenue");
            if (venueEl) venueEl.textContent = "";
            if (matchTimeElement) matchTimeElement.textContent = "Check back soon!";
        }

        if (boosterStatusEl) {
            boosterStatusEl.textContent = String(
                Math.max(0, 7 - ((boosterData?.used_boosters || []).length))
            );
        }
    }

    if (profile?.profile_completed) {
        initPushNotifications(userId);
    }
}

/* ══════════════════════════════════════════════════════
   ONESIGNAL PUSH NOTIFICATION INIT
══════════════════════════════════════════════════════ */
async function initPushNotifications(userId) {
    try {
        window.OneSignalDeferred = window.OneSignalDeferred || [];

        window.OneSignalDeferred.push(async (OneSignal) => {
            await OneSignal.init({
                appId:              "76bfec04-40bc-4a15-957b-f0c1c6e401d4",
                serviceWorkerPath:  "/onesignalsdkworker.js",
                serviceWorkerParam: { scope: "/" },
                notifyButton:       { enable: false },
                promptOptions: {
                    slidedown: {
                        prompts: [{
                            type:       "push",
                            autoPrompt: true,
                            text: {
                                actionMessage: "Allow notifications to get match lock alerts and points updates.",
                                acceptButton:  "Allow",
                                cancelButton:  "Later",
                            },
                            delay: { pageViews: 1, timeDelay: 5 },
                        }],
                    },
                },
            });

            const subscription = OneSignal.User.PushSubscription;

            // ── CASE 1: Already subscribed — force save if missing in DB ──
            if (subscription.isSubscribed && subscription.id) {
                const existingId = existingProfile?.onesignal_id;
                if (!existingId || existingId !== subscription.id) {
                    const { error } = await supabase
                        .from("user_profiles")
                        .update({ onesignal_id: subscription.id })
                        .eq("user_id", userId);
                    if (error) console.warn("Force-save onesignal_id failed:", error.message);
                    else console.log("OneSignal ID force-saved:", subscription.id);
                }
            }

            // ── CASE 2: Not subscribed — show prompt ──
            if (!subscription.isSubscribed) {
                await OneSignal.Slidedown.promptPush();
            }

            // ── CASE 3: User subscribes now — save immediately ──
            OneSignal.User.PushSubscription.addEventListener("change", async (event) => {
                if (!event.current.isSubscribed) return;
                const playerId = event.current.id;
                if (!playerId) return;
                const { error } = await supabase
                    .from("user_profiles")
                    .update({ onesignal_id: playerId })
                    .eq("user_id", userId);
                if (error) console.warn("Save on subscribe failed:", error.message);
                else console.log("OneSignal ID saved on subscribe:", playerId);
            });
        });

    } catch (err) {
        console.warn("Push notification init failed:", err.message);
    }
}

/* ══════════════════════════════════════════════════════
   FLAIR
══════════════════════════════════════════════════════ */
function applyOwnFlair() {
    const effectiveRank = getEffectiveRank(currentUserOverallRank, currentUserPrivateRank);
    applyRankFlair(avatarElement, null, effectiveRank);
}

/* ══════════════════════════════════════════════════════
   LEADERBOARD PREVIEW
══════════════════════════════════════════════════════ */
async function loadLeaderboardPreview() {
    const [{ data: lb, error }, { count: userCount }] = await Promise.all([
    supabase.from("leaderboard_view")
        .select("team_name, total_points, rank, user_id")
        .order("rank", { ascending: true })
        .limit(3),
    supabase.from("user_profiles")
        .select("*", { count: "exact", head: true })
        .eq("profile_completed", true),
]);

const overallCountEl = document.getElementById("overallMemberCount");
if (overallCountEl && userCount != null) {
    overallCountEl.textContent = `${(10000 + userCount).toLocaleString()} managers`;
}

    if (!leaderboardContainer) return;

    if (error) {
        leaderboardContainer.innerHTML =
            `<p class="empty-state-text">Could not load rankings. Check your connection.</p>`;
        return;
    }

    if (lb && lb.length > 0) {
        leaderboardContainer.innerHTML = "";
        lb.forEach(row => {
            const rowDiv     = document.createElement("div");
            rowDiv.className = "leader-row";
            rowDiv.onclick   = () => {
                const name = encodeURIComponent(row.team_name || "Expert");
                window.location.href = `team-view.html?uid=${row.user_id}&name=${name}`;
            };

            const rankSpan   = document.createElement("span");
const rankTxt = document.createTextNode(row.total_points > 0 ? `#${row.rank} ` : "");
            const nameStrong = document.createElement("strong");
            nameStrong.className   = "team-name-text";
            nameStrong.textContent = row.team_name || "Expert";
            rankSpan.append(rankTxt, nameStrong);

const ptsPill     = document.createElement("span");
const hasPoints   = row.total_points > 0;
ptsPill.className = `pts-pill${hasPoints ? " has-pts" : ""}`;
ptsPill.textContent = hasPoints ? `${row.total_points} pts` : "Pre-season";

            rowDiv.append(rankSpan, ptsPill);
            leaderboardContainer.appendChild(rowDiv);
        });
    } else {
        leaderboardContainer.innerHTML =
            `<p class="empty-state-text">Rankings appear after Match 1!</p>`;
    }

    const viewBtn = document.getElementById("viewFullLeaderboard");
    if (viewBtn) {
        viewBtn.onclick = () => { window.location.href = "leaderboard.html"; };
    }
}

/* ══════════════════════════════════════════════════════
   PRIVATE LEAGUE DATA
══════════════════════════════════════════════════════ */
async function fetchPrivateLeagueData(userId) {
    const leagueNameEl = document.getElementById("privateLeagueName");
    const inviteCodeEl = document.getElementById("privateInviteCode");
    const contentEl    = document.getElementById("privateLeagueContent");
    const emptyStateEl = document.getElementById("noLeagueState");
    const containerEl  = document.getElementById("privateLeaderboardContainer");
    const viewBtn      = document.getElementById("viewPrivateLeaderboard");

    // ← REMOVED: const card = getElementById("privateLeagueCard") — no longer exists
    // ← REMOVED: if (!card) return — was killing the whole function

    const { data: m, error } = await supabase
        .from("league_members")
        .select("league_id, leagues(name, invite_code)")
        .eq("user_id", userId)
        .maybeSingle();

    console.log("League fetch:", m, error); // remove after confirming it works

    if (error || !m) {
        contentEl?.classList.add("hidden");
        emptyStateEl?.classList.remove("hidden");
        currentUserPrivateRank = Infinity;
        applyOwnFlair();
        return;
    }

    contentEl?.classList.remove("hidden");
    emptyStateEl?.classList.add("hidden");

    if (leagueNameEl) leagueNameEl.textContent = m.leagues.name;

    const { count: leagueCount } = await supabase
        .from("league_members")
        .select("*", { count: "exact", head: true })
        .eq("league_id", m.league_id);

    const privateCountEl = document.getElementById("privateLeagueMemberCount");
    if (privateCountEl && leagueCount != null) {
        privateCountEl.textContent = `${leagueCount} member${leagueCount !== 1 ? "s" : ""}`;
    }

    if (inviteCodeEl) {
        inviteCodeEl.textContent  = m.leagues.invite_code;
        inviteCodeEl.style.cursor = "pointer";
        inviteCodeEl.title        = "Tap to copy";
        inviteCodeEl.onclick      = () => {
            navigator.clipboard.writeText(m.leagues.invite_code);
            const original = inviteCodeEl.textContent;
            inviteCodeEl.textContent  = "COPIED!";
            inviteCodeEl.style.color  = "var(--accent)";
            setTimeout(() => { inviteCodeEl.textContent = original; inviteCodeEl.style.color = ""; }, 2000);
        };
    }

    if (viewBtn) {
        viewBtn.onclick = () => {
            window.location.href = `leaderboard.html?league_id=${m.league_id}`;
        };
    }

    const { data: lb } = await supabase
        .from("private_league_leaderboard")
        .select("team_name, total_points, rank_in_league, user_id")
        .eq("league_id", m.league_id)
        .order("total_points", { ascending: false })
        .limit(3);

    const { data: myRow } = await supabase
        .from("private_league_leaderboard")
        .select("rank_in_league, total_points")
        .eq("league_id", m.league_id)
        .eq("user_id", userId)
        .maybeSingle();

    if (lb && containerEl) {
        containerEl.innerHTML = "";
        lb.forEach(row => {
            const rowDiv     = document.createElement("div");
            rowDiv.className = "leader-row";
            rowDiv.onclick   = () => {
                const name = encodeURIComponent(row.team_name || "Expert");
                window.location.href = `team-view.html?uid=${row.user_id}&name=${name}`;
            };

            const rankSpan   = document.createElement("span");
            const rankTxt    = document.createTextNode(row.total_points > 0 ? `#${row.rank_in_league} ` : "");
            const nameStrong = document.createElement("strong");
            nameStrong.className   = "team-name-text";
            nameStrong.textContent = row.team_name || "Expert";
            rankSpan.append(rankTxt, nameStrong);

            const ptsPill   = document.createElement("span");
            const hasPoints = row.total_points > 0;
            ptsPill.className   = `pts-pill${hasPoints ? " has-pts" : ""}`;
            ptsPill.textContent = hasPoints ? `${row.total_points} pts` : "Pre-season";

            rowDiv.append(rankSpan, ptsPill);
            containerEl.appendChild(rowDiv);
        });

        const rankSpan = document.getElementById("privateLeagueRank");
        if (rankSpan) {
            if (myRow && myRow.total_points > 0) {
                rankSpan.textContent = `#${myRow.rank_in_league}`;
                rankSpan.classList.remove("pre-season");
            } else {
                rankSpan.textContent = "Pre-Season";
                rankSpan.classList.add("pre-season");
            }
        }
        currentUserPrivateRank = myRow?.rank_in_league ?? Infinity;
    } else {
        currentUserPrivateRank = Infinity;
    }

    applyOwnFlair();
}

/* ══════════════════════════════════════════════════════
   COUNTDOWN
══════════════════════════════════════════════════════ */
function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    const matchTime = new Date(startTime).getTime();

    const update = () => {
        const dist = matchTime - Date.now();

        if (dist <= 0) {
            clearInterval(countdownInterval);
            if (matchTimeElement) matchTimeElement.textContent = "Match Live";
            if (editButton) {
                editButton.disabled            = true;
                editButton.style.opacity       = "0.5";
                editButton.style.pointerEvents = "none";
                editButton.textContent         = "LOCKED";
    

            setTimeout(() => {
                if (document.visibilityState !== "visible") return;
                if (!profileModal?.hasAttribute("data-forced") &&
                    profileModal?.classList.contains("hidden")) {
                    window.location.reload();
                }
            }, 5000);
            return;
        }}

        const days    = Math.floor(dist / 86400000);
        const hours   = Math.floor((dist % 86400000) / 3600000);
        const minutes = Math.floor((dist % 3600000)  / 60000);
        const seconds = Math.floor((dist % 60000)    / 1000);

        if (matchTimeElement) {
            matchTimeElement.innerHTML = days > 0
                ? `<i class="far fa-clock"></i> Starts in ${days}d ${hours}h ${minutes}m`
                : `<i class="far fa-clock"></i> Starts in ${hours}h ${minutes}m ${seconds}s`;
        }

        if (dist < 900000) {
            matchTimeElement?.classList.remove("neon-green");
            matchTimeElement?.classList.add("neon-red");
        }
    };

    update();
    countdownInterval = setInterval(update, 1000);
}

window.addEventListener("pagehide", () => {
    if (countdownInterval) clearInterval(countdownInterval);
    if (chatSubscription) supabase.removeChannel(chatSubscription); // <-- ADD THIS
    supabase.removeChannel(navChannel);
    supabase.removeChannel(pointsChannel);
    supabase.removeChannel(matchChannel);
    supabase.removeChannel(notifChannel);
});

/* ══════════════════════════════════════════════════════
   HOME LEAGUE ACTIONS
══════════════════════════════════════════════════════ */
function setupHomeLeagueListeners(userId) {
    const createBtn = document.getElementById("homeCreateLeagueBtn");
    const joinBtn   = document.getElementById("homeJoinLeagueBtn");
    if (!createBtn || !joinBtn) return;

    createBtn.onclick = async () => {
        const name = await window.showCustomPrompt("Create League", "Enter a cool name...");
        if (!name) return;
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: league, error } = await supabase
            .from("leagues")
            .insert([{ name, invite_code: inviteCode, owner_id: userId }])
            .select().single();
        if (error) return window.showToast("Error creating league: " + error.message, "error");
        await supabase.from("league_members").insert([{ league_id: league.id, user_id: userId }]);
        window.showToast("League created! Share your code.", "success");
        await fetchPrivateLeagueData(userId);
        switchLeagueTab("private"); // ← ADD THIS LINE
    };

    joinBtn.onclick = async () => {
        const code = await window.showCustomPrompt("Join League", "Enter invite code...");
        if (!code) return;
        const { data: league } = await supabase
            .from("leagues").select("id")
            .eq("invite_code", code.toUpperCase()).maybeSingle();
        if (!league) return window.showToast("Invalid code. Double-check it.", "error");
        const { error } = await supabase
            .from("league_members").insert([{ league_id: league.id, user_id: userId }]);
        if (error) return window.showToast("Already in this league or join failed.", "error");
        window.showToast("Joined league successfully!", "success");
        await fetchPrivateLeagueData(userId);
        switchLeagueTab("private"); // ← ADD THIS LINE
    };
}

/* ══════════════════════════════════════════════════════
   FIRST-TIME PROFILE MODAL (forced on new users)
   ── Full name + team name required
   ── Avatar optional
   ── Locked forever after save
══════════════════════════════════════════════════════ */
if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
if (!modalTeamName || !profileModal) return;

const fullName = "";
const teamName = modalTeamName.value.trim();
        const file     = avatarInput?.files[0];
        const isFirstTime = !existingProfile || !existingProfile.profile_completed;

        // Name + team mandatory on first time
        if (isFirstTime && (!teamName)) {
            window.showToast("Please enter your team name to continue.", "error");
            return;
        }

        saveProfileBtn.disabled    = true;
        saveProfileBtn.textContent = "SAVING...";

        try {
            let photoPath = existingProfile?.team_photo_url;

            
            // Upload avatar if selected (optional)
// Upload avatar if selected (optional)
if (file) {
    if (file.size > 2 * 1024 * 1024) {
        window.showToast("Photo must be under 2MB. Please choose a smaller image.", "error");
        saveProfileBtn.disabled    = false;
        saveProfileBtn.textContent = isFirstTime ? "Save & Start" : "Update Photo";
        return;
    }
    const fileExt  = file.name.split(".").pop();
                const fileName = `${currentUserId}/avatar.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                    .from("team-avatars")
                    .upload(fileName, file, { cacheControl: "3600", upsert: true });
                if (uploadError) throw new Error("Upload failed: " + uploadError.message);
                photoPath = `${fileName}?t=${Date.now()}`;
            }

            // Build payload — name + team only set on first time, never again
            // Check if match 1 has locked
const { data: match1 } = await supabase
    .from("matches")
    .select("status")
    .eq("match_number", 1)
    .maybeSingle();

const match1Locked = match1?.status === "locked";

const updatePayload = { team_photo_url: photoPath };
if (isFirstTime) {
    updatePayload.team_name         = teamName;
    updatePayload.profile_completed = true;
} else if (!match1Locked && teamName) {
    updatePayload.team_name = teamName;
}

            const { error: updateError } = await supabase
                .from("user_profiles")
                .upsert(
                    { user_id: currentUserId, ...updatePayload },
                    { onConflict: "user_id" }
                );
            if (updateError) throw updateError;

            window.showToast("Profile saved!", "success");
            profileModal.classList.add("hidden");
            window.location.reload();

        } catch (err) {
            console.error("Save error:", err.message);

            if (err.message?.includes("USER_LIMIT_REACHED") ||
                err.message?.includes("REGISTRATION_CLOSED")) {
                import("./registration-guard.js").then(({ showRegistrationClosed }) => {
                    showRegistrationClosed("full");
                });
                return;
            }

            window.showToast("Failed to save: " + err.message, "error");

        } finally {
            saveProfileBtn.disabled    = false;
            saveProfileBtn.textContent = isFirstTime ? "Save & Start" : "Update Photo";
        }
    };
}

// Avatar file input — preview in modal
if (avatarInput) {
    avatarInput.onchange = () => {
        const file = avatarInput.files[0];
        if (file && modalPreview) {
            const reader  = new FileReader();
            reader.onload = (e) => {
                modalPreview.style.backgroundImage    = `url(${e.target.result})`;
                modalPreview.style.backgroundSize     = "cover";
                modalPreview.style.backgroundPosition = "center";
            };
            reader.readAsDataURL(file);
        }
    };
}

// Close button — only works if not forced
const closeBtn = document.getElementById("closeProfileModal");
if (closeBtn) {
    closeBtn.onclick = () => {
        if (profileModal?.hasAttribute("data-forced")) {
            window.showToast("Please complete your profile to continue.", "warning");
            return;
        }
        profileModal?.classList.add("hidden");
    };
}

/* ══════════════════════════════════════════════════════
   AVATAR TAP — goes to profile page (photo change)
   No modal reopening — cleaner UX
══════════════════════════════════════════════════════ */
if (avatarElement) {
    avatarElement.onclick = () => {
        // If profile not completed yet, show the forced modal instead
        if (!existingProfile?.profile_completed) {
            profileModal?.classList.remove("hidden");
            return;
        }
        // Profile completed — go to account page to change photo
        window.location.href = "profile.html";
    };
}

/* ══════════════════════════════════════════════════════
   EDIT TEAM BUTTON
══════════════════════════════════════════════════════ */
if (editButton) {
    editButton.onclick = () => {
        if (!existingProfile?.profile_completed) {
            window.showToast("Complete your profile first!", "warning");
            profileModal?.classList.remove("hidden");
            return;
        }
        window.location.href = "/team-builder";
    };
}

/* ══════════════════════════════════════════════════════
   VIEW TEAM BUTTON
══════════════════════════════════════════════════════ */
if (viewXiBtn) {
    viewXiBtn.onclick = () => {
        if (!existingProfile?.profile_completed) {
            window.showToast("Complete your profile first!", "warning");
            profileModal?.classList.remove("hidden");
            return;
        }
        const name = encodeURIComponent(existingProfile.team_name);
        window.location.href = `team-view.html?uid=${currentUserId}&name=${name}`;
    };
}

// Close modal on backdrop click
window.addEventListener("click", (e) => {
    if (profileModal && e.target === profileModal &&
        !profileModal.hasAttribute("data-forced")) {
        profileModal.classList.add("hidden");
    }
});

/* ══════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════ */
window.showToast = (message, type = "success") => {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast         = document.createElement("div");
    toast.className     = `toast ${type}`;
    toast.textContent   = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("fade-out");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 3000);
};

/* ══════════════════════════════════════════════════════
   CUSTOM PROMPT
══════════════════════════════════════════════════════ */
window.showCustomPrompt = (title, placeholder) => {
    return new Promise((resolve) => {
        const overlay    = document.getElementById("customPromptOverlay");
        const titleEl    = document.getElementById("promptTitle");
        const inputEl    = document.getElementById("promptInput");
        const btnCancel  = document.getElementById("promptCancel");
        const btnConfirm = document.getElementById("promptConfirm");
        if (!overlay) return resolve(null);

        titleEl.textContent  = title;
        inputEl.placeholder  = placeholder;
        inputEl.value        = "";
        overlay.classList.remove("hidden");
        inputEl.focus();

        const cleanup = () => {
            overlay.classList.add("hidden");
            btnCancel.onclick  = null;
            btnConfirm.onclick = null;
        };

        btnCancel.onclick  = () => { cleanup(); resolve(null); };
        btnConfirm.onclick = () => { cleanup(); resolve(inputEl.value.trim()); };
    });
};


/* ─── CHAT MODULE ────────────────────────────────────────────────────────── */
// BUG FIX #7: In-memory sender name cache — one profile fetch per user, not per message


// BUG FIX #3: userId and leagueId passed in — no second getSession() call
async function initChat(userId, leagueId, tournamentId) {
    if (!chatFab) return;

    if (chatTitle) chatTitle.textContent = leagueId ? "League Banter" : "Global Banter";

    // Fetch top 3 for flair
    const rankQuery = leagueId
        ? supabase.from("private_league_leaderboard").select("user_id, rank_in_league").eq("league_id", leagueId).lte("rank_in_league", 3)
        : supabase.from("leaderboard_view").select("user_id, rank").eq("tournament_id", tournamentId).lte("rank", 3);

    const { data: topRows } = await rankQuery;
    if (topRows) {
        topRows.forEach(row => {
            top3UserIds.set(row.user_id, leagueId ? row.rank_in_league : row.rank);
        });
    }

chatFab.onclick = () => {
    chatPanel.classList.add("show");
    chatBackdrop.classList.remove("hidden");

    // Force hide the badge when chat is opened
    if (unreadBadge) {
        unreadBadge.classList.add("hidden");
        unreadBadge.style.display = "none";
    }

    setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 100);

    // Inject in-page push banner once when chat opens
    const bannerEl = document.getElementById("chatPushBanner");
    if (bannerEl && !bannerEl.dataset.loaded) {
        bannerEl.dataset.loaded = "true";
        const s = document.createElement("script");
        s.dataset.zone = "10746396";
        s.src = "https://nap5k.com/tag.min.js";
        bannerEl.appendChild(s);
    }
};

    const closeChat = () => {
        chatPanel.classList.remove("show");
        chatBackdrop.classList.add("hidden");
    };
    if (closeChatBtn) closeChatBtn.onclick = closeChat;
    if (chatBackdrop) chatBackdrop.onclick = closeChat;

    if (chatForm) {
        chatForm.onsubmit = async e => {
            e.preventDefault();
            const msg = chatInput?.value.trim();
            if (!msg) return;
            chatInput.value = "";

            // Optimistic render — use cached or "You"
            renderMessage({
                user_id: userId,
                message: msg,
                _senderName: "You",
            }, userId);

            await supabase.from("game_chat").insert([{
                user_id:   userId,
                message:   msg,
                league_id: leagueId || null,
            }]);
        };
    }

    await loadChatHistory(userId, leagueId);
    subscribeToChat(userId, leagueId);

    // BUG FIX #8: Unsubscribe on page hide
    window.addEventListener("pagehide", () => {
        if (chatSubscription) {
            supabase.removeChannel(chatSubscription);
            chatSubscription = null;
        }
    }, { once: true });
}

async function loadChatHistory(userId, leagueId) {
    if (!chatMessages) return;

    let query = supabase
        .from("game_chat")
        .select("user_id, message, created_at, user_profiles(team_name)")
        .order("created_at", { ascending: false })
        .limit(50);

    query = leagueId ? query.eq("league_id", leagueId) : query.is("league_id", null);

    const { data } = await query;
    chatMessages.replaceChildren();

    if (!data?.length) {
        chatIsEmpty = true;
        const placeholder = document.createElement("p");
        placeholder.className   = "chat-placeholder";
        placeholder.textContent = "Be the first to talk trash!";
        chatMessages.appendChild(placeholder);
        return;
    }

    chatIsEmpty = false;
    // Seed the sender name cache from history — avoids per-message fetches later
    data.forEach(msg => {
        const name = msg.user_profiles?.team_name;
        if (name && !senderNameCache.has(msg.user_id)) {
            senderNameCache.set(msg.user_id, name);
        }
    });

    data.reverse().forEach(msg => renderMessage(msg, userId));
}

function renderMessage(msgData, currentUserId) {
    if (!chatMessages) return;
    const isMe = msgData.user_id === currentUserId;

    // BUG FIX #6: Use flag instead of innerHTML.includes()
    if (chatIsEmpty) {
        chatMessages.replaceChildren();
        chatIsEmpty = false;
    }

    // BUG FIX #7: Use cache, never fetch inline
    const senderName = isMe
        ? "You"
        : msgData._senderName
          || senderNameCache.get(msgData.user_id)
          || msgData.user_profiles?.team_name
          || "Expert";

    // Update cache if we got a name from the message payload
    if (!isMe && senderName !== "Expert" && !senderNameCache.has(msgData.user_id)) {
        senderNameCache.set(msgData.user_id, senderName);
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${isMe ? "me" : "them"}`;

    if (!isMe) {
        const nameEl = document.createElement("div");
        nameEl.className   = "msg-sender";
        nameEl.textContent = senderName;

        const rank = top3UserIds.get(msgData.user_id);
        if (rank) applyRankFlair(null, nameEl, rank);

        const bubble = document.createElement("div");
        bubble.className   = "msg-bubble";
        bubble.textContent = msgData.message;

        msgDiv.append(nameEl, bubble);
    } else {
        const bubble = document.createElement("div");
        bubble.className   = "msg-bubble";
        bubble.textContent = msgData.message;
        msgDiv.appendChild(bubble);
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function subscribeToChat(userId, leagueId) {
    chatSubscription = supabase
        .channel("public:game_chat")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_chat" }, async payload => {
            const newMsg = payload.new;
            const isMatch = leagueId
                ? newMsg.league_id === leagueId
                : newMsg.league_id === null;
            if (!isMatch || newMsg.user_id === userId) return;

            // BUG FIX #7: Check cache first — only fetch if name unknown
            if (!senderNameCache.has(newMsg.user_id)) {
                const { data: profile } = await supabase
                    .from("user_profiles")
                    .select("team_name")
                    .eq("user_id", newMsg.user_id)
                    .maybeSingle();
                if (profile?.team_name) {
                    senderNameCache.set(newMsg.user_id, profile.team_name);
                }
            }

 newMsg._senderName = senderNameCache.get(newMsg.user_id) || "Expert";
            renderMessage(newMsg, userId);

            // --- THIS IS THE EXACT FIX FOR THE BADGE ---
            if (!chatPanel?.classList.contains("show")) {
                if (unreadBadge) {
                    unreadBadge.classList.remove("hidden");
                    unreadBadge.style.display = "block";
                }
            }
        })
        .subscribe();
}
/* ══════════════════════════════════════════════════════
   NETWORK STATUS
══════════════════════════════════════════════════════ */
window.addEventListener("offline", () => window.showToast("You are offline.", "error"));
window.addEventListener("online",  () => window.showToast("Back online!", "success"));