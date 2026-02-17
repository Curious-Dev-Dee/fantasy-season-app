import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      // FIX: Now checks against the Actual Start Time (handles rain delays)
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

async function lockUserTeamForMatch(
  supabase: any,
  match: any,
  team: any
) {
  const { data: existing } = await supabase
    .from("user_match_teams")
    .select("id")
    .eq("user_id", team.user_id)
    .eq("match_id", match.id)
    .maybeSingle();

  if (existing) return;

  const { data: lastSnapshot } = await supabase
    .from("user_match_teams")
    .select("id, total_subs_used")
    .eq("user_id", team.user_id)
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousPlayers = lastSnapshot
    ? await getSnapshotPlayers(supabase, lastSnapshot.id)
    : [];

  const currentPlayers = team.user_fantasy_team_players.map(
    (p: any) => p.player_id
  );

  let subsUsed = 0;
  let totalSubsUsed = 0;

  // First ever valid match → NO subs
  if (lastSnapshot) {
    subsUsed = currentPlayers.filter(
      (p: string) => !previousPlayers.includes(p)
    ).length;

    totalSubsUsed = lastSnapshot.total_subs_used + subsUsed;
  }

  if (totalSubsUsed > 80) {
    subsUsed = 0;
    totalSubsUsed = 80;
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
      // FIX: Records the actual time the match locked
      locked_at: match.actual_start_time, 
    })
    .select()
    .single();

  if (error) {
    console.error("Snapshot insert failed", error);
    return;
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