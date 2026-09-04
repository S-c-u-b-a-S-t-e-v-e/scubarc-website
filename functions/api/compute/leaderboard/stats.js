import { json } from "./_lib.js";

export async function onRequestGet({ env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const getContestDay = () => new Date().toISOString().slice(0, 10);
    const today = getContestDay();
    const gameType = "surf";

    const [playersToday, runsToday, bestDistance] = await Promise.all([
      env.COMMUNITY_DB.prepare(
        `SELECT COUNT(DISTINCT l.contributor_id) AS n FROM leaderboard l 
         WHERE l.game_type = ?1 AND l.contest_day = ?2`
      ).bind(gameType, today).first(),
      env.COMMUNITY_DB.prepare(
        `SELECT COUNT(*) AS n FROM leaderboard l 
         WHERE l.game_type = ?1 AND l.contest_day = ?2`
      ).bind(gameType, today).first(),
      env.COMMUNITY_DB.prepare(
        `SELECT MAX(l.server_score) AS n FROM leaderboard l 
         WHERE l.game_type = ?1 AND l.contest_day = ?2`
      ).bind(gameType, today).first()
    ]);

    return json({
      players_today: Number(playersToday?.n || 0),
      runs_today: Number(runsToday?.n || 0),
      best_distance_miles: bestDistance?.n ? (Number(bestDistance.n) / 160934.4).toFixed(2) : "0.00"
    });
  } catch (_) {
    return json({ error: "stats_unavailable" }, 500);
  }
}