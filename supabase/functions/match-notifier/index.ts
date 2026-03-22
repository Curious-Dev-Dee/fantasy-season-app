import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')
const ONESIGNAL_KEY    = Deno.env.get('ONESIGNAL_REST_API_KEY')

function getFirstName(fullName: string | null): string {
    const safe = (fullName ?? '').trim()
    return safe ? safe.split(/\s+/)[0] : 'Expert'
}

function toIST(date: Date): string {
    return date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour:     '2-digit',
        minute:   '2-digit',
        hour12:   true,
    })
}

/* ── Write bell notification for every user (direct INSERT, no RPC) ── */
async function notifyAll(
    supabase: ReturnType<typeof createClient>,
    title:   string,
    message: string,
    type:    string = 'info'
) {
    const { data: users, error: fetchErr } = await supabase
        .from('user_profiles')
        .select('user_id')

    if (fetchErr) {
        console.error('notifyAll — fetch users error:', fetchErr.message)
        return
    }

    if (!users || users.length === 0) {
        console.log('notifyAll — no users found')
        return
    }

    const { error: insertErr } = await supabase
        .from('notifications')
        .insert(
            users.map(u => ({
                user_id:    u.user_id,
                title:      title,
                message:    message,
                type:       type,
                is_read:    false,
                created_at: new Date().toISOString(),
            }))
        )

    if (insertErr) {
        console.error('notifyAll — insert error:', insertErr.message)
    } else {
        console.log(`notifyAll — inserted ${users.length} notifications: "${title}"`)
    }
}

/* ── Mark match notification as sent ── */
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
    else console.log(`markMatchNotified — ${notifType} for match ${matchId}`)
}

/* ── Send push to one device via OneSignal ── */
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

/* ── Send push to all subscribed devices ── */
async function pushAll(
    profiles: { full_name: string | null; onesignal_id: string }[],
    titleFn:  (firstName: string) => string,
    msgFn:    (firstName: string) => string
) {
    if (!profiles.length) return
    await Promise.all(
        profiles.map(p =>
            pushOne(
                p.onesignal_id,
                titleFn(getFirstName(p.full_name)),
                msgFn(getFirstName(p.full_name))
            )
        )
    )
}

