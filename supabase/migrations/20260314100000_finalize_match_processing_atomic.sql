create or replace function public.finalize_match_processing_atomic(
  p_match_id uuid,
  p_tournament_id uuid,
  p_stats_rows jsonb,
  p_winner_id uuid,
  p_pom_id uuid,
  p_is_abandoned boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_snapshot record;
  v_snapshot_ids uuid[] := '{}'::uuid[];
  v_used_boosters text[] := '{}'::text[];
  v_processed_rows integer := 0;
begin
  select *
  into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match % not found', p_match_id;
  end if;

  if p_tournament_id is not null and p_tournament_id <> v_match.tournament_id then
    raise exception 'Tournament mismatch for match %', p_match_id;
  end if;

  if p_is_abandoned then
    if jsonb_typeof(coalesce(p_stats_rows, '[]'::jsonb)) <> 'array' then
      raise exception 'p_stats_rows must be a JSON array';
    end if;

    if jsonb_array_length(coalesce(p_stats_rows, '[]'::jsonb)) > 0 then
      raise exception 'Abandoned-before-start matches must not include scoreboard rows';
    end if;

    for v_snapshot in
      select id, user_id, active_booster
      from public.user_match_teams
      where match_id = p_match_id
    loop
      v_snapshot_ids := array_append(v_snapshot_ids, v_snapshot.id);

      if v_snapshot.active_booster is not null and v_snapshot.active_booster <> 'NONE' then
        select coalesce(utp.used_boosters, '{}'::text[])
        into v_used_boosters
        from public.user_tournament_points utp
        where utp.user_id = v_snapshot.user_id
          and utp.tournament_id = v_match.tournament_id
        for update;

        if v_snapshot.active_booster = any(v_used_boosters) then
          update public.user_tournament_points
          set used_boosters = array_remove(v_used_boosters, v_snapshot.active_booster)
          where user_id = v_snapshot.user_id
            and tournament_id = v_match.tournament_id;
        end if;
      end if;
    end loop;

    if cardinality(v_snapshot_ids) > 0 then
      delete from public.user_match_team_players
      where user_match_team_id = any(v_snapshot_ids);
    end if;

    delete from public.user_match_teams
    where match_id = p_match_id;

    delete from public.player_match_stats
    where match_id = p_match_id;

    delete from public.user_match_points
    where match_id = p_match_id;

    update public.user_predictions
    set
      points_earned = 0,
      is_processed = true
    where match_id = p_match_id;

    perform public.rebuild_tournament_points(v_match.tournament_id);

    update public.matches
    set
      points_processed = false,
      is_counted_for_fantasy = false,
      winner_id = null,
      man_of_the_match_id = null,
      status = 'abandoned',
      lock_processed = false,
      locked_at = null
    where id = p_match_id;

    return jsonb_build_object(
      'success', true,
      'processed_rows', 0,
      'mode', 'abandoned_before_start'
    );
  end if;

  if p_winner_id is null then
    raise exception 'p_winner_id is required for a scored match';
  end if;

  if p_pom_id is null then
    raise exception 'p_pom_id is required for a scored match';
  end if;

  if jsonb_typeof(coalesce(p_stats_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_stats_rows must be a JSON array';
  end if;

  v_processed_rows := jsonb_array_length(coalesce(p_stats_rows, '[]'::jsonb));

  if v_processed_rows = 0 then
    raise exception 'Scoreboard has no valid player rows';
  end if;

  delete from public.player_match_stats
  where match_id = p_match_id;

  insert into public.player_match_stats (
    match_id,
    player_id,
    runs,
    balls,
    fours,
    sixes,
    wickets,
    overs,
    runs_conceded,
    maidens,
    catches,
    stumpings,
    runouts_direct,
    runouts_assisted,
    is_player_of_match,
    is_out,
    sr_points,
    er_points,
    milestone_points,
    boundary_points,
    duck_penalty,
    involvement_points,
    fantasy_points
  )
  select
    p_match_id,
    (stat ->> 'player_id')::uuid,
    coalesce((stat ->> 'runs')::integer, 0),
    coalesce((stat ->> 'balls')::integer, 0),
    coalesce((stat ->> 'fours')::integer, 0),
    coalesce((stat ->> 'sixes')::integer, 0),
    coalesce((stat ->> 'wickets')::integer, 0),
    coalesce((stat ->> 'overs')::numeric, 0),
    coalesce((stat ->> 'runs_conceded')::integer, 0),
    coalesce((stat ->> 'maidens')::integer, 0),
    coalesce((stat ->> 'catches')::integer, 0),
    coalesce((stat ->> 'stumpings')::integer, 0),
    coalesce((stat ->> 'runouts_direct')::integer, 0),
    coalesce((stat ->> 'runouts_assisted')::integer, 0),
    coalesce((stat ->> 'is_player_of_match')::boolean, false),
    coalesce((stat ->> 'is_out')::boolean, false),
    coalesce((stat ->> 'sr_points')::integer, 0),
    coalesce((stat ->> 'er_points')::integer, 0),
    coalesce((stat ->> 'milestone_points')::integer, 0),
    coalesce((stat ->> 'boundary_points')::integer, 0),
    coalesce((stat ->> 'duck_penalty')::integer, 0),
    coalesce((stat ->> 'involvement_points')::integer, 0),
    coalesce((stat ->> 'fantasy_points')::integer, 0)
  from jsonb_array_elements(p_stats_rows) as stat;

  update public.user_predictions
  set
    is_processed = false,
    points_earned = 0
  where match_id = p_match_id;

  perform public.update_leaderboard_after_match(
    p_match_id,
    p_winner_id,
    p_pom_id
  );

  update public.matches
  set
    points_processed = true,
    is_counted_for_fantasy = true,
    winner_id = p_winner_id,
    man_of_the_match_id = p_pom_id,
    status = 'locked'
  where id = p_match_id;

  return jsonb_build_object(
    'success', true,
    'processed_rows', v_processed_rows,
    'mode', 'scored_match'
  );
end;
$$;
