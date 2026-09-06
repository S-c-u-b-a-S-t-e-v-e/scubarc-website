import { json } from "./_lib.js";

export async function onRequestGet({ env, request }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const url = new URL(request.url);
    const tab = url.searchParams.get("tab") || "today";
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
    
    const getContestDay = () => new Date().toISOString().slice(0, 10);
    const today = getContestDay();
    const gameType = "surf";

    let whereClause = "";
    let params = [gameType];
    
    if (tab === "today") {
      whereClause = "l.game_type = ?1 AND l.contest_day = ?2";
      params.push(today);
    } else if (tab === "week") {
      // Last 7 days including today
      const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      whereClause = "l.game_type = ?1 AND l.contest_day >= ?2";
      params.push(weekAgo);
    } else {
      // all-time
      whereClause = "l.game_type = ?1";
    }

    const entries = await env.COMMUNITY_DB.prepare(
      `SELECT l.nickname, l.server_score, l.achieved_at, l.prize_eligible, l.contest_day
       FROM leaderboard l
       JOIN game_runs gr ON gr.run_id = l.run_id AND gr.game_version = 'surf-0.2'
       WHERE ${whereClause}
       ORDER BY l.server_score DESC, l.achieved_at ASC
       LIMIT ?${params.length + 1}`
    ).bind(...params, limit).all();

    // Get stats for the selected tab
    let statsWhere = "";
    let statsParams = [gameType];
    if (tab === "today") {
      statsWhere = "l.game_type = ?1 AND l.contest_day = ?2";
      statsParams.push(today);
    } else if (tab === "week") {
      const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      statsWhere = "l.game_type = ?1 AND l.contest_day >= ?2";
      statsParams.push(weekAgo);
    } else {
      statsWhere = "l.game_type = ?1";
    }

    const [playersToday, runsToday, bestDistance] = await Promise.all([
      env.COMMUNITY_DB.prepare(
        `SELECT COUNT(DISTINCT l.contributor_id) AS n FROM leaderboard l JOIN game_runs gr ON gr.run_id = l.run_id AND gr.game_version = 'surf-0.2' WHERE ${statsWhere}`
      ).bind(...statsParams).first(),
      env.COMMUNITY_DB.prepare(
        `SELECT COUNT(*) AS n FROM leaderboard l JOIN game_runs gr ON gr.run_id = l.run_id AND gr.game_version = 'surf-0.2' WHERE ${statsWhere}`
      ).bind(...statsParams).first(),
      env.COMMUNITY_DB.prepare(
        `SELECT MAX(l.server_score) AS n FROM leaderboard l JOIN game_runs gr ON gr.run_id = l.run_id AND gr.game_version = 'surf-0.2' WHERE ${statsWhere}`
      ).bind(...statsParams).first()
    ]);

    return json({
      entries: (entries.results || []).map((row, idx) => ({
        rank: idx + 1,
        nickname: String(row.nickname).slice(0, 24),
        distance_miles: (Number(row.server_score) / 160934.4).toFixed(2),
        achieved_at: row.achieved_at,
        exhibition: row.prize_eligible === 0,
        contest_day: row.contest_day
      })),
      stats: {
        players_today: Number(playersToday?.n || 0),
        runs_today: Number(runsToday?.n || 0),
        best_distance_miles: bestDistance?.n ? (Number(bestDistance.n) / 160934.4).toFixed(2) : "0.00"
      }
    });
  } catch (_) {
    return json({ error: "leaderboard_unavailable" }, 500);
  }
}