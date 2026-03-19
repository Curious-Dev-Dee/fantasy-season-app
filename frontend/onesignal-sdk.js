import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')
const ONESIGNAL_KEY    = Deno.env.get('ONESIGNAL_REST_API_KEY')

/* ── Helpers ── */
function getFirstName(fullName: string | null): string {
    const safe = (fullName ?? "").trim()
    return safe ? safe.split(/\s+/)[0] : "Expert"
}

function toIST(date: Date): string {
    return date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour:     '2-digit',
        minute:   '2-digit',
        hour12:   true,
    })
}

/* ── DB: write in-app notification for all users ── */
async function notifyAll(
    supabase: ReturnType<typeof createClient>,
    title:   string,
    message: string,
    type:    string = 'info'
) {
    const { error } = await supabase.rpc('notify_all_users', {
        p_title:   title,
        p_message: message,
        p_type:    type,
    })
    if (error) console.error('notify_all_users error:', error.message)
}

/* ── DB: mark match notification as sent ── */
async function markMatchNotified(
    supabase:  ReturnType<typeof createClient>,
    matchId:   string,
    notifType: string
) {
    const { error } = await supabase
        .from('matches')
        .update({
            last_notification_sent: notifType,
            last_notification_at:   new Date().toISOString(),
        })
        .eq('id', matchId)
    if (error) console.error('markMatchNotified error:', error.message)
}

/* ── OneSignal: push to a single device ── */
async function pushOne(playerId: string, title: string, message: string) {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json; charset=utf-8',
            'Authorization': `Basic ${ONESIGNAL_KEY}`,
        },
        body: JSON.stringify({
            app_id:             ONESIGNAL_APP_ID,
            include_player_ids: [playerId],
            headings:           { en: title },
            contents:           { en: message },
        }),
    })
    return res.json()
}

/* ── OneSignal: broadcast to all subscribed devices ── */
async function pushAll(
    profiles: { full_name: string | null; onesignal_id: string }[],
    titleFn:  (firstName: string) => string,
    msgFn:    (firstName: string) => string
) {
    await Promise.all(
        profiles.map(p =>
            pushOne(p.onesignal_id, titleFn(getFirstName(p.full_name)), msgFn(getFirstName(p.full_name)))
        )
    )
}

