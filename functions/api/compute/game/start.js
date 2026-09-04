import { json, readJson, newId, authenticateNode } from "../_lib.js";

function getContestDay() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function generateDailySeed(contestDay) {
  let hash = 0;
  const str = `surf-${contestDay}-genesis-2026`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) >>> 0;
}

function generateCourse(seed) {
  const obstacles = [];
  const random = mulberry32(seed);
  let distanceCm = 0;
  const maxObstacles = 500;
  const baseGap = 200;
  
  for (let i = 0; i < maxObstacles; i++) {
    const lane = Math.floor(random() * 3);
    const gap = baseGap + Math.floor(random() * 300);
    distanceCm += gap * 100;
    const type = Math.floor(random() * 3);
    obstacles.push({
      id: i,
      distance_cm: distanceCm,
      lane,
      type,
      width_cm: 80 + Math.floor(random() * 40)
    });
    
    if (distanceCm > 2000000) break;
  }
  return obstacles;
}

function mulberry32(a) {
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
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

    const existingRun = await env.COMMUNITY_DB.prepare(
      `SELECT run_id, seed, status, expires_at FROM game_runs
       WHERE node_id = ?1 AND status = 'active' AND expires_at > ?2 AND game_type = 'surf'
       ORDER BY created_at DESC LIMIT 1`
    ).bind(node.node_id, nowIso).first();

    if (existingRun) {
      if (existingRun.seed !== seed) {
        await env.COMMUNITY_DB.prepare("UPDATE game_runs SET status = 'rejected' WHERE run_id = ?1").bind(existingRun.run_id).run();
      } else {
        return json({
          run_id: existingRun.run_id,
          seed: existingRun.seed,
          contest_day: contestDay,
          game_version: "surf-0.1",
          expires_at: existingRun.expires_at,
          client_version: "cc-game-alpha-0.1",
          reused: true
        });
      }
    }

    const runId = newId("cgr");
    await env.COMMUNITY_DB.prepare(
      `INSERT INTO game_runs
       (run_id, node_id, contributor_id, created_at, expires_at, game_type, game_version, contest_day, seed, status)
       VALUES (?1, ?2, ?3, ?4, ?5, 'surf', 'surf-0.1', ?6, ?7, 'active')`
    ).bind(runId, node.node_id, node.contributor_id, nowIso, expires, contestDay, seed).run();

    return json({
      run_id: runId,
      seed,
      contest_day: contestDay,
      game_version: "surf-0.1",
      expires_at: expires,
      client_version: "cc-game-alpha-0.1"
    });
  } catch (_) {
    return json({ error: "game_start_failed" }, 400);
  }
}