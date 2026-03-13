create or replace function public.rebuild_tournament_points(
  p_tournament_id uuid
)
returns void
language plpgsql
as $$
begin
  update public.user_tournament_points
  set
    total_points = 0,
    matches_counted = 0,
    updated_at = now()
  where tournament_id = p_tournament_id;

  insert into public.user_tournament_points (
    user_id,
    tournament_id,
    total_points,
    matches_counted,
    updated_at
  )
  select
    ump.user_id,
    ump.tournament_id,
    sum(ump.total_points),
    count(ump.match_id),
    now()
  from public.user_match_points ump
  where ump.tournament_id = p_tournament_id
  group by ump.user_id, ump.tournament_id
  on conflict (user_id, tournament_id)
  do update set
    total_points = excluded.total_points,
    matches_counted = excluded.matches_counted,
    updated_at = now();
end;
$$;
