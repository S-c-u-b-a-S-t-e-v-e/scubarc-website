import { json, readJson, newId, authenticateNode } from "../_lib.js";

function getContestDay() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function generateDailySeed(contestDay) {
  let hash = 0;
  const str = `surf-0.2-${contestDay}-genesis-2026`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) >>> 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const body = await readJson(request, 4096);
    const node = await authenticateNode(env, request, String(body.node_id || ""));
    if (!node) return json({ error: "unauthorized_node" }, 401);

    const now = new Date();
    const nowIso = now.toISOString();
    const contestDay = getContestDay();
    const expires = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const seed = generateDailySeed(contestDay);

    await env.COMMUNITY_DB.prepare("UPDATE nodes SET last_seen = ?1 WHERE node_id = ?2").bind(nowIso, node.node_id).run();

    await env.COMMUNITY_DB.prepare(
      "UPDATE game_runs SET status = 'expired' WHERE node_id = ?1 AND game_type = 'surf' AND status = 'active' AND expires_at <= ?2"
    ).bind(node.node_id, nowIso).run();

    // Retire prior rules without deleting historical runs or scores.
    await env.COMMUNITY_DB.prepare(
      "UPDATE game_runs SET status = 'rejected' WHERE node_id = ?1 AND game_type = 'surf' AND status = 'active' AND game_version != 'surf-0.2'"
    ).bind(node.node_id).run();

    const existingRun = await env.COMMUNITY_DB.prepare(
      `SELECT run_id, seed, game_version, status, expires_at FROM game_runs
       WHERE node_id = ?1 AND status = 'active' AND expires_at > ?2 AND game_type = 'surf'
       ORDER BY created_at DESC LIMIT 1`
    ).bind(node.node_id, nowIso).first();

    if (existingRun) {
      if (existingRun.seed !== seed || existingRun.game_version !== "surf-0.2") {
        await env.COMMUNITY_DB.prepare("UPDATE game_runs SET status = 'rejected' WHERE run_id = ?1").bind(existingRun.run_id).run();
      } else {
        return json({
          run_id: existingRun.run_id,
          seed: existingRun.seed,
          contest_day: contestDay,
          game_version: "surf-0.2",
          expires_at: existingRun.expires_at,
          remaining_ms: Math.max(0, Date.parse(existingRun.expires_at) - Date.now()),
          client_version: "cc-game-alpha-0.2",
          reused: true
        });
      }
    }

    const runId = newId("cgr");
    await env.COMMUNITY_DB.prepare(
      `INSERT INTO game_runs
       (run_id, node_id, contributor_id, created_at, expires_at, game_type, game_version, contest_day, seed, status)
       SELECT ?1, ?2, ?3, ?4, ?5, 'surf', 'surf-0.2', ?6, ?7, 'active'
       WHERE NOT EXISTS (SELECT 1 FROM game_runs WHERE node_id = ?2 AND game_type = 'surf'
         AND status = 'active' AND game_version = 'surf-0.2' AND expires_at > ?4 AND seed = ?7)`
    ).bind(runId, node.node_id, node.contributor_id, nowIso, expires, contestDay, seed).run();

    const activeRun = await env.COMMUNITY_DB.prepare(
      `SELECT run_id, expires_at FROM game_runs WHERE node_id = ?1 AND game_type = 'surf'
       AND status = 'active' AND game_version = 'surf-0.2' AND expires_at > ?2 AND seed = ?3 ORDER BY created_at DESC LIMIT 1`
    ).bind(node.node_id, nowIso, seed).first();
    if (!activeRun) return json({ error: "game_start_failed" }, 400);

    return json({
      run_id: activeRun.run_id,
      seed,
      contest_day: contestDay,
      game_version: "surf-0.2",
      expires_at: activeRun.expires_at,
      remaining_ms: Math.max(0, Date.parse(activeRun.expires_at) - Date.now()),
      reused: activeRun.run_id !== runId,
      client_version: "cc-game-alpha-0.2"
    });
  } catch (_) {
    return json({ error: "game_start_failed" }, 400);
  }
}