/* ════════════════════════════════════════════════
   MAIN HANDLER
════════════════════════════════════════════════ */
Deno.serve(async (_req) => {
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } }
    )

    const now            = new Date()
    const currentHourUTC = now.getUTCHours()
    const currentMinUTC  = now.getUTCMinutes()

    /* ── Fetch matches + subscribed profiles in parallel ── */
    const [matchesRes, profilesRes] = await Promise.all([
        supabase
            .from('matches')
            .select('*, team_a:team_a_id(short_code), team_b:team_b_id(short_code)')
            .or('status.eq.upcoming,status.eq.locked,status.eq.abandoned'),
        supabase
            .from('user_profiles')
            .select('full_name, onesignal_id')
            .eq('is_active', true)
            .not('onesignal_id', 'is', null),
    ])

    if (matchesRes.error || profilesRes.error) {
        return new Response('Error fetching data', { status: 500 })
    }

    const matches  = matchesRes.data  ?? []
    const profiles = profilesRes.data ?? []

    /* ════════════════════════════════════════════
       TRIGGER A: DAILY 12:00 PM IST = 06:30 UTC
       Show today's matches in the bell panel.
       Push notification + in-app notification.
    ════════════════════════════════════════════ */
    if (currentHourUTC === 6 && currentMinUTC >= 30 && currentMinUTC < 35) {
        const todayIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
            .toISOString()
            .split('T')[0]

        const todaysMatches = matches.filter(m =>
            m.status === 'upcoming' &&
            new Date(m.actual_start_time)
                .toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
                .startsWith(todayIST.replace(/-/g, '/'))
        )

        if (todaysMatches.length > 0) {
            // Build a clean match list for the in-app notification
            const matchLines = todaysMatches.map(m => {
                const tA  = m.team_a?.short_code || 'TBA'
                const tB  = m.team_b?.short_code || 'TBA'
                const num = m.match_number
                const t   = toIST(new Date(m.actual_start_time))
                return `M#${num}: ${tA} vs ${tB} at ${t}`
            })

            const isDoubleHeader = todaysMatches.length >= 2
            const inAppTitle     = isDoubleHeader ? "Double Header Today 🏏🏏" : "Match Day 🏏"
            const inAppMsg       = matchLines.join('\n')

            // Push notification (personalised with first name)
            const pushMsg = todaysMatches
                .map(m => `${m.team_a?.short_code || 'TBA'} vs ${m.team_b?.short_code || 'TBA'}`)
                .join(', ')

            await pushAll(
                profiles,
                (name) => isDoubleHeader ? `Double Header Today, ${name}!` : `Match Day, ${name}!`,
                ()     => `${pushMsg} — Set your XI before lock time!`
            )

            // In-app bell notification
            await notifyAll(supabase, inAppTitle, inAppMsg, 'info')
        }
    }

    /* ════════════════════════════════════════════
       PER-MATCH TRIGGERS
       Waterfall priority — highest priority first,
       continue skips lower checks for that match.
    ════════════════════════════════════════════ */
    for (const match of matches) {
        const startTime    = new Date(match.actual_start_time)
        const originalTime = new Date(match.original_start_time)
        const diffMins     = (startTime.getTime() - now.getTime()) / 60000
        const tA           = match.team_a?.short_code || 'TBA'
        const tB           = match.team_b?.short_code || 'TBA'
        const mNum         = `M#${match.match_number}`
        const istTime      = toIST(startTime)
        const last         = match.last_notification_sent

        /* ── TRIGGER 1: POINTS PROCESSED ── */
        if (match.points_processed && last !== 'points_done') {
            const title = `Points Updated — ${mNum}`
            const msg   = `${tA} vs ${tB} points are live. Check your rank on the leaderboard!`

            await pushAll(
                profiles,
                (name) => `Points Aagaye, ${name}! — ${mNum}`,
                ()     => msg
            )
            await notifyAll(supabase, title, msg, 'points')
            await markMatchNotified(supabase, match.id, 'points_done')
            continue
        }

        /* ── TRIGGER 2: MATCH ABANDONED ── */
        if (
            match.status === 'abandoned' &&
            last !== 'abandoned' &&
            last !== 'points_done'
        ) {
            const title = `Match Abandoned — ${mNum}`
            const msg   = `${tA} vs ${tB} has been abandoned. No subs or boosters used for this match will be deducted.`

            await pushAll(
                profiles,
                ()     => `Match Abandoned — ${mNum}`,
                ()     => `${tA} vs ${tB} cancelled. Your subs and boosters are safe.`
            )
            await notifyAll(supabase, title, msg, 'abandoned')
            await markMatchNotified(supabase, match.id, 'abandoned')
            continue
        }

        /* ── TRIGGER 3: TEAM LOCKED ── */
        if (
            match.status === 'locked' &&
            match.lock_processed &&
            !['locked', 'points_done', 'abandoned'].includes(last)
        ) {
            const title = `Teams Locked — ${mNum}`
            const msg   = `${tA} vs ${tB} has started. Your team is locked in. Good luck!`

            await pushAll(
                profiles,
                (name) => `Game On, ${name}! — ${mNum}`,
                ()     => `${tA} vs ${tB} is live. Teams are locked. Let's go!`
            )
            await notifyAll(supabase, title, msg, 'locked')
            await markMatchNotified(supabase, match.id, 'locked')
            continue
        }

        /* ── TRIGGER 4: MATCH DELAYED ──
           Fires when actual_start_time > original_start_time.
           Re-fires if the time shifts again (last_notification_sent
           gets reset to null if the match time changes further —
           handled below).
        ── */
        if (
            match.status === 'upcoming' &&
            startTime > originalTime &&
            !['delayed', 'locked', 'points_done', 'abandoned'].includes(last)
        ) {
            const title = `Match Delayed — ${mNum}`
            const msg   = `${tA} vs ${tB} has been delayed. New lock time: ${istTime} IST. Check your team!`

            await pushAll(
                profiles,
                ()  => `Match Delayed — ${mNum}`,
                ()  => msg
            )
            await notifyAll(supabase, title, msg, 'delayed')
            await markMatchNotified(supabase, match.id, 'delayed')
            continue
        }

        /* ── TRIGGER 5: 30-MINUTE URGENCY ──
           Only fires once (when last_notification_sent is null).
           Does not fire if the match is already delayed — the
           delayed notification covers urgency.
        ── */
        if (
            match.status === 'upcoming' &&
            diffMins <= 30 &&
            diffMins > 0 &&
            last === null
        ) {
            const title = `30 Minutes to Lock — ${mNum}`
            const msg   = `${tA} vs ${tB} locks at ${istTime} IST. Make your final changes now!`

            await pushAll(
                profiles,
                (name) => `Last Chance, ${name}! — ${mNum}`,
                ()     => msg
            )
            await notifyAll(supabase, title, msg, 'info')
            await markMatchNotified(supabase, match.id, 'urgency_30m')
        }
    }

    return new Response(
        JSON.stringify({ status: 'processed', matches_checked: matches.length }),
        { headers: { 'Content-Type': 'application/json' } }
    )
})