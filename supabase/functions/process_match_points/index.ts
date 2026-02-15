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
    const scorecard = scoreboard.data.scorecard

    // 1️⃣ Fetch all players to get their DB IDs
    const { data: dbPlayers } = await supabase.from('players').select('id, name')

    // 2️⃣ Clear old match stats (Trigger will handle the cascading cleanup)
    await supabase.from('player_match_stats').delete().eq('match_id', match_id)

    const playerMap = new Map()

    // 3️⃣ Parse JSON Scorecard
    scorecard.forEach(inning => {
      inning.batting?.forEach(b => {
        const stats = playerMap.get(b.batsman.name) || { runs: 0, wickets: 0, catches: 0 }
        stats.runs += (b.r || 0)
        playerMap.set(b.batsman.name, stats)
      })

      inning.bowling?.forEach(bw => {
        const stats = playerMap.get(bw.bowler.name) || { runs: 0, wickets: 0, catches: 0 }
        stats.wickets += (bw.w || 0)
        playerMap.set(bw.bowler.name, stats)
      })

      inning.catching?.forEach(c => {
        const stats = playerMap.get(c.catcher.name) || { runs: 0, wickets: 0, catches: 0 }
        stats.catches += (c.catch || 0)
        playerMap.set(c.catcher.name, stats)
      })
    })

    // 4️⃣ Insert Player Stats
    // The moment this is inserted, your SQL Trigger "tr_update_user_points" 
    // will automatically update User Match Points and the Leaderboard!
    const statsToInsert = []
    playerMap.forEach((val, playerName) => {
      const dbMatch = dbPlayers?.find(p => p.name.trim().toLowerCase() === playerName.trim().toLowerCase())
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

    const { error: insertError } = await supabase.from('player_match_stats').insert(statsToInsert)
    if (insertError) throw insertError

    return new Response(JSON.stringify({ success: true, message: "Stats inserted. Database triggers are updating leaderboard..." }), {
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