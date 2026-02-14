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
    const innings = scoreboard.data.scorecard; // The correct path for your JSON

    // 1. Fetch all players for matching
    const { data: dbPlayers } = await supabase.from('players').select('id, name')
    
    // 2. Clear existing stats for this match
    await supabase.from('player_match_stats').delete().eq('match_id', match_id)

    // 3. Create a map to accumulate stats for each player
    const playerMap = new Map();

    // 4. CRAWL THE JSON (Batting, Bowling, Catching)
    innings.forEach(inning => {
      // Process Batting
      inning.batting?.forEach(b => {
        const pId = b.batsman.id;
        const stats = playerMap.get(pId) || { name: b.batsman.name, runs: 0, wickets: 0, catches: 0 };
        stats.runs += (b.r || 0);
        playerMap.set(pId, stats);
      });

      // Process Bowling
      inning.bowling?.forEach(bw => {
        const pId = bw.bowler.id;
        const stats = playerMap.get(pId) || { name: bw.bowler.name, runs: 0, wickets: 0, catches: 0 };
        stats.wickets += (bw.w || 0);
        playerMap.set(pId, stats);
      });

      // Process Catching
      inning.catching?.forEach(c => {
        const pId = c.catcher.id;
        const stats = playerMap.get(pId) || { name: c.catcher.name, runs: 0, wickets: 0, catches: 0 };
        stats.catches += (c.catch || 0);
        playerMap.set(pId, stats);
      });
    });

    // 5. Build Insert Array with Points Formula
    const statsToInsert = [];
    playerMap.forEach((val, key) => {
      const dbMatch = dbPlayers?.find(p => p.name === val.name);
      if (dbMatch) {
        const totalPoints = (val.runs * 1) + (val.wickets * 25) + (val.catches * 8);
        statsToInsert.push({
          match_id,
          player_id: dbMatch.id,
          runs: val.runs,
          wickets: val.wickets,
          catches: val.catches,
          fantasy_points: totalPoints
        });
      }
    });

    // 6. INSERT STATS
    await supabase.from('player_match_stats').insert(statsToInsert)

    // 7. TRIGGER THE USER UPDATE (This part remains the same)
    // [Keep the same loop you had for user_match_points here...]

    return new Response(JSON.stringify({ success: true, playersProcessed: statsToInsert.length }), {
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