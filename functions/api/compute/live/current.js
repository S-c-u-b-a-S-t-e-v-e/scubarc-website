import { json } from "../../_lib.js";

export async function onRequestGet({ env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const getContestDay = () => new Date().toISOString().slice(0, 10);
    const today = getContestDay();
    const gameType = "surf";

    // Get recent active runs (last 30 minutes)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const [activeRuns, recentCompletions, todayLeader] = await Promise.all([
      env.COMMUNITY_DB.prepare(
        `SELECT gr.run_id, gr.node_id, gr.contest_day, gr.seed, gr.created_at, gr.distance_cm,
                c.display_name, c.virginia_opt_in
         FROM game_runs gr
         JOIN contributors c ON c.contributor_id = gr.contributor_id
         WHERE gr.game_type = ?1 AND gr.status = 'active' 
           AND gr.created_at > ?2 AND gr.expires_at > datetime('now')
         ORDER BY gr.created_at DESC
         LIMIT 20`
      ).bind(gameType, thirtyMinAgo).all(),
      env.COMMUNITY_DB.prepare(
        `SELECT gr.run_id, gr.distance_cm, gr.terminal_reason, gr.completed_at,
                l.nickname, l.prize_eligible, c.virginia_opt_in
         FROM game_runs gr
         JOIN leaderboard l ON l.run_id = gr.run_id
         JOIN contributors c ON c.contributor_id = gr.contributor_id
         WHERE gr.game_type = ?1 AND gr.status = 'completed'
           AND gr.completed_at > ?2
         ORDER BY gr.completed_at DESC
         LIMIT 10`
      ).bind(gameType, thirtyMinAgo).all(),
      env.COMMUNITY_DB.prepare(
        `SELECT l.nickname, l.server_score, l.achieved_at, l.prize_eligible, c.virginia_opt_in
         FROM leaderboard l
         JOIN contributors c ON c.contributor_id = l.contributor_id
         WHERE l.game_type = ?1 AND l.contest_day = ?2
         ORDER BY l.server_score DESC, l.achieved_at ASC
         LIMIT 1`
      ).bind(gameType, today).first()
    ]);

    return json({
      contest_day: today,
      active_players: (activeRuns.results || []).map(row => ({
        run_id: row.run_id,
        nickname: row.display_name || "Anonymous",
        distance_miles: (Number(row.distance_cm || 0) / 160934.4).toFixed(2),
        started_at: row.created_at,
        virginia: row.virginia_opt_in === 1
      })),
      recent_completions: (recentCompletions.results || []).map(row => ({
        run_id: row.run_id,
        nickname: row.nickname,
        distance_miles: (Number(row.distance_cm || 0) / 160934.4).toFixed(2),
        reason: row.terminal_reason,
        completed_at: row.completed_at,
        exhibition: row.prize_eligible === 0,
        virginia: row.virginia_opt_in === 1
      })),
      current_leader: todayLeader ? {
        nickname: todayLeader.nickname,
        distance_miles: (Number(todayLeader.server_score) / 160934.4).toFixed(2),
        achieved_at: todayLeader.achieved_at,
        exhibition: todayLeader.prize_eligible === 0,
        virginia: todayLeader.virginia_opt_in === 1
      } : null
    });
  } catch (_) {
    return json({ error: "live_unavailable" }, 500);
  }
}