/* ════════════════════════════════════════════════════════
   MAIN HANDLER
════════════════════════════════════════════════════════ */
Deno.serve(async (_req) => {
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } }
    )

    const now            = new Date()
    const currentHourUTC = now.getUTCHours()
    const currentMinUTC  = now.getUTCMinutes()

    const [matchesRes, profilesRes] = await Promise.all([
        supabase
            .from('matches')
            .select('*, team_a:team_a_id(short_code), team_b:team_b_id(short_code)')
            .or('status.eq.upcoming,status.eq.locked,status.eq.abandoned'),
        supabase
            .from('user_profiles')
            .select('full_name, onesignal_id')
            .not('onesignal_id', 'is', null),
    ])

    if (matchesRes.error || profilesRes.error) {
        console.error('Fetch error:', matchesRes.error?.message, profilesRes.error?.message)
        return new Response('Error fetching data', { status: 500 })
    }

    const matches  = matchesRes.data  ?? []
    const profiles = profilesRes.data ?? []

    console.log(`Running — matches: ${matches.length}, push profiles: ${profiles.length}`)

    /* ── TRIGGER A: DAILY 12:00 PM IST (06:30 UTC) ── */
    if (currentHourUTC === 6 && currentMinUTC >= 30 && currentMinUTC < 35) {
        const istNow   = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const todayIST = `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${String(istNow.getDate()).padStart(2, '0')}`

        const todaysMatches = matches.filter(m => {
            const matchDate = new Date(m.actual_start_time)
                .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
            return m.status === 'upcoming' && matchDate === todayIST
        })

        if (todaysMatches.length > 0) {
            const matchLines = todaysMatches.map(m =>
                `M#${m.match_number}: ${m.team_a?.short_code || 'TBA'} vs ${m.team_b?.short_code || 'TBA'} at ${toIST(new Date(m.actual_start_time))}`
            )
            const isDouble   = todaysMatches.length >= 2
            const inAppTitle = isDouble ? 'Double Header Today 🏏🏏' : 'Match Day 🏏'
            const inAppMsg   = matchLines.join('\n')
            const pushSummary = todaysMatches
                .map(m => `${m.team_a?.short_code || 'TBA'} vs ${m.team_b?.short_code || 'TBA'}`)
                .join(', ')

            await pushAll(
                profiles,
                (name) => isDouble ? `Double Header Today, ${name}!` : `Match Day, ${name}!`,
                ()     => `${pushSummary} — Set your XI before lock time!`
            )
            await notifyAll(supabase, inAppTitle, inAppMsg, 'info')
        }
    }

    /* ── PER-MATCH TRIGGERS ── */
    for (const match of matches) {
        const startTime    = new Date(match.actual_start_time)
        const originalTime = new Date(match.original_start_time)
        const diffMins     = (startTime.getTime() - now.getTime()) / 60000
        const tA           = match.team_a?.short_code || 'TBA'
        const tB           = match.team_b?.short_code || 'TBA'
        const mNum         = `M#${match.match_number}`
        const istTime      = toIST(startTime)
        const last         = match.last_notification_sent

        /* TRIGGER 1 — POINTS PROCESSED */
        if (match.points_processed && last !== 'points_done') {
            const title = `Points Updated — ${mNum}`
            const msg   = `${tA} vs ${tB} points are live. Check your rank on the leaderboard!`
            await pushAll(profiles,
                (name) => `Points are live, ${name}! — ${mNum}`,
                ()     => msg
            )
            await notifyAll(supabase, title, msg, 'points')
            await markMatchNotified(supabase, match.id, 'points_done')
            continue
        }

        /* TRIGGER 2 — MATCH ABANDONED */
        if (match.status === 'abandoned' && last !== 'abandoned' && last !== 'points_done') {
            const title = `Match Abandoned — ${mNum}`
            const msg   = `${tA} vs ${tB} has been abandoned. No subs or boosters will be deducted.`
            await pushAll(profiles,
                () => `Match Abandoned — ${mNum}`,
                () => `${tA} vs ${tB} cancelled. Your subs and boosters are safe.`
            )
            await notifyAll(supabase, title, msg, 'abandoned')
            await markMatchNotified(supabase, match.id, 'abandoned')
            continue
        }

        /* TRIGGER 3 — TEAM LOCKED */
        if (
            match.status === 'locked' &&
            match.lock_processed &&
            !['locked', 'points_done', 'abandoned'].includes(last)
        ) {
            const title = `Teams Locked — ${mNum}`
            const msg   = `${tA} vs ${tB} has started. Your team is locked in. Good luck!`
            await pushAll(profiles,
                (name) => `Game On, ${name}! — ${mNum}`,
                ()     => `${tA} vs ${tB} is live. Teams locked. Good luck!`
            )
            await notifyAll(supabase, title, msg, 'locked')
            await markMatchNotified(supabase, match.id, 'locked')
            continue
        }

        /* TRIGGER 4 — MATCH DELAYED */
        if (
            match.status === 'upcoming' &&
            startTime > originalTime &&
            !['delayed', 'locked', 'points_done', 'abandoned'].includes(last)
        ) {
            const title = `Match Delayed — ${mNum}`
            const msg   = `${tA} vs ${tB} delayed. New lock time: ${istTime} IST. Check your team!`
            await pushAll(profiles,
                () => `Match Delayed — ${mNum}`,
                () => msg
            )
            await notifyAll(supabase, title, msg, 'delayed')
            await markMatchNotified(supabase, match.id, 'delayed')
            continue
        }

        /* TRIGGER 5 — 30-MINUTE URGENCY */
        if (
            match.status === 'upcoming' &&
            diffMins <= 30 &&
            diffMins > 0 &&
            last === null
        ) {
            const title = `30 Minutes to Lock — ${mNum}`
            const msg   = `${tA} vs ${tB} locks at ${istTime} IST. Make your final changes now!`
            await pushAll(profiles,
                (name) => `Last Chance, ${name}! — ${mNum}`,
                ()     => msg
            )
            await notifyAll(supabase, title, msg, 'info')
            await markMatchNotified(supabase, match.id, 'urgency_30m')
        }
    }

    return new Response(
        JSON.stringify({
            status:          'processed',
            matches_checked: matches.length,
            push_profiles:   profiles.length,
        }),
        { headers: { 'Content-Type': 'application/json' } }
    )
})