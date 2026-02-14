import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { match_id, tournament_id, scoreboard } = await req.json()
    const innings = scoreboard.data.scorecard

    // 1️⃣ Fetch DB players
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name')

    // 2️⃣ Clear old match stats
    await supabase
      .from('player_match_stats')
      .delete()
      .eq('match_id', match_id)

    const playerMap = new Map()

    // 3️⃣ Parse JSON
    innings.forEach(inning => {
      inning.batting?.forEach(b => {
        const pId = b.batsman.id
        const stats = playerMap.get(pId) || { name: b.batsman.name, runs: 0, wickets: 0, catches: 0 }
        stats.runs += (b.r || 0)
        playerMap.set(pId, stats)
      })

      inning.bowling?.forEach(bw => {
        const pId = bw.bowler.id
        const stats = playerMap.get(pId) || { name: bw.bowler.name, runs: 0, wickets: 0, catches: 0 }
        stats.wickets += (bw.w || 0)
        playerMap.set(pId, stats)
      })

      inning.catching?.forEach(c => {
        const pId = c.catcher.id
        const stats = playerMap.get(pId) || { name: c.catcher.name, runs: 0, wickets: 0, catches: 0 }
        stats.catches += (c.catch || 0)
        playerMap.set(pId, stats)
      })
    })

    // 4️⃣ Build insert array
    const statsToInsert: any[] = []

    playerMap.forEach((val) => {
      const dbMatch = dbPlayers?.find(p => p.name === val.name)
      if (dbMatch) {
        const totalPoints = (val.runs * 1) + (val.wickets * 25) + (val.catches * 8)
        statsToInsert.push({
          match_id,
          player_id: dbMatch.id,
          runs: val.runs,
          wickets: val.wickets,
          catches: val.catches,
          fantasy_points: totalPoints
        })
      }
    })

    await supabase.from('player_match_stats').insert(statsToInsert)

    // 5️⃣ CALCULATE USER MATCH POINTS

    const { data: userTeams } = await supabase
      .from('user_match_teams')
      .select('id, user_id')
      .eq('match_id', match_id)

    for (const team of userTeams || []) {

      const { data: teamPlayers } = await supabase
        .from('user_match_team_players')
        .select('player_id')
        .eq('user_match_team_id', team.id)

      const playerIds = teamPlayers?.map(p => p.player_id) || []

      const { data: playerStats } = await supabase
        .from('player_match_stats')
        .select('player_id, fantasy_points')
        .eq('match_id', match_id)
        .in('player_id', playerIds)

      let rawPoints = 0

      playerStats?.forEach(p => {
        rawPoints += p.fantasy_points || 0
      })

      await supabase.from('user_match_points').upsert({
        user_id: team.user_id,
        match_id,
        tournament_id,
        raw_points: rawPoints,
        captain_bonus: 0,
        vice_captain_bonus: 0,
        total_points: rawPoints,
        is_counted: true
      }, { onConflict: 'user_id,match_id' })
    }

    // 6️⃣ RECALCULATE TOURNAMENT TOTALS

    const { data: aggregated } = await supabase
      .from('user_match_points')
      .select('user_id, total_points')
      .eq('tournament_id', tournament_id)

    const userTotals = new Map()

    aggregated?.forEach(row => {
      const current = userTotals.get(row.user_id) || 0
      userTotals.set(row.user_id, current + row.total_points)
    })

    for (const [userId, total] of userTotals.entries()) {
      await supabase.from('user_tournament_points').upsert({
        user_id: userId,
        tournament_id,
        total_points: total,
        matches_counted: aggregated?.filter(r => r.user_id === userId).length || 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,tournament_id' })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
