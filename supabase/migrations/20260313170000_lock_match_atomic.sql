create or replace function public.lock_match_atomic(
  p_match_id uuid,
  p_playoff_start integer,
  p_knockout_phase integer,
  p_booster_window_start integer,
  p_booster_window_end integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_team record;
  v_current_player jsonb;
  v_existing_snapshot_id uuid;
  v_last_snapshot_id uuid;
  v_snapshot_id uuid;
  v_current_ids uuid[] := '{}'::uuid[];
  v_previous_player_ids uuid[] := '{}'::uuid[];
  v_used_boosters text[] := '{}'::text[];
  v_last_total_subs_used integer := 0;
  v_raw_change_count integer := 0;
  v_subs_used integer := 0;
  v_total_subs_used integer := 0;
  v_snapshots_created integer := 0;
  v_has_uncapped_discount boolean := false;
  v_final_booster text := 'NONE';
begin
  select *
  into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match % not found', p_match_id;
  end if;

  if v_match.actual_start_time is null then
    raise exception 'Match % has no actual_start_time', p_match_id;
  end if;

  if v_match.status <> 'upcoming'
     or coalesce(v_match.lock_processed, false)
     or v_match.actual_start_time > now() then
    return jsonb_build_object(
      'locked', false,
      'match_id', v_match.id,
      'reason', 'not_due_or_already_processed'
    );
  end if;

  for v_team in
    select
      uft.id,
      uft.user_id,
      uft.captain_id,
      uft.vice_captain_id,
      uft.total_credits,
      coalesce(uft.active_booster, 'NONE') as active_booster,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', uftp.player_id,
            'category', p.category
          )
          order by uftp.player_id
        ) filter (where uftp.player_id is not null),
        '[]'::jsonb
      ) as current_players
    from public.user_fantasy_teams uft
    left join public.user_fantasy_team_players uftp
      on uftp.user_fantasy_team_id = uft.id
    left join public.players p
      on p.id = uftp.player_id
    where uft.tournament_id = v_match.tournament_id
    group by
      uft.id,
      uft.user_id,
      uft.captain_id,
      uft.vice_captain_id,
      uft.total_credits,
      uft.active_booster
  loop
    v_existing_snapshot_id := null;
    select umt.id
    into v_existing_snapshot_id
    from public.user_match_teams umt
    where umt.user_id = v_team.user_id
      and umt.match_id = v_match.id
    limit 1;

    if v_existing_snapshot_id is not null then
      continue;
    end if;

    v_last_snapshot_id := null;
    v_last_total_subs_used := 0;
    select
      umt.id,
      coalesce(umt.total_subs_used, 0)
    into
      v_last_snapshot_id,
      v_last_total_subs_used
    from public.user_match_teams umt
    where umt.user_id = v_team.user_id
      and umt.match_id <> v_match.id
    order by umt.locked_at desc
    limit 1;

    if v_last_snapshot_id is not null then
      select coalesce(array_agg(umtp.player_id order by umtp.player_id), '{}'::uuid[])
      into v_previous_player_ids
      from public.user_match_team_players umtp
      where umtp.user_match_team_id = v_last_snapshot_id;
    else
      v_previous_player_ids := '{}'::uuid[];
    end if;

    v_current_ids := '{}'::uuid[];
    for v_current_player in
      select value
      from jsonb_array_elements(v_team.current_players)
    loop
      v_current_ids := array_append(v_current_ids, (v_current_player ->> 'id')::uuid);
    end loop;

    select
      count(*),
      coalesce(bool_or((player.value ->> 'category') = 'uncapped'), false)
    into
      v_raw_change_count,
      v_has_uncapped_discount
    from jsonb_array_elements(v_team.current_players) as player(value)
    where not ((player.value ->> 'id')::uuid = any(v_previous_player_ids));

    if v_match.match_number = 1 or v_match.match_number = p_playoff_start then
      v_subs_used := 0;
    else
      v_subs_used := case
        when v_has_uncapped_discount and v_raw_change_count > 0 then v_raw_change_count - 1
        else v_raw_change_count
      end;
    end if;

    v_final_booster := 'NONE';
    if v_match.match_number between p_booster_window_start and p_booster_window_end
       and v_team.active_booster <> 'NONE' then
      v_used_boosters := '{}'::text[];
      select coalesce(utp.used_boosters, '{}'::text[])
      into v_used_boosters
      from public.user_tournament_points utp
      where utp.user_id = v_team.user_id
        and utp.tournament_id = v_match.tournament_id
      for update;

      if not (v_team.active_booster = any(v_used_boosters)) then
        v_final_booster := v_team.active_booster;

        if v_final_booster = 'FREE_11' then
          v_subs_used := 0;
        end if;

        update public.user_tournament_points utp
        set used_boosters = array_append(v_used_boosters, v_final_booster)
        where utp.user_id = v_team.user_id
          and utp.tournament_id = v_match.tournament_id;
      end if;
    end if;

    if v_match.match_number = 1 or v_match.match_number = p_playoff_start then
      v_total_subs_used := 0;
    elsif v_match.match_number = p_knockout_phase then
      v_total_subs_used := v_subs_used;
    elsif v_last_snapshot_id is not null then
      v_total_subs_used := v_last_total_subs_used + v_subs_used;
    else
      v_total_subs_used := 0;
    end if;

    insert into public.user_match_teams (
      user_id,
      match_id,
      tournament_id,
      captain_id,
      vice_captain_id,
      total_credits,
      subs_used_for_match,
      total_subs_used,
      active_booster,
      locked_at
    )
    values (
      v_team.user_id,
      v_match.id,
      v_match.tournament_id,
      v_team.captain_id,
      v_team.vice_captain_id,
      v_team.total_credits,
      v_subs_used,
      v_total_subs_used,
      v_final_booster,
      v_match.actual_start_time
    )
    returning id into v_snapshot_id;

    if cardinality(v_current_ids) > 0 then
      insert into public.user_match_team_players (
        user_match_team_id,
        player_id
      )
      select
        v_snapshot_id,
        player_id
      from unnest(v_current_ids) as player_id;
    end if;

    v_snapshots_created := v_snapshots_created + 1;
  end loop;

  update public.matches
  set
    status = 'locked',
    lock_processed = true,
    locked_at = now()
  where id = v_match.id;

  return jsonb_build_object(
    'locked', true,
    'match_id', v_match.id,
    'snapshots_created', v_snapshots_created
  );
end;
$$;
