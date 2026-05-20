-- ============================================================
-- PPL 2026 — Backend SQL Functions
-- Run once in Supabase SQL Editor
-- ============================================================

-- ── 1. FANTASY POINTS CALCULATOR ────────────────────────────
-- Called after each match: reads ppl_deliveries, writes ppl_player_match_points
CREATE OR REPLACE FUNCTION calculate_ppl_fantasy_points(p_match_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_player RECORD;
  v_runs int; v_balls int; v_fours int; v_sixes int; v_wickets int;
  v_maidens int; v_catches int; v_stumpings int; v_runouts int;
  v_points numeric; v_dismissed_type text; v_innings_id uuid;
  v_economy numeric; v_overs_bowled numeric; v_dot_balls int;
BEGIN
  -- Delete existing points for this match first (safe to re-run)
  DELETE FROM ppl_player_match_points WHERE match_id = p_match_id;

  -- Loop through every player who appeared in this match
  FOR v_player IN
    SELECT DISTINCT p.id, p.name, p.team_id
    FROM ppl_players p
    WHERE p.id IN (
      SELECT DISTINCT batter_id FROM ppl_deliveries WHERE match_id = p_match_id
      UNION
      SELECT DISTINCT bowler_id FROM ppl_deliveries WHERE match_id = p_match_id
      UNION
      SELECT DISTINCT fielder_id FROM ppl_deliveries WHERE match_id = p_match_id AND fielder_id IS NOT NULL
    )
  LOOP
    v_points := 0;

    -- ── BATTING ──
    SELECT
      COALESCE(SUM(runs_off_bat), 0),
      COUNT(*) FILTER (WHERE extra_type IS NULL OR extra_type NOT IN ('wide')),
      COALESCE(SUM(CASE WHEN is_four THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN is_six  THEN 1 ELSE 0 END), 0)
    INTO v_runs, v_balls, v_fours, v_sixes
    FROM ppl_deliveries
    WHERE match_id = p_match_id AND batter_id = v_player.id;

    v_points := v_points + (v_runs * 1);            -- 1pt per run
    v_points := v_points + (v_fours * 1);           -- bonus 1pt per 4
    v_points := v_points + (v_sixes * 2);           -- bonus 2pt per 6

    -- Milestone bonuses
    IF v_runs >= 50 THEN v_points := v_points + 8; END IF;  -- 50+ bonus
    IF v_runs >= 30 AND v_runs < 50 THEN v_points := v_points + 4; END IF; -- 30+ bonus

    -- Strike rate bonus/penalty (min 10 balls)
    IF v_balls >= 10 THEN
      DECLARE v_sr numeric := (v_runs::numeric / v_balls) * 100;
      BEGIN
        IF    v_sr >= 170 THEN v_points := v_points + 6;
        ELSIF v_sr >= 150 THEN v_points := v_points + 4;
        ELSIF v_sr >= 130 THEN v_points := v_points + 2;
        ELSIF v_sr < 60  THEN v_points := v_points - 4;
        ELSIF v_sr < 80  THEN v_points := v_points - 2;
        END IF;
      END;
    END IF;

    -- Duck penalty
    IF v_runs = 0 AND v_balls > 0 THEN
      -- Only if actually dismissed
      IF EXISTS (
        SELECT 1 FROM ppl_deliveries
        WHERE match_id = p_match_id AND is_wicket = true
          AND dismissed_player_id = v_player.id
      ) THEN
        v_points := v_points - 2;
      END IF;
    END IF;

    -- ── BOWLING ──
    SELECT
      COUNT(*) FILTER (WHERE is_wicket = true AND dismissal_type NOT IN ('run out')),
      COUNT(*) FILTER (WHERE extra_type IS NULL OR extra_type NOT IN ('wide','no_ball')),
      COUNT(*) FILTER (WHERE runs_off_bat = 0 AND (extra_type IS NULL))
    INTO v_wickets, v_balls, v_dot_balls
    FROM ppl_deliveries
    WHERE match_id = p_match_id AND bowler_id = v_player.id;

    v_overs_bowled := FLOOR(v_balls::numeric / 6) + (v_balls % 6) / 10.0;

    v_points := v_points + (v_wickets * 20);        -- 20pts per wicket

    -- Wicket haul bonuses
    IF v_wickets >= 4 THEN v_points := v_points + 8;
    ELSIF v_wickets = 3 THEN v_points := v_points + 4;
    END IF;

    -- Economy rate bonus/penalty (min 1 over = 6 balls)
    IF v_balls >= 6 THEN
      v_economy := (SELECT COALESCE(SUM(runs_off_bat + extras), 0)::numeric / NULLIF(v_overs_bowled, 0)
                    FROM ppl_deliveries
                    WHERE match_id = p_match_id AND bowler_id = v_player.id);
      IF    v_economy < 6  THEN v_points := v_points + 6;
      ELSIF v_economy < 7  THEN v_points := v_points + 4;
      ELSIF v_economy < 8  THEN v_points := v_points + 2;
      ELSIF v_economy > 14 THEN v_points := v_points - 4;
      ELSIF v_economy > 12 THEN v_points := v_points - 2;
      END IF;
    END IF;

    -- Maiden over bonus
    -- (a maiden = 6 legal balls with 0 runs off bat and 0 extras)
    SELECT COUNT(*) INTO v_maidens
    FROM (
      SELECT over_number,
        SUM(runs_off_bat + COALESCE(extras,0)) AS over_runs,
        COUNT(*) FILTER (WHERE extra_type IS NULL OR extra_type NOT IN ('wide','no_ball')) AS legal
      FROM ppl_deliveries
      WHERE match_id = p_match_id AND bowler_id = v_player.id
      GROUP BY over_number
      HAVING COUNT(*) FILTER (WHERE extra_type IS NULL OR extra_type NOT IN ('wide','no_ball')) = 6
         AND SUM(runs_off_bat + COALESCE(extras,0)) = 0
    ) maidens;
    v_points := v_points + (v_maidens * 8);

    -- ── FIELDING ──
    SELECT
      COUNT(*) FILTER (WHERE dismissal_type = 'caught' AND fielder_id = v_player.id),
      COUNT(*) FILTER (WHERE dismissal_type = 'stumped' AND fielder_id = v_player.id),
      COUNT(*) FILTER (WHERE dismissal_type = 'run out' AND fielder_id = v_player.id)
    INTO v_catches, v_stumpings, v_runouts
    FROM ppl_deliveries
    WHERE match_id = p_match_id AND fielder_id = v_player.id;

    v_points := v_points + (v_catches   * 8);
    v_points := v_points + (v_stumpings * 10);
    v_points := v_points + (v_runouts   * 6);

    -- 3-catch bonus
    IF v_catches >= 3 THEN v_points := v_points + 4; END IF;

    -- ── INSERT ──
    INSERT INTO ppl_player_match_points (
      match_id, player_id, runs_scored, balls_faced, fours, sixes,
      wickets_taken, overs_bowled, economy_rate, catches, stumpings, run_outs,
      fantasy_points
    ) VALUES (
      p_match_id, v_player.id, v_runs, v_balls, v_fours, v_sixes,
      v_wickets, v_overs_bowled, COALESCE(v_economy, 0),
      v_catches, v_stumpings, v_runouts, v_points
    );

  END LOOP;

  -- ── FANTASY USER SCORES ──
  -- For each user team player, sum their match points → ppl_fantasy_scores
  INSERT INTO ppl_fantasy_scores (user_id, day_id, total_points, rank)
  SELECT
    utp.user_id,
    ut.day_id,
    COALESCE(SUM(
      pmp.fantasy_points *
      CASE WHEN utp.is_captain     THEN 2
           WHEN utp.is_vice_captain THEN 1.5
           ELSE 1 END
    ), 0) AS total_points,
    0 AS rank
  FROM ppl_user_team_players utp
  JOIN ppl_user_teams ut ON ut.id = utp.user_team_id
  JOIN ppl_fantasy_days fd ON fd.id = ut.day_id
  JOIN ppl_player_match_points pmp
    ON pmp.player_id = utp.player_id AND pmp.match_id = p_match_id
  WHERE fd.id IN (
    SELECT day_id FROM ppl_matches WHERE id = p_match_id
      AND day_id IS NOT NULL
    LIMIT 1
  )
  GROUP BY utp.user_id, ut.day_id
  ON CONFLICT (user_id, day_id) DO UPDATE
    SET total_points = ppl_fantasy_scores.total_points + EXCLUDED.total_points;

  -- Update ranks per day
  WITH ranked AS (
    SELECT id, RANK() OVER (PARTITION BY day_id ORDER BY total_points DESC) AS r
    FROM ppl_fantasy_scores
  )
  UPDATE ppl_fantasy_scores fs SET rank = r.r FROM ranked r WHERE fs.id = r.id;

END;
$$;


-- ── 2. POINTS TABLE UPDATER ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_ppl_points_table()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_match RECORD;
  v_inn1 RECORD; v_inn2 RECORD;
  v_winner_id uuid; v_loser_id uuid;
  v_nrr_winner numeric; v_nrr_loser numeric;
BEGIN
  -- Reset all rows to 0 and recalculate from scratch
  UPDATE ppl_points_table SET
    played=0, won=0, lost=0, tied=0, no_result=0, points=0,
    runs_scored=0, balls_faced=0, runs_conceded=0, balls_bowled=0, nrr=0;

  FOR v_match IN
    SELECT * FROM ppl_matches WHERE status = 'completed'
  LOOP
    -- Get both innings
    SELECT * INTO v_inn1 FROM ppl_innings
      WHERE match_id = v_match.id AND innings_number = 1;
    SELECT * INTO v_inn2 FROM ppl_innings
      WHERE match_id = v_match.id AND innings_number = 2;

    IF v_inn1 IS NULL OR v_inn2 IS NULL THEN CONTINUE; END IF;

    v_winner_id := v_match.winner_id;
    v_loser_id  := CASE WHEN v_winner_id = v_match.team_a_id
                        THEN v_match.team_b_id ELSE v_match.team_a_id END;

    -- Update winner row
    UPDATE ppl_points_table SET
      played         = played + 1,
      won            = won + CASE WHEN team_id = v_winner_id THEN 1 ELSE 0 END,
      lost           = lost + CASE WHEN team_id = v_loser_id  THEN 1 ELSE 0 END,
      points         = points + CASE WHEN team_id = v_winner_id THEN 2 ELSE 0 END,
      runs_scored    = runs_scored + CASE WHEN team_id = v_inn1.batting_team_id THEN v_inn1.total_runs ELSE v_inn2.total_runs END,
      balls_faced    = balls_faced + CASE WHEN team_id = v_inn1.batting_team_id
                         THEN FLOOR(v_inn1.total_overs)*6 + ((v_inn1.total_overs - FLOOR(v_inn1.total_overs))*10)::int
                         ELSE FLOOR(v_inn2.total_overs)*6 + ((v_inn2.total_overs - FLOOR(v_inn2.total_overs))*10)::int END,
      runs_conceded  = runs_conceded + CASE WHEN team_id = v_inn1.batting_team_id THEN v_inn2.total_runs ELSE v_inn1.total_runs END,
      balls_bowled   = balls_bowled + CASE WHEN team_id = v_inn1.batting_team_id
                         THEN FLOOR(v_inn2.total_overs)*6 + ((v_inn2.total_overs - FLOOR(v_inn2.total_overs))*10)::int
                         ELSE FLOOR(v_inn1.total_overs)*6 + ((v_inn1.total_overs - FLOOR(v_inn1.total_overs))*10)::int END
    WHERE team_id IN (v_winner_id, v_loser_id);

  END LOOP;

  -- Recalculate NRR for all teams
  UPDATE ppl_points_table SET
    nrr = ROUND(
      CASE WHEN balls_faced > 0 THEN (runs_scored::numeric / NULLIF(balls_faced,0) * 6) ELSE 0 END -
      CASE WHEN balls_bowled > 0 THEN (runs_conceded::numeric / NULLIF(balls_bowled,0) * 6) ELSE 0 END
    , 3)
  WHERE balls_faced > 0 OR balls_bowled > 0;

END;
$$;


-- ── 3. PLAYER STATS UPDATER ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_ppl_player_stats()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Upsert batting + bowling stats from ppl_player_match_points
  INSERT INTO ppl_player_stats (
    player_id, matches, runs, balls_faced, fours, sixes,
    highest_score, fifties, thirties,
    wickets, overs_bowled, runs_conceded, best_bowling,
    catches, stumpings, run_outs, fantasy_points_total
  )
  SELECT
    player_id,
    COUNT(DISTINCT match_id)                              AS matches,
    COALESCE(SUM(runs_scored),0)                         AS runs,
    COALESCE(SUM(balls_faced),0)                         AS balls_faced,
    COALESCE(SUM(fours),0)                               AS fours,
    COALESCE(SUM(sixes),0)                               AS sixes,
    COALESCE(MAX(runs_scored),0)                         AS highest_score,
    COUNT(*) FILTER (WHERE runs_scored >= 50)            AS fifties,
    COUNT(*) FILTER (WHERE runs_scored >= 30 AND runs_scored < 50) AS thirties,
    COALESCE(SUM(wickets_taken),0)                       AS wickets,
    COALESCE(SUM(overs_bowled),0)                        AS overs_bowled,
    COALESCE(SUM(runs_conceded_batting),0)               AS runs_conceded,
    MAX(wickets_taken || '/' || runs_conceded_batting)   AS best_bowling,
    COALESCE(SUM(catches),0)                             AS catches,
    COALESCE(SUM(stumpings),0)                           AS stumpings,
    COALESCE(SUM(run_outs),0)                            AS run_outs,
    COALESCE(SUM(fantasy_points),0)                      AS fantasy_points_total
  FROM ppl_player_match_points
  GROUP BY player_id
  ON CONFLICT (player_id) DO UPDATE SET
    matches               = EXCLUDED.matches,
    runs                  = EXCLUDED.runs,
    balls_faced           = EXCLUDED.balls_faced,
    fours                 = EXCLUDED.fours,
    sixes                 = EXCLUDED.sixes,
    highest_score         = EXCLUDED.highest_score,
    fifties               = EXCLUDED.fifties,
    thirties              = EXCLUDED.thirties,
    wickets               = EXCLUDED.wickets,
    overs_bowled          = EXCLUDED.overs_bowled,
    runs_conceded         = EXCLUDED.runs_conceded,
    best_bowling          = EXCLUDED.best_bowling,
    catches               = EXCLUDED.catches,
    stumpings             = EXCLUDED.stumpings,
    run_outs              = EXCLUDED.run_outs,
    fantasy_points_total  = EXCLUDED.fantasy_points_total;
END;
$$;