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

async function lockUserTeamForMatch(
  supabase: any,
  match: any,
  team: any
) {
  // 1. Prevent double snapshots
  const { data: existing } = await supabase
    .from("user_match_teams")
    .select("id")
    .eq("user_id", team.user_id)
    .eq("match_id", match.id)
    .maybeSingle();

  if (existing) return;

  // 2. Fetch the most recent snapshot for sub-comparison
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

  const previousPlayers = lastSnapshot
    ? await getSnapshotPlayers(supabase, lastSnapshot.id)
    : [];

  const currentPlayers = (team.user_fantasy_team_players ?? []).map(
    (p: any) => p.player_id
  );

  // 3. Stage-aware sub logic
  let subsUsed = 0;
  let totalSubsUsed = 0;

  // Define stage boundaries
  const isSuper8 = match.match_number >= 41 && match.match_number <= 52;
  const isKnockout = match.match_number >= 53;
  const lastMatchNumber = lastSnapshot?.matches?.match_number ?? 0;

  // Reset at Group->Super8 and Super8->Knockout transitions
  const isResetMatch = (isSuper8 && lastMatchNumber < 41) || (isKnockout && lastMatchNumber < 53);

  if (isResetMatch) {
    subsUsed = 0;
    totalSubsUsed = 0;
  } else if (lastSnapshot) {
    subsUsed = currentPlayers.filter(
      (p: string) => !previousPlayers.includes(p)
    ).length;
    totalSubsUsed = (lastSnapshot.total_subs_used ?? 0) + subsUsed;
  }

  // 4. Booster tracking
  let boosterToApply = false;
  if (match.match_number >= 43 && match.match_number <= 52) {
    const { data: boosterState } = await supabase
      .from("user_tournament_points")
      .select("s8_booster_used")
      .eq("user_id", team.user_id)
      .eq("tournament_id", match.tournament_id)
      .maybeSingle();
    const alreadyUsed = boosterState?.s8_booster_used ?? false;
    boosterToApply = !!team.use_booster && !alreadyUsed;
  }

  // 5. Create the Snapshot
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
      use_booster: boosterToApply, // NEW: Locks the booster choice
      locked_at: match.actual_start_time,
    })
    .select()
    .single();

  if (error) {
    console.error("Snapshot insert failed", error);
    return;
  }

  // 6. If Booster was used, mark it permanently in the user's tournament record
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
