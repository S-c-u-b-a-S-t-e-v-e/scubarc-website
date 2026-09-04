import { json, readJson, newId, clampInt, mix32, authenticateNode } from "./_lib.js";

function randomSeed() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] >>> 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const body = await readJson(request, 2048);
    const node = await authenticateNode(env, request, String(body.node_id || ""));
    if (!node) return json({ error: "unauthorized_node" }, 401);

    const now = new Date();
    const nowIso = now.toISOString();
    const expires = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    await env.COMMUNITY_DB.prepare("UPDATE nodes SET last_seen = ?1 WHERE node_id = ?2").bind(nowIso, node.node_id).run();

    let work = await env.COMMUNITY_DB.prepare(
      `SELECT w.work_id, w.seed, w.iterations, w.expected_result, w.work_type,
              COUNT(a.assignment_id) AS assigned_count
       FROM work_units w
       LEFT JOIN assignments a ON a.work_id = w.work_id
       WHERE w.status = 'open'
         AND w.expires_at > ?1
         AND NOT EXISTS (
           SELECT 1 FROM assignments ax WHERE ax.work_id = w.work_id AND ax.node_id = ?2
         )
       GROUP BY w.work_id
       HAVING assigned_count < w.replication_factor
       ORDER BY w.created_at ASC
       LIMIT 1`
    ).bind(nowIso, node.node_id).first();

    if (!work) {
      const workId = newId("ccw");
      const seed = randomSeed();
      const baseIterations = node.device_class === "mobile" ? 180000 : 650000;
      const iterations = clampInt(baseIterations + (node.logical_processors || 1) * 7500, 100000, 1500000, baseIterations);
      const expected = mix32(seed, iterations);
      await env.COMMUNITY_DB.prepare(
        `INSERT INTO work_units
         (work_id, created_at, expires_at, work_type, seed, iterations, expected_result, replication_factor, verified_count, status)
         VALUES (?1, ?2, ?3, 'mix32_v1', ?4, ?5, ?6, 3, 0, 'open')`
      ).bind(workId, nowIso, expires, seed, iterations, expected).run();
      work = { work_id: workId, seed, iterations, expected_result: expected, work_type: "mix32_v1" };
    }

    const assignmentId = newId("cca");
    await env.COMMUNITY_DB.prepare(
      `INSERT INTO assignments
       (assignment_id, work_id, node_id, issued_at, expires_at, status)
       VALUES (?1, ?2, ?3, ?4, ?5, 'issued')`
    ).bind(assignmentId, work.work_id, node.node_id, nowIso, expires).run();

    return json({
      work_id: work.work_id,
      work_type: work.work_type,
      seed: Number(work.seed),
      iterations: Number(work.iterations),
      expires_at: expires,
      max_result_bytes: 2048,
      client_version: "cc-alpha-0.1"
    });
  } catch (_) {
    return json({ error: "work_assignment_failed" }, 400);
  }
}
