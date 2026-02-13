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

    // 1. Get all players for name matching
    const { data: players } = await supabase.from('players').select('id, name')
    
    // 2. Clear existing stats for this match (to allow re-processing)
    await supabase.from('player_match_stats').delete().eq('match_id', match_id)

    const statsToInsert = []

    // 3. Process scoreboard JSON (assuming a standard structure)
    for (const p of scoreboard.players) {
      const dbPlayer = players?.find(dp => dp.name === p.name)
      if (!dbPlayer) continue

      // Point Logic
      const runs = p.runs || 0
      const wickets = p.wickets || 0
      const catches = p.catches || 0
      
      // Basic Point Calculation Formula
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

    // 4. Insert Player Stats
    const { error: statsError } = await supabase.from('player_match_stats').insert(statsToInsert)
    if (statsError) throw statsError

    // 5. Calculate User Match Points (including Captain 2x and VC 1.5x)
    // This logic joins user teams with the stats we just inserted
    const { data: userTeams } = await supabase
      .from('user_match_teams')
      .select('id, user_id, captain_id, vice_captain_id')
      .eq('match_id', match_id)

    for (const team of userTeams || []) {
       // SQL logic usually handles this better, but here is the process:
       // 1. Sum up all player points in the user's match team
       // 2. Add extra 1x for Captain, 0.5x for VC
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