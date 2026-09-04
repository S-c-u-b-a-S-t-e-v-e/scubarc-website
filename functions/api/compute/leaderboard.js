import { json } from "../../_lib.js";

export async function onRequestGet({ env, request }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const url = new URL(request.url);
    const contestDay = url.searchParams.get("day");
    const gameType = url.searchParams.get("game") || "surf";
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
    
    const getContestDay = () => new Date().toISOString().slice(0, 10);
    const targetDay = contestDay || getContestDay();

    const entries = await env.COMMUNITY_DB.prepare(
      `SELECT l.nickname, l.server_score, l.achieved_at, l.prize_eligible, c.virginia_opt_in
       FROM leaderboard l
       JOIN contributors c ON c.contributor_id = l.contributor_id
       WHERE l.game_type = ?1 AND l.contest_day = ?2
       ORDER BY l.server_score DESC, l.achieved_at ASC
       LIMIT ?3`
    ).bind(gameType, targetDay, limit).all();

    const allTime = await env.COMMUNITY_DB.prepare(
      `SELECT l.nickname, l.server_score, l.achieved_at, l.prize_eligible, c.virginia_opt_in, l.contest_day
       FROM leaderboard l
       JOIN contributors c ON c.contributor_id = l.contributor_id
       WHERE l.game_type = ?1
       ORDER BY l.server_score DESC, l.achieved_at ASC
       LIMIT 10`
    ).bind(gameType).all();

    return json({
      daily: {
        contest_day: targetDay,
        game_type: gameType,
        leaders: (entries.results || []).map((row, idx) => ({
          rank: idx + 1,
          nickname: String(row.nickname).slice(0, 24),
          distance_cm: Number(row.server_score),
          distance_miles: (Number(row.server_score) / 160934.4).toFixed(2),
          achieved_at: row.achieved_at,
          virginia: row.virginia_opt_in === 1,
          prize_eligible: row.prize_eligible === 1
        }))
      },
      all_time: {
        game_type: gameType,
        leaders: (allTime.results || []).map((row, idx) => ({
          rank: idx + 1,
          nickname: String(row.nickname).slice(0, 24),
          distance_cm: Number(row.server_score),
          distance_miles: (Number(row.server_score) / 160934.4).toFixed(2),
          achieved_at: row.achieved_at,
          contest_day: row.contest_day,
          virginia: row.virginia_opt_in === 1,
          prize_eligible: row.prize_eligible === 1
        }))
      }
    });
  } catch (_) {
    return json({ error: "leaderboard_unavailable" }, 500);
  }
}