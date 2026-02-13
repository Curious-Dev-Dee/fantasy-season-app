import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const { match_id, scoreboard } = await req.json();

    if (!match_id || !scoreboard) {
      return new Response("Missing match_id or scoreboard", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: match } = await supabase
      .from("matches")
      .select("*")
      .eq("id", match_id)
      .single();

    if (!match) {
      return new Response("Match not found", { status: 404 });
    }

    if (match.points_processed) {
      return new Response("Points already processed", { status: 400 });
    }

    await processScorecard(supabase, match, scoreboard);
    await calculateUserMatchPoints(supabase, match);
    await updateLeaderboard(supabase, match);

    await supabase
      .from("matches")
      .update({ points_processed: true })
      .eq("id", match_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response("Processing failed", { status: 500 });
  }
});


// ================= PLAYER MATCHING =================

async function findPlayer(supabase: any, tournament_id: string, jsonPlayer: any) {

  // Try api id
  if (jsonPlayer?.id) {
    const { data } = await supabase
      .from("players")
      .select("id")
      .eq("tournament_id", tournament_id)
      .eq("api_player_id", jsonPlayer.id)
      .maybeSingle();

    if (data) return data;
  }

  // Try name match
  const { data: nameMatch } = await supabase
    .from("players")
    .select("id")
    .eq("tournament_id", tournament_id)
    .ilike("name", jsonPlayer.name)
    .maybeSingle();

  if (nameMatch) return nameMatch;

  // Log unmatched
  await supabase.from("unmatched_players_log").insert({
    match_id: tournament_id,
    json_player_name: jsonPlayer?.name,
    json_player_id: jsonPlayer?.id,
    reason: "No match found"
  });

  return null;
}


// ================= PROCESS SCORECARD =================

async function processScorecard(supabase: any, match: any, scoreboard: any) {

  const playerStats: Record<string, any> = {};

  for (const inning of scoreboard.scorecard || []) {

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

  // Insert all player stats
  for (const key in playerStats) {
    await supabase.from("player_match_stats").insert(playerStats[key]);
  }
}


// ================= INIT STAT OBJECT =================

function initStats(match_id: string, player_id: string) {
  return {
    match_id,
    player_id,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
    overs: 0,
    maidens: 0,
    catches: 0,
    stumpings: 0,
    runouts_direct: 0,
    runouts_assisted: 0,
    is_player_of_match: false,
    fantasy_points: 0
  };
}


// ================= SCORING RULES =================

function calculateBattingPoints(bat: any) {
  let points = 0;

  points += bat.r || 0;
  points += (bat["4s"] || 0) * 1;
  points += (bat["6s"] || 0) * 2;

  if (bat.r >= 50) points += 10;
  else if (bat.r >= 30) points += 5;

  if (bat.r === 0 && bat["dismissal-text"] !== "not out")
    points -= 5;

  return points;
}

function calculateBowlingPoints(bowl: any) {
  let points = 0;

  points += (bowl.w || 0) * 20;

  if (bowl.w >= 3) points += 10;

  if (bowl.o >= 2) {
    if (bowl.eco < 8) points += 10;
    if (bowl.eco > 11) points -= 10;
  }

  return points;
}

function calculateFieldingPoints(field: any) {
  let points = 0;

  points += (field.catch || 0) * 10;
  points += (field.stumped || 0) * 10;

  if (field.runout === 1) {
    points += 10;
  }

  return points;
}


// ================= USER MATCH POINTS =================

async function calculateUserMatchPoints(supabase: any, match: any) {

  const { data: teams } = await supabase
    .from("user_match_teams")
    .select("*")
    .eq("match_id", match.id);

  for (const team of teams || []) {

    const { data: players } = await supabase
      .from("user_match_team_players")
      .select("player_id")
      .eq("user_match_team_id", team.id);

    let rawPoints = 0;

    for (const p of players || []) {
      const { data } = await supabase
        .from("player_match_stats")
        .select("fantasy_points")
        .eq("match_id", match.id)
        .eq("player_id", p.player_id)
        .maybeSingle();

      rawPoints += data?.fantasy_points || 0;
    }

    const captainPoints = await getPlayerPoints(supabase, match.id, team.captain_id);
    const vicePoints = await getPlayerPoints(supabase, match.id, team.vice_captain_id);

    const captainBonus = captainPoints;
    const viceBonus = Math.floor(vicePoints * 0.5);

    const total = rawPoints + captainBonus + viceBonus;

    await supabase.from("user_match_points").insert({
      user_id: team.user_id,
      match_id: match.id,
      tournament_id: match.tournament_id,
      raw_points: rawPoints,
      captain_bonus: captainBonus,
      vice_captain_bonus: viceBonus,
      total_points: total,
      is_counted: true
    });
  }
}

async function getPlayerPoints(supabase: any, match_id: string, player_id: string) {
  if (!player_id) return 0;

  const { data } = await supabase
    .from("player_match_stats")
    .select("fantasy_points")
    .eq("match_id", match_id)
    .eq("player_id", player_id)
    .maybeSingle();

  return data?.fantasy_points || 0;
}


// ================= LEADERBOARD UPDATE =================

async function updateLeaderboard(supabase: any, match: any) {

  const { data: users } = await supabase
    .from("user_match_points")
    .select("user_id, total_points")
    .eq("match_id", match.id);

  for (const u of users || []) {

    const { data: existing } = await supabase
      .from("user_tournament_points")
      .select("*")
      .eq("user_id", u.user_id)
      .eq("tournament_id", match.tournament_id)
      .maybeSingle();

    if (!existing) {
      await supabase.from("user_tournament_points").insert({
        user_id: u.user_id,
        tournament_id: match.tournament_id,
        total_points: u.total_points,
        matches_counted: 1
      });
    } else {
      await supabase
        .from("user_tournament_points")
        .update({
          total_points: existing.total_points + u.total_points,
          matches_counted: existing.matches_counted + 1
        })
        .eq("user_id", u.user_id)
        .eq("tournament_id", match.tournament_id);
    }
  }
}
