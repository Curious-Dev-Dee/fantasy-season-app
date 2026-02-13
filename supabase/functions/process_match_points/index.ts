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

    const { match_id, scoreboard } = await req.json()

    // 1. Fetch all players for exact name matching
    const { data: players } = await supabase.from('players').select('id, name')
    
    // 2. Clear existing stats for this match to allow re-processing
    await supabase.from('player_match_stats').delete().eq('match_id', match_id)

    const statsToInsert = []

    // 3. Process scoreboard JSON (iterating through players)
    for (const p of scoreboard.players) {
      const dbPlayer = players?.find(dp => dp.name === p.name)
      if (!dbPlayer) continue

      const runs = p.runs || 0
      const wickets = p.wickets || 0
      const catches = p.catches || 0
      
      // Points formula: 1pt/run, 25pt/wicket, 8pt/catch
      const fantasyPoints = (runs * 1) + (wickets * 25) + (catches * 8)

      statsToInsert.push({
        match_id,
        player_id: dbPlayer.id,
        runs,
        wickets,
        catches,
        fantasy_points: fantasyPoints
      })
    }

    // 4. Save Player Stats
    await supabase.from('player_match_stats').insert(statsToInsert)

    // 5. Finalize User Match Points with Bonuses
    const { data: userTeams } = await supabase
      .from('user_match_teams')
      .select('id, user_id, tournament_id, captain_id, vice_captain_id')
      .eq('match_id', match_id)

    const { data: allStats } = await supabase
      .from('player_match_stats')
      .select('player_id, fantasy_points')
      .eq('match_id', match_id)

    const statsMap = Object.fromEntries(allStats.map(s => [s.player_id, s.fantasy_points]))

    for (const team of userTeams || []) {
      const { data: teamPlayers } = await supabase
        .from('user_match_team_players')
        .select('player_id')
        .eq('user_match_team_id', team.id)

      let rawPoints = 0
      teamPlayers?.forEach(tp => rawPoints += (statsMap[tp.player_id] || 0))

      const cBonus = statsMap[team.captain_id] || 0 // Extra 1x for Captain
      const vcBonus = (statsMap[team.vice_captain_id] || 0) * 0.5 // Extra 0.5x for VC

      await supabase.from('user_match_points').upsert({
        user_id: team.user_id,
        match_id: match_id,
        tournament_id: team.tournament_id,
        raw_points: rawPoints,
        captain_bonus: cBonus,
        vice_captain_bonus: vcBonus,
        total_points: rawPoints + cBonus + vcBonus,
        is_counted: true
      }, { onConflict: 'user_id,match_id' })
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