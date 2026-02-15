import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle CORS for the browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { match_id, scoreboard, tournament_id } = await req.json()

    // --- CRITICAL LOGGING ---
    console.log(`Processing Match: ${match_id}`)
    console.log(`Players received: ${scoreboard?.length}`)

    if (!match_id || !scoreboard || scoreboard.length === 0) {
      throw new Error("Missing match_id or empty scoreboard data.")
    }

    // 2. Map the data into the Database Format
    const statsToUpsert = scoreboard.map((p: any) => {
      // THE MATH FORMULA
      let points = 0
      const runs = p.runs || 0
      const sixes = p.sixes || 0
      const fours = p.fours || 0
      const wickets = p.wickets || 0
      const isOut = p.is_out || false

      // Example T20 Points logic
      points += runs * 1          // 1 pt per run
      points += fours * 1         // 1 pt bonus per 4
      points += sixes * 2         // 2 pt bonus per 6
      points += wickets * 25      // 25 pts per wicket
      
      if (runs >= 50) points += 8  // Half-century bonus
      if (runs >= 100) points += 16 // Century bonus
      if (runs === 0 && isOut) points -= 2 // Duck penalty

      return {
        match_id: match_id,
        name: p.player_name, // Matches the 'player_name' from your admin.js parser
        runs: runs,
        balls: p.balls || 0,
        fours: fours,
        sixes: sixes,
        wickets: wickets,
        overs: p.overs || 0,
        runs_conceded: p.runs_conceded || 0,
        maidens: p.maidens || 0,
        points: points
      }
    })

    // 3. UPSERT TO DATABASE
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, name' })

    if (upsertError) throw upsertError

    // 4. TRIGGER LEADERBOARD UPDATE
    // This calls your RPC or logic to recalculate user scores
    const { error: rpcError } = await supabase.rpc('update_leaderboard_after_match', {
        target_match_id: match_id
    })

    return new Response(JSON.stringify({ success: true, count: statsToUpsert.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Function Error:", error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})