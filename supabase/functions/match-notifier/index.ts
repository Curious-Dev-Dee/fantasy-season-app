import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')
const ONESIGNAL_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const now = new Date()
  const currentHourUTC = now.getUTCHours()
  const currentMinUTC = now.getUTCMinutes()

  // 1. FETCH ALL RELEVANT MATCHES with corrected real_teams columns
  const { data: matches, error } = await supabase
    .from('matches')
    .select(`
      *,
      team_a:team_a_id(name, short_code),
      team_b:team_b_id(name, short_code)
    `)
    .or(`status.eq.upcoming,status.eq.locked,status.eq.abandoned`)

  if (error || !matches) return new Response("Error fetching matches", { status: 500 });

  // ---------------------------------------------------------
  // TRIGGER A: DAILY 12:00 PM IST PREVIEW (06:30 AM UTC)
  // ---------------------------------------------------------
  if (currentHourUTC === 6 && currentMinUTC >= 30 && currentMinUTC < 35) {
    const todayStr = now.toISOString().split('T')[0]
    const todaysMatches = matches.filter(m => 
      m.status === 'upcoming' && m.actual_start_time.startsWith(todayStr)
    )

    if (todaysMatches.length > 0) {
      const matchDetails = todaysMatches.map(m => {
        const time = new Date(m.actual_start_time).toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
        })
        // Using short_code (e.g., IND vs AUS)
        return `${m.team_a.short_code} vs ${m.team_b.short_code} @ ${time}`
      }).join(", ")

      await sendNotification(
        "Today's Lineup! 🏏",
        `${todaysMatches.length} Matches today: ${matchDetails}. Set your XI now to stay ahead!`,
        "all"
      )
    }
  }

  // ---------------------------------------------------------
  // LOOP THROUGH INDIVIDUAL MATCHES FOR REAL-TIME EVENTS
  // ---------------------------------------------------------
  for (const match of matches) {
    const startTime = new Date(match.actual_start_time)
    const originalTime = new Date(match.original_start_time)
    const diffMins = (startTime.getTime() - now.getTime()) / 60000
    const istTimeStr = startTime.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
    })

    // TRIGGER B: 30-MINUTE URGENCY
    if (match.status === 'upcoming' && diffMins <= 30 && diffMins > 24 && match.last_notification_sent !== 'urgency_30m') {
      await sendNotification(
        "30 MINS TO LOCK! 🚨",
        `Finalize your XI for ${match.team_a.short_code} vs ${match.team_b.short_code}. Match starts at ${istTimeStr}!`,
        "all"
      )
      await updateMatchNotifyStatus(supabase, match.id, 'urgency_30m')
    }

    // TRIGGER C: RAIN DELAY (If actual time > original time)
    if (match.status === 'upcoming' && startTime > originalTime && match.last_notification_sent !== 'delayed') {
      await sendNotification(
        "Rain Delay Update 🌧️",
        `Match ${match.team_a.short_code} vs ${match.team_b.short_code} is delayed. New lock time: ${istTimeStr}!`,
        "all"
      )
      await updateMatchNotifyStatus(supabase, match.id, 'delayed')
    }

    // TRIGGER D: MATCH LOCKED
    if (match.status === 'locked' && match.lock_processed && match.last_notification_sent !== 'locked') {
      await sendNotification(
        "Locked & Loaded! 🔒",
        `Teams for ${match.team_a.short_code} vs ${match.team_b.short_code} are now locked. Good luck!`,
        "all"
      )
      await updateMatchNotifyStatus(supabase, match.id, 'locked')
    }

    // TRIGGER E: ABANDONED
    if (match.status === 'abandoned' && match.last_notification_sent !== 'abandoned') {
      await sendNotification(
        "Match Abandoned 🚫",
        `${match.team_a.short_code} vs ${match.team_b.short_code} abandoned. No points, but no subs deducted!`,
        "all"
      )
      await updateMatchNotifyStatus(supabase, match.id, 'abandoned')
    }

    // TRIGGER F: POINTS PROCESSED
    if (match.points_processed && match.last_notification_sent !== 'points_done') {
      await sendNotification(
        "Points Are Live! 📊",
        `Leaderboard updated for ${match.team_a.short_code} vs ${match.team_b.short_code}. Check your rank!`,
        "all"
      )
      await updateMatchNotifyStatus(supabase, match.id, 'points_done')
    }
  }

  return new Response(JSON.stringify({ status: "processed" }), {
    headers: { "Content-Type": "application/json" }
  })
})

async function updateMatchNotifyStatus(supabase: any, matchId: string, type: string) {
  await supabase.from('matches').update({ last_notification_sent: type }).eq('id', matchId)
}

async function sendNotification(title: string, message: string, target: string) {
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Basic ${ONESIGNAL_KEY}`
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      included_segments: target === "all" ? ["All"] : undefined,
      headings: { "en": title },
      contents: { "en": message },
      android_accent_color: "9AE000",
      small_icon: "ic_stat_onesignal_default"
    })
  })
  return res.json()
}