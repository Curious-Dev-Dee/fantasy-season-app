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

  // 1. FETCH MATCHES AND ACTIVE EXPERT PROFILES
  // Using Promise.all for maximum speed
  const [matchesRes, profilesRes] = await Promise.all([
    supabase
      .from('matches')
      .select(`*, team_a:team_a_id(short_code), team_b:team_b_id(short_code)`)
      .or(`status.eq.upcoming,status.eq.locked,status.eq.abandoned`),
    supabase
      .from('user_profiles')
      .select('full_name, onesignal_id')
      .eq('is_active', true)
      .not('onesignal_id', 'is', null)
  ]);

  if (matchesRes.error || profilesRes.error) return new Response("Error fetching data", { status: 500 });
  
  const matches = matchesRes.data;
  const profiles = profilesRes.data;

  // TRIGGER A: DAILY 12:00 PM IST PREVIEW (06:30 AM UTC)
  if (currentHourUTC === 6 && currentMinUTC >= 30 && currentMinUTC < 35) {
    const todayStr = now.toISOString().split('T')[0]
    const todaysMatches = matches.filter(m => 
      m.status === 'upcoming' && m.actual_start_time.startsWith(todayStr)
    )

    if (todaysMatches.length > 0) {
      const matchText = todaysMatches.map(m => `${m.team_a.short_code} vs ${m.team_b.short_code}`).join(", ")
      
      await Promise.all(profiles.map(profile => {
        const firstName = profile.full_name.split(' ')[0];
        return sendPersonalizedNotification(
          profile.onesignal_id,
          `Good Afternoon, ${firstName}! 🏏`,
          `Aaj ${matchText} ki pitch ready hai. Rank 1 waali team banaoge ya wahi puraani 'safe' strategy? 😉 Set your XI!`
        );
      }));
    }
  }

  // LOOP THROUGH INDIVIDUAL MATCHES - Waterfall Priority Logic
  for (const match of matches) {
    const startTime = new Date(match.actual_start_time)
    const originalTime = new Date(match.original_start_time)
    const diffMins = (startTime.getTime() - now.getTime()) / 60000
    const istTimeStr = startTime.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
    })

    // --- TRIGGER 1: POINTS PROCESSED (Highest Priority) ---
    if (match.points_processed && match.last_notification_sent !== 'points_done') {
      await Promise.all(profiles.map(profile => {
        const firstName = profile.full_name.split(' ')[0];
        return sendPersonalizedNotification(
          profile.onesignal_id,
          `Zilzal Aagaya, ${firstName}! 📊`,
          `Results out hain! Leaderboard pe aag laga di ya fir kal ke liye nets practice shuru? 😉 Check rank now!`
        );
      }));
      await updateMatchNotifyStatus(supabase, match.id, 'points_done');
      continue; 
    }

    // --- TRIGGER 2: ABANDONED ---
    if (match.status === 'abandoned' && match.last_notification_sent !== 'abandoned' && match.last_notification_sent !== 'points_done') {
      await Promise.all(profiles.map(profile => {
        return sendPersonalizedNotification(
          profile.onesignal_id,
          "Match Abandoned 🚫",
          `${match.team_a.short_code} vs ${match.team_b.short_code} cancel ho gaya boss. No subs deducted!`
        );
      }));
      await updateMatchNotifyStatus(supabase, match.id, 'abandoned');
      continue;
    }

    // --- TRIGGER 3: MATCH LOCKED ---
    if (match.status === 'locked' && match.lock_processed && !['locked', 'points_done', 'abandoned'].includes(match.last_notification_sent)) {
      await Promise.all(profiles.map(profile => {
        const firstName = profile.full_name.split(' ')[0];
        return sendPersonalizedNotification(
          profile.onesignal_id,
          `Game On, ${firstName}! 🔒`,
          `Sabki kismat lock ho chuki hai. Dekhte hain kiske pass 'Expert' dimaag hai aur kiske pass sirf luck! Best of luck!`
        );
      }));
      await updateMatchNotifyStatus(supabase, match.id, 'locked');
      continue;
    }

    // --- TRIGGER 4: RAIN DELAY ---
    if (match.status === 'upcoming' && startTime > originalTime && !['delayed', 'locked', 'points_done'].includes(match.last_notification_sent)) {
      await Promise.all(profiles.map(profile => {
        return sendPersonalizedNotification(
          profile.onesignal_id,
          "Baarish Update! 🌧️",
          `Match delay ho gaya hai. New lock time: ${istTimeStr}. Ek baar XI check kar lo!`
        );
      }));
      await updateMatchNotifyStatus(supabase, match.id, 'delayed');
      continue;
    }

    // --- TRIGGER 5: 30-MINUTE URGENCY ---
    if (match.status === 'upcoming' && diffMins <= 30 && diffMins > 0 && match.last_notification_sent === null) {
      await Promise.all(profiles.map(profile => {
        const firstName = profile.full_name.split(' ')[0];
        return sendPersonalizedNotification(
          profile.onesignal_id,
          `Aakhri Over, ${firstName}! 🚨`,
          `30 mins bache hain. Kahin koi star player bench pe toh nahi reh gaya? Lock hone se pehle dekh lo!`
        );
      }));
      await updateMatchNotifyStatus(supabase, match.id, 'urgency_30m');
    }
  }

  return new Response(JSON.stringify({ status: "processed" }), { headers: { "Content-Type": "application/json" } })
})

// HELPER: Update Database Memory
async function updateMatchNotifyStatus(supabase: any, matchId: string, type: string) {
  const { error } = await supabase
    .from('matches')
    .update({ 
      last_notification_sent: type,
      last_notification_at: new Date().toISOString() 
    })
    .eq('id', matchId);

  if (error) console.error(`❌ DB Update Failed:`, error.message);
  else console.log(`✅ DB Synced: ${type} for ${matchId}`);
}

// HELPER: Send Individual Personalized Notification
async function sendPersonalizedNotification(onesignalId: string, title: string, message: string) {
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "Authorization": `Basic ${ONESIGNAL_KEY}` },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: [onesignalId],
      headings: { "en": title },
      contents: { "en": message }
    })
  });
  return res.json();
}