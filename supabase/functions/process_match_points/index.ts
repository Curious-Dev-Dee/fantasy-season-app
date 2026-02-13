import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1. DEFINE CORS HEADERS (The Fix)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 2. HANDLE BROWSER PRE-FLIGHT CHECK (OPTIONS Request)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { match_id, scoreboard } = await req.json();

    if (!match_id || !scoreboard) {
      return new Response("Missing match_id or scoreboard", { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- MATCH VALIDATION ---
    const { data: match } = await supabase
      .from("matches")
      .select("*")
      .eq("id", match_id)
      .single();

    if (!match) {
      return new Response("Match not found", { 
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (match.points_processed) {
      return new Response("Points already processed", { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // --- JSON PARSING ---
    const scorecardData = scoreboard.scorecard || scoreboard.data?.scorecard;

    if (!scorecardData) {
      console.error("JSON Error: ", scoreboard);
      return new Response("Invalid JSON: Could not find 'scorecard' array", { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // --- PROCESSING ---
    await processScorecard(supabase, match, scorecardData);
    await calculateUserMatchPoints(supabase, match);
    await updateLeaderboard(supabase, match);

    // --- MARK COMPLETE ---
    await supabase
      .from("matches")
      .update({ points_processed: true })
      .eq("id", match_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});


// ================= PLAYER MATCHING (NAME ONLY) =================

async function findPlayer(supabase: any, tournament_id: string, jsonPlayer: any) {
  const nameToFind = jsonPlayer.name.trim();

  const { data } = await supabase
    .from("players")
    .select("id")
    .eq("tournament_id", tournament_id)
    .ilike("name", nameToFind) 
    .maybeSingle();

  if (data) return data;

  console.log(`❌ Unmatched Player: "${nameToFind}"`);
  await supabase.from("unmatched_players_log").insert({
    match_id: tournament_id,
    json_player_name: nameToFind,
    reason: "Name mismatch"
  });

  return null;
}

// ================= PROCESSING LOGIC =================

async function processScorecard(supabase: any, match: any, scorecard: any[]) {
  const playerStats: Record<string, any> = {};

  for (const inning of scorecard || []) {
    // Batting
    for (const bat of inning.batting || []) {
      const player = await findPlayer(supabase, match.tournament_id, bat.batsman);
      if (!player) continue;
      const id = player.id;
      if (!playerStats[id]) playerStats[id] = initStats(match.id, id);
      playerStats[id].runs += bat.r || 0;
      playerStats[id].balls += bat.b || 0;
      playerStats[id].fours += bat["4s"] || 0;
      playerStats[id].sixes += bat["6s"] || 0;
      playerStats[id].fantasy_points += calculateBattingPoints(bat);
    }
    // Bowling
    for (const bowl of inning.bowling || []) {
      const player = await findPlayer(supabase, match.tournament_id, bowl.bowler);
      if (!player) continue;
      const id = player.id;
      if (!playerStats[id]) playerStats[id] = initStats(match.id, id);
      playerStats[id].wickets += bowl.w || 0;
      playerStats[id].overs += bowl.o || 0;
      playerStats[id].maidens += bowl.m || 0;
      playerStats[id].fantasy_points += calculateBowlingPoints(bowl);
    }
    // Fielding
    for (const field of inning.catching || []) {
      const player = await findPlayer(supabase, match.tournament_id, field.catcher);
      if (!player) continue;
      const id = player.id;
      if (!playerStats[id]) playerStats[id] = initStats(match.id, id);
      playerStats[id].catches += field.catch || 0;
      playerStats[id].stumpings += field.stumped || 0;
      playerStats[id].runouts_direct += field.runout === 1 ? 1 : 0;
      playerStats[id].fantasy_points += calculateFieldingPoints(field);
    }
  }

  const statsArray = Object.values(playerStats);
  if (statsArray.length > 0) {
    await supabase.from("player_match_stats").insert(statsArray);
  }
}

function initStats(match_id: string, player_id: string) {
  return {
    match_id, player_id,
    runs: 0, balls: 0, fours: 0, sixes: 0,
    wickets: 0, overs: 0, maidens: 0,
    catches: 0, stumpings: 0, runouts_direct: 0, runouts_assisted: 0,
    is_player_of_match: false, fantasy_points: 0
  };
}

function calculateBattingPoints(bat: any) {
  let p = 0;
  p += bat.r || 0;
  p += (bat["4s"] || 0) * 1;
  p += (bat["6s"] || 0) * 2;
  if (bat.r >= 30) p += 4;
  if (bat.r >= 50) p += 8;
  if (bat.r >= 100) p += 16;
  if (bat.r === 0 && bat["dismissal-text"] !== "not out") p -= 2;
  return p;
}

function calculateBowlingPoints(bowl: any) {
  let p = 0;
  p += (bowl.w || 0) * 25;
  if (bowl.w >= 3) p += 4;
  if (bowl.w >= 5) p += 16;
  if (bowl.m > 0) p += 8;
  return p;
}

function calculateFieldingPoints(field: any) {
  let p = 0;
  p += (field.catch || 0) * 8;
  p += (field.stumped || 0) * 12;
  if (field.runout === 1) p += 6;
  return p;
}

async function calculateUserMatchPoints(supabase: any, match: any) {
  const { data: teams } = await supabase
    .from("user_match_teams")
    .select("id, user_id, captain_id, vice_captain_id")
    .eq("match_id", match.id);

  if (!teams) return;

  const { data: stats } = await supabase
    .from("player_match_stats")
    .select("player_id, fantasy_points")
    .eq("match_id", match.id);
  
  const pMap: Record<string, number> = {};
  stats?.forEach((s: any) => pMap[s.player_id] = s.fantasy_points);

  const updates = [];
  for (const team of teams) {
    const { data: teamPlayers } = await supabase
      .from("user_match_team_players")
      .select("player_id")
      .eq("user_match_team_id", team.id);

    let raw = 0;
    teamPlayers?.forEach((tp: any) => raw += (pMap[tp.player_id] || 0));

    const cPoints = pMap[team.captain_id] || 0;
    const vcPoints = pMap[team.vice_captain_id] || 0;

    updates.push({
      user_id: team.user_id,
      match_id: match.id,
      tournament_id: match.tournament_id,
      raw_points: raw,
      captain_bonus: cPoints,
      vice_captain_bonus: vcPoints * 0.5,
      total_points: raw + cPoints + (vcPoints * 0.5),
      is_counted: true
    });
  }

  if (updates.length > 0) {
    await supabase.from("user_match_points").insert(updates);
  }
}

async function updateLeaderboard(supabase: any, match: any) {
  const { data: newPoints } = await supabase
    .from("user_match_points")
    .select("user_id, total_points")
    .eq("match_id", match.id);

  if (!newPoints) return;

  for (const entry of newPoints) {
    const { data: existing } = await supabase
      .from("user_tournament_points")
      .select("total_points, matches_counted")
      .eq("user_id", entry.user_id)
      .eq("tournament_id", match.tournament_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("user_tournament_points")
        .update({
          total_points: existing.total_points + entry.total_points,
          matches_counted: existing.matches_counted + 1
        })
        .eq("user_id", entry.user_id)
        .eq("tournament_id", match.tournament_id);
    } else {
      await supabase.from("user_tournament_points").insert({
        user_id: entry.user_id,
        tournament_id: match.tournament_id,
        total_points: entry.total_points,
        matches_counted: 1
      });
    }
  }
}