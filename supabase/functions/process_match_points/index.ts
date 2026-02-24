import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. EXTRACT DATA SAFELY (Added winner_id and defaults)
    const body = await req.json();
    const { 
        match_id, 
        tournament_id, 
        scoreboard = [], 
        pom_id = null, 
        winner_id = null // Now captured from Admin JS
    } = body;

    console.log(`[START] Processing Match: ${match_id} | Winner: ${winner_id}`);

    // Helper to convert cricket overs (3.2) to mathematical overs (3.33)
const getTrueOvers = (overs: number) => {
  const wholeOvers = Math.floor(overs);
  const balls = Math.round((overs - wholeOvers) * 10);
  return wholeOvers + (balls / 6);
};

    // 1. Fetch all players to map Names to IDs
    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name')
      .eq('is_active', true);

    if (pError) throw pError;
    
    const nameToIdMap = Object.fromEntries(
      dbPlayers.map(p => [p.name.trim().toLowerCase(), p.id])
    );

    // 2. Map JSON stats and Apply NEW Rules
    const statsToUpsert = scoreboard.map((p: any) => {
      const playerNameClean = p.player_name.trim().toLowerCase();
      const playerId = nameToIdMap[playerNameClean];
      
      if (!playerId) return null;

      const runs = Number(p.runs || 0);
      const balls = Number(p.balls || 0);
      const fours = Number(p.fours || 0);
      const sixes = Number(p.sixes || 0);
      const wickets = Number(p.wickets || 0);
      const maidens = Number(p.maidens || 0);
      const catches = Number(p.catches || 0);
      const stumpings = Number(p.stumpings || 0);
      const runouts = Number(p.runouts_direct || 0) + Number(p.runouts_assisted || 0);
      const isOut = String(p.is_out) === "true";

      // --- NEW FANTASY SCORING LOGIC ---
      // --- NEW FANTASY SCORING LOGIC ---
      let pts = 0;
      let sr_pts = 0;        // To store Runs - Balls
      let er_pts = 0;        // To store Economy Bonus/Penalty
      let milestone_pts = 0; // To store 30/50/100 bonuses
      let boundary_pts = 0;  // To store Fours/Sixes bonuses
      let duck_pts = 0;      // To store the -2 penalty
      let involve_pts = 0;   // To store the +4 involvement

      // A. Batting
      // A. Batting
      pts += runs; 
      boundary_pts = (fours * 1) + (sixes * 2); // Capture boundary points
      pts += boundary_pts;
      
      if (runs >= 100) milestone_pts = 20;
      else if (runs >= 75) milestone_pts = 15;
      else if (runs >= 50) milestone_pts = 10;
      else if (runs >= 30) milestone_pts = 5;
      pts += milestone_pts;

      if (runs === 0 && isOut) {
          duck_pts = -2; // Capture penalty
          pts += duck_pts;
      }

      sr_pts = (runs - balls); // Capture Strike Rate points
      pts += sr_pts;
      
      // B. Bowling
      if (wickets > 0) {
        pts += 20 + ((wickets - 1) * 25); // 1st: 20, 2nd+: 25
      }
      pts += (maidens * 10);

      // Economy Rate Calculation (Min 2 Overs)
const rawOvers = Number(p.overs || 0);
if (rawOvers >= 2) {
  const trueOvers = getTrueOvers(rawOvers); // Use the helper here
  const rpo = Number(p.runs_conceded || 0) / trueOvers; // Precise RPO
  
  if (rpo < 5) er_pts = 8;
      else if (rpo < 6) er_pts = 6;
      else if (rpo <= 7) er_pts = 4;
      else if (rpo > 12) er_pts = -6;
      else if (rpo > 11) er_pts = -4;
      
      pts += er_pts; // Add the captured value to total
}

      // C. Fielding
      pts += (catches * 8);
      pts += (stumpings * 8);
      pts += (runouts * 8); // Flat 8 as requested

      // D. Involvement Bonus (+4)
      if (pts !== 0) {
          involve_pts = 4;
          pts += involve_pts;
      }

      // E. Player of the Match (+20)
      const isPOM = (playerId === pom_id);
      if (isPOM) pts += 20;

      return {
        match_id,
        player_id: playerId,
        runs,
        balls,
        fours,
        sixes,
        wickets,
        overs: rawOvers,
        runs_conceded: Number(p.runs_conceded || 0),
        maidens,
        catches,
        stumpings,
        runouts_direct: runouts_dir,
        runouts_assisted: runouts_asst,
        is_player_of_match: isPOM,
        is_out: isOut,
        sr_points: sr_pts,
        er_points: er_pts,
        milestone_points: milestone_pts,
        boundary_points: boundary_pts,
        duck_penalty: duck_pts,
        involvement_points: involve_pts,
        fantasy_points: Math.round(pts)
      };
    }).filter(Boolean);

    // 3. Upsert into DB (triggers will handle the rest)
// ... (rest of the function stays the same)

    // 3. Upsert Player Stats
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

    if (upsertError) throw upsertError;

    // 4. Trigger the SQL RPC to update User Leaderboards
    // ... (inside the try block, after step 3)

// 4. Trigger the SQL RPC to update User Leaderboards AND Fun Zone Predictions
const { error: rpcError } = await supabase.rpc('update_leaderboard_after_match', { 
  target_match_id: match_id,
  p_winner_id: winner_id, // NEW: Pass winner from req.json()
  p_pom_id: pom_id        // NEW: Pass pom_id from req.json()
});

if (rpcError) throw rpcError;

// 5. Mark match as processed and save official winner/motm to matches table
await supabase.from('matches').update({ 
    points_processed: true,
    winner_id: winner_id, // Saved for results view
    man_of_the_match_id: pom_id, // Saved for results view
    status: 'completed' // Important for UI toggle
}).eq('id', match_id);
    return new Response(JSON.stringify({ success: true, players_processed: statsToUpsert.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[CRITICAL ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});