create or replace function public.update_leaderboard_after_match(
  target_match_id uuid,
  p_winner_id uuid,
  p_pom_id uuid
)
returns void
language plpgsql
as $$
declare
  actual_rank_1_user_id uuid;
  v_tournament_id uuid;
begin
  select tournament_id
  into v_tournament_id
  from public.matches
  where id = target_match_id;

  delete from public.user_match_points
  where match_id = target_match_id;

  insert into public.user_match_points (
    user_id,
    match_id,
    tournament_id,
    raw_points,
    captain_bonus,
    vice_captain_bonus,
    total_points
  )
  select
    umt.user_id,
    umt.match_id,
    umt.tournament_id,
    sum(pms.fantasy_points) as raw_points,
    coalesce((
      select pms2.fantasy_points
      from public.player_match_stats pms2
      where pms2.match_id = target_match_id
        and pms2.player_id = umt.captain_id
    ), 0) as captain_bonus,
    floor(coalesce((
      select pms3.fantasy_points
      from public.player_match_stats pms3
      where pms3.match_id = target_match_id
        and pms3.player_id = umt.vice_captain_id
    ), 0) * 0.5) as vice_captain_bonus,
    sum(
      case
        when umt.active_booster = 'TOTAL_2X' then (pms.fantasy_points * 2)
        when umt.active_booster = 'OVERSEAS_2X' and p.category = 'overseas' then (pms.fantasy_points * 2)
        when umt.active_booster = 'UNCAPPED_2X' and p.category = 'uncapped' then (pms.fantasy_points * 2)
        when umt.active_booster = 'CAPPED_2X' and p.category = 'none' then (pms.fantasy_points * 2)
        else pms.fantasy_points
      end
    )
    + (
      case
        when umt.active_booster = 'CAPTAIN_3X' then
          (coalesce((
            select pms2.fantasy_points
            from public.player_match_stats pms2
            where pms2.match_id = target_match_id
              and pms2.player_id = umt.captain_id
          ), 0) * 2)
        when umt.active_booster = 'TOTAL_2X' then
          (coalesce((
            select pms2.fantasy_points
            from public.player_match_stats pms2
            where pms2.match_id = target_match_id
              and pms2.player_id = umt.captain_id
          ), 0) * 2)
        else
          coalesce((
            select pms2.fantasy_points
            from public.player_match_stats pms2
            where pms2.match_id = target_match_id
              and pms2.player_id = umt.captain_id
          ), 0)
      end
    )
    + (
      case
        when umt.active_booster = 'TOTAL_2X' then
          (floor(coalesce((
            select pms3.fantasy_points
            from public.player_match_stats pms3
            where pms3.match_id = target_match_id
              and pms3.player_id = umt.vice_captain_id
          ), 0) * 0.5) * 2)
        else
          floor(coalesce((
            select pms3.fantasy_points
            from public.player_match_stats pms3
            where pms3.match_id = target_match_id
              and pms3.player_id = umt.vice_captain_id
          ), 0) * 0.5)
      end
    ) as total_points
  from public.user_match_teams umt
  join public.user_match_team_players umtp
    on umt.id = umtp.user_match_team_id
  join public.player_match_stats pms
    on pms.match_id = umt.match_id
   and pms.player_id = umtp.player_id
  join public.players p
    on p.id = umtp.player_id
  where umt.match_id = target_match_id
  group by
    umt.user_id,
    umt.match_id,
    umt.tournament_id,
    umt.captain_id,
    umt.vice_captain_id,
    umt.active_booster
  on conflict (user_id, match_id)
  do update set
    raw_points = excluded.raw_points,
    captain_bonus = excluded.captain_bonus,
    vice_captain_bonus = excluded.vice_captain_bonus,
    total_points = excluded.total_points;

  perform public.rebuild_tournament_points(v_tournament_id);

  select user_id
  into actual_rank_1_user_id
  from public.user_tournament_points
  where tournament_id = v_tournament_id
  order by total_points desc, updated_at asc
  limit 1;

  update public.user_predictions
  set
    points_earned = (
      (case when predicted_winner_id = p_winner_id then 1 else -1 end) +
      (case when predicted_mvp_id = p_pom_id then 1 else -1 end) +
      (case when predicted_top_user_id = actual_rank_1_user_id then 1 else -1 end)
    ),
    is_processed = true
  where match_id = target_match_id;
end;
$$;
