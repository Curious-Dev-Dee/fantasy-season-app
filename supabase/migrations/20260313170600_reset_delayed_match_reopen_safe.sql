create or replace function public.reset_delayed_match(
  target_match_id uuid,
  new_start_time timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_snapshot record;
  v_snapshot_ids uuid[] := '{}'::uuid[];
  v_used_boosters text[] := '{}'::text[];
begin
  if new_start_time is null then
    raise exception 'new_start_time is required';
  end if;

  select *
  into v_match
  from public.matches
  where id = target_match_id
  for update;

  if not found then
    raise exception 'Match % not found', target_match_id;
  end if;

  for v_snapshot in
    select id, user_id, active_booster
    from public.user_match_teams
    where match_id = target_match_id
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
  where match_id = target_match_id;

  delete from public.user_match_points
  where match_id = target_match_id;

  delete from public.player_match_stats
  where match_id = target_match_id;

  update public.user_predictions
  set
    is_processed = false,
    points_earned = 0
  where match_id = target_match_id;

  perform public.rebuild_tournament_points(v_match.tournament_id);

  update public.matches
  set
    status = 'upcoming',
    actual_start_time = new_start_time,
    lock_processed = false,
    locked_at = null,
    points_processed = false,
    is_counted_for_fantasy = true,
    winner_id = null,
    man_of_the_match_id = null,
    last_notification_sent = null,
    last_notification_at = null
  where id = target_match_id;
end;
$$;
