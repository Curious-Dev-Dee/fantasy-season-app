import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- IPL 2026 CONFIGURATION ---
const LEAGUE_STAGE_END = 70;
const PLAYOFF_START = 71;
const KNOCKOUT_PHASE = 72;   // Match 72 = Start of the 10-sub pool
const BOOSTER_WINDOW_START = 11; 
const BOOSTER_WINDOW_END = 70;

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const now = new Date().toISOString();

    const { data: matches, error: matchError } = await supabase
      .from("matches")
      .select("*")
      .lte("actual_start_time", now) 
      .eq("lock_processed", false)
      .eq("status", "upcoming");

    if (matchError) throw matchError;

    for (const match of matches ?? []) {
      await lockSingleMatch(supabase, match);
    }

    return new Response(
      JSON.stringify({ status: "ok", locked: matches?.length ?? 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response("Lock failed", { status: 500 });
  }
});

async function lockSingleMatch(supabase: any, match: any) {
  console.log(`Locking match ${match.id}`);

  const { error: lockError } = await supabase
    .from("matches")
    .update({
      status: "locked",
      lock_processed: true,
      locked_at: new Date().toISOString(),
    })
    .eq("id", match.id)
    .eq("lock_processed", false);

  if (lockError) {
    console.error("Match lock failed", lockError);
    return;
  }

  const { data: teams, error: teamError } = await supabase
    .from("user_fantasy_teams")
    .select(`
      id,
      user_id,
      captain_id,
      vice_captain_id,
      total_credits,
      use_booster,
      user_fantasy_team_players(player_id)
    `)
    .eq("tournament_id", match.tournament_id);

  if (teamError) {
    console.error("Fetching teams failed", teamError);
    return;
  }

  for (const team of teams ?? []) {
    await lockUserTeamForMatch(supabase, match, team);
  }
}

async function lockUserTeamForMatch(supabase: any, match: any, team: any) {
  const { data: existing } = await supabase
    .from("user_match_teams")
    .select("id")
    .eq("user_id", team.user_id)
    .eq("match_id", match.id)
    .maybeSingle();

  if (existing) return;

  const { data: lastSnapshot } = await supabase
    .from("user_match_teams")
    .select(`
      id,
      match_id,
      total_subs_used,
      matches!inner(match_number)
    `)
    .eq("user_id", team.user_id)
    .neq("match_id", match.id)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentPlayers = (team.user_fantasy_team_players ?? []).map((p: any) => p.player_id);
  const previousPlayers = lastSnapshot ? await getSnapshotPlayers(supabase, lastSnapshot.id) : [];

  // 3. Stage-aware sub logic (Updated for IPL Specifics)
  let subsUsed = 0;
  let totalSubsUsed = 0;

  const matchNum = match.match_number;
  const lastMatchNum = lastSnapshot?.matches?.match_number ?? 0;

  // RULE 1: Match 1 is always free (0 subs used)
  if (matchNum === 1) {
    subsUsed = 0;
    totalSubsUsed = 0;
  } 
  // RULE 2: Match 71 is a Full Reset (Unlimited transfers for Playoffs)
  else if (matchNum === PLAYOFF_START) {
    subsUsed = 0;
    totalSubsUsed = 0;
  } 
  // RULE 3: Match 72 starts the 10-sub limit phase
  else if (matchNum === KNOCKOUT_PHASE) {
    subsUsed = currentPlayers.filter((p: string) => !previousPlayers.includes(p)).length;
    totalSubsUsed = subsUsed; // Start fresh count from this match
  } 
  // RULE 4: Standard accumulation for League (M2-M70) or Knockouts (M73-74)
  else if (lastSnapshot) {
    subsUsed = currentPlayers.filter((p: string) => !previousPlayers.includes(p)).length;
    totalSubsUsed = (lastSnapshot.total_subs_used ?? 0) + subsUsed;
  }
  
  let boosterToApply = false;
  if (matchNum >= BOOSTER_WINDOW_START && matchNum <= BOOSTER_WINDOW_END) {
    const { data: boosterState } = await supabase
      .from("user_tournament_points")
      .select("s8_booster_used") 
      .eq("user_id", team.user_id)
      .eq("tournament_id", match.tournament_id)
      .maybeSingle();
    
    const alreadyUsed = boosterState?.s8_booster_used ?? false;
    boosterToApply = !!team.use_booster && !alreadyUsed;
  }

  const { data: snapshot, error } = await supabase
    .from("user_match_teams")
    .insert({
      user_id: team.user_id,
      match_id: match.id,
      tournament_id: match.tournament_id,
      captain_id: team.captain_id,
      vice_captain_id: team.vice_captain_id,
      total_credits: team.total_credits,
      subs_used_for_match: subsUsed,
      total_subs_used: totalSubsUsed,
      use_booster: boosterToApply,
      locked_at: match.actual_start_time,
    })
    .select()
    .single();

  if (error) {
    console.error("Snapshot insert failed", error);
    return;
  }

  if (boosterToApply) {
    await supabase
      .from("user_tournament_points")
      .update({ s8_booster_used: true })
      .eq("user_id", team.user_id)
      .eq("tournament_id", match.tournament_id);
  }

  const rows = currentPlayers.map((playerId: string) => ({
    user_match_team_id: snapshot.id,
    player_id: playerId,
  }));

  await supabase.from("user_match_team_players").insert(rows);
}

async function getSnapshotPlayers(supabase: any, snapshotId: string) {
  const { data } = await supabase
    .from("user_match_team_players")
    .select("player_id")
    .eq("user_match_team_id", snapshotId);

  return data?.map((d) => d.player_id) ?? [];
}